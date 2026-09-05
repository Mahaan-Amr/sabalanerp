import { createPerformanceCorrection } from './personnelPerformanceDisclosureStore';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type PerformancePrivacyCase } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, persistPerformancePayload, readPerformancePayload } from './personnelPerformancePayloadStore';

type Client = PrismaClient | Prisma.TransactionClient;
const privacyError = (message: string, code = 'PERFORMANCE_PRIVACY_UNAVAILABLE', status = 404) => Object.assign(new Error(message), { code, status });
const unavailable = () => privacyError('پرونده درخواست برای شما قابل دسترسی نیست.');
const inTransaction = async <T>(client: Client, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  if (!('$transaction' in client)) return work(client);
  for (let attempt = 0; ; attempt++) {
    try { return await client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 }); }
    catch (error) { if (attempt >= 2 || !(error && typeof error === 'object' && 'code' in error && error.code === 'P2034')) throw error; }
  }
};
const workingDeadline = (from: Date, days: number) => {
  const deadline = new Date(from);
  while (days > 0) {
    deadline.setUTCDate(deadline.getUTCDate() + 1);
    if (new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', weekday: 'short' }).format(deadline) !== 'Fri') days--;
  }
  return deadline;
};
const requirePermission = async (client: Client, actorId: string, permission: string) => {
  const permissions = await activeHrActionPermissionsForUser(client, actorId);
  if (!permissions.includes(permission)) throw unavailable();
  return { actorUserId: actorId, permission, effectivePermissions: permissions.sort(), resolvedAt: new Date().toISOString() };
};
const mayRead = async (client: Client, actorId: string, subjectId: string, permission = 'VIEW_PERFORMANCE_PRIVACY_CASE') => {
  const [actor, subject] = await Promise.all([
    client.user.findUnique({ where: { id: actorId }, select: { isActive: true, personnelId: true } }),
    client.performanceSubject.findUnique({ where: { id: subjectId }, select: { personnelId: true } }),
  ]);
  if (!actor?.isActive || !subject) throw unavailable();
  if (actor.personnelId && actor.personnelId === subject.personnelId) return { actorUserId: actorId, subjectId, personnelId: actor.personnelId, authority: 'SUBJECT_OWNERSHIP', resolvedAt: new Date().toISOString() };
  return requirePermission(client, actorId, permission);
};
const publicCase = (record: PerformancePrivacyCase) => ({
  id: record.id, requestKind: record.requestKind, status: record.status, requestedAt: record.requestedAt,
  acknowledgeBy: record.acknowledgeBy, verifyBy: record.verifyBy, respondBy: record.respondBy,
  restrictionBy: record.requestKind === 'CORRECTION' ? workingDeadline(record.requestedAt, 1) : null,
  extensionCount: record.extensionCount, closedAt: record.closedAt, version: record.version,
});
const appendDecision = (tx: Prisma.TransactionClient, record: PerformancePrivacyCase, actorUserId: string, action: string, reasonCode: string, contentHash: string, authority: unknown) => tx.performancePrivacyDecision.create({ data: {
  caseId: record.id, version: record.version, action, actorUserId,
  authorityHash: canonicalPerformanceHash(authority), reasonCode, contentHash,
} });

export const requestPerformancePrivacy = async (client: Client, input: {
  actorUserId: string; subjectId: string; requestKind: 'ACCESS' | 'CORRECTION' | 'ERASURE';
  evaluationIds: string[]; reason: string; requestId?: string; now?: Date;
}) => inTransaction(client, async (tx) => {
  const authority = await mayRead(tx, input.actorUserId, input.subjectId, 'REQUEST_PERFORMANCE_PRIVACY_CASE');
  if (!['ACCESS', 'CORRECTION', 'ERASURE'].includes(input.requestKind) || typeof input.reason !== 'string'
    || input.reason.trim().length < 5 || input.reason.length > 4000 || !Array.isArray(input.evaluationIds)
    || input.evaluationIds.some((id) => typeof id !== 'string' || !id) || input.evaluationIds.length > 1000) {
    throw privacyError('نوع درخواست، دلیل و دامنه معتبر را ثبت کنید.', 'PERFORMANCE_PRIVACY_INVALID', 422);
  }
  const now = input.now ?? new Date();
  const id = input.requestId ?? randomUUID();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-privacy:' + id},0))`;
  const requestHash = canonicalPerformanceHash({ subjectId: input.subjectId, requestKind: input.requestKind, reason: input.reason.trim(), evaluationIds: [...new Set(input.evaluationIds)].sort() });
  const existing = await tx.performancePrivacyCase.findUnique({ where: { id } });
  if (existing) {
    const payload = await tx.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: existing.encryptedRequestId } });
    const expected = { reason: input.reason.trim(), requestKind: input.requestKind, scopeHash: existing.scopeHash, requestHash };
    if (existing.requestedByUserId !== input.actorUserId || existing.subjectId !== input.subjectId || payload.plaintextHash !== canonicalPerformanceHash(expected)) {
      throw privacyError('شناسه تکرار به درخواست دیگری تعلق دارد.', 'PERFORMANCE_PRIVACY_RETRY_CONFLICT', 409);
    }
    return publicCase(existing);
  }
  const requestedIds = input.evaluationIds.length ? input.evaluationIds
    : (await tx.performanceEvaluation.findMany({ where: { subjectId: input.subjectId }, select: { id: true }, take: 1001 })).map(({ id }) => id);
  if (requestedIds.length > 1000) throw privacyError('دامنه درخواست را به دوره‌های کوچک‌تر تقسیم کنید.', 'PERFORMANCE_PRIVACY_SCOPE_TOO_LARGE', 422);
  const ids = [...new Set(requestedIds)].sort();
  const scope = await tx.performanceEvaluation.findMany({ where: { id: { in: ids }, subjectId: input.subjectId }, select: { id: true } });
  if (scope.length !== ids.length) throw unavailable();
  const scopeHash = canonicalPerformanceHash({ subjectId: input.subjectId, evaluationIds: ids });
  const request = { reason: input.reason.trim(), requestKind: input.requestKind, scopeHash, requestHash };
  const encrypted = await persistPerformancePayload(tx, {
    aggregateType: 'PERFORMANCE_PRIVACY_CASE', aggregateId: id, payloadKind: 'REQUEST', schemaVersion: 1,
    payload: request, keyring: performanceVaultKeyFromEnvironment(),
  });
  const record = await tx.performancePrivacyCase.create({ data: {
    id, subjectId: input.subjectId, requestKind: input.requestKind, requestedByUserId: input.actorUserId, requestedAt: now,
    acknowledgeBy: workingDeadline(now, 3), verifyBy: workingDeadline(now, 5), respondBy: workingDeadline(now, 15),
    scopeHash, encryptedRequestId: encrypted.id,
  } });
  if (ids.length) await tx.performancePrivacyScope.createMany({ data: ids.map((evaluationId) => ({ caseId: id, evaluationId })) });
  await appendDecision(tx, record, input.actorUserId, 'REQUEST', 'SUBJECT_REQUEST', canonicalPerformanceHash(request), authority);
  return publicCase(record);
});

