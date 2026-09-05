import { activePerformanceRestrictionIds } from './personnelPerformanceRestrictionQueries';
import { readPerformanceRetentionPolicy } from './personnelPerformanceRetentionStore';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { PerformanceExportStatus, PerformanceProjectionState, PerformanceResultStatus, Prisma, type PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser, resolveHrNamedResponsibility } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import {
  buildPerformanceAnalytics,
  buildPerformanceBadgeSummary,
  buildPerformanceCalibration,
  escapePerformanceSpreadsheetCell,
  escapePerformanceExportHtml,
  validateConsequenceHandoff,
  type PerformanceAnalyticsMember,
  type PerformanceConsequenceRule,
  PERFORMANCE_LEVELS,
  performanceReportingQuarter,
  performanceReportingMonths,
  performancePeerFamilyKey,
  latestPerformancePeerFamilies,
} from './personnelPerformanceDisclosure';
import {
  performanceVaultKeyFromEnvironment,
  persistPerformancePayload,
  readPerformancePayload,
  type PerformanceVaultKey,
} from './personnelPerformancePayloadStore';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';
import { publishNotificationEvent } from './notificationService';
import { generatePdfBufferFromHtml } from '../utils/pdf';

const disclosureError = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });

type ConsequencePolicyContent = { schemaVersion: 1; rules: Record<string, PerformanceConsequenceRule> };
const effectiveConsequencePolicy = async (client: PrismaClient | Prisma.TransactionClient, at = new Date()) => {
  const version = await client.performanceConsequencePolicyVersion.findFirst({
    where: { lifecycle: 'ACTIVE', effectiveFrom: { lte: at } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!version) throw disclosureError('سیاست فعال ارجاع پیامد عملکرد وجود ندارد.', 'PERFORMANCE_CONSEQUENCE_POLICY_MISSING', 409);
  const content = version.content as unknown as ConsequencePolicyContent;
  if (content.schemaVersion !== 1 || !content.rules || typeof content.rules !== 'object') {
    throw disclosureError('ساختار سیاست ارجاع پیامد پشتیبانی نمی‌شود.', 'PERFORMANCE_CONSEQUENCE_POLICY_INVALID', 409);
  }
  return { version, content };
};

const consequenceRule = (policy: ConsequencePolicyContent, consequenceType: string) => {
  const rule = policy.rules[consequenceType];
  if (!rule || !Number.isInteger(rule.minimumResults) || rule.minimumResults < 1
    || !Number.isInteger(rule.maximumAgeDays) || rule.maximumAgeDays < 1
    || !rule.destination?.responsibilityTypeCode || !rule.destination.workspaceCode || !rule.destination.queueCode
    || (rule.requireLegalControl && !rule.legalControlResponsibilityTypeCode)) {
    throw disclosureError('نوع پیامد در سیاست فعال تعریف نشده است.', 'PERFORMANCE_CONSEQUENCE_TYPE_INVALID', 422);
  }
  return rule;
};
export const performanceExportStorageDirectory = () => path.resolve(process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR || path.join(process.cwd(), 'storage', 'performance-exports'));
const exportRoot = performanceExportStorageDirectory;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const DEVELOPMENT_EXPORT_KEY = createHash('sha256').update('sabalan-local-performance-export-key').digest();

export const validatePerformanceExportKeyEnvironment = (environment: NodeJS.ProcessEnv = process.env) => {
  const encoded = environment.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64?.trim();
  const keyId = environment.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID?.trim();
  if (encoded && keyId) {
    const key = Buffer.from(encoded, 'base64');
    const payloadKey = environment.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64?.replace(/\s/g, '');
    if (/^(change|replace|example|placeholder|local)/i.test(keyId) || key.length !== 32 || key.toString('base64') !== encoded.replace(/\s/g, '') || payloadKey === encoded.replace(/\s/g, '')) throw disclosureError('کلید رمزگذاری خروجی عملکرد باید معتبر و مستقل از کلید مخزن باشد.', 'PERFORMANCE_EXPORT_ENCRYPTION_CONFIGURATION_INVALID', 500);
    return { keyId, key };
  }
  throw disclosureError('کلید مستقل خروجی عملکرد پیکربندی نشده است.', 'PERFORMANCE_EXPORT_ENCRYPTION_CONFIGURATION_MISSING', 500);
};

export const performanceExportKeyFromEnvironment = () => {
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

export const withinPerformanceExportDeadline = async <T>(work: (signal: AbortSignal) => Promise<T>, milliseconds = 5 * 60_000) => {
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(disclosureError('زمان تولید خروجی از سقف مجاز گذشت.', 'PERFORMANCE_EXPORT_GENERATION_TIMEOUT', 504)); }, milliseconds); }),
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
  encryptedPayloadId?: string;
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
    encryptedPayloadId: input.encryptedPayloadId,
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

