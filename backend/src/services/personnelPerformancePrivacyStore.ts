import { assessPerformanceEvaluationRetention } from './personnelPerformanceRetentionStore';
import { createPerformanceCorrection } from './personnelPerformanceDisclosureStore';
import { isPerformanceTransactionConflict, normalizePerformanceWriteError } from './personnelPerformanceRolloutPolicy';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type PerformancePrivacyCase } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, persistPerformancePayload, readPerformancePayload } from './personnelPerformancePayloadStore';
import { publishNotificationEvent } from './notificationService';

type Client = PrismaClient | Prisma.TransactionClient;
const privacyError = (message: string, code = 'PERFORMANCE_PRIVACY_UNAVAILABLE', status = 404) => Object.assign(new Error(message), { code, status });
const unavailable = () => privacyError('پرونده درخواست برای شما قابل دسترسی نیست.');
const inTransaction = async <T>(client: Client, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  if (!('$transaction' in client)) return work(client);
  for (let attempt = 0; ; attempt++) {
    try { return await client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 }); }
    catch (error) { if (attempt >= 2 || !isPerformanceTransactionConflict(error)) throw normalizePerformanceWriteError(error); }
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
  const subjectPersonnelId = (await tx.performanceSubject.findUniqueOrThrow({ where: { id: input.subjectId } })).personnelId;
  const subjectUser = subjectPersonnelId ? await tx.user.findFirst({ where: { personnelId: subjectPersonnelId,
    isActive: true }, select: { id: true } }) : null;
  if (subjectUser) await publishNotificationEvent(tx, { type: 'PERFORMANCE_PRIVACY_NOTICE',
    deduplicationKey: `performance-privacy-request:${record.id}`, recipientIds: [subjectUser.id],
    recipientGroups: { DIRECT_USER: [subjectUser.id] }, resourceType: 'PERFORMANCE_PRIVACY_CASE', resourceId: record.id,
    actionUrl: '/dashboard/hr/personnel/performance', payload: {} });
  return publicCase(record);
});

export const runPerformancePrivacyDeadlineNotifications = async (client: Client, now = new Date()) => {
  const warningAt = new Date(now.getTime() + 86_400_000);
  const cases = await client.performancePrivacyCase.findMany({ where: { OR: [
    { status: 'RECEIVED', acknowledgeBy: { lte: warningAt } },
    { status: 'ACKNOWLEDGED', verifyBy: { lte: warningAt } },
    { status: 'VERIFIED', respondBy: { lte: warningAt } },
  ] }, orderBy: { requestedAt: 'asc' }, take: 500 });
  if (!cases.length) return { cases: 0, notifications: 0 };
  const users = await client.user.findMany({ where: { isActive: true }, select: { id: true } });
  const reviewers: string[] = [];
  for (const user of users) if ((await activeHrActionPermissionsForUser(client, user.id, now)).includes('VIEW_PERFORMANCE_PRIVACY_CASE')) reviewers.push(user.id);
  let notifications = 0;
  for (const record of cases) {
    if (!reviewers.length) break;
    await publishNotificationEvent(client, { type: 'PERFORMANCE_PRIVACY_DEADLINE',
      deduplicationKey: `performance-privacy-deadline:${record.id}:${record.version}:${now.toISOString().slice(0, 10)}`,
      recipientIds: reviewers, recipientGroups: { DIRECT_USER: reviewers }, resourceType: 'PERFORMANCE_PRIVACY_CASE', resourceId: record.id,
      actionUrl: '/dashboard/hr/personnel/performance', payload: {} });
    notifications += reviewers.length;
  }
  return { cases: cases.length, notifications };
};

export const listPerformancePrivacyQueue = async (client: Client, input: { actorUserId: string; afterId?: string }) => inTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  const authority = await requirePermission(tx, input.actorUserId, 'VIEW_PERFORMANCE_PRIVACY_CASE');
  if (input.afterId !== undefined && (typeof input.afterId !== 'string' || !input.afterId || input.afterId.length > 128)) {
    throw privacyError('نشانگر صفحه معتبر نیست.', 'PERFORMANCE_PRIVACY_INVALID', 422);
  }
  const cursor = input.afterId ? await tx.performancePrivacyCase.findUnique({ where: { id: input.afterId }, select: { id: true, requestedAt: true } }) : null;
  if (input.afterId && !cursor) throw privacyError('نشانگر صفحه در دسترس نیست.', 'PERFORMANCE_PRIVACY_INVALID', 422);
  const rows = await tx.performancePrivacyCase.findMany({ where: { status: { not: 'CLOSED' },
    ...(cursor ? { OR: [{ requestedAt: { gt: cursor.requestedAt } }, { requestedAt: cursor.requestedAt, id: { gt: cursor.id } }] } : {}) },
    orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }], take: 51 });
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const correctionCaseIds = rows.slice(0, 50).filter((row) => row.requestKind === 'CORRECTION' && row.status === 'VERIFIED').map(({ id }) => id);
  const scopes = correctionCaseIds.length ? await tx.performancePrivacyScope.findMany({ where: { caseId: { in: correctionCaseIds } }, select: { caseId: true } }) : [];
  const links = correctionCaseIds.length ? await tx.performancePrivacyCorrection.findMany({ where: { caseId: { in: correctionCaseIds } } }) : [];
  const corrections = links.length ? await tx.performanceCorrection.findMany({ where: { id: { in: links.map(({ correctionId }) => correctionId) } }, select: { id: true, status: true } }) : [];
  const items = rows.slice(0, 50).map((record) => {
    const dueAt = record.status === 'RECEIVED' ? record.acknowledgeBy : record.status === 'ACKNOWLEDGED' ? record.verifyBy : record.respondBy;
    let nextAction = record.status === 'RECEIVED' ? 'ACKNOWLEDGE'
      : record.status === 'ACKNOWLEDGED' ? 'VERIFY' : record.status === 'VERIFIED' ? 'RESPOND' : 'CLOSE';
    if (record.requestKind === 'CORRECTION' && record.status === 'VERIFIED') {
      const caseLinks = links.filter(({ caseId }) => caseId === record.id);
      if (caseLinks.length < scopes.filter(({ caseId }) => caseId === record.id).length) nextAction = 'OPEN_CORRECTION';
      else if (caseLinks.some(({ correctionId }) => {
        const correction = corrections.find(({ id }) => id === correctionId);
        return !correction || correction.status === 'OPEN';
      })) nextAction = 'WAIT_FOR_CORRECTION_DECISION';
    }
    return { ...publicCase(record), nextAction, dueAt, overdue: record.status !== 'RESPONDED' && dueAt < clock.now };
  });
  const disclosureReceiptId = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id: disclosureReceiptId, aggregateType: 'PERFORMANCE_PRIVACY_QUEUE', aggregateId: disclosureReceiptId,
    eventType: 'PERFORMANCE_PRIVACY_QUEUE_DISCLOSED', actorUserId: input.actorUserId, authorityHash: canonicalPerformanceHash(authority),
    reason: 'AUTHORIZED_CASE_QUEUE', eventHash: canonicalPerformanceHash({ id: disclosureReceiptId,
      scope: items.map(({ id, version }) => ({ id, version })), afterId: input.afterId ?? null }) } });
  return { items, nextCursor: rows.length > 50 ? items[items.length - 1].id : null, disclosureReceiptId };
});