export const getPerformancePrivacyCase = async (client: Client, actorUserId: string, caseId: string) => {
  const record = await client.performancePrivacyCase.findUnique({ where: { id: caseId } });
  if (!record) throw unavailable();
  await mayRead(client, actorUserId, record.subjectId);
  const response = record.encryptedResponseId
    ? await readPerformancePayload<unknown>(client, record.encryptedResponseId, performanceVaultKeyFromEnvironment()) : null;
  const reviewer = (await activeHrActionPermissionsForUser(client, actorUserId)).includes('VIEW_PERFORMANCE_PRIVACY_CASE');
  const request = reviewer ? await readPerformancePayload<unknown>(client, record.encryptedRequestId, performanceVaultKeyFromEnvironment()) : undefined;
  const scope = reviewer ? await client.performancePrivacyScope.findMany({ where: { caseId }, select: { evaluationId: true } }) : undefined;
  return { ...publicCase(record), response, ...(reviewer ? { request, scope, subjectId: record.subjectId, requestedByUserId: record.requestedByUserId } : {}) };
};

const responsePermission = (kind: string) => ({
  ACCESS: 'DECIDE_PERFORMANCE_PRIVACY_ACCESS', CORRECTION: 'DECIDE_PERFORMANCE_PRIVACY_CORRECTION', ERASURE: 'DECIDE_PERFORMANCE_ERASURE',
}[kind] ?? '');