const activeDisclosureCohort = (client: PrismaClient, cohortVersionId: string | null | undefined) => cohortVersionId
  ? client.performanceCohortVersion.findFirst({ where: { id: cohortVersionId, lifecycle: 'ACTIVE', effectiveFrom: { lte: new Date() } }, select: { id: true } })
  : Promise.resolve(null);

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
  if (!await activeDisclosureCohort(client, phase.cohortVersionId)) return null;
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
  const cohort = await activeDisclosureCohort(client, phase.cohortVersionId);
  if (!cohort) return [];
  const cohortSubjects = await client.performanceCohortMember.findMany({ where: { cohortVersionId: cohort.id }, select: { subjectId: true } });
  const projections = await client.performanceCurrentLevelProjection.findMany({
    where: { state: PerformanceProjectionState.LEVEL, levelCode: { not: null }, subjectId: { in: cohortSubjects.map(({ subjectId }) => subjectId) } },
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
  const activeFamilies = latestPerformancePeerFamilies(await client.performancePeerFamilyVersion.findMany({
    where: { lifecycle: 'ACTIVE', effectiveFrom: { lte: new Date() } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  }));
  const familyJobs = activeFamilies.length ? await client.performancePeerFamilyJob.findMany({
    where: { familyVersionId: { in: activeFamilies.map(({ id }) => id) } },
  }) : [];
  const currentFamilyByJob = new Map([...new Set(familyJobs.map(({ jobId }) => jobId))].map((jobId) => [jobId,
    performancePeerFamilyKey(jobId, activeFamilies.filter((family) => familyJobs.some((member) => member.jobId === jobId && member.familyVersionId === family.id))),
  ]));
  const results = await client.performanceAcceptedResult.findMany({
    where: { AND: [{ evaluationId: { notIn: await activePerformanceRestrictionIds(client) } }], status: PerformanceResultStatus.EFFECTIVE, expiresAt: { gt: new Date() } },
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
    if (jobId === 'unclassified' || currentFamilyByJob.get(jobId) === null) return [];
    const score = resultBySubject.get(subject.id);
    if (!score) return [];
    return [{
      subjectId: subject.id,
      personnelId: relationship.personnel.id,
      displayName: `${relationship.personnel.firstName} ${relationship.personnel.lastName}`.trim(),
      employmentRelationshipId: relationship.id,
      levelCode: projection.levelCode,
      comparabilitySignature: score.signature,
      peerGroupKey: currentFamilyByJob.get(jobId) ?? `job:${jobId}`,
      measurementTo: projection.newestMeasurementTo ?? projection.projectedAt,
    }];
  });
};

const analyticsAuthorizedSubjectIds = async (client: PrismaClient) => {
  const phase = await client.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
  if (!phase?.releaseEnabled || ['SCHEMA_PROTECTION', 'POLICY_DARK_LAUNCH', 'READINESS', 'SUPERVISOR_HR_PILOT', 'RESULT_LEVEL_BADGE'].includes(phase.phase)) return [];
  const cohort = await activeDisclosureCohort(client, phase.cohortVersionId);
  if (!cohort) return [];
  return (await client.performanceCohortMember.findMany({ where: { cohortVersionId: cohort.id }, select: { subjectId: true } })).map(({ subjectId }) => subjectId);
};

const historicalAnalyticsPopulation = async (
  client: PrismaClient,
  keyring: PerformanceVaultKey,
  reportingFrom: Date,
  reportingTo: Date,
  namedRanking = false,
): Promise<PerformanceAnalyticsMember[]> => {
  const authorizedSubjectIds = await analyticsAuthorizedSubjectIds(client);
  if (!authorizedSubjectIds.length) return [];
  const evaluations = await client.performanceEvaluation.findMany({ where: {
    status: 'ACCEPTED', subjectId: { in: authorizedSubjectIds }, measurementTo: { gte: reportingFrom, lt: reportingTo },
  } });
  const results = evaluations.length ? await client.performanceAcceptedResult.findMany({
    where: { AND: [{ evaluationId: { notIn: await activePerformanceRestrictionIds(client) } }], evaluationId: { in: evaluations.map(({ id }) => id) }, status: namedRanking ? PerformanceResultStatus.EFFECTIVE : { in: [PerformanceResultStatus.EFFECTIVE, PerformanceResultStatus.EXPIRED] },
      ...(namedRanking ? { expiresAt: { gt: new Date() } } : {}) },
    orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }],
  }) : [];
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const latestBySubject = new Map<string, typeof results[number]>();
  for (const result of [...results].sort((a, b) =>
    (evaluationById.get(b.evaluationId)?.measurementTo.getTime() ?? 0) - (evaluationById.get(a.evaluationId)?.measurementTo.getTime() ?? 0)
    || b.version - a.version)) {
    const evaluation = evaluationById.get(result.evaluationId);
    if (evaluation && !latestBySubject.has(evaluation.subjectId)) latestBySubject.set(evaluation.subjectId, result);
  }
  const subjects = await client.performanceSubject.findMany({
    where: { id: { in: [...latestBySubject.keys()] }, identityDetachedAt: null },
  });
  const relationships = await client.hrEmploymentRelationship.findMany({
    where: {
      id: { in: subjects.map(({ employmentRelationshipId }) => employmentRelationshipId).filter((id): id is string => Boolean(id)) },
      effectiveFrom: { lte: reportingTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: reportingFrom } }],
    }, include: { personnel: { select: { id: true, firstName: true, lastName: true } } },
  });
  const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  const members: PerformanceAnalyticsMember[] = [];
  for (const subject of subjects) {
    const relationship = subject.employmentRelationshipId ? relationshipById.get(subject.employmentRelationshipId) : null;
    const result = latestBySubject.get(subject.id);
    const evaluation = result ? evaluationById.get(result.evaluationId) : null;
    if (!relationship || !result || !evaluation) continue;
    const payload = await readPerformancePayload<ResultPayload>(client, result.encryptedPayloadId, keyring);
    const sections = await client.performanceEvaluationSection.findMany({ where: { evaluationId: evaluation.id, status: 'ACCEPTED' }, select: { employmentAssignmentId: true } });
    const assignments = await client.hrEmploymentAssignment.findMany({ where: { id: { in: sections.map(({ employmentAssignmentId }) => employmentAssignmentId) } }, include: { position: { select: { jobId: true } } } });
    const peerKeys = new Set<string>();
    let completeJobCoverage = true;
    for (const assignment of assignments) {
      const jobId = assignment.position?.jobId;
      if (!jobId) { completeJobCoverage = false; continue; }
      // Resolve the version before membership: a newer version may remove this Job.
      const effectiveFamilies = latestPerformancePeerFamilies(await client.performancePeerFamilyVersion.findMany({ where: {
        lifecycle: { in: ['ACTIVE', 'RETIRED'] },
        effectiveFrom: { lte: evaluation.measurementTo },
      }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] }));
      const memberships = await client.performancePeerFamilyJob.findMany({ where: { jobId, familyVersionId: { in: effectiveFamilies.map(({ id }) => id) } } });
      const families = effectiveFamilies.filter((family) => memberships.some(({ familyVersionId }) => familyVersionId === family.id));
      const peerKey = performancePeerFamilyKey(jobId, families);
      if (!peerKey) { peerKeys.add('ambiguous'); peerKeys.add(`job:${jobId}`); }
      else peerKeys.add(peerKey);
    }
    if (namedRanking && (!completeJobCoverage || peerKeys.size !== 1 || assignments.length !== sections.length || !sections.length)) continue;
    members.push({
      subjectId: subject.id, personnelId: relationship.personnel.id,
      displayName: `${relationship.personnel.firstName} ${relationship.personnel.lastName}`.trim(),
      employmentRelationshipId: relationship.id, levelCode: result.levelCode,
      comparabilitySignature: payload.templateSnapshotHash ?? result.levelPolicyVersionId,
      peerGroupKey: peerKeys.size === 1 ? [...peerKeys][0] : 'aggregate-only',
      measurementTo: evaluation.measurementTo,
    });
  }
  return members;
};

export const fixedCohortPerformanceTrend = async (
  client: PrismaClient | Prisma.TransactionClient,
  authorizedSubjectIds: readonly string[],
  reportingFrom: Date,
  reportingTo: Date,
) => {
  if (!authorizedSubjectIds.length) return { suppressed: true as const, reasonCode: 'TREND_REPORTING_DISABLED' };
  const evaluations = await client.performanceEvaluation.findMany({
    where: {
      status: 'ACCEPTED', subjectId: { in: [...authorizedSubjectIds] },
      ...(reportingFrom || reportingTo ? { measurementTo: { ...(reportingFrom ? { gte: reportingFrom } : {}), ...(reportingTo ? { lt: reportingTo } : {}) } } : {}),
    }, orderBy: [{ measurementTo: 'desc' }, { id: 'desc' }],
    select: { id: true, subjectId: true, measurementFrom: true, measurementTo: true },
  });
  const periodKeys = performanceReportingMonths(reportingFrom, reportingTo);
  if (periodKeys.length < 2) return { suppressed: true as const, reasonCode: 'TREND_PERIODS_INSUFFICIENT' };
  const relevant = evaluations.filter(({ measurementTo }) => periodKeys.includes(`${measurementTo.getUTCFullYear()}-${String(measurementTo.getUTCMonth() + 1).padStart(2, '0')}`));
  const results = await client.performanceAcceptedResult.findMany({
    where: { AND: [{ evaluationId: { notIn: await activePerformanceRestrictionIds(client) } }], evaluationId: { in: relevant.map(({ id }) => id) }, status: { in: [PerformanceResultStatus.EFFECTIVE, PerformanceResultStatus.EXPIRED] } },
    orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }],
  });
  const evaluationById = new Map(relevant.map((evaluation) => [evaluation.id, evaluation]));
  const byPeriod = new Map<string, Map<string, { levelCode: string; resultId: string; evaluationId: string }>>();
  for (const result of [...results].sort((a, b) =>
    (evaluationById.get(b.evaluationId)?.measurementTo.getTime() ?? 0) - (evaluationById.get(a.evaluationId)?.measurementTo.getTime() ?? 0)
    || b.version - a.version)) {
    const evaluation = evaluationById.get(result.evaluationId);
    if (!evaluation) continue;
    const periodKey = `${evaluation.measurementTo.getUTCFullYear()}-${String(evaluation.measurementTo.getUTCMonth() + 1).padStart(2, '0')}`;
    const members = byPeriod.get(periodKey) ?? new Map();
    if (!members.has(evaluation.subjectId)) members.set(evaluation.subjectId, { levelCode: result.levelCode, resultId: result.id, evaluationId: evaluation.id });
    byPeriod.set(periodKey, members);
  }
  const fixedSubjects = periodKeys.reduce<Set<string>>((intersection, periodKey, index) => {
    const subjects = new Set(byPeriod.get(periodKey)?.keys() ?? []);
    return index === 0 ? subjects : new Set([...intersection].filter((subjectId) => subjects.has(subjectId)));
  }, new Set());
  const authorizedSubjects = await client.performanceSubject.findMany({
    where: { id: { in: [...authorizedSubjectIds] }, identityDetachedAt: null }, select: { id: true, employmentRelationshipId: true },
  });
  const relationships = await client.hrEmploymentRelationship.findMany({
    where: { id: { in: authorizedSubjects.map(({ employmentRelationshipId }) => employmentRelationshipId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, effectiveFrom: true, effectiveTo: true },
  });
  const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  const eligibleByPeriod = new Map(periodKeys.map((periodKey) => {
    const [year, month] = periodKey.split('-').map(Number);
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 1));
    return [periodKey, new Set(authorizedSubjects.filter(({ employmentRelationshipId }) => {
      const relationship = employmentRelationshipId ? relationshipById.get(employmentRelationshipId) : null;
      return Boolean(relationship && relationship.effectiveFrom < periodEnd && (!relationship.effectiveTo || relationship.effectiveTo >= periodStart));
    }).map(({ id }) => id))] as const;
  }));
  const populationPeriods = periodKeys.map((periodKey, index) => {
    const eligible = eligibleByPeriod.get(periodKey) ?? new Set<string>();
    const previousEligible = new Set(index + 1 < periodKeys.length ? eligibleByPeriod.get(periodKeys[index + 1]) ?? [] : []);
    const present = new Set(byPeriod.get(periodKey)?.keys() ?? []);
    return {
      periodKey, eligiblePopulationCount: eligible.size,
      resultPopulationCount: [...present].filter((subjectId) => eligible.has(subjectId)).length,
      missingResultCount: [...eligible].filter((subjectId) => !present.has(subjectId)).length,
      entriesSincePrevious: index + 1 < periodKeys.length ? [...eligible].filter((subjectId) => !previousEligible.has(subjectId)).length : 0,
      exitsSincePrevious: index + 1 < periodKeys.length ? [...previousEligible].filter((subjectId) => !eligible.has(subjectId)).length : 0,
    };
  });
  const exposesSmallDifference = populationPeriods.some((period) => [period.missingResultCount, period.entriesSincePrevious, period.exitsSincePrevious]
    .some((count) => count > 0 && count < 10) || period.eligiblePopulationCount < 10 || (period.resultPopulationCount > 0 && period.resultPopulationCount < 10));
  const fixedPeriods = periodKeys.map((periodKey) => ({
    periodKey,
    levelDistribution: PERFORMANCE_LEVELS.map((level) => ({
      levelCode: level.code, labelFa: level.labelFa,
      count: [...fixedSubjects].filter((subjectId) => byPeriod.get(periodKey)?.get(subjectId)?.levelCode === level.code).length,
    })),
  }));
  const fixedSuppressed = fixedSubjects.size < 10 || fixedPeriods.some(({ levelDistribution }) => levelDistribution.some(({ count }) => count > 0 && count < 10));
  return {
    suppressed: false as const,
    fixedCohortSuppressed: fixedSuppressed,
    fixedCohortCount: fixedSuppressed ? undefined : fixedSubjects.size,
    periods: fixedSuppressed ? [] : fixedPeriods,
    populationComposition: exposesSmallDifference
      ? { suppressed: true as const, reasonCode: 'TREND_COMPOSITION_DIFFERENCING_RISK' }
      : { suppressed: false as const, periods: populationPeriods },
    reconstruction: periodKeys.map((periodKey) => ({
      periodKey,
      members: [...fixedSubjects].map((subjectId) => ({ subjectId, ...byPeriod.get(periodKey)?.get(subjectId) })),
    })),
  };
};

