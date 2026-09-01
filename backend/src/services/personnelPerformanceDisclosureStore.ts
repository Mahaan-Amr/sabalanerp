import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { PerformanceExportStatus, PerformanceProjectionState, PerformanceResultStatus, Prisma, type PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import {
  buildPerformanceAnalytics,
  buildPerformanceBadgeSummary,
  buildPerformanceCalibration,
  escapePerformanceSpreadsheetCell,
  escapePerformanceExportHtml,
  validateConsequenceHandoff,
  type PerformanceAnalyticsMember,
  PERFORMANCE_LEVELS,
} from './personnelPerformanceDisclosure';
import {
  performanceVaultKeyFromEnvironment,
  persistPerformancePayload,
  readPerformancePayload,
  type PerformanceVaultKey,
} from './personnelPerformancePayloadStore';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';
import { generatePdfBufferFromHtml } from '../utils/pdf';

const disclosureError = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });
const exportRoot = () => path.resolve(process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR || path.join(process.cwd(), 'storage', 'performance-exports'));
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const DEVELOPMENT_EXPORT_KEY = createHash('sha256').update('sabalan-local-performance-export-key').digest();

export const validatePerformanceExportKeyEnvironment = (environment: NodeJS.ProcessEnv = process.env) => {
  const encoded = environment.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64?.trim();
  const keyId = environment.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID?.trim();
  if (encoded && keyId) {
    const key = Buffer.from(encoded, 'base64');
    if (/^(change|replace|example|placeholder|local)/i.test(keyId) || key.length !== 32 || key.toString('base64') !== encoded.replace(/\s/g, '')) throw disclosureError('کلید رمزگذاری خروجی عملکرد معتبر نیست.', 'PERFORMANCE_EXPORT_ENCRYPTION_CONFIGURATION_INVALID', 500);
    return { keyId, key };
  }
  throw disclosureError('کلید مستقل خروجی عملکرد پیکربندی نشده است.', 'PERFORMANCE_EXPORT_ENCRYPTION_CONFIGURATION_MISSING', 500);
};

const performanceExportKeyFromEnvironment = () => {
  if (process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64 && process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID) {
    if (process.env.NODE_ENV === 'production') return validatePerformanceExportKeyEnvironment();
    const key = Buffer.from(process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64, 'base64');
    if (key.length === 32) return { keyId: process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID, key };
  }
  if (process.env.NODE_ENV !== 'production') return { keyId: 'local-export-v1', key: DEVELOPMENT_EXPORT_KEY };
  throw disclosureError('کلید مستقل خروجی عملکرد پیکربندی نشده است.', 'PERFORMANCE_EXPORT_ENCRYPTION_CONFIGURATION_MISSING', 500);
};

export const encryptPerformanceExportArtifact = (plaintext: Buffer, key: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from('SPX1'), iv, cipher.getAuthTag(), ciphertext]);
};

export const decryptPerformanceExportArtifact = (envelope: Buffer, key: Buffer) => {
  if (envelope.subarray(0, 4).toString('utf8') !== 'SPX1' || envelope.length < 32) throw disclosureError('فایل خروجی قابل بازیابی نیست.', 'PERFORMANCE_EXPORT_ARTIFACT_INVALID', 500);
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(4, 16));
  decipher.setAuthTag(envelope.subarray(16, 32));
  return Buffer.concat([decipher.update(envelope.subarray(32)), decipher.final()]);
};