export const actOnPerformancePrivacyCase = async (client: Client, input: {
  actorUserId: string; caseId: string; expectedVersion: number;
  action: 'ACKNOWLEDGE' | 'VERIFY' | 'EXTEND' | 'OPEN_CORRECTION' | 'RESPOND' | 'CLOSE'; reasonCode: string;
}) => inTransaction(client, async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-privacy:' + input.caseId},0))`;
  const record = await tx.performancePrivacyCase.findUnique({ where: { id: input.caseId } });
  if (!record) throw unavailable();
  const permission = input.action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGE_PERFORMANCE_PRIVACY_CASE'
    : input.action === 'VERIFY' ? 'VERIFY_PERFORMANCE_PRIVACY_IDENTITY' : responsePermission(record.requestKind);
  const authority = await requirePermission(tx, input.actorUserId, permission);
  if (record.version !== input.expectedVersion) throw privacyError('پرونده تغییر کرده است. وضعیت تازه را بررسی کنید.', 'PERFORMANCE_PRIVACY_CONFLICT', 409);
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(input.reasonCode)) throw privacyError('دلیل کنترل‌شده معتبر را انتخاب کنید.', 'PERFORMANCE_PRIVACY_REASON_REQUIRED', 422);
  const now = new Date();
  const data: Prisma.PerformancePrivacyCaseUpdateInput = { version: { increment: 1 } };
  if (input.action === 'ACKNOWLEDGE' && record.status === 'RECEIVED') data.status = 'ACKNOWLEDGED';
  else if (input.action === 'VERIFY' && record.status === 'ACKNOWLEDGED') {
    const [subject, actor] = await Promise.all([
      tx.performanceSubject.findUniqueOrThrow({ where: { id: record.subjectId } }),
      tx.user.findUniqueOrThrow({ where: { id: input.actorUserId }, select: { personnelId: true } }),
    ]);
    if (record.requestedByUserId === input.actorUserId || (actor.personnelId && actor.personnelId === subject.personnelId)) {
      throw privacyError('احراز هویت باید توسط بررسی‌کننده مستقل انجام شود.', 'PERFORMANCE_PRIVACY_INDEPENDENT_VERIFIER_REQUIRED', 409);
    }
    data.status = 'VERIFIED'; data.identityVerifiedAt = now; data.verifiedByUserId = input.actorUserId;
  } else if (input.action === 'EXTEND' && record.status === 'VERIFIED' && record.extensionCount === 0) {
    data.respondBy = workingDeadline(record.respondBy, 15); data.extensionCount = 1;
  } else if (input.action === 'OPEN_CORRECTION' && record.requestKind === 'CORRECTION' && record.status === 'VERIFIED') {
    const scope = await tx.performancePrivacyScope.findMany({ where: { caseId: record.id } });
    if (!scope.length) throw privacyError('نتیجه‌ای در دامنه درخواست وجود ندارد.', 'PERFORMANCE_PRIVACY_CORRECTION_SCOPE_EMPTY', 409);
    for (const item of scope) {
      const existingLink = await tx.performancePrivacyCorrection.findUnique({ where: { caseId_evaluationId: { caseId: record.id, evaluationId: item.evaluationId } } });
      if (existingLink) continue;
      const correction = await createPerformanceCorrection(tx, { evaluationId: item.evaluationId, actorUserId: input.actorUserId,
        correctionKind: 'SUBJECT_PRIVACY_REQUEST', reason: `PRIVACY_CASE:${record.id}:${input.reasonCode}` });
      await tx.performancePrivacyCorrection.upsert({ where: { caseId_evaluationId: { caseId: record.id, evaluationId: item.evaluationId } },
        update: {}, create: { caseId: record.id, evaluationId: item.evaluationId, correctionId: correction.id } });
    }
  } else if (input.action === 'RESPOND' && record.status === 'VERIFIED') {
    const scope = await tx.performancePrivacyScope.findMany({ where: { caseId: record.id }, select: { evaluationId: true } });
    const ids = scope.map(({ evaluationId }) => evaluationId);
    const evaluations = await tx.performanceEvaluation.findMany({ where: { id: { in: ids }, subjectId: record.subjectId } });
    const results = await tx.performanceAcceptedResult.findMany({ where: { evaluationId: { in: evaluations.map(({ id }) => id) } }, orderBy: [{ acceptedAt: 'asc' }, { version: 'asc' }] });
    const byId = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
    const links = record.requestKind === 'CORRECTION' ? await tx.performancePrivacyCorrection.findMany({ where: { caseId: record.id } }) : [];
    const corrections = links.length ? await tx.performanceCorrection.findMany({ where: { id: { in: links.map(({ correctionId }) => correctionId) } } }) : [];
    if (record.requestKind === 'CORRECTION' && ids.length && (links.length !== ids.length || corrections.some(({ status }) => status === 'OPEN'))) {
      throw privacyError('اصلاح‌های دامنه درخواست هنوز تصمیم نهایی ندارند.', 'PERFORMANCE_PRIVACY_CORRECTION_PENDING', 409);
    }
    if (record.requestKind === 'ERASURE' && ids.length) throw privacyError('پاسخ حذف به تصمیم نگهداری و شواهد اجرای حذف نیاز دارد.', 'PERFORMANCE_PRIVACY_ERASURE_PENDING', 409);
    const response = record.requestKind === 'ACCESS' ? {
      schemaVersion: 1, purpose: 'PERSONNEL_PERFORMANCE_REVIEW', recipientCategories: ['AUTHORIZED_HUMAN_RESOURCES', 'ASSIGNED_SUPERVISORS', ...(await tx.performanceConsequenceHandoff.count({ where: { subjectId: record.subjectId } }) ? ['AUTHORIZED_CONSEQUENCE_RECIPIENTS'] : [])],
      levels: results.map((result) => ({
        levelCode: result.levelCode, acceptedAt: result.acceptedAt.toISOString(), expiresAt: result.expiresAt.toISOString(),
        measurementFrom: byId.get(result.evaluationId)!.measurementFrom.toISOString(), measurementTo: byId.get(result.evaluationId)!.measurementTo.toISOString(),
        correctionStatus: result.supersedesResultId ? 'CORRECTED' : result.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'ORIGINAL',
      })),
      withheldCategories: ['THIRD_PARTY_INFORMATION','SUPERVISOR_NARRATIVE','CRITERION_SCORES','OTHER_PERSONNEL_RANKING','INTERNAL_REVIEW_NOTES'],
    } : {
      schemaVersion: 1, decision: ids.length ? 'CORRECTION_DECIDED' : 'NO_SCOPED_EVALUATIONS',
      reasonCode: input.reasonCode, corrections: corrections.map(({ id, status, decidedAt }) => ({ id, status, decidedAt: decidedAt?.toISOString() ?? null })),
    };
    const payload = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_PRIVACY_CASE', aggregateId: record.id, payloadKind: 'RESPONSE', schemaVersion: 1,
      payload: response, keyring: performanceVaultKeyFromEnvironment(),
    });
    data.status = 'RESPONDED'; data.encryptedResponseId = payload.id;
  } else if (input.action === 'CLOSE' && record.status === 'RESPONDED') { data.status = 'CLOSED'; data.closedAt = now; }
  else throw privacyError('این اقدام در وضعیت فعلی پرونده مجاز نیست.', 'PERFORMANCE_PRIVACY_TRANSITION_INVALID', 409);
  const updated = await tx.performancePrivacyCase.update({ where: { id: record.id, version: input.expectedVersion }, data });
  await appendDecision(tx, updated, input.actorUserId, input.action, input.reasonCode, canonicalPerformanceHash({ status: updated.status, responseId: updated.encryptedResponseId, version: updated.version }), authority);
  return publicCase(updated);
});