export const getPerformanceAnalytics = async (client: PrismaClient, input: {
  actorUserId: string;
  personnelIds?: readonly string[];
  mode?: 'AGGREGATE' | 'NAMED_RANKING';
  reportingFrom?: Date;
  reportingTo?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const quarter = performanceReportingQuarter(input.reportingFrom, input.reportingTo);
  const population = await historicalAnalyticsPopulation(client, keyring, quarter.from, quarter.to, input.mode === 'NAMED_RANKING');
  if (input.personnelIds?.length) throw disclosureError('فیلتر دلخواه افراد برای این گزارش محرمانه مجاز نیست.', 'PERFORMANCE_ANALYTICS_ARBITRARY_SCOPE_FORBIDDEN', 422);
  const selected = population;
  const baseResult = buildPerformanceAnalytics({ population, selected, mode: input.mode });
  const authorizedSubjectIds = await analyticsAuthorizedSubjectIds(client);
  const trend = input.mode === 'NAMED_RANKING'
    ? undefined
    : await fixedCohortPerformanceTrend(client, authorizedSubjectIds, quarter.from, quarter.to);
  const result = trend ? { ...baseResult, trend: trend.suppressed ? trend : { ...trend, reconstruction: undefined } } : baseResult;
  const reconstructionId = randomUUID();
  await client.$transaction(async (tx) => {
    const snapshot = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_ANALYTICS_RECONSTRUCTION', aggregateId: reconstructionId, payloadKind: 'REPORTING_WINDOW', schemaVersion: 1,
      payload: {
        asOf: new Date().toISOString(), windowKind: 'CANONICAL_QUARTER',
        reportingFrom: quarter.from.toISOString(), reportingTo: quarter.to.toISOString(),
        mode: input.mode ?? 'AGGREGATE',
        population: population.map(({ subjectId, employmentRelationshipId, levelCode, comparabilitySignature, peerGroupKey, measurementTo }) => ({ subjectId, employmentRelationshipId, levelCode, comparabilitySignature, peerGroupKey, measurementTo })),
        suppressionOrResult: result,
        trendReconstruction: trend && !trend.suppressed ? trend.reconstruction : trend,
      }, keyring,
    });
    await auditDisclosure(tx, {
      aggregateType: 'PERFORMANCE_ANALYTICS', aggregateId: reconstructionId,
      eventType: input.mode === 'NAMED_RANKING' ? 'NAMED_RANKING_VIEWED' : 'AGGREGATE_ANALYTICS_VIEWED',
      actorUserId: input.actorUserId,
      authorityCodes: [input.mode === 'NAMED_RANKING' ? 'VIEW_NAMED_PERFORMANCE_RANKING' : 'VIEW_PERFORMANCE_ANALYTICS'],
      evidenceHash: snapshot.contentHash,
      encryptedPayloadId: snapshot.id,
    });
  });
  return result;
};

export const getEvaluatorCalibration = async (client: PrismaClient, input: { actorUserId: string; evaluatorPersonnelId: string; keyring?: PerformanceVaultKey }) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const submissions = await client.performanceSubmission.findMany({ where: { supervisorPersonnelId: input.evaluatorPersonnelId } });
  const sections = submissions.length ? await client.performanceEvaluationSection.findMany({ where: { id: { in: submissions.map(({ sectionId }) => sectionId) }, status: 'ACCEPTED' } }) : [];
  const evaluations = sections.length ? await client.performanceEvaluation.findMany({ where: { id: { in: sections.map(({ evaluationId }) => evaluationId), notIn: await activePerformanceRestrictionIds(client) } } }) : [];
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
  const rows = Array.isArray(object.peerGroups)
    ? (object.peerGroups as Array<{ peerGroupKey: string; groups: Array<{ labelFa: string; members: Array<Record<string, unknown>> }> }>).flatMap((peer) => peer.groups.flatMap((group) => group.members.map((member) => ({ peerGroupKey: peer.peerGroupKey, level: group.labelFa, ...member }))))
    : Array.isArray(object.levelDistribution) ? object.levelDistribution as Array<Record<string, unknown>> : [object];
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, escapePerformanceSpreadsheetCell(value)])));
};