export const withinPerformanceExportDeadline = async <T>(work: Promise<T>, milliseconds = 5 * 60_000) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(disclosureError('زمان تولید خروجی از سقف مجاز گذشت.', 'PERFORMANCE_EXPORT_GENERATION_TIMEOUT', 504)), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const auditDisclosure = async (client: PrismaClient | Prisma.TransactionClient, input: {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  actorUserId: string | null;
  authorityCodes: readonly string[];
  reason?: string;
  evidenceHash?: string;
}): Promise<unknown> => {
  if ('$transaction' in client) {
    return client.$transaction((tx) => auditDisclosure(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.aggregateType}:${input.aggregateId}`}, 0))`;
  const previous = await client.performanceAuditEvent.findFirst({
    where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  });
  const id = randomUUID();
  return client.performanceAuditEvent.create({ data: {
    id,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    authorityHash: canonicalPerformanceHash([...input.authorityCodes].sort()),
    reason: input.reason,
    previousEventHash: previous?.eventHash,
    eventHash: canonicalPerformanceHash({
      id,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      authorityCodes: [...input.authorityCodes].sort(),
      evidenceHash: input.evidenceHash ?? null,
      previousEventHash: previous?.eventHash ?? null,
    }),
  } });
};

const activeRelationshipForPersonnel = async (client: PrismaClient | Prisma.TransactionClient, personnelId: string) => client.hrEmploymentRelationship.findFirst({
  where: { personnelId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
  orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
  select: { id: true, personnelId: true, status: true, effectiveFrom: true, effectiveTo: true },
});

const requireScopedConsequenceAuthority = async (client: PrismaClient | Prisma.TransactionClient, input: {
  actorUserId: string;
  personnelId: string;
  consequenceType: string;
}) => {
  const now = new Date();
  const authority = await client.hrNamedResponsibility.findFirst({
    where: {
      responsibilityTypeCode: `PERFORMANCE_CONSEQUENCE_${input.consequenceType}`,
      scopeType: 'PERSONNEL',
      scopeId: input.personnelId,
      assignedUserId: input.actorUserId,
      responsibilityType: { isActive: true },
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: { id: true },
  });
  if (!authority) {
    await auditDisclosure(client, {
      aggregateType: 'PERFORMANCE_CONSEQUENCE_AUTHORITY_DENIAL',
      aggregateId: canonicalPerformanceHash({ personnelId: input.personnelId, consequenceType: input.consequenceType }),
      eventType: 'CONSEQUENCE_HANDOFF_SCOPE_DENIED', actorUserId: input.actorUserId,
      authorityCodes: ['CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF'],
    });
    throw disclosureError('اختیار مستقل این فرد و نوع پیامد برای شما ثبت نشده است.', 'PERFORMANCE_CONSEQUENCE_SCOPE_FORBIDDEN', 403);
  }
};

const projectionForPersonnel = async (client: PrismaClient, personnelId: string) => {
  const relationship = await activeRelationshipForPersonnel(client, personnelId);
  if (!relationship) return null;
  const subject = await client.performanceSubject.findFirst({
    where: { personnelId, employmentRelationshipId: relationship.id, identityDetachedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!subject) return buildPerformanceBadgeSummary({ state: 'UNEVALUATED', version: 0 });
  const phase = await client.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
  if (!phase?.releaseEnabled || ['SCHEMA_PROTECTION', 'POLICY_DARK_LAUNCH', 'READINESS', 'SUPERVISOR_HR_PILOT'].includes(phase.phase)) return null;
  if (phase.cohortVersionId) {
    const membership = await client.performanceCohortMember.findUnique({ where: { cohortVersionId_subjectId: { cohortVersionId: phase.cohortVersionId, subjectId: subject.id } } });
    if (!membership) return null;
  }
  const projection = await client.performanceCurrentLevelProjection.findUnique({ where: { subjectId: subject.id } });
  if (projection?.state === PerformanceProjectionState.LEVEL) {
    const evaluations = await client.performanceEvaluation.findMany({ where: { subjectId: subject.id }, select: { id: true } });
    const validSource = evaluations.length ? await client.performanceAcceptedResult.findFirst({
      where: { evaluationId: { in: evaluations.map(({ id }) => id) }, status: PerformanceResultStatus.EFFECTIVE, expiresAt: { gt: new Date() } },
      select: { id: true },
    }) : null;
    if (!validSource) return buildPerformanceBadgeSummary({ state: 'TEMPORARILY_UNAVAILABLE', version: projection.version });
  }
  if (projection?.nextReviewAt && projection.nextReviewAt <= new Date()) {
    return buildPerformanceBadgeSummary({ state: 'TEMPORARILY_UNAVAILABLE', version: projection.version });
  }
  return projection
    ? buildPerformanceBadgeSummary(projection)
    : buildPerformanceBadgeSummary({ state: 'UNEVALUATED', version: 0 });
};

export const getPersonalPerformanceBadge = async (client: PrismaClient, userId: string) => {
  const user = await client.user.findUnique({ where: { id: userId }, select: { personnelId: true } });
  if (!user?.personnelId) return null;
  return projectionForPersonnel(client, user.personnelId);
};

export const getPersonnelPerformanceBadges = async (client: PrismaClient, input: {
  actorUserId: string;
  personnelIds: readonly string[];
}) => {
  const ids = [...new Set(input.personnelIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  const badges = await Promise.all(ids.map(async (personnelId) => ({
    personnelId,
    badge: await projectionForPersonnel(client, personnelId),
  })));
  return badges.filter(({ badge }) => badge !== null);
};

type ResultPayload = {
  exactScore?: string;
  displayScore?: string;
  measurementFrom: string;
  measurementTo: string;
  levelCode: string;
  levelPolicyVersionId: string;
  templateSnapshotHash?: string;
};

export const getPerformanceHistory = async (client: PrismaClient, input: {
  actorUserId: string;
  personnelId: string;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const subjects = await client.performanceSubject.findMany({ where: { personnelId: input.personnelId } });
  if (!subjects.length) return [];
  const evaluations = await client.performanceEvaluation.findMany({
    where: { subjectId: { in: subjects.map(({ id }) => id) } },
    orderBy: [{ measurementTo: 'desc' }, { id: 'desc' }],
  });
  const results = evaluations.length ? await client.performanceAcceptedResult.findMany({
    where: { evaluationId: { in: evaluations.map(({ id }) => id) } },
    orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }],
  }) : [];
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const history = await Promise.all(results.map(async (result) => {
    const payload = await readPerformancePayload<ResultPayload>(client, result.encryptedPayloadId, keyring);
    return {
      id: result.id,
      version: result.version,
      status: result.status,
      levelCode: result.levelCode,
      levelPolicyVersionId: result.levelPolicyVersionId,
      acceptedAt: result.acceptedAt,
      expiresAt: result.expiresAt,
      measurementFrom: evaluationById.get(result.evaluationId)?.measurementFrom ?? new Date(payload.measurementFrom),
      measurementTo: evaluationById.get(result.evaluationId)?.measurementTo ?? new Date(payload.measurementTo),
      exactScore: payload.exactScore,
      displayScore: payload.displayScore,
      supersedesResultId: result.supersedesResultId,
    };
  }));
  await auditDisclosure(client, {
    aggregateType: 'PERSONNEL_HISTORY_ACCESS', aggregateId: canonicalPerformanceHash(input.personnelId),
    eventType: 'PERFORMANCE_HISTORY_VIEWED', actorUserId: input.actorUserId,
    authorityCodes: ['VIEW_PERFORMANCE_HISTORY'], evidenceHash: canonicalPerformanceHash(history.map(({ id, version }) => ({ id, version }))),
  });
  return history;
};

const analyticsPopulation = async (client: PrismaClient, keyring: PerformanceVaultKey): Promise<PerformanceAnalyticsMember[]> => {
  const phase = await client.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
  if (!phase?.releaseEnabled || ['SCHEMA_PROTECTION', 'POLICY_DARK_LAUNCH', 'READINESS', 'SUPERVISOR_HR_PILOT', 'RESULT_LEVEL_BADGE'].includes(phase.phase)) return [];
  const cohortSubjects = phase.cohortVersionId ? await client.performanceCohortMember.findMany({ where: { cohortVersionId: phase.cohortVersionId }, select: { subjectId: true } }) : [];
  const projections = await client.performanceCurrentLevelProjection.findMany({
    where: { state: PerformanceProjectionState.LEVEL, levelCode: { not: null }, ...(phase.cohortVersionId ? { subjectId: { in: cohortSubjects.map(({ subjectId }) => subjectId) } } : {}) },
  });
  if (!projections.length) return [];
  const subjects = await client.performanceSubject.findMany({ where: { id: { in: projections.map(({ subjectId }) => subjectId) }, identityDetachedAt: null } });
  const relationshipIds = subjects.map(({ employmentRelationshipId }) => employmentRelationshipId).filter((id): id is string => Boolean(id));
  const relationships = await client.hrEmploymentRelationship.findMany({
    where: { id: { in: relationshipIds }, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    include: { personnel: { select: { id: true, firstName: true, lastName: true } } },
  });
  const assignments = await client.hrEmploymentAssignment.findMany({
    where: { employmentRelationshipId: { in: relationships.map(({ id }) => id) }, type: 'PRIMARY', effectiveTo: null },
    include: { position: { select: { jobId: true } } },
  });
  const activeFamilies = await client.performancePeerFamilyVersion.findMany({
    where: { lifecycle: 'ACTIVE', effectiveFrom: { lte: new Date() } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  const familyJobs = activeFamilies.length ? await client.performancePeerFamilyJob.findMany({
    where: { familyVersionId: { in: activeFamilies.map(({ id }) => id) } },
  }) : [];
  const currentFamilyByJob = new Map<string, string>();
  for (const family of activeFamilies) {
    for (const member of familyJobs.filter(({ familyVersionId }) => familyVersionId === family.id)) {
      if (!currentFamilyByJob.has(member.jobId)) currentFamilyByJob.set(member.jobId, `${family.familyKey}:v${family.version}`);
    }
  }
  const results = await client.performanceAcceptedResult.findMany({
    where: { status: PerformanceResultStatus.EFFECTIVE },
    orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }],
  });
  const resultBySubject = new Map<string, { exactScore?: number; signature: string }>();
  if (results.length) {
    const evaluations = await client.performanceEvaluation.findMany({ where: { id: { in: results.map(({ evaluationId }) => evaluationId) } } });
    const subjectByEvaluation = new Map(evaluations.map(({ id, subjectId }) => [id, subjectId]));
    for (const result of results) {
      const subjectId = subjectByEvaluation.get(result.evaluationId);
      if (!subjectId || resultBySubject.has(subjectId)) continue;
      const payload = await readPerformancePayload<ResultPayload>(client, result.encryptedPayloadId, keyring);
      resultBySubject.set(subjectId, {
        exactScore: payload.exactScore === undefined ? undefined : Number(payload.exactScore),
        signature: payload.templateSnapshotHash ?? result.levelPolicyVersionId,
      });
    }
  }
  const projectionBySubject = new Map(projections.map((projection) => [projection.subjectId, projection]));
  const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  const assignmentByRelationship = new Map(assignments.map((assignment) => [assignment.employmentRelationshipId, assignment]));
  return subjects.flatMap((subject) => {
    const relationship = subject.employmentRelationshipId ? relationshipById.get(subject.employmentRelationshipId) : null;
    const projection = projectionBySubject.get(subject.id);
    if (!relationship || !projection?.levelCode) return [];
    const jobId = assignmentByRelationship.get(relationship.id)?.position?.jobId ?? 'unclassified';
    const score = resultBySubject.get(subject.id);
    return [{
      subjectId: subject.id,
      personnelId: relationship.personnel.id,
      displayName: `${relationship.personnel.firstName} ${relationship.personnel.lastName}`.trim(),
      employmentRelationshipId: relationship.id,
      levelCode: projection.levelCode,
      comparabilitySignature: score?.signature ?? 'unknown',
      peerGroupKey: currentFamilyByJob.get(jobId) ?? `job:${jobId}`,
      measurementTo: projection.newestMeasurementTo ?? projection.projectedAt,
      exactScore: score?.exactScore,
    }];
  });
};

export const getPerformanceAnalytics = async (client: PrismaClient, input: {
  actorUserId: string;
  personnelIds?: readonly string[];
  mode?: 'AGGREGATE' | 'NAMED_RANKING';
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const population = await analyticsPopulation(client, keyring);
  if (input.personnelIds?.length) throw disclosureError('فیلتر دلخواه افراد برای این گزارش محرمانه مجاز نیست.', 'PERFORMANCE_ANALYTICS_ARBITRARY_SCOPE_FORBIDDEN', 422);
  const selectedIds: Set<string> | null = null;
  const selected = population;
  const result = buildPerformanceAnalytics({ population, selected, mode: input.mode });
  await auditDisclosure(client, {
    aggregateType: 'PERFORMANCE_ANALYTICS', aggregateId: canonicalPerformanceHash({ mode: input.mode ?? 'AGGREGATE', selected: [...(selectedIds ?? [])].sort() }),
    eventType: input.mode === 'NAMED_RANKING' ? 'NAMED_RANKING_VIEWED' : 'AGGREGATE_ANALYTICS_VIEWED',
    actorUserId: input.actorUserId,
    authorityCodes: [input.mode === 'NAMED_RANKING' ? 'VIEW_NAMED_PERFORMANCE_RANKING' : 'VIEW_PERFORMANCE_ANALYTICS'],
    evidenceHash: canonicalPerformanceHash(result),
  });
  return result;
};

export const getEvaluatorCalibration = async (client: PrismaClient, input: { actorUserId: string; evaluatorPersonnelId: string; keyring?: PerformanceVaultKey }) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const submissions = await client.performanceSubmission.findMany({ where: { supervisorPersonnelId: input.evaluatorPersonnelId } });
  const sections = submissions.length ? await client.performanceEvaluationSection.findMany({ where: { id: { in: submissions.map(({ sectionId }) => sectionId) }, status: 'ACCEPTED' } }) : [];
  const evaluations = sections.length ? await client.performanceEvaluation.findMany({ where: { id: { in: sections.map(({ evaluationId }) => evaluationId) } } }) : [];
  const subjectByEvaluation = new Map(evaluations.map(({ id, subjectId, measurementTo }) => [id, { subjectId, measurementTo }]));
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const samples: Array<{ evaluatorPersonnelId: string; subjectId: string; periodKey: string; comparabilitySignature: string; grade: number }> = [];
  for (const submission of submissions) {
    const section = sectionById.get(submission.sectionId);
    const evaluation = section ? subjectByEvaluation.get(section.evaluationId) : undefined;
    if (!section || !evaluation) continue;
    const payload = await readPerformancePayload<{ responses?: Array<{ grade?: number }>; templateSnapshotHash?: string }>(client, submission.encryptedPayloadId, keyring);
    const grades = (payload.responses ?? []).map(({ grade }) => grade).filter((grade): grade is number => Number.isInteger(grade) && grade! >= 1 && grade! <= 5);
    if (grades.length) samples.push({
      evaluatorPersonnelId: input.evaluatorPersonnelId,
      subjectId: evaluation.subjectId,
      periodKey: `${evaluation.measurementTo.getUTCFullYear()}-${evaluation.measurementTo.getUTCMonth() + 1}`,
      comparabilitySignature: payload.templateSnapshotHash ?? section.templateSnapshotId ?? 'unknown',
      grade: Math.round(grades.reduce((sum, grade) => sum + grade, 0) / grades.length),
    });
  }
  const result = buildPerformanceCalibration(samples);
  await auditDisclosure(client, {
    aggregateType: 'EVALUATOR_CALIBRATION', aggregateId: canonicalPerformanceHash(input.evaluatorPersonnelId),
    eventType: 'EVALUATOR_CALIBRATION_VIEWED', actorUserId: input.actorUserId,
    authorityCodes: ['VIEW_EVALUATOR_CALIBRATION'], evidenceHash: canonicalPerformanceHash(result),
  });
  return result;
};

export const listPerformanceEvaluators = async (client: PrismaClient) => {
  const evaluatorIds = await client.performanceSubmission.findMany({ distinct: ['supervisorPersonnelId'], select: { supervisorPersonnelId: true } });
  return evaluatorIds.length ? client.personnel.findMany({
    where: { id: { in: evaluatorIds.map(({ supervisorPersonnelId }) => supervisorPersonnelId) } },
    select: { id: true, firstName: true, lastName: true, employeeNumber: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  }) : [];
};

const exportRows = (report: unknown) => {
  const object = report && typeof report === 'object' ? report as Record<string, unknown> : { value: report };
  const rows = Array.isArray(object.groups)
    ? (object.groups as Array<Record<string, unknown>>).flatMap((group) => (group.members as Array<Record<string, unknown>> ?? []).map((member) => ({ level: group.labelFa, ...member })))
    : Array.isArray(object.levelDistribution) ? object.levelDistribution as Array<Record<string, unknown>> : [object];
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, escapePerformanceSpreadsheetCell(value)])));
};

const renderExportArtifact = async (kind: 'XLSX' | 'PDF', rows: Array<Record<string, unknown>>) => {
  if (kind === 'XLSX') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'گزارش عملکرد');
    return { bytes: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const html = `<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px;text-align:right}h1{font-size:20px}</style><h1>گزارش محرمانه عملکرد</h1><table><thead><tr>${headers.map((header) => `<th>${escapePerformanceExportHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapePerformanceExportHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`;
  return { bytes: await generatePdfBufferFromHtml({ htmlContent: html }), mimeType: 'application/pdf' };
};

export const processPerformanceExport = async (client: PrismaClient, exportId: string, keyring = performanceVaultKeyFromEnvironment()) => {
  const receipt = await runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-export-queue'}, 0))`;
    const queued = await tx.performanceExportReceipt.findUnique({ where: { id: exportId } });
    if (!queued || queued.status !== PerformanceExportStatus.QUEUED) return null;
    const limit = queued.exportKind === 'PDF' ? 2 : 5;
    const running = await tx.performanceExportReceipt.count({ where: { exportKind: queued.exportKind, status: PerformanceExportStatus.RUNNING } });
    if (running >= limit) return null;
    const attemptCount = queued.attemptCount + 1;
    const artifactPath = path.join(exportRoot(), `${queued.id}-${attemptCount}.${queued.exportKind === 'PDF' ? 'pdf' : 'xlsx'}.enc`);
    return tx.performanceExportReceipt.update({ where: { id: queued.id }, data: { status: PerformanceExportStatus.RUNNING, startedAt: new Date(), attemptCount, artifactPath, failureCode: null } });
  });
  if (!receipt?.encryptedPayloadId) return null;
  try {
    const payload = await readPerformancePayload<{ report: unknown }>(client, receipt.encryptedPayloadId, keyring);
    const rows = exportRows(payload.report);
    if ((receipt.exportKind === 'XLSX' && rows.length > 100_000) || (receipt.exportKind === 'PDF' && rows.length > 12_500)) {
      throw disclosureError('دامنه خروجی از سقف مجاز بیشتر است.', 'PERFORMANCE_EXPORT_SCOPE_TOO_LARGE', 422);
    }
    await mkdir(exportRoot(), { recursive: true, mode: 0o700 });
    const artifactPath = receipt.artifactPath!;
    const rendered = await withinPerformanceExportDeadline(renderExportArtifact(receipt.exportKind as 'XLSX' | 'PDF', rows));
    const artifactHash = createHash('sha256').update(rendered.bytes).digest('hex');
    const maximumBytes = receipt.exportKind === 'PDF' ? 50 * 1024 * 1024 : 100 * 1024 * 1024;
    if (rendered.bytes.length > maximumBytes) {
      throw disclosureError('حجم فایل خروجی از سقف مجاز بیشتر است.', 'PERFORMANCE_EXPORT_FILE_TOO_LARGE', 422);
    }
    const exportKey = performanceExportKeyFromEnvironment();
    await writeFile(artifactPath, encryptPerformanceExportArtifact(rendered.bytes, exportKey.key), { mode: 0o600 });
    const promoted = await runPerformanceSerializableTransaction(client, async (tx) => {
      const updated = await tx.performanceExportReceipt.updateMany({ where: {
        id: receipt.id, status: PerformanceExportStatus.RUNNING, attemptCount: receipt.attemptCount,
      }, data: {
        status: PerformanceExportStatus.READY,
        artifactPath,
        artifactMimeType: rendered.mimeType,
        artifactSize: rendered.bytes.length,
        artifactKeyId: exportKey.keyId,
        artifactHash,
        readyAt: new Date(),
        downloadTokenExpiresAt: new Date(Date.now() + 15 * 60_000),
      } });
      if (updated.count === 1) await auditDisclosure(tx, {
        aggregateType: 'PERFORMANCE_EXPORT', aggregateId: receipt.id, eventType: 'PERFORMANCE_EXPORT_GENERATED',
        actorUserId: receipt.requestedByUserId, authorityCodes: ['REQUEST_PERFORMANCE_EXPORT'], evidenceHash: artifactHash,
      });
      return updated.count;
    });
    if (promoted !== 1) {
      await unlink(artifactPath).catch(() => undefined);
      return null;
    }
    const ready = await client.performanceExportReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    return ready;
  } catch (error) {
    const current = await client.performanceExportReceipt.findUnique({ where: { id: receipt.id } });
    if (current?.status === PerformanceExportStatus.READY) return current;
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'PERFORMANCE_EXPORT_GENERATION_FAILED';
    const artifactPath = receipt.artifactPath!;
    await unlink(artifactPath).catch((unlinkError: NodeJS.ErrnoException) => { if (unlinkError.code !== 'ENOENT') throw unlinkError; });
    const retryable = ['PERFORMANCE_EXPORT_GENERATION_FAILED', 'PERFORMANCE_EXPORT_GENERATION_TIMEOUT'].includes(code) && receipt.attemptCount < 3;
    await client.performanceExportReceipt.updateMany({
      where: { id: receipt.id, status: PerformanceExportStatus.RUNNING, attemptCount: receipt.attemptCount },
      data: { status: retryable ? PerformanceExportStatus.QUEUED : PerformanceExportStatus.FAILED, failureCode: code, artifactPath: null },
    });
    return null;
  }
};

export const requestPerformanceExport = async (client: PrismaClient, input: {
  actorUserId: string;
  exportKind: 'PDF' | 'XLSX';
  reportKind: 'AGGREGATE' | 'NAMED_RANKING';
  personnelIds?: readonly string[];
  purpose: string;
  keyring?: PerformanceVaultKey;
}) => {
  if (!['PDF', 'XLSX'].includes(input.exportKind)) throw disclosureError('نوع فایل خروجی معتبر نیست.', 'PERFORMANCE_EXPORT_KIND_INVALID', 422);
  if (input.purpose.trim().length < 8) throw disclosureError('هدف خروجی باید روشن و دلیل‌دار باشد.', 'PERFORMANCE_EXPORT_PURPOSE_REQUIRED', 422);
  if (input.personnelIds?.length) throw disclosureError('فیلتر دلخواه افراد برای خروجی محرمانه مجاز نیست.', 'PERFORMANCE_EXPORT_ARBITRARY_SCOPE_FORBIDDEN', 422);
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const permissionCodes = await activeHrActionPermissionsForUser(client, input.actorUserId);
  const requiredView = input.reportKind === 'NAMED_RANKING' ? 'VIEW_NAMED_PERFORMANCE_RANKING' : 'VIEW_PERFORMANCE_ANALYTICS';
  if (!permissionCodes.includes(requiredView)) throw disclosureError('مجوز مشاهده محتوای این خروجی معتبر نیست.', 'PERFORMANCE_EXPORT_VIEW_PERMISSION_REQUIRED', 403);
  const report = await getPerformanceAnalytics(client, {
    actorUserId: input.actorUserId,
    personnelIds: input.personnelIds,
    mode: input.reportKind === 'NAMED_RANKING' ? 'NAMED_RANKING' : 'AGGREGATE',
    keyring,
  });
  if (report.suppressed) throw disclosureError(report.messageFa, report.reasonCode, 409);
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const id = randomUUID();
  const scope = { reportKind: input.reportKind, personnelIds: [...(input.personnelIds ?? [])].sort(), purpose: input.purpose.trim(), generatedFromHash: canonicalPerformanceHash(report) };
  const encrypted = await client.$transaction((tx) => persistPerformancePayload(tx, {
    aggregateType: 'PERFORMANCE_EXPORT', aggregateId: id, payloadKind: 'SCOPE_SNAPSHOT', schemaVersion: 1,
    payload: { scope, report }, keyring,
  }));
  const receipt = await client.performanceExportReceipt.create({ data: {
    id,
    requestedByUserId: input.actorUserId,
    exportKind: input.exportKind,
    scopeHash: canonicalPerformanceHash(scope),
    permissionHash: canonicalPerformanceHash(permissionCodes.sort()),
    encryptedPayloadId: encrypted.id,
    downloadTokenHash: tokenHash(token),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
  } });
  queueMicrotask(() => { void processPerformanceExport(client, receipt.id, keyring); });
  return { receipt, downloadToken: token };
};

export const processQueuedPerformanceExports = async (client: PrismaClient, keyring = performanceVaultKeyFromEnvironment()) => {
  const staleBefore = new Date(Date.now() - 6 * 60_000);
  const stale = await client.performanceExportReceipt.findMany({ where: { status: PerformanceExportStatus.RUNNING, startedAt: { lte: staleBefore } } });
  for (const receipt of stale) {
    const recovered = await client.performanceExportReceipt.updateMany({
      where: { id: receipt.id, status: PerformanceExportStatus.RUNNING, attemptCount: receipt.attemptCount },
      data: {
        status: receipt.attemptCount < 3 ? PerformanceExportStatus.QUEUED : PerformanceExportStatus.FAILED,
        failureCode: receipt.attemptCount < 3 ? 'PERFORMANCE_EXPORT_WORKER_INTERRUPTED' : 'PERFORMANCE_EXPORT_RETRY_EXHAUSTED',
        artifactPath: null,
      },
    });
    if (recovered.count === 1 && receipt.artifactPath) await unlink(receipt.artifactPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  const queued = await client.performanceExportReceipt.findMany({
    where: { status: PerformanceExportStatus.QUEUED }, orderBy: { requestedAt: 'asc' }, take: 7, select: { id: true },
  });
  await Promise.all(queued.map(({ id }) => processPerformanceExport(client, id, keyring)));
  return queued.length;
};

export const getPerformanceExport = async (client: PrismaClient, input: { exportId: string; actorUserId: string }) => {
  const receipt = await client.performanceExportReceipt.findUnique({ where: { id: input.exportId } });
  if (!receipt || receipt.requestedByUserId !== input.actorUserId) throw disclosureError('خروجی پیدا نشد.', 'PERFORMANCE_EXPORT_NOT_FOUND', 404);
  return {
    id: receipt.id,
    exportKind: receipt.exportKind,
    status: receipt.status,
    requestedAt: receipt.requestedAt,
    readyAt: receipt.readyAt,
    expiresAt: receipt.expiresAt,
    artifactHash: receipt.artifactHash,
    artifactSize: receipt.artifactSize,
    failureCode: receipt.failureCode,
  };
};

export const claimPerformanceExportDownload = async (client: PrismaClient, input: { exportId: string; actorUserId: string; token: string }) => {
  const now = new Date();
  const permissions = await activeHrActionPermissionsForUser(client, input.actorUserId);
  if (!permissions.includes('REQUEST_PERFORMANCE_EXPORT')) throw disclosureError('مجوز دانلود این خروجی دیگر معتبر نیست.', 'PERFORMANCE_EXPORT_PERMISSION_REVOKED', 403);
  const receipt = await client.performanceExportReceipt.findUnique({ where: { id: input.exportId } });
  if (!receipt || receipt.requestedByUserId !== input.actorUserId || receipt.downloadTokenHash !== tokenHash(input.token)) {
    throw disclosureError('خروجی پیدا نشد.', 'PERFORMANCE_EXPORT_NOT_FOUND', 404);
  }
  const scope = receipt.encryptedPayloadId ? await readPerformancePayload<{ scope?: { reportKind?: string } }>(client, receipt.encryptedPayloadId, performanceVaultKeyFromEnvironment()) : null;
  const requiredView = scope?.scope?.reportKind === 'NAMED_RANKING' ? 'VIEW_NAMED_PERFORMANCE_RANKING' : 'VIEW_PERFORMANCE_ANALYTICS';
  if (!permissions.includes(requiredView)) throw disclosureError('مجوز مشاهده محتوای این خروجی دیگر معتبر نیست.', 'PERFORMANCE_EXPORT_PERMISSION_REVOKED', 403);
  if (receipt.status !== PerformanceExportStatus.READY || !receipt.artifactPath || !receipt.downloadTokenExpiresAt || receipt.downloadTokenExpiresAt <= now || !receipt.expiresAt || receipt.expiresAt <= now) {
    throw disclosureError('پیوند دانلود منقضی یا استفاده شده است.', 'PERFORMANCE_EXPORT_LINK_EXPIRED', 410);
  }
  const exportKey = performanceExportKeyFromEnvironment();
  if (receipt.artifactKeyId !== exportKey.keyId) throw disclosureError('کلید فایل خروجی در دسترس نیست.', 'PERFORMANCE_EXPORT_KEY_UNAVAILABLE', 410);
  const bytes = decryptPerformanceExportArtifact(await readFile(receipt.artifactPath), exportKey.key);
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.artifactHash) throw disclosureError('تمامیت فایل خروجی تأیید نشد.', 'PERFORMANCE_EXPORT_INTEGRITY_FAILED', 500);
  const claimed = await client.performanceExportReceipt.updateMany({
    where: { id: receipt.id, status: PerformanceExportStatus.READY, downloadedAt: null },
    data: { status: PerformanceExportStatus.DELIVERING },
  });
  if (claimed.count !== 1) throw disclosureError('پیوند دانلود قبلاً استفاده شده است.', 'PERFORMANCE_EXPORT_ALREADY_DOWNLOADED', 409);
  return { bytes, mimeType: receipt.artifactMimeType ?? 'application/octet-stream', filename: `performance-${receipt.id}.${receipt.exportKind === 'PDF' ? 'pdf' : 'xlsx'}` };
};

export const completePerformanceExportDownload = async (client: PrismaClient, input: { exportId: string; actorUserId: string; delivered: boolean }) => {
  if (!input.delivered) {
    await client.performanceExportReceipt.updateMany({
      where: { id: input.exportId, status: PerformanceExportStatus.DELIVERING, downloadedAt: null },
      data: { status: PerformanceExportStatus.READY },
    });
    return;
  }
  const now = new Date();
  const completed = await client.performanceExportReceipt.updateMany({
    where: { id: input.exportId, status: PerformanceExportStatus.DELIVERING, downloadedAt: null },
    data: { status: PerformanceExportStatus.DOWNLOADED, downloadedAt: now },
  });
  if (completed.count !== 1) return;
  const receipt = await client.performanceExportReceipt.findUnique({ where: { id: input.exportId } });
  if (!receipt) return;
  await auditDisclosure(client, {
    aggregateType: 'PERFORMANCE_EXPORT', aggregateId: receipt.id, eventType: 'PERFORMANCE_EXPORT_DOWNLOADED',
    actorUserId: input.actorUserId, authorityCodes: ['REQUEST_PERFORMANCE_EXPORT'], evidenceHash: receipt.artifactHash ?? undefined,
  });
  await deleteDownloadedPerformanceExport(client, receipt.id, input.actorUserId);
};

const deleteDownloadedPerformanceExport = async (client: PrismaClient, exportId: string, actorUserId: string | null) => {
  const receipt = await client.performanceExportReceipt.findUnique({ where: { id: exportId } });
  if (!receipt?.artifactPath) return;
  await unlink(receipt.artifactPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  await client.performanceExportReceipt.update({ where: { id: receipt.id }, data: { status: PerformanceExportStatus.DELETED, deletedAt: new Date(), artifactPath: null } });
  await auditDisclosure(client, {
    aggregateType: 'PERFORMANCE_EXPORT', aggregateId: receipt.id, eventType: 'PERFORMANCE_EXPORT_CLEANED_UP',
    actorUserId, authorityCodes: ['REQUEST_PERFORMANCE_EXPORT'], evidenceHash: receipt.artifactHash ?? undefined,
  });
};

export const cleanupExpiredPerformanceExports = async (client: PrismaClient, now = new Date()) => {
  const expired = await client.performanceExportReceipt.findMany({
    where: { status: { not: PerformanceExportStatus.DELETED }, expiresAt: { lte: now } },
  });
  for (const receipt of expired) {
    if (receipt.artifactPath) await unlink(receipt.artifactPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await client.performanceExportReceipt.update({ where: { id: receipt.id }, data: { status: PerformanceExportStatus.DELETED, deletedAt: now, artifactPath: null } });
    await auditDisclosure(client, {
      aggregateType: 'PERFORMANCE_EXPORT', aggregateId: receipt.id, eventType: 'PERFORMANCE_EXPORT_CLEANED_UP',
      actorUserId: null, authorityCodes: ['SYSTEM_EXPORT_RETENTION'], evidenceHash: receipt.artifactHash ?? undefined,
    });
  }
  return expired.length;
};

export const createPerformanceConsequenceHandoff = async (client: PrismaClient, input: {
  actorUserId: string;
  personnelId: string;
  employmentRelationshipId: string;
  consequenceType: string;
  policyCycleKey: string;
  resultIds: readonly string[];
  reasonCategory: string;
  reason: string;
  independentEvidenceReferences: readonly string[];
  keyring?: PerformanceVaultKey;
}) => {
  const errors = validateConsequenceHandoff(input);
  if (errors.length) throw disclosureError(errors.join(' '), 'PERFORMANCE_CONSEQUENCE_HANDOFF_INVALID', 422);
  await requireScopedConsequenceAuthority(client, input);
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await requireScopedConsequenceAuthority(tx, input);
    const relationship = await tx.hrEmploymentRelationship.findUnique({ where: { id: input.employmentRelationshipId } });
    if (!relationship || relationship.personnelId !== input.personnelId) throw disclosureError('رابطه استخدامی معتبر پیدا نشد.', 'PERFORMANCE_HANDOFF_RELATIONSHIP_NOT_FOUND', 404);
    const subject = await tx.performanceSubject.findFirst({ where: { personnelId: input.personnelId, employmentRelationshipId: relationship.id, identityDetachedAt: null } });
    if (!subject) throw disclosureError('موضوع عملکرد معتبر پیدا نشد.', 'PERFORMANCE_HANDOFF_SUBJECT_NOT_FOUND', 404);
    const results = await tx.performanceAcceptedResult.findMany({ where: {
      id: { in: [...input.resultIds] },
      status: { in: [PerformanceResultStatus.EFFECTIVE, PerformanceResultStatus.EXPIRED, PerformanceResultStatus.SUPERSEDED] },
    } });
    const evaluations = results.length ? await tx.performanceEvaluation.findMany({ where: { id: { in: results.map(({ evaluationId }) => evaluationId) }, subjectId: subject.id } }) : [];
    if (results.length !== new Set(input.resultIds).size || evaluations.length !== results.length) throw disclosureError('نتیجه‌های انتخاب‌شده به همین رابطه استخدامی تعلق ندارند.', 'PERFORMANCE_HANDOFF_RESULT_SCOPE_INVALID', 409);
    if (['PERFORMANCE_IMPROVEMENT_REVIEW', 'DEMOTION_REVIEW'].includes(input.consequenceType) && new Set(results.map(({ evaluationId }) => evaluationId)).size < 2) {
      throw disclosureError('بازبینی اقدام نامساعد به دو دوره مصوب مستقل نیاز دارد.', 'PERFORMANCE_HANDOFF_MULTI_PERIOD_REQUIRED', 409);
    }
    const active = await tx.performanceConsequenceHandoff.findFirst({ where: {
      personnelId: input.personnelId,
      employmentRelationshipId: input.employmentRelationshipId,
      consequenceType: input.consequenceType,
      policyCycleKey: input.policyCycleKey,
      status: { in: ['SENT', 'RECEIVED', 'SUSPENDED'] },
    } });
    if (active) throw disclosureError('برای این نوع پیامد در این چرخه یک ارجاع فعال وجود دارد.', 'PERFORMANCE_HANDOFF_ALREADY_ACTIVE', 409);
    const projection = await tx.performanceCurrentLevelProjection.findUnique({ where: { subjectId: subject.id } });
    const recentResults = await tx.performanceAcceptedResult.findMany({
      where: { evaluationId: { in: (await tx.performanceEvaluation.findMany({ where: { subjectId: subject.id }, select: { id: true } })).map(({ id }) => id) }, status: { not: PerformanceResultStatus.SUSPENDED } },
      orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }], take: 4,
    });
    const recentEvaluations = await tx.performanceEvaluation.findMany({ where: { id: { in: recentResults.map(({ evaluationId }) => evaluationId) } } });
    const recentEvaluationById = new Map(recentEvaluations.map((evaluation) => [evaluation.id, evaluation]));
    const compensationSnapshot = relationship.hiringApplicationId ? await tx.hrCompensationSnapshot.findFirst({
      where: { applicationId: relationship.hiringApplicationId }, orderBy: { version: 'desc' },
      select: { id: true, version: true, currency: true, totalRials: true, payrollReviewStatus: true, preparedAt: true },
    }) : null;
    const snapshot = {
      schemaVersion: 1,
      subjectId: subject.id,
      personnelId: input.personnelId,
      employmentRelationshipId: relationship.id,
      relationshipStatus: relationship.status,
      consequenceType: input.consequenceType,
      policyCycleKey: input.policyCycleKey,
      selectedResults: results.map((result) => ({
        id: result.id, version: result.version, levelCode: result.levelCode, levelPolicyVersionId: result.levelPolicyVersionId,
        calculationTraceId: result.calculationTraceId, acceptedAt: result.acceptedAt, expiresAt: result.expiresAt,
        measurementFrom: evaluations.find(({ id }) => id === result.evaluationId)?.measurementFrom,
        measurementTo: evaluations.find(({ id }) => id === result.evaluationId)?.measurementTo,
        contextSnapshotId: evaluations.find(({ id }) => id === result.evaluationId)?.contextSnapshotId,
      })),
      currentProjection: projection ? { state: projection.state, levelCode: projection.levelCode, levelPolicyVersionId: projection.levelPolicyVersionId, version: projection.version, sourceResultsHash: projection.sourceResultsHash } : null,
      recentTrend: recentResults.map((result) => ({
        resultId: result.id, version: result.version, levelCode: result.levelCode, levelPolicyVersionId: result.levelPolicyVersionId,
        measurementFrom: recentEvaluationById.get(result.evaluationId)?.measurementFrom,
        measurementTo: recentEvaluationById.get(result.evaluationId)?.measurementTo,
      })),
      employmentContext: { status: relationship.status, effectiveFrom: relationship.effectiveFrom, effectiveTo: relationship.effectiveTo },
      compensationContext: compensationSnapshot ? { ...compensationSnapshot, totalRials: compensationSnapshot.totalRials.toString() } : null,
      reasonCategory: input.reasonCategory,
      reason: input.reason.trim(),
      independentEvidenceReferences: [...input.independentEvidenceReferences],
      automaticMutation: false,
    };
    const id = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: id, payloadKind: 'IMMUTABLE_HANDOFF', schemaVersion: 1,
      payload: snapshot, keyring,
    });
    const handoff = await tx.performanceConsequenceHandoff.create({ data: {
      id,
      subjectId: subject.id,
      personnelId: input.personnelId,
      employmentRelationshipId: relationship.id,
      consequenceType: input.consequenceType,
      policyCycleKey: input.policyCycleKey,
      reasonCategory: input.reasonCategory,
      reason: input.reason.trim(),
      encryptedPayloadId: encrypted.id,
      snapshotHash: encrypted.contentHash,
      createdByUserId: input.actorUserId,
    } });
    await auditDisclosure(tx, {
      aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoff.id, eventType: 'CONSEQUENCE_HANDOFF_CREATED',
      actorUserId: input.actorUserId, authorityCodes: ['CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF'], evidenceHash: encrypted.contentHash,
    });
    const { encryptedPayloadId: _payloadId, ...publicHandoff } = handoff;
    return publicHandoff;
  });
};

export const listEligibleConsequenceResults = async (client: PrismaClient, input: { personnelId: string; actorUserId: string; consequenceType: string }) => {
  await requireScopedConsequenceAuthority(client, input);
  const { personnelId } = input;
  const subjects = await client.performanceSubject.findMany({ where: { personnelId, identityDetachedAt: null }, select: { id: true } });
  if (!subjects.length) return [];
  const evaluations = await client.performanceEvaluation.findMany({
    where: { subjectId: { in: subjects.map(({ id }) => id) }, status: 'ACCEPTED' },
    select: { id: true, measurementFrom: true, measurementTo: true },
  });
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const results = evaluations.length ? await client.performanceAcceptedResult.findMany({
    where: { evaluationId: { in: evaluations.map(({ id }) => id) }, status: { in: [PerformanceResultStatus.EFFECTIVE, PerformanceResultStatus.EXPIRED, PerformanceResultStatus.SUPERSEDED] } },
    orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }], take: 4,
  }) : [];
  return results.map((result) => ({
    id: result.id,
    levelCode: result.levelCode,
    labelFa: PERFORMANCE_LEVELS.find(({ code }) => code === result.levelCode)?.labelFa ?? result.levelCode,
    acceptedAt: result.acceptedAt,
    expiresAt: result.expiresAt,
    measurementFrom: evaluationById.get(result.evaluationId)?.measurementFrom,
    measurementTo: evaluationById.get(result.evaluationId)?.measurementTo,
    status: result.status,
  }));
};