export const getPerformancePrivacyCase = async (client: Client, actorUserId: string, caseId: string) => inTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  const record = await tx.performancePrivacyCase.findUnique({ where: { id: caseId } });
  if (!record) throw unavailable();
  const authority = await mayRead(tx, actorUserId, record.subjectId);
  const response = record.encryptedResponseId
    ? await readPerformancePayload<unknown>(tx, record.encryptedResponseId, performanceVaultKeyFromEnvironment()) : null;
  const reviewer = (await activeHrActionPermissionsForUser(tx, actorUserId)).includes('VIEW_PERFORMANCE_PRIVACY_CASE');
  const request = reviewer ? await readPerformancePayload<unknown>(tx, record.encryptedRequestId, performanceVaultKeyFromEnvironment()) : undefined;
  const scope = reviewer ? await tx.performancePrivacyScope.findMany({ where: { caseId }, select: { evaluationId: true } }) : undefined;
  const disclosureReceiptId = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id: disclosureReceiptId, aggregateType: 'PERFORMANCE_PRIVACY_CASE', aggregateId: caseId,
    eventType: 'PERFORMANCE_PRIVACY_CASE_DISCLOSED', actorUserId, authorityHash: canonicalPerformanceHash({ authority, reviewer }),
    reason: reviewer ? 'AUTHORIZED_CASE_REVIEW' : 'SUBJECT_CASE_ACCESS',
    eventHash: canonicalPerformanceHash({ id: disclosureReceiptId, caseId, version: record.version,
      requestId: reviewer ? record.encryptedRequestId : null, responseId: record.encryptedResponseId, scopeHash: record.scopeHash }),
  } });
  return { ...publicCase(record), response, disclosureReceiptId, ...(reviewer ? { request, scope, subjectId: record.subjectId, requestedByUserId: record.requestedByUserId } : {}) };
});

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
    const retentionDecisions: Array<Awaited<ReturnType<typeof assessPerformanceEvaluationRetention>>> = [];
    if (record.requestKind === 'ERASURE') {
      // The open request itself preserves scoped evidence. Record the policy decision rather than
      // falsely declaring physical erasure or leaving a verified request permanently unanswerable.
      for (const evaluationId of ids) retentionDecisions.push(await assessPerformanceEvaluationRetention(tx, { actorUserId: input.actorUserId, evaluationId }));
    }
    const response = record.requestKind === 'ACCESS' ? {
      schemaVersion: 1, purpose: 'PERSONNEL_PERFORMANCE_REVIEW', recipientCategories: ['AUTHORIZED_HUMAN_RESOURCES', 'ASSIGNED_SUPERVISORS', ...(await tx.performanceConsequenceHandoff.count({ where: { subjectId: record.subjectId } }) ? ['AUTHORIZED_CONSEQUENCE_RECIPIENTS'] : [])],
      levels: results.map((result) => ({
        levelCode: result.levelCode, acceptedAt: result.acceptedAt.toISOString(), expiresAt: result.expiresAt.toISOString(),
        measurementFrom: byId.get(result.evaluationId)!.measurementFrom.toISOString(), measurementTo: byId.get(result.evaluationId)!.measurementTo.toISOString(),
        correctionStatus: result.supersedesResultId ? 'CORRECTED' : result.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'ORIGINAL',
      })),
      withheldCategories: ['THIRD_PARTY_INFORMATION','SUPERVISOR_NARRATIVE','CRITERION_SCORES','OTHER_PERSONNEL_RANKING','INTERNAL_REVIEW_NOTES'],
    } : record.requestKind === 'ERASURE' ? {
      schemaVersion: 1, decision: ids.length ? 'RETAINED_UNDER_POLICY' : 'NO_SCOPED_EVALUATIONS', deletionCompleted: false,
      reasonCode: input.reasonCode, closedRequestPreservationDays: 90,
      records: retentionDecisions.map((decision) => ({ retentionDecisionId: decision.id, classification: decision.classification,
        status: decision.status, policyVersionId: decision.policyVersionId, reviewAfter: decision.deleteAfter?.toISOString() ?? null })),
      backupStatus: 'INDEPENDENT_CHECKPOINT_POLICY',
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