const renderExportArtifact = async (kind: 'XLSX' | 'PDF', rows: Array<Record<string, unknown>>, signal: AbortSignal) => {
  if (kind === 'XLSX') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'گزارش عملکرد');
    return { bytes: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const html = `<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px;text-align:right}h1{font-size:20px}</style><h1>گزارش محرمانه عملکرد</h1><table><thead><tr>${headers.map((header) => `<th>${escapePerformanceExportHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapePerformanceExportHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`;
  return { bytes: await generatePdfBufferFromHtml({ htmlContent: html, signal }), mimeType: 'application/pdf' };
};

export const processPerformanceExport = async (client: PrismaClient, exportId: string, keyring = performanceVaultKeyFromEnvironment()) => {
  const receipt = await runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-export-queue'}, 0))`;
    const queued = await tx.performanceExportReceipt.findUnique({ where: { id: exportId } });
    if (!queued || queued.status !== PerformanceExportStatus.QUEUED) return null;
    const revision = await evidenceRevision(tx, true);
    const payload = queued.encryptedPayloadId ? await readPerformancePayload<{ scope?: { evidenceRevision?: string; reportKind?: string } }>(tx, queued.encryptedPayloadId, keyring) : null;
    const permissions = await activeHrActionPermissionsForUser(tx, queued.requestedByUserId);
    const requiredView = payload?.scope?.reportKind === 'NAMED_RANKING' ? 'VIEW_NAMED_PERFORMANCE_RANKING' : 'VIEW_PERFORMANCE_ANALYTICS';
    if (!payload?.scope || payload.scope.evidenceRevision !== revision || !permissions.includes('REQUEST_PERFORMANCE_EXPORT') || !permissions.includes(requiredView)) {
      await tx.performanceExportReceipt.update({ where: { id: queued.id }, data: { status: 'FAILED', failureCode: 'PERFORMANCE_EXPORT_AUTHORIZATION_CHANGED' } });
      return null;
    }
    const limit = queued.exportKind === 'PDF' ? 2 : 5;
    const running = await tx.performanceExportReceipt.count({ where: { exportKind: queued.exportKind, status: PerformanceExportStatus.RUNNING } });
    if (running >= limit) return null;
    const attemptCount = queued.attemptCount + 1;
    const artifactPath = path.join(exportRoot(), `${queued.id}-${attemptCount}.${queued.exportKind === 'PDF' ? 'pdf' : 'xlsx'}.enc`);
    // Commit the path before writing any bytes so interrupted and superseded attempts remain discoverable.
    await tx.performanceExportArtifact.create({ data: { exportId: queued.id, attemptCount, artifactPath } });
    return tx.performanceExportReceipt.update({ where: { id: queued.id }, data: { status: PerformanceExportStatus.RUNNING, startedAt: new Date(), attemptCount, artifactPath, failureCode: null } });
  });
  if (!receipt?.encryptedPayloadId) return null;
  try {
    const payload = await readPerformancePayload<{ report: unknown; scope: { evidenceRevision: string } }>(client, receipt.encryptedPayloadId, keyring);
    const rows = exportRows(payload.report);
    if ((receipt.exportKind === 'XLSX' && rows.length > 100_000) || (receipt.exportKind === 'PDF' && rows.length > 12_500)) {
      throw disclosureError('دامنه خروجی از سقف مجاز بیشتر است.', 'PERFORMANCE_EXPORT_SCOPE_TOO_LARGE', 422);
    }
    await mkdir(exportRoot(), { recursive: true, mode: 0o700 });
    const artifactPath = receipt.artifactPath!;
    const rendered = await withinPerformanceExportDeadline((signal) => renderExportArtifact(receipt.exportKind as 'XLSX' | 'PDF', rows, signal));
    const artifactHash = createHash('sha256').update(rendered.bytes).digest('hex');
    const maximumBytes = receipt.exportKind === 'PDF' ? 50 * 1024 * 1024 : 100 * 1024 * 1024;
    if (rendered.bytes.length > maximumBytes) {
      throw disclosureError('حجم فایل خروجی از سقف مجاز بیشتر است.', 'PERFORMANCE_EXPORT_FILE_TOO_LARGE', 422);
    }
    const exportKey = performanceExportKeyFromEnvironment();
    const promoted = await client.$transaction(async (tx) => {
      if (await evidenceRevision(tx, true) !== payload.scope.evidenceRevision) throw disclosureError('شواهد خروجی تغییر کرده است.', 'PERFORMANCE_EXPORT_EVIDENCE_CHANGED', 409);
      const scopeHash = createHash('sha256').update(receipt.id).digest('hex');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'PERFORMANCE_EXPORT:' + scopeHash}, 0))`;
      const current = await tx.performanceExportReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
      if (current.status !== PerformanceExportStatus.RUNNING || current.attemptCount !== receipt.attemptCount
        || !current.expiresAt || current.expiresAt <= new Date()) return 0;
      // Serialize storage publication with cleanup; a delayed renderer must never recreate a deleted file.
      await writeFile(artifactPath, encryptPerformanceExportArtifact(rendered.bytes, exportKey.key), { mode: 0o600 });
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
    if (promoted !== 1) {
      return null;
    }
    const ready = await client.performanceExportReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    return ready;
  } catch (error) {
    const current = await client.performanceExportReceipt.findUnique({ where: { id: receipt.id } });
    if (current?.status === PerformanceExportStatus.READY) return current;
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'PERFORMANCE_EXPORT_GENERATION_FAILED';
    // Failed files remain in the committed inventory until policy- and hold-aware cleanup.
    const retryable = ['PERFORMANCE_EXPORT_GENERATION_FAILED', 'PERFORMANCE_EXPORT_GENERATION_TIMEOUT'].includes(code) && receipt.attemptCount < 3;
    await client.performanceExportReceipt.updateMany({
      where: { id: receipt.id, status: PerformanceExportStatus.RUNNING, attemptCount: receipt.attemptCount },
      data: { status: retryable ? PerformanceExportStatus.QUEUED : PerformanceExportStatus.FAILED, failureCode: code, artifactPath: null },
    });
    return null;
  }
};

const evidenceRevision = async (client: PrismaClient | Prisma.TransactionClient, lock = false) => {
  const rows = lock
    ? await client.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`
    : await client.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM performance_disclosure_revision WHERE id = 1`;
  if (rows.length !== 1) throw disclosureError('وضعیت حفاظت شواهد در دسترس نیست.', 'PERFORMANCE_DISCLOSURE_FENCE_UNAVAILABLE', 409);
  return String(rows[0].revision);
};

export const requestPerformanceExport = async (client: PrismaClient, input: {
  actorUserId: string;
  exportKind: 'PDF' | 'XLSX';
  reportKind: 'AGGREGATE' | 'NAMED_RANKING';
  personnelIds?: readonly string[];
  purpose: string;
  reportingFrom?: Date;
  reportingTo?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  if (!['PDF', 'XLSX'].includes(input.exportKind)) throw disclosureError('نوع فایل خروجی معتبر نیست.', 'PERFORMANCE_EXPORT_KIND_INVALID', 422);
  if (input.purpose.trim().length < 8) throw disclosureError('هدف خروجی باید روشن و دلیل‌دار باشد.', 'PERFORMANCE_EXPORT_PURPOSE_REQUIRED', 422);
  if (input.personnelIds?.length) throw disclosureError('فیلتر دلخواه افراد برای خروجی محرمانه مجاز نیست.', 'PERFORMANCE_EXPORT_ARBITRARY_SCOPE_FORBIDDEN', 422);
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const permissionCodes = await activeHrActionPermissionsForUser(client, input.actorUserId);
  const requiredView = input.reportKind === 'NAMED_RANKING' ? 'VIEW_NAMED_PERFORMANCE_RANKING' : 'VIEW_PERFORMANCE_ANALYTICS';
  if (!permissionCodes.includes(requiredView)) throw disclosureError('مجوز مشاهده محتوای این خروجی معتبر نیست.', 'PERFORMANCE_EXPORT_VIEW_PERMISSION_REQUIRED', 403);
  const revision = await evidenceRevision(client);
  const report = await getPerformanceAnalytics(client, {
    actorUserId: input.actorUserId,
    personnelIds: input.personnelIds,
    mode: input.reportKind === 'NAMED_RANKING' ? 'NAMED_RANKING' : 'AGGREGATE',
    reportingFrom: input.reportingFrom, reportingTo: input.reportingTo,
    keyring,
  });
  if (report.suppressed) throw disclosureError(report.messageFa, report.reasonCode, 409);
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const id = randomUUID();
  const scope = { evidenceRevision: revision, reportKind: input.reportKind, personnelIds: [...(input.personnelIds ?? [])].sort(), purpose: input.purpose.trim(), generatedFromHash: canonicalPerformanceHash(report) };
  const receipt = await client.$transaction(async (tx) => {
    if (await evidenceRevision(tx, true) !== revision) throw disclosureError('شواهد گزارش تغییر کرده است؛ خروجی تازه درخواست کنید.', 'PERFORMANCE_EXPORT_EVIDENCE_CHANGED', 409);
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_EXPORT', aggregateId: id, payloadKind: 'SCOPE_SNAPSHOT', schemaVersion: 1,
      payload: { scope, report }, keyring,
    });
    return tx.performanceExportReceipt.create({ data: {
      id,
      requestedByUserId: input.actorUserId,
      exportKind: input.exportKind,
      scopeHash: canonicalPerformanceHash(scope),
      permissionHash: canonicalPerformanceHash(permissionCodes.sort()),
      encryptedPayloadId: encrypted.id,
      downloadTokenHash: tokenHash(token),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    } });
  });
  queueMicrotask(() => { void processPerformanceExport(client, receipt.id, keyring).catch(() => {
    console.error('Performance export dispatch failed closed; queued work remains available for recovery.');
  }); });
  return { receipt, downloadToken: token };
};

export const processQueuedPerformanceExports = async (client: PrismaClient, keyring = performanceVaultKeyFromEnvironment()) => {
  const staleBefore = new Date(Date.now() - 6 * 60_000);
  const stale = await client.performanceExportReceipt.findMany({ where: { status: PerformanceExportStatus.RUNNING, startedAt: { lte: staleBefore } } });
  for (const receipt of stale) {
    await client.performanceExportReceipt.updateMany({
      where: { id: receipt.id, status: PerformanceExportStatus.RUNNING, attemptCount: receipt.attemptCount },
      data: {
        status: receipt.attemptCount < 3 ? PerformanceExportStatus.QUEUED : PerformanceExportStatus.FAILED,
        failureCode: receipt.attemptCount < 3 ? 'PERFORMANCE_EXPORT_WORKER_INTERRUPTED' : 'PERFORMANCE_EXPORT_RETRY_EXHAUSTED',
        artifactPath: null,
      },
    });
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

export const claimPerformanceExportDownload = async (client: PrismaClient | Prisma.TransactionClient, input: { exportId: string; actorUserId: string; token: string }) => {
  const work = async (tx: Prisma.TransactionClient) => {
  const revision = await evidenceRevision(tx, true);
  const now = new Date();
  const permissions = await activeHrActionPermissionsForUser(tx, input.actorUserId);
  if (!permissions.includes('REQUEST_PERFORMANCE_EXPORT')) throw disclosureError('مجوز دانلود این خروجی دیگر معتبر نیست.', 'PERFORMANCE_EXPORT_PERMISSION_REVOKED', 403);
  const receipt = await tx.performanceExportReceipt.findUnique({ where: { id: input.exportId } });
  if (!receipt || receipt.requestedByUserId !== input.actorUserId || receipt.downloadTokenHash !== tokenHash(input.token)) {
    throw disclosureError('خروجی پیدا نشد.', 'PERFORMANCE_EXPORT_NOT_FOUND', 404);
  }
  const scope = receipt.encryptedPayloadId ? await readPerformancePayload<{ scope?: { reportKind?: string; evidenceRevision?: string } }>(tx, receipt.encryptedPayloadId, performanceVaultKeyFromEnvironment()) : null;
  if (!scope?.scope?.evidenceRevision || scope.scope.evidenceRevision !== revision) throw disclosureError('شواهد گزارش تغییر کرده است؛ خروجی تازه درخواست کنید.', 'PERFORMANCE_EXPORT_EVIDENCE_CHANGED', 409);
  const requiredView = scope?.scope?.reportKind === 'NAMED_RANKING' ? 'VIEW_NAMED_PERFORMANCE_RANKING' : 'VIEW_PERFORMANCE_ANALYTICS';
  if (!permissions.includes(requiredView)) throw disclosureError('مجوز مشاهده محتوای این خروجی دیگر معتبر نیست.', 'PERFORMANCE_EXPORT_PERMISSION_REVOKED', 403);
  if (receipt.status !== PerformanceExportStatus.READY || !receipt.artifactPath || !receipt.downloadTokenExpiresAt || receipt.downloadTokenExpiresAt <= now || !receipt.expiresAt || receipt.expiresAt <= now) {
    throw disclosureError('پیوند دانلود منقضی یا استفاده شده است.', 'PERFORMANCE_EXPORT_LINK_EXPIRED', 410);
  }
  const exportKey = performanceExportKeyFromEnvironment();
  if (receipt.artifactKeyId !== exportKey.keyId) throw disclosureError('کلید فایل خروجی در دسترس نیست.', 'PERFORMANCE_EXPORT_KEY_UNAVAILABLE', 410);
  const bytes = decryptPerformanceExportArtifact(await readFile(receipt.artifactPath), exportKey.key);
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.artifactHash) throw disclosureError('تمامیت فایل خروجی تأیید نشد.', 'PERFORMANCE_EXPORT_INTEGRITY_FAILED', 500);
  const claimed = await tx.performanceExportReceipt.updateMany({
    where: { id: receipt.id, status: PerformanceExportStatus.READY, downloadedAt: null },
    data: { status: PerformanceExportStatus.DELIVERING },
  });
  if (claimed.count !== 1) throw disclosureError('پیوند دانلود قبلاً استفاده شده است.', 'PERFORMANCE_EXPORT_ALREADY_DOWNLOADED', 409);
  return { bytes, mimeType: receipt.artifactMimeType ?? 'application/octet-stream', filename: `performance-${receipt.id}.${receipt.exportKind === 'PDF' ? 'pdf' : 'xlsx'}` };
  };
  return '$transaction' in client ? client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 }) : work(client);
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

const redactPerformanceExportPayload = async (client: PrismaClient | Prisma.TransactionClient, receipt: {
  id: string; encryptedPayloadId: string | null; scopeHash: string; requestedByUserId: string;
}, deletedAt: Date, actorUserId: string | null) => {
  const work = async (tx: Prisma.TransactionClient) => {
    await tx.performanceExportReceipt.update({ where: { id: receipt.id }, data: { status: PerformanceExportStatus.DELETED, deletedAt, artifactPath: null, encryptedPayloadId: null } });
    if (receipt.encryptedPayloadId) {
      const [payload, { policy: retentionPolicy }] = await Promise.all([
        tx.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: receipt.encryptedPayloadId } }),
        readPerformanceRetentionPolicy(tx, deletedAt),
      ]);
      await tx.performanceDeletionReceipt.create({ data: {
        deletedTableName: 'performance_encrypted_payloads', deletedRecordId: payload.id, deletedPayloadId: payload.id,
        aggregateType: payload.aggregateType, aggregateIdHash: createHash('sha256').update(payload.aggregateId).digest('hex'),
        scopeHash: receipt.scopeHash, policyVersionId: retentionPolicy.id, reasonCode: 'PERFORMANCE_EXPORT_TTL_CLEANUP',
        reason: 'پاک‌سازی محتوای کامل خروجی پس از تحویل یا پایان مهلت عملیاتی', recordCount: 1,
        dependencyEffectHash: canonicalPerformanceHash({ exportId: receipt.id, payloadId: payload.id, artifactDeleted: true }),
        actorUserId, authorityHash: canonicalPerformanceHash(actorUserId ? ['REQUEST_PERFORMANCE_EXPORT'] : ['SYSTEM_EXPORT_RETENTION']),
      } });
      await tx.performanceEncryptedPayload.delete({ where: { id: payload.id } });
    }
  };
  if ('$transaction' in client) return client.$transaction(work);
  return work(client);
};


const cleanupPerformanceExport = async (
  client: PrismaClient | Prisma.TransactionClient, exportId: string, now: Date, actorUserId: string | null,
) => {
  const candidate = await client.performanceExportReceipt.findUnique({ where: { id: exportId } });
  if (!candidate || candidate.status === PerformanceExportStatus.DELETED
    || (!candidate.downloadedAt && (!candidate.expiresAt || candidate.expiresAt > now))) return false;
  const { policy } = await readPerformanceRetentionPolicy(client, now);
  // With the runtime PrismaClient this intent commits before any filesystem mutation. A failed cleanup retains the same retry id.
  const attempt = await client.performanceExportCleanupAttempt.upsert({ where: { exportId }, update: {}, create: {
    exportId, policyVersionId: policy.id, artifactHash: candidate.artifactHash, scopeHash: candidate.scopeHash,
  } });
  if (attempt.status === 'LIVE_DELETED_PENDING_BACKUP') return false;
  const work = async (tx: Prisma.TransactionClient) => {
    // The hold is re-read after the scope lock. An older repeatable snapshot cannot authorize filesystem deletion.
    const isolation = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`;
    if (isolation[0]?.transaction_isolation !== 'read committed') {
      throw disclosureError('پاک‌سازی خروجی باید در تراکنش مستقل نگهداری انجام شود.', 'PERFORMANCE_CLEANUP_TRANSACTION_REQUIRED', 409);
    }
    await evidenceRevision(tx, true);
    const scopeHash = createHash('sha256').update(exportId).digest('hex');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'PERFORMANCE_EXPORT:' + scopeHash}, 0))`;
    const receipt = await tx.performanceExportReceipt.findUnique({ where: { id: exportId } });
    if (!receipt || receipt.status === PerformanceExportStatus.DELETED) return false;
    if (!receipt.downloadedAt && (!receipt.expiresAt || receipt.expiresAt > now)) return false;
    const payload = receipt.encryptedPayloadId
      ? await tx.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: receipt.encryptedPayloadId } }) : null;
    const scopes = [{ aggregateType: 'PERFORMANCE_EXPORT', aggregateIdHash: scopeHash }];
    if (payload) {
      const aggregateIdHash = createHash('sha256').update(payload.aggregateId).digest('hex');
      const lockKey = `${payload.aggregateType}:${aggregateIdHash}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      scopes.push({ aggregateType: payload.aggregateType, aggregateIdHash });
    }
    if (await tx.performanceLegalHold.findFirst({ where: { status: 'ACTIVE', OR: scopes }, select: { id: true } })) {
      await tx.performanceExportCleanupAttempt.update({ where: { id: attempt.id }, data: { status: 'HELD', attemptCount: { increment: 1 }, lastFailureCode: 'PERFORMANCE_LEGAL_HOLD_ACTIVE' } });
      return false;
    }
    await readPerformanceRetentionPolicy(tx, now);
    const artifacts = await tx.performanceExportArtifact.findMany({ where: { exportId }, select: { artifactPath: true } });
    const artifactPaths = new Set(artifacts.map((artifact) => artifact.artifactPath));
    if (receipt.artifactPath) artifactPaths.add(receipt.artifactPath);
    for (const artifactPath of artifactPaths) {
      await unlink(artifactPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
    await redactPerformanceExportPayload(tx, receipt, now, actorUserId);
    await tx.performanceExportCleanupAttempt.update({ where: { id: attempt.id }, data: { status: 'LIVE_DELETED_PENDING_BACKUP', liveDeletedAt: now, attemptCount: { increment: 1 }, lastFailureCode: null } });
    await auditDisclosure(tx, {
      aggregateType: 'PERFORMANCE_EXPORT', aggregateId: receipt.id, eventType: 'PERFORMANCE_EXPORT_CLEANED_UP',
      actorUserId, authorityCodes: actorUserId ? ['REQUEST_PERFORMANCE_EXPORT'] : ['SYSTEM_EXPORT_RETENTION'],
      evidenceHash: receipt.artifactHash ?? undefined,
    });
    return true;
  };
  try {
    return '$transaction' in client
      ? await client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }) : await work(client);
  } catch (error) {
    if ('$transaction' in client) {
      const persisted = await client.performanceExportCleanupAttempt.findUnique({ where: { id: attempt.id } }).catch(() => null);
      if (persisted?.status === 'LIVE_DELETED_PENDING_BACKUP') return true;
      await client.performanceExportCleanupAttempt.update({ where: { id: attempt.id }, data: {
        status: 'RETRY_REQUIRED', attemptCount: { increment: 1 }, lastFailureCode: 'PERFORMANCE_CLEANUP_STORAGE_OR_DATABASE_FAILURE',
      } }).catch(() => undefined);
    }
    throw error;
  }
};