export const getPerformanceConsequenceHandoff = async (client: PrismaClient, input: { handoffId: string; actorUserId: string; keyring?: PerformanceVaultKey }) => {
  const handoff = await client.performanceConsequenceHandoff.findUnique({ where: { id: input.handoffId } });
  if (!handoff) throw disclosureError('ارجاع پیامد پیدا نشد.', 'PERFORMANCE_HANDOFF_NOT_FOUND', 404);
  await requireScopedConsequenceAuthority(client, { actorUserId: input.actorUserId, personnelId: handoff.personnelId, consequenceType: handoff.consequenceType });
  await auditDisclosure(client, {
    aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoff.id, eventType: 'CONSEQUENCE_HANDOFF_VIEWED',
    actorUserId: input.actorUserId, authorityCodes: ['CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF'], evidenceHash: handoff.snapshotHash,
  });
  const { encryptedPayloadId: _payloadId, ...publicHandoff } = handoff;
  return { handoff: publicHandoff };
};

export const createPerformanceCorrection = async (client: PrismaClient, input: { evaluationId: string; actorUserId: string; correctionKind: string; reason: string }) => {
  if (input.reason.trim().length < 8) throw disclosureError('دلیل اصلاح الزامی است.', 'PERFORMANCE_CORRECTION_REASON_REQUIRED', 422);
  return runPerformanceSerializableTransaction(client, async (tx) => {
    const evaluation = await tx.performanceEvaluation.findUnique({ where: { id: input.evaluationId } });
    if (!evaluation) throw disclosureError('پرونده ارزیابی پیدا نشد.', 'PERFORMANCE_EVALUATION_NOT_FOUND', 404);
    const target = await tx.performanceAcceptedResult.findFirst({ where: { evaluationId: evaluation.id }, orderBy: { version: 'desc' } });
    if (!target) throw disclosureError('نتیجه مصوبی برای اصلاح وجود ندارد.', 'PERFORMANCE_RESULT_NOT_FOUND', 404);
    const open = await tx.performanceCorrection.findFirst({ where: { evaluationId: evaluation.id, status: 'OPEN' } });
    if (open) return open;
    const latest = await tx.performanceCorrection.findFirst({ where: { evaluationId: evaluation.id }, orderBy: { version: 'desc' } });
    const correction = await tx.performanceCorrection.create({ data: {
      evaluationId: evaluation.id,
      targetResultId: target.id,
      version: (latest?.version ?? 0) + 1,
      correctionKind: input.correctionKind.trim() || 'RESULT_CORRECTION',
      reason: input.reason.trim(),
      requestedByUserId: input.actorUserId,
    } });
    const activeHandoffs = await tx.performanceConsequenceHandoff.findMany({
      where: { subjectId: evaluation.subjectId, status: { in: ['SENT', 'RECEIVED'] } },
      select: { id: true, encryptedPayloadId: true },
    });
    const keyring = performanceVaultKeyFromEnvironment();
    const affected: string[] = [];
    for (const handoff of activeHandoffs) {
      const snapshot = await readPerformancePayload<{ selectedResults?: Array<{ id?: string }> }>(tx, handoff.encryptedPayloadId, keyring);
      if (snapshot.selectedResults?.some(({ id }) => id === target.id)) affected.push(handoff.id);
    }
    if (affected.length) await tx.performanceConsequenceHandoff.updateMany({ where: { id: { in: affected } }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
    return correction;
  });
};