const deleteDownloadedPerformanceExport = async (client: PrismaClient, exportId: string, actorUserId: string | null) => {
  await cleanupPerformanceExport(client, exportId, new Date(), actorUserId);
};

export const cleanupExpiredPerformanceExports = async (client: PrismaClient | Prisma.TransactionClient, now = new Date()) => {
  let count = 0;
  let failed = 0;
  let cursor: string | undefined;
  while (true) {
    const expired: Array<{ id: string }> = await client.performanceExportReceipt.findMany({
      where: { status: { not: PerformanceExportStatus.DELETED }, OR: [{ expiresAt: { lte: now } }, { downloadedAt: { not: null } }] },
      orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true },
    });
    if (!expired.length) break;
    for (const receipt of expired) {
      try { if (await cleanupPerformanceExport(client, receipt.id, now, null)) count += 1; } catch { failed += 1; }
    }
    cursor = expired[expired.length - 1].id;
  }
  if (failed) throw disclosureError('بخشی از پاک‌سازی تکمیل نشد و برای تلاش دوباره حفظ شد.', 'PERFORMANCE_CLEANUP_RETRY_REQUIRED', 503);
  return count;
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
    const { version: consequencePolicyVersion, content: consequencePolicy } = await effectiveConsequencePolicy(tx);
    const rule = consequenceRule(consequencePolicy, input.consequenceType);
    if (!['ACTIVE', 'SUSPENDED'].includes(relationship.status)
      && !(input.consequenceType === 'DISCRETIONARY_BONUS_REVIEW' && rule.allowEndedRelationship)) {
      throw disclosureError('سیاست فعال این نوع پیامد، ارجاع برای رابطه پایان‌یافته را مجاز نمی‌داند.', 'PERFORMANCE_HANDOFF_RELATIONSHIP_ENDED', 409);
    }
    const subject = await tx.performanceSubject.findFirst({ where: { personnelId: input.personnelId, employmentRelationshipId: relationship.id, identityDetachedAt: null } });
    if (!subject) throw disclosureError('موضوع عملکرد معتبر پیدا نشد.', 'PERFORMANCE_HANDOFF_SUBJECT_NOT_FOUND', 404);
    if (input.resultIds.length < rule.minimumResults) {
      throw disclosureError('تعداد نتیجه‌های انتخاب‌شده با سیاست فعال این نوع پیامد سازگار نیست.', 'PERFORMANCE_HANDOFF_MINIMUM_RESULTS_REQUIRED', 409);
    }
    const earliestAcceptedAt = new Date(Date.now() - rule.maximumAgeDays * 24 * 60 * 60_000);
    const results = await tx.performanceAcceptedResult.findMany({ where: { AND: [{ evaluationId: { notIn: await activePerformanceRestrictionIds(tx) } }],
      id: { in: [...input.resultIds] },
      status: PerformanceResultStatus.EFFECTIVE,
      expiresAt: { gt: new Date() },
      acceptedAt: { gte: earliestAcceptedAt },
    } });
    const evaluations = results.length ? await tx.performanceEvaluation.findMany({ where: { id: { in: results.map(({ evaluationId }) => evaluationId) }, subjectId: subject.id } }) : [];
    if (results.length !== new Set(input.resultIds).size || evaluations.length !== results.length) throw disclosureError('نتیجه‌های انتخاب‌شده به همین رابطه استخدامی تعلق ندارند.', 'PERFORMANCE_HANDOFF_RESULT_SCOPE_INVALID', 409);
    if (rule.requireMultiplePeriods && new Set(results.map(({ evaluationId }) => evaluationId)).size < rule.minimumResults) {
      throw disclosureError('این بازبینی به دوره‌های مصوب مستقل مطابق سیاست پیامد نیاز دارد.', 'PERFORMANCE_HANDOFF_MULTI_PERIOD_REQUIRED', 409);
    }
    const destination = await resolveHrNamedResponsibility(tx, {
      sourceActionCode: 'CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF',
      responsibilityTypeCode: rule.destination.responsibilityTypeCode,
      scopeType: 'PERSONNEL', scopeId: input.personnelId, sourceActorUserId: input.actorUserId,
    });
    if (destination.status !== 'RESOLVED' || destination.assignedUserId === input.actorUserId) {
      throw disclosureError('مقصد مستقل و واجد شرایط این ارجاع پیکربندی نشده است.', 'PERFORMANCE_HANDOFF_DESTINATION_UNRESOLVED', 409);
    }
    if (destination.destination.workspaceCode !== rule.destination.workspaceCode
      || destination.destination.queueCode !== rule.destination.queueCode
      || (rule.destination.featureCode && destination.destination.featureCode !== rule.destination.featureCode)) {
      throw disclosureError('مسیر مقصد با نسخه مؤثر سیاست پیامد سازگار نیست.', 'PERFORMANCE_HANDOFF_DESTINATION_POLICY_MISMATCH', 409);
    }
    const legalControl = rule.requireLegalControl ? await resolveHrNamedResponsibility(tx, {
      sourceActionCode: 'CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF',
      responsibilityTypeCode: rule.legalControlResponsibilityTypeCode!, scopeType: 'PERSONNEL', scopeId: input.personnelId,
      sourceActorUserId: input.actorUserId, disallowedUserIds: [input.actorUserId, destination.assignedUserId],
    }) : null;
    if (rule.requireLegalControl && legalControl?.status !== 'RESOLVED') {
      throw disclosureError('کنترل حقوقی مستقل و مؤثر تعریف‌شده در سیاست در دسترس نیست.', 'PERFORMANCE_HANDOFF_LEGAL_CONTROL_UNRESOLVED', 409);
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
    let projectionResultIds: string[] = [];
    if (projection?.state === 'LEVEL') {
      const event = await tx.performanceAuditEvent.findFirst({ where: { aggregateType: 'CURRENT_LEVEL_PROJECTION', aggregateId: subject.id, eventType: 'RECOMPUTED' }, orderBy: { occurredAt: 'desc' } });
      const evidence = event?.encryptedPayloadId ? await readPerformancePayload<{ next: { sourceResultsHashInput: string; trace: { inputs: Array<{ resultId: string }> } } }>(tx, event.encryptedPayloadId, keyring) : null;
      if (!evidence?.next || canonicalPerformanceHash(evidence.next.sourceResultsHashInput) !== projection.sourceResultsHash) {
        throw disclosureError('وابستگی‌های سطح جاری قابل بازسازی نیست.', 'PERFORMANCE_HANDOFF_PROJECTION_UNVERIFIED', 409);
      }
      projectionResultIds = evidence.next.trace.inputs.map(({ resultId }) => resultId);
    }
    const trendCandidates = await tx.performanceAcceptedResult.findMany({
      where: { AND: [{ evaluationId: { notIn: await activePerformanceRestrictionIds(tx) } }], evaluationId: { in: (await tx.performanceEvaluation.findMany({ where: { subjectId: subject.id }, select: { id: true } })).map(({ id }) => id) }, status: { in: [PerformanceResultStatus.EFFECTIVE, PerformanceResultStatus.EXPIRED] } },
      orderBy: [{ acceptedAt: 'desc' }, { version: 'desc' }], take: 12,
    });
    const recentResults = trendCandidates.filter((result, index, all) => all.findIndex(({ evaluationId }) => evaluationId === result.evaluationId) === index).slice(0, 4);
    const recentEvaluations = await tx.performanceEvaluation.findMany({ where: { id: { in: recentResults.map(({ evaluationId }) => evaluationId) } } });
    const recentEvaluationById = new Map(recentEvaluations.map((evaluation) => [evaluation.id, evaluation]));
    const compensationAt = relationship.status === 'ENDED' && rule.allowEndedRelationship && relationship.effectiveTo
      ? new Date(relationship.effectiveTo.getTime() - 1) : new Date();
    const compensationAgreement = await tx.hrCompensationAgreement.findFirst({
      where: {
        employmentRelationshipId: relationship.id, status: { in: ['ACTIVE', 'RETIRED'] }, effectiveFrom: { lte: compensationAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: compensationAt } }],
      }, orderBy: { version: 'desc' },
    });
    if (rule.requireCompensationContext && (!compensationAgreement
      || (rule.requireLegalControl && compensationAgreement.legalControlStatus !== 'APPROVED'))) {
      throw disclosureError('توافق جاری جبران خدمت با کنترل حقوقی لازم برای این ارجاع در دسترس نیست.', 'PERFORMANCE_HANDOFF_COMPENSATION_CONTEXT_REQUIRED', 409);
    }
    const snapshot = {
      schemaVersion: 1,
      subjectId: subject.id,
      personnelId: input.personnelId,
      employmentRelationshipId: relationship.id,
      relationshipStatus: relationship.status,
      consequenceType: input.consequenceType,
      policyCycleKey: input.policyCycleKey,
      consequencePolicy: {
        id: consequencePolicyVersion.id, version: consequencePolicyVersion.version,
        contentHash: consequencePolicyVersion.contentHash, effectiveFrom: consequencePolicyVersion.effectiveFrom,
        selectedRule: rule,
      },
      destination: {
        responsibilityId: destination.responsibilityId,
        assignedUserId: destination.assignedUserId,
        workspaceCode: destination.destination.workspaceCode,
        featureCode: destination.destination.featureCode,
        queueCode: destination.destination.queueCode,
        version: destination.destination.version,
      },
      legalControl: legalControl?.status === 'RESOLVED' ? {
        responsibilityId: legalControl.responsibilityId, assignedUserId: legalControl.assignedUserId,
        responsibilityTypeCode: rule.legalControlResponsibilityTypeCode, status: 'REQUIRED_BEFORE_DESTINATION_DECISION',
      } : null,
      selectedResults: results.map((result) => ({
        id: result.id, version: result.version, levelCode: result.levelCode, levelPolicyVersionId: result.levelPolicyVersionId,
        calculationTraceId: result.calculationTraceId, acceptedAt: result.acceptedAt, expiresAt: result.expiresAt,
        measurementFrom: evaluations.find(({ id }) => id === result.evaluationId)?.measurementFrom,
        measurementTo: evaluations.find(({ id }) => id === result.evaluationId)?.measurementTo,
        contextSnapshotId: evaluations.find(({ id }) => id === result.evaluationId)?.contextSnapshotId,
      })),
      projectionResultIds,
      currentProjection: projection ? { state: projection.state, levelCode: projection.levelCode, levelPolicyVersionId: projection.levelPolicyVersionId, version: projection.version, sourceResultsHash: projection.sourceResultsHash } : null,
      recentTrend: recentResults.map((result) => ({
        resultId: result.id, version: result.version, levelCode: result.levelCode, levelPolicyVersionId: result.levelPolicyVersionId,
        measurementFrom: recentEvaluationById.get(result.evaluationId)?.measurementFrom,
        measurementTo: recentEvaluationById.get(result.evaluationId)?.measurementTo,
      })),
      employmentContext: { status: relationship.status, effectiveFrom: relationship.effectiveFrom, effectiveTo: relationship.effectiveTo },
      compensationContext: compensationAgreement ? {
        agreement: {
          id: compensationAgreement.id, version: compensationAgreement.version, currency: compensationAgreement.currency,
          components: compensationAgreement.componentsJson, totalRials: compensationAgreement.totalRials.toString(),
          effectiveFrom: compensationAgreement.effectiveFrom, effectiveTo: compensationAgreement.effectiveTo,
          contentHash: compensationAgreement.contentHash,
        },
        payRange: {
          minimumRials: compensationAgreement.payRangeMinimumRials.toString(),
          maximumRials: compensationAgreement.payRangeMaximumRials.toString(),
        },
        budget: { code: compensationAgreement.budgetCode, availableRials: compensationAgreement.budgetAvailableRials.toString() },
        legalControlStatus: compensationAgreement.legalControlStatus,
        destinationMustRevalidateLiveContext: true,
      } : null,
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
    const packageRecord = await tx.performanceConsequencePackage.create({ data: {
      encryptedPayloadId: encrypted.id,
      snapshotHash: encrypted.contentHash,
      destinationResponsibilityId: destination.responsibilityId,
      destinationWorkspaceCode: destination.destination.workspaceCode,
      destinationFeatureCode: destination.destination.featureCode,
      destinationQueueCode: destination.destination.queueCode,
      destinationVersion: destination.destination.version,
      assignedDestinationUserId: destination.assignedUserId,
    } });
    const handoff = await tx.performanceConsequenceHandoff.create({ data: {
      id,
      subjectId: subject.id,
      personnelId: input.personnelId,
      employmentRelationshipId: relationship.id,
      consequenceType: input.consequenceType,
      policyCycleKey: input.policyCycleKey,
      packageId: packageRecord.id,
      snapshotHash: encrypted.contentHash,
      createdByUserId: input.actorUserId,
    } });
    await auditDisclosure(tx, {
      aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoff.id, eventType: 'CONSEQUENCE_HANDOFF_CREATED',
      actorUserId: input.actorUserId, authorityCodes: ['CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF'], evidenceHash: encrypted.contentHash,
    });
    await publishNotificationEvent(tx, {
      type: 'PERFORMANCE_CONSEQUENCE_REVIEW_REQUIRED',
      deduplicationKey: `performance-consequence-review-required:${handoff.id}:sent`,
      recipientIds: [destination.assignedUserId], recipientGroups: { DIRECT_USER: [destination.assignedUserId] },
      actorId: input.actorUserId, resourceType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', resourceId: handoff.id,
      actionUrl: `/dashboard/hr/personnel/performance/insights?handoffId=${encodeURIComponent(handoff.id)}`,
      referenceId: `performance-consequence:${handoff.id}`,
      payload: { statusMessage: 'یک بسته محرمانه عملکرد در صف مسئولیت شما نیازمند بازبینی مستقل است.' },
    });
    const { encryptedPayloadId: _payloadId, ...publicHandoff } = handoff;
    return publicHandoff;
  });
};

export const listEligibleConsequenceResults = async (client: PrismaClient, input: { personnelId: string; actorUserId: string; consequenceType: string }) => {
  await requireScopedConsequenceAuthority(client, input);
  const { personnelId } = input;
  const { content } = await effectiveConsequencePolicy(client);
  const rule = consequenceRule(content, input.consequenceType);
  const currentRelationships = await client.hrEmploymentRelationship.findMany({
    where: { personnelId, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true }, orderBy: { effectiveFrom: 'desc' }, take: 1,
  });
  const subjects = await client.performanceSubject.findMany({
    where: { personnelId, employmentRelationshipId: { in: currentRelationships.map(({ id }) => id) }, identityDetachedAt: null }, select: { id: true },
  });
  if (!subjects.length) return [];
  const evaluations = await client.performanceEvaluation.findMany({
    where: { subjectId: { in: subjects.map(({ id }) => id) }, status: 'ACCEPTED' },
    select: { id: true, measurementFrom: true, measurementTo: true },
  });
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const results = evaluations.length ? await client.performanceAcceptedResult.findMany({
    where: { AND: [{ evaluationId: { notIn: await activePerformanceRestrictionIds(client) } }],
      evaluationId: { in: evaluations.map(({ id }) => id) }, status: PerformanceResultStatus.EFFECTIVE,
      expiresAt: { gt: new Date() }, acceptedAt: { gte: new Date(Date.now() - rule.maximumAgeDays * 24 * 60 * 60_000) },
    },
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

export const getPerformanceConsequenceHandoff = async (client: PrismaClient | Prisma.TransactionClient, input: { handoffId: string; actorUserId: string; keyring?: PerformanceVaultKey }) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`UPDATE performance_disclosure_revision SET revision = revision WHERE id = 1`;
    const handoff = await tx.performanceConsequenceHandoff.findUnique({ where: { id: input.handoffId } });
    if (!handoff) throw disclosureError('ارجاع پیامد پیدا نشد.', 'PERFORMANCE_HANDOFF_NOT_FOUND', 404);
    const packageRecord = handoff.packageId ? await tx.performanceConsequencePackage.findUnique({ where: { id: handoff.packageId } }) : null;
    const now = new Date();
    const effectiveDestinationAuthority = packageRecord ? await tx.hrNamedResponsibility.findFirst({ where: {
      id: packageRecord.destinationResponsibilityId,
      assignedUserId: input.actorUserId,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      responsibilityType: { isActive: true },
    } }) : null;
    const destinationPermissions = packageRecord?.assignedDestinationUserId === input.actorUserId
      ? await activeHrActionPermissionsForUser(tx, input.actorUserId) : [];
    const isDestination = packageRecord?.assignedDestinationUserId === input.actorUserId
      && Boolean(effectiveDestinationAuthority)
      && destinationPermissions.includes('VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF');
    if (!isDestination) {
      await requireScopedConsequenceAuthority(tx, { actorUserId: input.actorUserId, personnelId: handoff.personnelId, consequenceType: handoff.consequenceType });
    }
    if (isDestination && handoff.status === 'SUSPENDED') {
      throw disclosureError('اعتبار شواهد این ارجاع معلق شده و بسته تا بازبینی دوباره قابل مشاهده نیست.', 'PERFORMANCE_HANDOFF_SUSPENDED', 409);
    }
    const destinationPackage = isDestination && packageRecord && ['SENT', 'RECEIVED'].includes(handoff.status)
      ? await readPerformancePayload<Record<string, unknown>>(tx, packageRecord.encryptedPayloadId, keyring)
      : undefined;
    if (isDestination && handoff.status === 'SENT') {
      await tx.performanceConsequenceHandoff.update({ where: { id: handoff.id }, data: { status: 'RECEIVED' } });
    }
    await auditDisclosure(tx, {
      aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoff.id, eventType: 'CONSEQUENCE_HANDOFF_VIEWED',
      actorUserId: input.actorUserId,
      authorityCodes: [isDestination ? 'VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF' : 'CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF'],
      evidenceHash: handoff.snapshotHash,
    });
    const { encryptedPayloadId: _payloadId, ...publicHandoff } = handoff;
    return { handoff: { ...publicHandoff, status: isDestination && handoff.status === 'SENT' ? 'RECEIVED' : handoff.status }, package: destinationPackage };
  });
};

export const suspendPerformanceHandoffsForResult = async (tx: Prisma.TransactionClient, input: {
  resultId: string;
  actorUserId: string | null;
  reasonCode: string;
  keyring: PerformanceVaultKey;
}) => {
  const result = await tx.performanceAcceptedResult.findUnique({ where: { id: input.resultId }, select: { evaluationId: true } });
  const evaluation = result ? await tx.performanceEvaluation.findUnique({ where: { id: result.evaluationId }, select: { subjectId: true } }) : null;
  if (!evaluation) return 0;
  const activeHandoffs = await tx.performanceConsequenceHandoff.findMany({
    where: { subjectId: evaluation.subjectId, status: { in: ['SENT', 'RECEIVED'] } },
    select: { id: true, createdByUserId: true, packageId: true, encryptedPayloadId: true },
  });
  let suspended = 0;
  for (const handoff of activeHandoffs) {
    const packageRecord = handoff.packageId ? await tx.performanceConsequencePackage.findUnique({ where: { id: handoff.packageId } }) : null;
    const payloadId = packageRecord?.encryptedPayloadId ?? handoff.encryptedPayloadId;
    if (!payloadId) continue;
    const snapshot = await readPerformancePayload<{ selectedResults?: Array<{ id?: string }> }>(tx, payloadId, input.keyring);
    if (!snapshot.selectedResults?.some(({ id }) => id === input.resultId)) continue;
    const changed = await tx.performanceConsequenceHandoff.updateMany({
      where: { id: handoff.id, status: { in: ['SENT', 'RECEIVED'] } },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    if (changed.count !== 1) continue;
    suspended += 1;
    await auditDisclosure(tx, {
      aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoff.id, eventType: 'CONSEQUENCE_HANDOFF_SUSPENDED',
      actorUserId: input.actorUserId, authorityCodes: ['SYSTEM_HANDOFF_INTEGRITY'], reason: input.reasonCode,
      evidenceHash: canonicalPerformanceHash({ resultId: input.resultId, reasonCode: input.reasonCode }),
    });
    const recipientIds = [...new Set([handoff.createdByUserId, packageRecord?.assignedDestinationUserId].filter((id): id is string => Boolean(id)))];
    await publishNotificationEvent(tx, {
      type: 'PERFORMANCE_CONSEQUENCE_REVIEW_REQUIRED',
      deduplicationKey: `performance-consequence-review-required:${handoff.id}:suspended:${input.resultId}`,
      recipientIds, recipientGroups: { DIRECT_USER: recipientIds }, actorId: input.actorUserId,
      resourceType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', resourceId: handoff.id,
      actionUrl: '/dashboard/hr/personnel/performance/insights',
      referenceId: `performance-consequence-review:${handoff.id}:${input.resultId}`,
      payload: { statusMessage: 'اعتبار یکی از نتیجه‌های مبنا تغییر کرده و ارجاع برای بازبینی مستقل معلق شده است.' },
    });
  }
  return suspended;
};

export const createPerformanceCorrection = async (client: PrismaClient | Prisma.TransactionClient, input: { evaluationId: string; actorUserId: string; correctionKind: string; reason: string }) => {
  if (input.reason.trim().length < 8) throw disclosureError('دلیل اصلاح الزامی است.', 'PERFORMANCE_CORRECTION_REASON_REQUIRED', 422);
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`UPDATE performance_disclosure_revision SET revision = revision WHERE id = 1`;
    if (!(await activeHrActionPermissionsForUser(tx, input.actorUserId)).includes('REGISTER_PERFORMANCE_CORRECTION')) throw disclosureError('اختیار مستقل ثبت اصلاح معتبر نیست.', 'PERFORMANCE_CORRECTION_PERMISSION_REQUIRED', 403);
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
    await suspendPerformanceHandoffsForResult(tx, {
      resultId: target.id, actorUserId: input.actorUserId, reasonCode: 'PERFORMANCE_CORRECTION_OPENED', keyring: performanceVaultKeyFromEnvironment(),
    });
    return correction;
  });
};
