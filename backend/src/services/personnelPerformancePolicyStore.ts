import { normalizePerformanceWriteError, isPerformanceTransactionConflict } from './personnelPerformanceRolloutPolicy';
import { activePerformanceRestrictionIds } from './personnelPerformanceRestrictionQueries';
import { isSupportedPerformanceRetentionPolicy } from './personnelPerformanceRetention';
import { createHash, randomUUID } from 'node:crypto';
import {
  PerformanceArtifactLifecycle,
  PerformancePolicyKind,
  PerformanceTemplateKind,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  calculateCurrentPerformanceLevel,
  type CurrentPerformanceResultInput,
  type PerformanceTemplateSnapshot,
} from './personnelPerformanceCalculation';
import {
  DEFAULT_LEVEL_POLICY_CONTENT,
  buildDeterministicPolicyPreview,
  canonicalPerformanceHash,
  validateCriterionPolicyContent,
  validateLevelPolicyContent,
  validatePerformancePublication,
  type LevelPolicyContent,
  type PerformanceCriterionPolicyContent,
} from './personnelPerformancePolicy';
import {
  decryptPerformancePayloadRow,
  performanceVaultKeyFromEnvironment,
  persistPerformancePayload,
  readPerformancePayload,
  type PerformanceVaultKey,
} from './personnelPerformancePayloadStore';
import { publishNotificationEvent } from './notificationService';

export type CurrentLevelPolicyContent = {
  schemaVersion: 1;
  recencyWeightsPercent: [string, string, string, string];
  maximumResults: 4;
  expiresAfterDays: 365;
  expiryTimeZone: 'Asia/Tehran';
};

export type ScoringPolicyContent = {
  schemaVersion: 1;
  gradePoints: ['0.000000', '25.000000', '50.000000', '75.000000', '100.000000'];
  minimumOriginalCoveragePercent: '70.000000';
  minimumRequiredCategoryCoveragePercent: '50.000000';
  defaultJobSharePercent: string;
  defaultAddendumSharePercent: string;
  minimumJobSharePercent: '70.000000';
  maximumAddendumSharePercent: '30.000000';
  precisionScale: 6;
};

export type PerformanceTemplatePolicyContent = {
  schemaVersion: 1;
  titleFa: string;
  categories: Array<{
    id: string;
    titleFa: string;
    weightPercent: string;
    required: boolean;
    criteria: Array<{ criterionVersionId: string; weightPercent: string }>;
  }>;
};

export type PerformancePolicyContent = LevelPolicyContent | CurrentLevelPolicyContent | ScoringPolicyContent | {
  schemaVersion: 1;
  [key: string]: unknown;
};

export const DEFAULT_CURRENT_LEVEL_POLICY_CONTENT: CurrentLevelPolicyContent = {
  schemaVersion: 1,
  recencyWeightsPercent: ['50.000000', '30.000000', '15.000000', '5.000000'],
  maximumResults: 4,
  expiresAfterDays: 365,
  expiryTimeZone: 'Asia/Tehran',
};

export const DEFAULT_SCORING_POLICY_CONTENT: ScoringPolicyContent = {
  schemaVersion: 1,
  gradePoints: ['0.000000', '25.000000', '50.000000', '75.000000', '100.000000'],
  minimumOriginalCoveragePercent: '70.000000',
  minimumRequiredCategoryCoveragePercent: '50.000000',
  defaultJobSharePercent: '80.000000',
  defaultAddendumSharePercent: '20.000000',
  minimumJobSharePercent: '70.000000',
  maximumAddendumSharePercent: '30.000000',
  precisionScale: 6,
};

const asTx = async <T>(client: PrismaClient | Prisma.TransactionClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  const fencedWork = async (tx: Prisma.TransactionClient) => {
    const fence = await tx.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
    if (!fence.length) throw Object.assign(new Error('وضعیت انتشار عملکرد در دسترس نیست.'), { code: 'PERFORMANCE_OPERATIONS_FENCE_UNAVAILABLE', status: 409 });
    return work(tx);
  };
  if (!('$transaction' in client)) return fencedWork(client).catch((error: unknown) => {
    // The transaction owner must see the original conflict so it can retry the whole operation.
    if (isPerformanceTransactionConflict(error)) throw error;
    throw normalizePerformanceWriteError(error);
  });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.$transaction(fencedWork, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 300_000,
        maxWait: 30_000,
      });
    } catch (error) {
      lastError = error;
      if (!isPerformanceTransactionConflict(error) || attempt === 3) throw normalizePerformanceWriteError(error);
    }
  }
  throw lastError;
};

export const runPerformanceSerializableTransaction = asTx;

const policyError = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });
const systemActorAuthorityHash = canonicalPerformanceHash({ actorType: 'SYSTEM', actorCode: 'PERFORMANCE_MAINTENANCE' });

const ensureNoErrors = (errors: string[]) => {
  if (errors.length > 0) throw policyError(errors[0], 'PERFORMANCE_POLICY_VALIDATION_FAILED', 422);
};

const payloadKind = (kind: string, revision: number) => `${kind}_CONTENT_REVISION_${revision}`;

const nextPayloadRevision = async (tx: Prisma.TransactionClient, aggregateType: string, aggregateId: string) => (
  await tx.performanceEncryptedPayload.count({ where: { aggregateType, aggregateId } }) + 1
);

const persistVersionContent = async (
  tx: Prisma.TransactionClient,
  input: { aggregateType: string; aggregateId: string; payloadKindPrefix: string; content: unknown; keyring: PerformanceVaultKey },
) => {
  const revision = await nextPayloadRevision(tx, input.aggregateType, input.aggregateId);
  return persistPerformancePayload(tx, {
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payloadKind: payloadKind(input.payloadKindPrefix, revision),
    schemaVersion: 1,
    payload: input.content,
    keyring: input.keyring,
  });
};

const validateTemplateContent = (content: PerformanceTemplatePolicyContent) => {
  const errors: string[] = [];
  const twoDecimals = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value);
  const sum = (values: string[]) => values.reduce((total, value) => total.add(value), new Prisma.Decimal(0));
  if (content.schemaVersion !== 1 || !content.titleFa.trim()) errors.push('عنوان و نسخه ساختار الگوی ارزیابی الزامی است.');
  if (content.categories.length === 0 || !sum(content.categories.map((category) => category.weightPercent)).eq(100)) {
    errors.push('جمع وزن دسته‌های الگو باید دقیقاً ۱۰۰ درصد باشد.');
  }
  const seen = new Set<string>();
  for (const category of content.categories) {
    if (!twoDecimals(category.weightPercent) || new Prisma.Decimal(category.weightPercent).lte(0)) errors.push(`وزن دسته «${category.titleFa}» معتبر نیست.`);
    if (category.criteria.length === 0 || !sum(category.criteria.map((criterion) => criterion.weightPercent)).eq(100)) {
      errors.push(`جمع وزن معیارهای دسته «${category.titleFa}» باید دقیقاً ۱۰۰ درصد باشد.`);
    }
    for (const criterion of category.criteria) {
      if (!twoDecimals(criterion.weightPercent) || new Prisma.Decimal(criterion.weightPercent).lt(0)) errors.push('وزن معیار باید نامنفی و حداکثر دو رقم اعشار داشته باشد.');
      if (seen.has(criterion.criterionVersionId)) errors.push('هر نسخه معیار فقط یک‌بار و در یک دسته الگو مجاز است.');
      seen.add(criterion.criterionVersionId);
    }
  }
  return errors;
};

const validatePolicyContent = (kind: PerformancePolicyKind, content: PerformancePolicyContent) => {
  if (kind === PerformancePolicyKind.RETENTION) return isSupportedPerformanceRetentionPolicy(content)
    ? [] : ['برنامه نگهداری با نسخه مصوب سازمان سازگار نیست. پیش از انتشار، همه طبقات و مبدأهای نگهداری را تکمیل کنید.'];
  if (kind === PerformancePolicyKind.LEVEL_CLASSIFICATION) return validateLevelPolicyContent(content as LevelPolicyContent);
  if (kind === PerformancePolicyKind.CURRENT_LEVEL) {
    const policy = content as CurrentLevelPolicyContent;
    const weights = policy.recencyWeightsPercent ?? [];
    if (policy.schemaVersion !== 1 || policy.maximumResults !== 4 || policy.expiresAfterDays !== 365 || policy.expiryTimeZone !== 'Asia/Tehran'
      || canonicalPerformanceHash(weights) !== canonicalPerformanceHash(DEFAULT_CURRENT_LEVEL_POLICY_CONTENT.recencyWeightsPercent)) {
      return ['سیاست سطح جاری باید چهار نتیجه با وزن‌های ثابت ۵۰، ۳۰، ۱۵ و ۵ درصد و انقضای ۳۶۵ روزه تهران داشته باشد.'];
    }
    return [];
  }
  if (kind === PerformancePolicyKind.SCORING) {
    const policy = content as ScoringPolicyContent;
    if (canonicalPerformanceHash(policy.gradePoints) !== canonicalPerformanceHash(DEFAULT_SCORING_POLICY_CONTENT.gradePoints)
      || policy.minimumOriginalCoveragePercent !== '70.000000'
      || policy.minimumRequiredCategoryCoveragePercent !== '50.000000'
      || policy.precisionScale !== 6
      || !new Prisma.Decimal(policy.defaultJobSharePercent).add(policy.defaultAddendumSharePercent).eq(100)
      || new Prisma.Decimal(policy.defaultJobSharePercent).lt(70)
      || new Prisma.Decimal(policy.defaultAddendumSharePercent).gt(30)) {
      return ['سیاست امتیازدهی با نگاشت پنج درجه، کف پوشش یا سهم الگو و افزوده سازگار نیست.'];
    }
  }
  return content.schemaVersion === 1 ? [] : ['نسخه ساختار سیاست پشتیبانی نمی‌شود.'];
};

const acquireVersionLock = (tx: Prisma.TransactionClient, key: string) => tx.$executeRaw`
  SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
`;

export const createPerformanceCriterionDraft = async (client: PrismaClient, input: {
  content: PerformanceCriterionPolicyContent;
  createdByUserId: string;
  keyring?: PerformanceVaultKey;
}) => {
  ensureNoErrors(validateCriterionPolicyContent(input.content));
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    await acquireVersionLock(tx, `performance-criterion:${input.content.conceptCode}`);
    const identity = await tx.performanceCriterionIdentity.upsert({
      where: { conceptCode: input.content.conceptCode },
      create: {
        stableKey: randomUUID(), conceptCode: input.content.conceptCode, createdByUserId: input.createdByUserId,
      },
      update: {},
    });
    const predecessor = await tx.performanceCriterionVersion.findFirst({
      where: { criterionIdentityId: identity.id }, orderBy: { version: 'desc' },
    });
    if (predecessor?.lifecycle === PerformanceArtifactLifecycle.DRAFT) {
      throw policyError('برای این معیار یک نسخه پیش‌نویس باز وجود دارد.', 'PERFORMANCE_DRAFT_ALREADY_EXISTS', 409);
    }
    const id = randomUUID();
    const encrypted = await persistVersionContent(tx, {
      aggregateType: 'CRITERION_VERSION', aggregateId: id, payloadKindPrefix: 'CRITERION', content: input.content, keyring,
    });
    return tx.performanceCriterionVersion.create({ data: {
      id,
      criterionIdentityId: identity.id,
      version: (predecessor?.version ?? 0) + 1,
      predecessorId: predecessor?.id,
      contentHash: encrypted.contentHash,
      encryptedPayloadId: encrypted.id,
      createdByUserId: input.createdByUserId,
    } });
  });
};

export const updatePerformanceCriterionDraft = async (client: PrismaClient, input: {
  versionId: string;
  content: PerformanceCriterionPolicyContent;
  keyring?: PerformanceVaultKey;
}) => {
  ensureNoErrors(validateCriterionPolicyContent(input.content));
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    await acquireVersionLock(tx, `performance-criterion-version:${input.versionId}`);
    const version = await tx.performanceCriterionVersion.findUnique({ where: { id: input.versionId } });
    if (!version || version.lifecycle !== PerformanceArtifactLifecycle.DRAFT) {
      throw policyError('فقط نسخه پیش‌نویس معیار قابل ویرایش است.', 'PERFORMANCE_VERSION_NOT_EDITABLE', 409);
    }
    const identity = await tx.performanceCriterionIdentity.findUnique({ where: { id: version.criterionIdentityId } });
    if (identity?.conceptCode !== input.content.conceptCode) {
      throw policyError('تغییر مفهوم کسب‌وکاری به هویت معیار تازه نیاز دارد.', 'PERFORMANCE_CRITERION_IDENTITY_CHANGE', 409);
    }
    const encrypted = await persistVersionContent(tx, {
      aggregateType: 'CRITERION_VERSION', aggregateId: version.id, payloadKindPrefix: 'CRITERION', content: input.content, keyring,
    });
    return tx.performanceCriterionVersion.update({
      where: { id: version.id }, data: { contentHash: encrypted.contentHash, encryptedPayloadId: encrypted.id },
    });
  });
};

export const createPerformanceTemplateDraft = async (client: PrismaClient, input: {
  templateKind: PerformanceTemplateKind;
  ownerType: string;
  ownerId: string;
  content: PerformanceTemplatePolicyContent;
  createdByUserId: string;
  keyring?: PerformanceVaultKey;
}) => {
  ensureNoErrors(validateTemplateContent(input.content));
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    const ownerKey = `${input.templateKind}:${input.ownerType}:${input.ownerId}`;
    await acquireVersionLock(tx, `performance-template:${ownerKey}`);
    const predecessor = await tx.performanceTemplateVersion.findFirst({
      where: { templateKind: input.templateKind, ownerType: input.ownerType, ownerId: input.ownerId }, orderBy: { version: 'desc' },
    });
    if (predecessor?.lifecycle === PerformanceArtifactLifecycle.DRAFT) {
      throw policyError('برای این مالک الگو یک نسخه پیش‌نویس باز وجود دارد.', 'PERFORMANCE_DRAFT_ALREADY_EXISTS', 409);
    }
    const id = randomUUID();
    const encrypted = await persistVersionContent(tx, {
      aggregateType: 'TEMPLATE_VERSION', aggregateId: id, payloadKindPrefix: 'TEMPLATE', content: input.content, keyring,
    });
    return tx.performanceTemplateVersion.create({ data: {
      id,
      templateKind: input.templateKind,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      version: (predecessor?.version ?? 0) + 1,
      predecessorId: predecessor?.id,
      contentHash: encrypted.contentHash,
      encryptedPayloadId: encrypted.id,
      createdByUserId: input.createdByUserId,
    } });
  });
};

export const updatePerformanceTemplateDraft = async (client: PrismaClient, input: {
  versionId: string;
  content: PerformanceTemplatePolicyContent;
  keyring?: PerformanceVaultKey;
}) => {
  ensureNoErrors(validateTemplateContent(input.content));
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    await acquireVersionLock(tx, `performance-template-version:${input.versionId}`);
    const version = await tx.performanceTemplateVersion.findUnique({ where: { id: input.versionId } });
    if (!version || version.lifecycle !== PerformanceArtifactLifecycle.DRAFT) {
      throw policyError('فقط نسخه پیش‌نویس الگو قابل ویرایش است.', 'PERFORMANCE_VERSION_NOT_EDITABLE', 409);
    }
    const encrypted = await persistVersionContent(tx, {
      aggregateType: 'TEMPLATE_VERSION', aggregateId: version.id, payloadKindPrefix: 'TEMPLATE', content: input.content, keyring,
    });
    return tx.performanceTemplateVersion.update({
      where: { id: version.id }, data: { contentHash: encrypted.contentHash, encryptedPayloadId: encrypted.id },
    });
  });
};

export const createPerformancePolicyDraft = async (client: PrismaClient | Prisma.TransactionClient, input: {
  policyKind: PerformancePolicyKind;
  content: PerformancePolicyContent;
  createdByUserId: string;
  keyring?: PerformanceVaultKey;
}) => {
  ensureNoErrors(validatePolicyContent(input.policyKind, input.content));
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    await acquireVersionLock(tx, `performance-policy:${input.policyKind}`);
    const openDraft = await tx.performancePolicyVersion.findFirst({
      where: { policyKind: input.policyKind, lifecycle: PerformanceArtifactLifecycle.DRAFT },
    });
    if (openDraft) {
      throw policyError('برای این سیاست یک نسخه پیش‌نویس باز وجود دارد.', 'PERFORMANCE_DRAFT_ALREADY_EXISTS', 409);
    }
    const predecessor = await tx.performancePolicyVersion.findFirst({
      where: { policyKind: input.policyKind }, orderBy: { version: 'desc' },
    });
    const id = randomUUID();
    const encrypted = await persistVersionContent(tx, {
      aggregateType: 'POLICY_VERSION', aggregateId: id, payloadKindPrefix: 'POLICY', content: input.content, keyring,
    });
    return tx.performancePolicyVersion.create({ data: {
      id,
      policyKind: input.policyKind,
      version: (predecessor?.version ?? 0) + 1,
      predecessorId: predecessor?.id,
      contentHash: encrypted.contentHash,
      encryptedPayloadId: encrypted.id,
      createdByUserId: input.createdByUserId,
    } });
  });
};

export const updatePerformancePolicyDraft = async (client: PrismaClient | Prisma.TransactionClient, input: {
  versionId: string;
  content: PerformancePolicyContent;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    await acquireVersionLock(tx, `performance-policy-version:${input.versionId}`);
    const version = await tx.performancePolicyVersion.findUnique({ where: { id: input.versionId } });
    if (!version || version.lifecycle !== PerformanceArtifactLifecycle.DRAFT) {
      throw policyError('فقط نسخه پیش‌نویس سیاست قابل ویرایش است.', 'PERFORMANCE_VERSION_NOT_EDITABLE', 409);
    }
    ensureNoErrors(validatePolicyContent(version.policyKind, input.content));
    const encrypted = await persistVersionContent(tx, {
      aggregateType: 'POLICY_VERSION', aggregateId: version.id, payloadKindPrefix: 'POLICY', content: input.content, keyring,
    });
    return tx.performancePolicyVersion.update({
      where: { id: version.id }, data: { contentHash: encrypted.contentHash, encryptedPayloadId: encrypted.id },
    });
  });
};

const getPolicyContent = async <T extends PerformancePolicyContent>(
  tx: Prisma.TransactionClient,
  kind: PerformancePolicyKind,
  keyring: PerformanceVaultKey,
  lifecycle = PerformanceArtifactLifecycle.ACTIVE,
): Promise<{ id: string; content: T } | null> => {
  const row = await tx.performancePolicyVersion.findFirst({
    where: { policyKind: kind, lifecycle }, orderBy: { version: 'desc' },
  });
  if (!row?.encryptedPayloadId) return null;
  return { id: row.id, content: await readPerformancePayload<T>(tx, row.encryptedPayloadId, keyring) };
};

type AcceptedResultPayload = { exactScore: string; measurementTo?: string; trace?: unknown };

const listCurrentPerformanceSubjects = async (tx: Prisma.TransactionClient, subjectIds?: string[]) => {
  const relationships = await tx.hrEmploymentRelationship.findMany({
    where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
    select: { id: true, personnelId: true },
  });
  return tx.performanceSubject.findMany({
    where: {
      employmentRelationshipId: { in: relationships.map(({ id }) => id) },
      identityDetachedAt: null,
      ...(subjectIds ? { id: { in: subjectIds } } : {}),
    },
    select: { id: true, personnelId: true },
    orderBy: { id: 'asc' },
  });
};

const hasActivePerformanceAggregationPolicies = async (tx: Prisma.TransactionClient) => {
  const rows = await tx.performancePolicyVersion.findMany({
    where: {
      policyKind: { in: [PerformancePolicyKind.LEVEL_CLASSIFICATION, PerformancePolicyKind.CURRENT_LEVEL] },
      lifecycle: PerformanceArtifactLifecycle.ACTIVE,
    },
    select: { policyKind: true },
  });
  const kinds = new Set(rows.map(({ policyKind }) => policyKind));
  return kinds.has(PerformancePolicyKind.LEVEL_CLASSIFICATION) && kinds.has(PerformancePolicyKind.CURRENT_LEVEL);
};

const calculatePopulation = async (
  tx: Prisma.TransactionClient,
  input: {
    now: Date;
    keyring: PerformanceVaultKey;
    subjectIds?: string[];
    proposed?: { kind: PerformancePolicyKind; id: string; content: PerformancePolicyContent };
  },
) => {
  const subjects = await listCurrentPerformanceSubjects(tx, input.subjectIds);
  const projections = await tx.performanceCurrentLevelProjection.findMany({ where: input.subjectIds ? { subjectId: { in: input.subjectIds } } : {} });
  const projectionBySubject = new Map(projections.map((projection) => [projection.subjectId, projection]));
  const evaluations = await tx.performanceEvaluation.findMany({
    where: { subjectId: { in: subjects.map((subject) => subject.id) } },
    select: { id: true, subjectId: true, measurementTo: true },
  });
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const restrictedIds = new Set(await activePerformanceRestrictionIds(tx, evaluations.map(({ id }) => id)));
  const results = evaluations.length === 0 ? [] : await tx.performanceAcceptedResult.findMany({
    where: { evaluationId: { in: evaluations.map((evaluation) => evaluation.id) } },
    orderBy: [{ evaluationId: 'asc' }, { version: 'desc' }],
  });
  const activeLevels = input.proposed?.kind === PerformancePolicyKind.LEVEL_CLASSIFICATION
    ? { id: input.proposed.id, content: input.proposed.content as LevelPolicyContent }
    : await getPolicyContent<LevelPolicyContent>(tx, PerformancePolicyKind.LEVEL_CLASSIFICATION, input.keyring);
  const activeCurrent = input.proposed?.kind === PerformancePolicyKind.CURRENT_LEVEL
    ? { id: input.proposed.id, content: input.proposed.content as CurrentLevelPolicyContent }
    : await getPolicyContent<CurrentLevelPolicyContent>(tx, PerformancePolicyKind.CURRENT_LEVEL, input.keyring);
  const levelPolicy = activeLevels ?? { id: 'LEVEL_CLASSIFICATION_DEFAULT_V1', content: DEFAULT_LEVEL_POLICY_CONTENT };
  const currentPolicy = activeCurrent ?? { id: 'CURRENT_LEVEL_DEFAULT_V1', content: DEFAULT_CURRENT_LEVEL_POLICY_CONTENT };
  const decodedBySubject = new Map<string, CurrentPerformanceResultInput[]>();
  const decodeErrors = new Map<string, string>();
  for (const result of results) {
    const evaluation = evaluationById.get(result.evaluationId);
    if (!evaluation) continue;
    try {
      const payload = await readPerformancePayload<AcceptedResultPayload>(tx, result.encryptedPayloadId, input.keyring);
      const list = decodedBySubject.get(evaluation.subjectId) ?? [];
      list.push({
        resultId: result.id,
        exactScore: payload.exactScore,
        measurementTo: (payload.measurementTo ? new Date(payload.measurementTo) : evaluation.measurementTo).toISOString(),
        expiresAt: result.expiresAt.toISOString(),
        status: restrictedIds.has(result.evaluationId) ? 'SUSPENDED' : result.status,
      });
      decodedBySubject.set(evaluation.subjectId, list);
    } catch (error) {
      decodeErrors.set(evaluation.subjectId, error instanceof Error ? error.message : 'خطای نامشخص بازسازی نتیجه');
    }
  }
  const population = subjects.map((subject) => {
    const beforeProjection = projectionBySubject.get(subject.id);
    const error = decodeErrors.get(subject.id);
    if (error) return {
      subjectId: subject.id,
      before: beforeProjection ? { state: beforeProjection.state, levelCode: beforeProjection.levelCode } : null,
      after: null,
      error,
    };
    const after = calculateCurrentPerformanceLevel({
      asOf: input.now,
      policy: { versionId: levelPolicy.id, thresholds: levelPolicy.content.thresholds },
      aggregationPolicy: {
        versionId: currentPolicy.id,
        recencyWeightsPercent: currentPolicy.content.recencyWeightsPercent,
        maximumResults: currentPolicy.content.maximumResults,
      },
      results: decodedBySubject.get(subject.id) ?? [],
    });
    return {
      subjectId: subject.id,
      before: beforeProjection ? { state: beforeProjection.state, levelCode: beforeProjection.levelCode } : null,
      after: { state: after.state === 'UNEVALUATED' && evaluations.some((evaluation) => evaluation.subjectId === subject.id && restrictedIds.has(evaluation.id)) ? 'TEMPORARILY_UNAVAILABLE' : after.state, levelCode: after.levelCode },
    };
  });
  return {
    preview: buildDeterministicPolicyPreview(population),
    sourcePopulationHash: canonicalPerformanceHash({
      restrictedEvaluationIds: [...restrictedIds].sort(),
      subjects: subjects.map(({ id }) => id),
      projections: projections.map(({ subjectId, state, levelCode, sourceResultsHash }) => ({
        subjectId, state, levelCode, sourceResultsHash,
      })),
      results: results.map(({ id, exactScoreHash, status, expiresAt }) => ({ id, exactScoreHash, status, expiresAt })),
    }),
  };
};

export const previewPerformancePolicy = async (client: PrismaClient, input: {
  versionId: string;
  asOf?: Date;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    const version = await tx.performancePolicyVersion.findUnique({ where: { id: input.versionId } });
    const overdueScheduled = version?.lifecycle === PerformanceArtifactLifecycle.SCHEDULED
      && Boolean(version.effectiveFrom && version.effectiveFrom.getTime() <= (input.now ?? new Date()).getTime());
    if (!version?.encryptedPayloadId
      || (version.lifecycle !== PerformanceArtifactLifecycle.DRAFT && !overdueScheduled)) {
      throw policyError('پیش‌نمایش فقط برای پیش‌نویس یا انتشار سررسیدشده نیازمند تأیید دوباره ممکن است.', 'PERFORMANCE_POLICY_PREVIEW_UNAVAILABLE', 409);
    }
    const content = await readPerformancePayload<PerformancePolicyContent>(tx, version.encryptedPayloadId, keyring);
    ensureNoErrors(validatePolicyContent(version.policyKind, content));
    if (overdueScheduled && version.activationPreviewId && version.effectiveFrom) {
      const confirmed = await tx.performancePolicyActivationPreview.findUniqueOrThrow({ where: { id: version.activationPreviewId } });
      const duePopulation = await calculatePopulation(tx, {
        now: version.effectiveFrom, keyring, proposed: { kind: version.policyKind, id: version.id, content },
      });
      if (confirmed.populationHash === duePopulation.sourcePopulationHash
        && confirmed.resultHash === duePopulation.preview.resultHash) {
        throw policyError('پیش‌نمایش تأییدشده هنوز معتبر است و نسخه باید فعال شود.', 'PERFORMANCE_POLICY_ACTIVATION_DUE', 409);
      }
    }
    const population = await calculatePopulation(tx, {
      now: input.asOf ?? new Date(), keyring, proposed: { kind: version.policyKind, id: version.id, content },
    });
    return { policyVersionId: version.id, policyContentHash: version.contentHash, ...population };
  });
};

export const schedulePerformancePolicy = async (client: PrismaClient, input: {
  versionId: string;
  effectiveFrom: Date;
  reason: string;
  confirmedByUserId: string;
  confirmedPreviewHash: string;
  confirmedPopulationHash: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  const now = input.now ?? new Date();
  ensureNoErrors(validatePerformancePublication({ now, effectiveFrom: input.effectiveFrom, reason: input.reason }));
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    const version = await tx.performancePolicyVersion.findUnique({ where: { id: input.versionId } });
    const overdueScheduled = version?.lifecycle === PerformanceArtifactLifecycle.SCHEDULED
      && Boolean(version.effectiveFrom && version.effectiveFrom.getTime() <= now.getTime());
    if (!version?.encryptedPayloadId
      || (version.lifecycle !== PerformanceArtifactLifecycle.DRAFT && !overdueScheduled)) {
      throw policyError('فقط پیش‌نویس یا انتشار سررسیدشده نیازمند تأیید دوباره قابل زمان‌بندی است.', 'PERFORMANCE_POLICY_NOT_SCHEDULABLE', 409);
    }
    await acquireVersionLock(tx, `performance-policy:${version.policyKind}`);
    const alreadyScheduled = await tx.performancePolicyVersion.findFirst({
      where: { policyKind: version.policyKind, lifecycle: PerformanceArtifactLifecycle.SCHEDULED, id: { not: version.id } },
    });
    if (alreadyScheduled) throw policyError('برای این نوع سیاست یک نسخه زمان‌بندی‌شده وجود دارد.', 'PERFORMANCE_POLICY_SCHEDULE_CONFLICT', 409);
    const content = await readPerformancePayload<PerformancePolicyContent>(tx, version.encryptedPayloadId, keyring);
    ensureNoErrors(validatePolicyContent(version.policyKind, content));
    if (overdueScheduled && version.activationPreviewId && version.effectiveFrom) {
      const confirmed = await tx.performancePolicyActivationPreview.findUniqueOrThrow({ where: { id: version.activationPreviewId } });
      const duePopulation = await calculatePopulation(tx, {
        now: version.effectiveFrom, keyring, proposed: { kind: version.policyKind, id: version.id, content },
      });
      if (confirmed.populationHash === duePopulation.sourcePopulationHash
        && confirmed.resultHash === duePopulation.preview.resultHash) {
        throw policyError('پیش‌نمایش تأییدشده هنوز معتبر است و نسخه باید فعال شود.', 'PERFORMANCE_POLICY_ACTIVATION_DUE', 409);
      }
    }
    const population = await calculatePopulation(tx, {
      now: input.effectiveFrom, keyring, proposed: { kind: version.policyKind, id: version.id, content },
    });
    if (population.preview.resultHash !== input.confirmedPreviewHash
      || population.sourcePopulationHash !== input.confirmedPopulationHash) {
      throw policyError('اثر یا جمعیت پیش‌نمایش تغییر کرده است؛ تأیید تازه لازم است.', 'PERFORMANCE_POLICY_PREVIEW_CONFIRMATION_STALE', 409);
    }
    if (population.preview.counts.errors > 0) {
      throw policyError('پیش‌نمایش جمعیت خطای حل‌نشده دارد و انتشار متوقف شد.', 'PERFORMANCE_POLICY_PREVIEW_HAS_ERRORS', 409);
    }
    let schedulingVersion = version;
    if (overdueScheduled) {
      const latestPolicyVersion = await tx.performancePolicyVersion.findFirst({
        where: { policyKind: version.policyKind },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });
      const replacementId = randomUUID();
      const replacementPayload = await persistVersionContent(tx, {
        aggregateType: 'POLICY_VERSION',
        aggregateId: replacementId,
        payloadKindPrefix: 'POLICY',
        content,
        keyring,
      });
      schedulingVersion = await tx.performancePolicyVersion.create({ data: {
        id: replacementId,
        policyKind: version.policyKind,
        version: (latestPolicyVersion?.version ?? version.version) + 1,
        predecessorId: latestPolicyVersion?.id ?? version.id,
        contentHash: replacementPayload.contentHash,
        encryptedPayloadId: replacementPayload.id,
        createdByUserId: input.confirmedByUserId,
      } });
      if (latestPolicyVersion && latestPolicyVersion.id !== version.id) {
        await tx.performancePolicyVersion.update({
          where: { id: latestPolicyVersion.id },
          data: { lifecycle: PerformanceArtifactLifecycle.CANCELLED },
        });
      }
      await tx.performancePolicyVersion.update({
        where: { id: version.id },
        data: { lifecycle: PerformanceArtifactLifecycle.RETIRED, retiredAt: now },
      });
      const supersessionAuditId = randomUUID();
      const supersessionEvidence = await persistPerformancePayload(tx, {
        aggregateType: 'POLICY_VERSION', aggregateId: supersessionAuditId,
        payloadKind: 'OVERDUE_SUPERSESSION', schemaVersion: 1,
        payload: {
          supersededVersionId: version.id,
          preservedEffectiveFrom: version.effectiveFrom?.toISOString() ?? null,
          replacementVersionId: replacementId,
          replacementEffectiveFrom: input.effectiveFrom.toISOString(),
          displacedDraftVersionId: latestPolicyVersion?.id !== version.id ? latestPolicyVersion?.id : null,
        },
        keyring,
      });
      const priorSupersededEvent = await tx.performanceAuditEvent.findFirst({
        where: { aggregateType: 'POLICY_VERSION', aggregateId: version.id }, orderBy: { occurredAt: 'desc' },
      });
      await tx.performanceAuditEvent.create({ data: {
        id: supersessionAuditId,
        aggregateType: 'POLICY_VERSION',
        aggregateId: version.id,
        eventType: 'OVERDUE_SUPERSEDED',
        actorUserId: input.confirmedByUserId,
        reason: input.reason.trim(),
        encryptedPayloadId: supersessionEvidence.id,
        previousEventHash: priorSupersededEvent?.eventHash,
        eventHash: canonicalPerformanceHash({
          supersessionAuditId, supersededVersionId: version.id, replacementVersionId: replacementId,
          evidenceHash: supersessionEvidence.contentHash,
        }),
        occurredAt: now,
      } });
    }
    const previewId = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'POLICY_ACTIVATION_PREVIEW',
      aggregateId: previewId,
      payloadKind: 'POPULATION_RESULT',
      schemaVersion: 1,
      payload: population.preview.population,
      keyring,
    });
    if (encrypted.contentHash !== population.preview.resultHash) {
      throw policyError('هش پیش‌نمایش جمعیت پایدار نیست.', 'PERFORMANCE_POLICY_PREVIEW_HASH_MISMATCH', 409);
    }
    const counts = population.preview.counts;
    await tx.performancePolicyActivationPreview.create({ data: {
      id: previewId,
      policyVersionId: schedulingVersion.id,
      policyContentHash: schedulingVersion.contentHash,
      populationHash: population.sourcePopulationHash,
      encryptedPayloadId: encrypted.id,
      eligibleSubjectCount: counts.eligible,
      evaluatedSubjectCount: counts.evaluated,
      increasedCount: counts.increased,
      decreasedCount: counts.decreased,
      unchangedCount: counts.unchanged,
      expiredCount: counts.expired,
      needsNewEvaluationCount: counts.needsNewEvaluation,
      errorCount: counts.errors,
      resultHash: population.preview.resultHash,
      generatedAt: now,
      confirmedAt: now,
      confirmedByUserId: input.confirmedByUserId,
    } });
    const scheduled = await tx.performancePolicyVersion.update({
      where: { id: schedulingVersion.id },
      data: {
        lifecycle: PerformanceArtifactLifecycle.SCHEDULED,
        effectiveFrom: input.effectiveFrom,
        publicationReason: input.reason.trim(),
        publishedByUserId: input.confirmedByUserId,
        publishedAt: now,
        activationPreviewId: previewId,
        activationPreviewHash: population.preview.resultHash,
        activationConfirmedAt: now,
      },
    });
    const auditId = randomUUID();
    const auditEvidence = await persistPerformancePayload(tx, {
      aggregateType: 'POLICY_VERSION',
      aggregateId: auditId,
      payloadKind: overdueScheduled ? 'REPLACEMENT_SCHEDULING' : 'SCHEDULING',
      schemaVersion: 1,
      payload: {
        before: {
          lifecycle: schedulingVersion.lifecycle,
          effectiveFrom: schedulingVersion.effectiveFrom?.toISOString() ?? null,
          publicationReason: schedulingVersion.publicationReason,
          publishedByUserId: schedulingVersion.publishedByUserId,
          activationPreviewId: schedulingVersion.activationPreviewId,
        },
        after: {
          lifecycle: scheduled.lifecycle,
          effectiveFrom: scheduled.effectiveFrom?.toISOString() ?? null,
          publicationReason: scheduled.publicationReason,
          publishedByUserId: scheduled.publishedByUserId,
          activationPreviewId: scheduled.activationPreviewId,
        },
      },
      keyring,
    });
    const previousEvent = await tx.performanceAuditEvent.findFirst({
      where: { aggregateType: 'POLICY_VERSION', aggregateId: schedulingVersion.id },
      orderBy: { occurredAt: 'desc' },
    });
    await tx.performanceAuditEvent.create({ data: {
      id: auditId,
      aggregateType: 'POLICY_VERSION',
      aggregateId: schedulingVersion.id,
      eventType: overdueScheduled ? 'REPLACEMENT_SCHEDULED' : 'SCHEDULED',
      actorUserId: input.confirmedByUserId,
      reason: input.reason.trim(),
      encryptedPayloadId: auditEvidence.id,
      previousEventHash: previousEvent?.eventHash,
      eventHash: canonicalPerformanceHash({
        auditId,
        versionId: schedulingVersion.id,
        eventType: overdueScheduled ? 'REPLACEMENT_SCHEDULED' : 'SCHEDULED',
        evidenceHash: auditEvidence.contentHash,
      }),
      occurredAt: now,
    } });
    const recomputation = await hasActivePerformanceAggregationPolicies(tx)
      ? await recomputeAllProjections(tx, {
        now,
        actorUserId: input.confirmedByUserId,
        reason: 'زمان‌بندی سیاست عملکرد و ثبت تاریخ بازبینی بعدی',
        keyring,
      })
      : { pendingPublishedAggregationPolicies: true };
    return {
      version: scheduled,
      supersededVersionId: overdueScheduled ? version.id : null,
      preview: { ...counts, resultHash: population.preview.resultHash },
      recomputation,
    };
  });
};

const scheduleArtifact = async (client: PrismaClient, input: {
  artifactType: 'criterion' | 'template';
  versionId: string;
  effectiveFrom: Date;
  reason: string;
  publishedByUserId: string;
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  ensureNoErrors(validatePerformancePublication({ now, effectiveFrom: input.effectiveFrom, reason: input.reason }));
  return asTx(client, async (tx) => {
    if (input.artifactType === 'criterion') {
      const version = await tx.performanceCriterionVersion.findUnique({ where: { id: input.versionId } });
      if (!version || version.lifecycle !== PerformanceArtifactLifecycle.DRAFT) throw policyError('فقط نسخه پیش‌نویس معیار قابل زمان‌بندی است.', 'PERFORMANCE_VERSION_NOT_SCHEDULABLE', 409);
      const alreadyScheduled = await tx.performanceCriterionVersion.findFirst({ where: {
        criterionIdentityId: version.criterionIdentityId,
        lifecycle: PerformanceArtifactLifecycle.SCHEDULED,
        id: { not: version.id },
      } });
      if (alreadyScheduled) throw policyError('برای این معیار از قبل یک نسخه زمان‌بندی شده است.', 'PERFORMANCE_VERSION_SCHEDULE_CONFLICT', 409);
      return tx.performanceCriterionVersion.update({ where: { id: version.id }, data: {
        lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: input.effectiveFrom,
        publicationReason: input.reason.trim(), publishedByUserId: input.publishedByUserId, publishedAt: now,
      } });
    }
    const version = await tx.performanceTemplateVersion.findUnique({ where: { id: input.versionId } });
    if (!version || version.lifecycle !== PerformanceArtifactLifecycle.DRAFT) throw policyError('فقط نسخه پیش‌نویس الگو قابل زمان‌بندی است.', 'PERFORMANCE_VERSION_NOT_SCHEDULABLE', 409);
    const alreadyScheduled = await tx.performanceTemplateVersion.findFirst({ where: {
      templateKind: version.templateKind,
      ownerType: version.ownerType,
      ownerId: version.ownerId,
      lifecycle: PerformanceArtifactLifecycle.SCHEDULED,
      id: { not: version.id },
    } });
    if (alreadyScheduled) throw policyError('برای این الگو از قبل یک نسخه زمان‌بندی شده است.', 'PERFORMANCE_VERSION_SCHEDULE_CONFLICT', 409);
    return tx.performanceTemplateVersion.update({ where: { id: version.id }, data: {
      lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: input.effectiveFrom,
      publicationReason: input.reason.trim(), publishedByUserId: input.publishedByUserId, publishedAt: now,
    } });
  });
};

export const schedulePerformanceCriterion = (client: PrismaClient, input: Omit<Parameters<typeof scheduleArtifact>[1], 'artifactType'>) => (
  scheduleArtifact(client, { ...input, artifactType: 'criterion' })
);

export const schedulePerformanceTemplate = (client: PrismaClient, input: Omit<Parameters<typeof scheduleArtifact>[1], 'artifactType'>) => (
  scheduleArtifact(client, { ...input, artifactType: 'template' })
);

export const cancelScheduledPerformanceVersion = async (client: PrismaClient, input: {
  artifactType: 'policy' | 'criterion' | 'template';
  versionId: string;
  reason: string;
  actorUserId: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  if (input.reason.trim().length < 8) throw policyError('دلیل لغو باید روشن و قابل حسابرسی باشد.', 'PERFORMANCE_CANCELLATION_REASON_REQUIRED', 422);
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    const version = input.artifactType === 'policy'
      ? await tx.performancePolicyVersion.findUnique({ where: { id: input.versionId } })
      : input.artifactType === 'criterion'
        ? await tx.performanceCriterionVersion.findUnique({ where: { id: input.versionId } })
        : await tx.performanceTemplateVersion.findUnique({ where: { id: input.versionId } });
    if (!version || version.lifecycle !== PerformanceArtifactLifecycle.SCHEDULED) {
      throw policyError('فقط نسخه زمان‌بندی‌شده و استفاده‌نشده قابل لغو است.', 'PERFORMANCE_VERSION_NOT_CANCELLABLE', 409);
    }
    if (version.effectiveFrom && version.effectiveFrom.getTime() <= now.getTime()) {
      throw policyError('لغو عادی فقط پیش از تاریخ اثر مجاز است؛ سیاست سررسیدشده باید دوباره پیش‌نمایش و تأیید شود.', 'PERFORMANCE_VERSION_CANCELLATION_TOO_LATE', 409);
    }
    const cancelled = input.artifactType === 'policy'
      ? await tx.performancePolicyVersion.update({ where: { id: version.id }, data: { lifecycle: PerformanceArtifactLifecycle.CANCELLED } })
      : input.artifactType === 'criterion'
        ? await tx.performanceCriterionVersion.update({ where: { id: version.id }, data: { lifecycle: PerformanceArtifactLifecycle.CANCELLED } })
        : await tx.performanceTemplateVersion.update({ where: { id: version.id }, data: { lifecycle: PerformanceArtifactLifecycle.CANCELLED } });
    const auditId = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_VERSION', aggregateId: auditId, payloadKind: 'CANCELLATION_REASON', schemaVersion: 1,
      payload: { artifactType: input.artifactType, versionId: version.id, reason: input.reason.trim() }, keyring,
    });
    await tx.performanceAuditEvent.create({ data: {
      id: auditId,
      aggregateType: `${input.artifactType.toUpperCase()}_VERSION`,
      aggregateId: version.id,
      eventType: 'CANCELLED',
      actorUserId: input.actorUserId,
      reason: input.reason.trim(),
      encryptedPayloadId: encrypted.id,
      eventHash: canonicalPerformanceHash({ auditId, versionId: version.id, evidenceHash: encrypted.contentHash }),
      occurredAt: now,
    } });
    return cancelled;
  });
};

export const retirePerformanceArtifactVersion = async (client: PrismaClient, input: {
  artifactType: 'criterion' | 'template';
  versionId: string;
  reason: string;
  actorUserId: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  if (input.reason.trim().length < 8) throw policyError('دلیل بازنشستگی باید روشن و قابل حسابرسی باشد.', 'PERFORMANCE_RETIREMENT_REASON_REQUIRED', 422);
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    const version = input.artifactType === 'criterion'
      ? await tx.performanceCriterionVersion.findUnique({ where: { id: input.versionId } })
      : await tx.performanceTemplateVersion.findUnique({ where: { id: input.versionId } });
    if (!version || version.lifecycle !== PerformanceArtifactLifecycle.ACTIVE) {
      throw policyError('فقط نسخه فعال معیار یا الگو قابل بازنشستگی است.', 'PERFORMANCE_VERSION_NOT_RETIRABLE', 409);
    }
    const retired = input.artifactType === 'criterion'
      ? await tx.performanceCriterionVersion.update({ where: { id: version.id }, data: { lifecycle: PerformanceArtifactLifecycle.RETIRED, retiredAt: now } })
      : await tx.performanceTemplateVersion.update({ where: { id: version.id }, data: { lifecycle: PerformanceArtifactLifecycle.RETIRED, retiredAt: now } });
    const auditId = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_VERSION', aggregateId: auditId, payloadKind: 'RETIREMENT_REASON', schemaVersion: 1,
      payload: { artifactType: input.artifactType, versionId: version.id, reason: input.reason.trim() }, keyring,
    });
    await tx.performanceAuditEvent.create({ data: {
      id: auditId,
      aggregateType: `${input.artifactType.toUpperCase()}_VERSION`,
      aggregateId: version.id,
      eventType: 'RETIRED',
      actorUserId: input.actorUserId,
      reason: input.reason.trim(),
      encryptedPayloadId: encrypted.id,
      eventHash: canonicalPerformanceHash({ auditId, versionId: version.id, evidenceHash: encrypted.contentHash }),
      occurredAt: now,
    } });
    return retired;
  });
};

const publicVersion = <T extends { encryptedPayloadId: string | null }>(row: T, content: unknown) => {
  const { encryptedPayloadId: _payloadId, ...metadata } = row;
  return { ...metadata, content };
};

export const listPerformanceCriteria = async (client: PrismaClient, keyring = performanceVaultKeyFromEnvironment()) => {
  const rows = await client.performanceCriterionVersion.findMany({ orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] });
  const identities = await client.performanceCriterionIdentity.findMany();
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));
  return Promise.all(rows.map(async (row) => publicVersion({ ...row, conceptCode: identityById.get(row.criterionIdentityId)?.conceptCode }, row.encryptedPayloadId
    ? decryptPerformancePayloadRow(await client.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: row.encryptedPayloadId } }), keyring)
    : null)));
};

export const listPerformanceTemplates = async (client: PrismaClient, keyring = performanceVaultKeyFromEnvironment()) => {
  const rows = await client.performanceTemplateVersion.findMany({ orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] });
  return Promise.all(rows.map(async (row) => publicVersion(row, row.encryptedPayloadId
    ? decryptPerformancePayloadRow(await client.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: row.encryptedPayloadId } }), keyring)
    : null)));
};

export const listPerformancePolicies = async (client: PrismaClient, keyring = performanceVaultKeyFromEnvironment()) => {
  const rows = await client.performancePolicyVersion.findMany({
    orderBy: [{ policyKind: 'asc' }, { version: 'desc' }],
  });
  return Promise.all(rows.map(async (row) => publicVersion(row, row.encryptedPayloadId
    ? decryptPerformancePayloadRow(await client.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: row.encryptedPayloadId } }), keyring)
    : null)));
};

const recomputeAllProjections = async (tx: Prisma.TransactionClient, input: {
  now: Date;
  actorUserId: string | null;
  reason: string;
  keyring: PerformanceVaultKey;
  subjectIds?: string[];
}) => {
  const population = await calculatePopulation(tx, { now: input.now, keyring: input.keyring, subjectIds: input.subjectIds });
  if (population.preview.counts.errors > 0) {
    throw policyError('بازمحاسبه سطح جاری خطای حل‌نشده دارد و تغییر اتمیک متوقف شد.', 'PERFORMANCE_RECOMPUTATION_FAILED', 409);
  }
  const levelPolicy = await getPolicyContent<LevelPolicyContent>(tx, PerformancePolicyKind.LEVEL_CLASSIFICATION, input.keyring);
  const currentPolicy = await getPolicyContent<CurrentLevelPolicyContent>(tx, PerformancePolicyKind.CURRENT_LEVEL, input.keyring);
  if (!levelPolicy || !currentPolicy) {
    throw policyError('بازمحاسبه سطح جاری به نسخه فعال سیاست سطح‌بندی و تجمیع نیاز دارد.', 'PERFORMANCE_AGGREGATION_POLICY_MISSING', 409);
  }
  const nextScheduledPolicy = await tx.performancePolicyVersion.findFirst({
    where: {
      policyKind: { in: [PerformancePolicyKind.LEVEL_CLASSIFICATION, PerformancePolicyKind.CURRENT_LEVEL] },
      lifecycle: PerformanceArtifactLifecycle.SCHEDULED,
      effectiveFrom: { gt: input.now },
    },
    orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
    select: { effectiveFrom: true },
  });
  const subjects = await listCurrentPerformanceSubjects(tx, input.subjectIds);
  const currentSubjectIds = subjects.map(({ id }) => id);
  const staleProjections = await tx.performanceCurrentLevelProjection.findMany({
    where: { subjectId: { notIn: currentSubjectIds, ...(input.subjectIds ? { in: input.subjectIds } : {}) } },
  });
  for (const stale of staleProjections) {
    const auditId = randomUUID();
    await tx.performanceAuditEvent.create({ data: {
      id: auditId,
      aggregateType: 'CURRENT_LEVEL_PROJECTION',
      aggregateId: stale.subjectId,
      eventType: 'CURRENT_EFFECT_CLEARED',
      actorUserId: input.actorUserId,
      reason: 'رابطه استخدامی دیگر فعال یا معلق نیست و فقط سابقه حفظ می‌شود',
      eventHash: canonicalPerformanceHash({ auditId, subjectId: stale.subjectId, previousVersion: stale.version, clearedAt: input.now.toISOString() }),
      occurredAt: input.now,
    } });
  }
  if (staleProjections.length > 0) await tx.performanceCurrentLevelProjection.deleteMany({
    where: { subjectId: { in: staleProjections.map(({ subjectId }) => subjectId) } },
  });
  const evaluations = await tx.performanceEvaluation.findMany({
    where: { subjectId: { in: subjects.map(({ id }) => id) } }, select: { id: true, subjectId: true, measurementTo: true },
  });
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const restrictedIds = new Set(await activePerformanceRestrictionIds(tx, evaluations.map(({ id }) => id)));
  const results = evaluations.length === 0 ? [] : await tx.performanceAcceptedResult.findMany({
    where: { evaluationId: { in: evaluations.map(({ id }) => id) } },
  });
  const resultsBySubject = new Map<string, CurrentPerformanceResultInput[]>();
  for (const result of results) {
    const evaluation = evaluationById.get(result.evaluationId);
    if (!evaluation) continue;
    const payload = await readPerformancePayload<AcceptedResultPayload>(tx, result.encryptedPayloadId, input.keyring);
    const items = resultsBySubject.get(evaluation.subjectId) ?? [];
    items.push({
      resultId: result.id,
      exactScore: payload.exactScore,
      measurementTo: (payload.measurementTo ? new Date(payload.measurementTo) : evaluation.measurementTo).toISOString(),
      expiresAt: result.expiresAt.toISOString(),
      status: restrictedIds.has(result.evaluationId) ? 'SUSPENDED' : result.status,
    });
    resultsBySubject.set(evaluation.subjectId, items);
  }
  for (const subject of subjects) {
    const previous = await tx.performanceCurrentLevelProjection.findUnique({ where: { subjectId: subject.id } });
    const next = calculateCurrentPerformanceLevel({
      asOf: input.now,
      policy: { versionId: levelPolicy.id, thresholds: levelPolicy.content.thresholds },
      aggregationPolicy: {
        versionId: currentPolicy.id,
        recencyWeightsPercent: currentPolicy.content.recencyWeightsPercent,
        maximumResults: currentPolicy.content.maximumResults,
      },
      nextPolicyEffectiveAt: nextScheduledPolicy?.effectiveFrom ?? null,
      results: resultsBySubject.get(subject.id) ?? [],
    });
    const projectionState = next.state === 'UNEVALUATED' && evaluations.some((evaluation) => evaluation.subjectId === subject.id && restrictedIds.has(evaluation.id)) ? 'TEMPORARILY_UNAVAILABLE' : next.state;
    const sourceResultsHash = canonicalPerformanceHash(next.sourceResultsHashInput);
    const projection = await tx.performanceCurrentLevelProjection.upsert({
      where: { subjectId: subject.id },
      create: {
        subjectId: subject.id,
        state: projectionState,
        levelCode: next.levelCode,
        levelPolicyVersionId: next.state === 'LEVEL' ? levelPolicy.id : null,
        sourceResultsHash,
        newestMeasurementTo: next.newestMeasurementTo ? new Date(next.newestMeasurementTo) : null,
        nextReviewAt: next.nextReviewAt ? new Date(next.nextReviewAt) : null,
        version: 1,
        projectedAt: input.now,
      },
      update: {
        state: projectionState,
        levelCode: next.levelCode,
        levelPolicyVersionId: next.state === 'LEVEL' ? levelPolicy.id : null,
        sourceResultsHash,
        newestMeasurementTo: next.newestMeasurementTo ? new Date(next.newestMeasurementTo) : null,
        nextReviewAt: next.nextReviewAt ? new Date(next.nextReviewAt) : null,
        version: { increment: 1 },
        projectedAt: input.now,
      },
    });
    const auditId = randomUUID();
    const auditEvidence = await persistPerformancePayload(tx, {
      aggregateType: 'CURRENT_LEVEL_PROJECTION', aggregateId: auditId, payloadKind: 'RECOMPUTATION_TRACE', schemaVersion: 1,
      payload: { subjectId: subject.id, previous, next, reason: input.reason }, keyring: input.keyring,
    });
    const previousEvent = await tx.performanceAuditEvent.findFirst({
      where: { aggregateType: 'CURRENT_LEVEL_PROJECTION', aggregateId: subject.id }, orderBy: { occurredAt: 'desc' },
    });
    await tx.performanceAuditEvent.create({ data: {
      id: auditId,
      aggregateType: 'CURRENT_LEVEL_PROJECTION',
      aggregateId: subject.id,
      eventType: 'RECOMPUTED',
      actorUserId: input.actorUserId,
      authorityHash: input.actorUserId === null ? systemActorAuthorityHash : undefined,
      reason: input.reason,
      encryptedPayloadId: auditEvidence.id,
      previousEventHash: previousEvent?.eventHash,
      eventHash: canonicalPerformanceHash({ auditId, subjectId: subject.id, projection, evidenceHash: auditEvidence.contentHash }),
      occurredAt: input.now,
    } });
    if (subject.personnelId && (!previous || previous.sourceResultsHash !== sourceResultsHash)) {
      const user = await tx.user.findUnique({ where: { personnelId: subject.personnelId }, select: { id: true } });
      if (user) await publishNotificationEvent(tx, {
        type: 'PERFORMANCE_SUMMARY_UPDATED',
        deduplicationKey: `performance-summary-updated:${subject.id}:v${projection.version}`,
        recipientIds: [user.id], recipientGroups: { DIRECT_USER: [user.id] },
        actorId: input.actorUserId, resourceType: 'PERFORMANCE_SUBJECT', resourceId: subject.id,
        actionUrl: '/dashboard/hr/personnel/performance',
        referenceId: `performance-projection:${subject.id}:v${projection.version}`,
        payload: {},
      });
    }
  }
  return { subjectCount: subjects.length, resultHash: population.preview.resultHash };
};

export const recomputePerformanceProjectionsInTransaction = recomputeAllProjections;

export const reconcilePerformanceProjectionSubjects = async (client: PrismaClient, input: {
  now: Date;
  actorUserId: string | null;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return asTx(client, async (tx) => {
    const subjects = await listCurrentPerformanceSubjects(tx);
    const projections = await tx.performanceCurrentLevelProjection.findMany({ select: { subjectId: true } });
    const subjectIds = new Set(subjects.map(({ id }) => id));
    const projectionIds = new Set(projections.map(({ subjectId }) => subjectId));
    const populationChanged = subjectIds.size !== projectionIds.size
      || [...subjectIds].some((id) => !projectionIds.has(id));
    if (!populationChanged) return null;
    return recomputeAllProjections(tx, {
      now: input.now,
      actorUserId: input.actorUserId,
      reason: 'تغییر رابطه استخدامی و تطبیق جمعیت سطح جاری',
      keyring,
    });
  });
};

export const activateDuePerformancePolicies = async (client: PrismaClient, input: {
  actorUserId: string | null;
  idempotencyKey: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const idempotencyKeyHash = createHash('sha256').update(input.idempotencyKey).digest('hex');
  const intentHash = canonicalPerformanceHash({ operation: 'ACTIVATE_DUE_POLICIES' });
  return asTx(client, async (tx) => {
    await acquireVersionLock(tx, `performance-operation:${idempotencyKeyHash}`);
    const existing = await tx.performanceOperationReceipt.findUnique({ where: { idempotencyKeyHash } });
    if (existing) {
      if (existing.intentHash !== intentHash) throw policyError('کلید تکرار با درخواست دیگری استفاده شده است.', 'PERFORMANCE_IDEMPOTENCY_CONFLICT', 409);
      return readPerformancePayload<{ activatedPolicyVersionIds: string[]; recomputation: unknown }>(tx, existing.encryptedPayloadId, keyring);
    }
    const due = await tx.performancePolicyVersion.findMany({
      where: { lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
    });
    if (due.length > 1) {
      throw policyError('فعال‌سازی هم‌زمان چند سیاست نیازمند پیش‌نمایش جمعی تازه است.', 'PERFORMANCE_POLICY_ACTIVATION_CONFLICT', 409);
    }
    const kinds = new Set<string>();
    for (const policy of due) {
      if (kinds.has(policy.policyKind)) throw policyError('بیش از یک نسخه هم‌زمان برای یک سیاست آماده فعال‌سازی است.', 'PERFORMANCE_POLICY_ACTIVATION_CONFLICT', 409);
      kinds.add(policy.policyKind);
      await acquireVersionLock(tx, `performance-policy:${policy.policyKind}`);
      if (!policy.activationPreviewId || !policy.encryptedPayloadId || !policy.effectiveFrom) {
        throw policyError('سیاست زمان‌بندی‌شده پیش‌نمایش کامل و قابل بازبینی ندارد.', 'PERFORMANCE_POLICY_PREVIEW_MISSING', 409);
      }
      const confirmedPreview = await tx.performancePolicyActivationPreview.findUnique({
        where: { id: policy.activationPreviewId },
      });
      const content = await readPerformancePayload<PerformancePolicyContent>(tx, policy.encryptedPayloadId, keyring);
      ensureNoErrors(validatePolicyContent(policy.policyKind, content));
      const currentPopulation = await calculatePopulation(tx, {
        now: policy.effectiveFrom,
        keyring,
        proposed: { kind: policy.policyKind, id: policy.id, content },
      });
      if (!confirmedPreview
        || confirmedPreview.populationHash !== currentPopulation.sourcePopulationHash
        || confirmedPreview.resultHash !== currentPopulation.preview.resultHash) {
        throw policyError('جمعیت یا اثر سیاست پس از تأیید تغییر کرده است؛ پیش‌نمایش و تأیید تازه لازم است.', 'PERFORMANCE_POLICY_REPREVIEW_REQUIRED', 409);
      }
      const active = await tx.performancePolicyVersion.findFirst({
        where: { policyKind: policy.policyKind, lifecycle: PerformanceArtifactLifecycle.ACTIVE },
      });
      if (active) await tx.performancePolicyVersion.update({
        where: { id: active.id }, data: { lifecycle: PerformanceArtifactLifecycle.RETIRED, retiredAt: now },
      });
      await tx.performancePolicyVersion.update({
        where: { id: policy.id }, data: { lifecycle: PerformanceArtifactLifecycle.ACTIVE },
      });
      const previousEvent = await tx.performanceAuditEvent.findFirst({
        where: { aggregateType: 'POLICY_VERSION', aggregateId: policy.id },
        orderBy: { occurredAt: 'desc' },
      });
      await tx.performanceAuditEvent.create({ data: {
        aggregateType: 'POLICY_VERSION',
        aggregateId: policy.id,
        eventType: 'ACTIVATED',
        actorUserId: input.actorUserId,
        authorityHash: input.actorUserId === null ? systemActorAuthorityHash : undefined,
        reason: policy.publicationReason,
        previousEventHash: previousEvent?.eventHash,
        eventHash: canonicalPerformanceHash({
          type: 'POLICY_VERSION', id: policy.id, event: 'ACTIVATED', at: now.toISOString(),
        }),
        occurredAt: now,
      } });
    }
    const recomputation = due.length > 0 && await hasActivePerformanceAggregationPolicies(tx)
      ? await recomputeAllProjections(tx, { now, actorUserId: input.actorUserId, reason: 'فعال‌سازی سیاست عملکرد', keyring })
      : { subjectCount: 0, resultHash: canonicalPerformanceHash([]), pendingPublishedAggregationPolicies: due.length > 0 };
    const response = { activatedPolicyVersionIds: due.map(({ id }) => id), recomputation };
    const receiptId = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'POLICY_OPERATION_RECEIPT', aggregateId: receiptId, payloadKind: 'ACTIVATION_RESULT', schemaVersion: 1,
      payload: response, keyring,
    });
    await tx.performanceOperationReceipt.create({ data: {
      id: receiptId,
      idempotencyKeyHash,
      operationKind: 'ACTIVATE_DUE_POLICIES',
      policyVersionId: due.length === 1 ? due[0].id : null,
      intentHash,
      encryptedPayloadId: encrypted.id,
      completedAt: now,
    } });
    return response;
  });
};

export const activateDuePerformanceArtifacts = async (client: PrismaClient, input: {
  actorUserId: string | null;
  idempotencyKey: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const idempotencyKeyHash = createHash('sha256').update(input.idempotencyKey).digest('hex');
  const intentHash = canonicalPerformanceHash({ operation: 'ACTIVATE_DUE_ARTIFACTS' });
  return asTx(client, async (tx) => {
    await acquireVersionLock(tx, `performance-operation:${idempotencyKeyHash}`);
    const existing = await tx.performanceOperationReceipt.findUnique({ where: { idempotencyKeyHash } });
    if (existing) {
      if (existing.intentHash !== intentHash) throw policyError('کلید تکرار با درخواست دیگری استفاده شده است.', 'PERFORMANCE_IDEMPOTENCY_CONFLICT', 409);
      return readPerformancePayload<{ activatedCriterionVersionIds: string[]; activatedTemplateVersionIds: string[] }>(tx, existing.encryptedPayloadId, keyring);
    }
    const criteria = await tx.performanceCriterionVersion.findMany({
      where: { lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
    });
    const criterionIdentities = new Set<string>();
    for (const version of criteria) {
      if (criterionIdentities.has(version.criterionIdentityId)) throw policyError('بیش از یک نسخه هم‌زمان برای یک معیار آماده فعال‌سازی است.', 'PERFORMANCE_ARTIFACT_ACTIVATION_CONFLICT', 409);
      criterionIdentities.add(version.criterionIdentityId);
      await acquireVersionLock(tx, `performance-criterion:${version.criterionIdentityId}`);
      const active = await tx.performanceCriterionVersion.findFirst({
        where: { criterionIdentityId: version.criterionIdentityId, lifecycle: PerformanceArtifactLifecycle.ACTIVE },
      });
      if (active) await tx.performanceCriterionVersion.update({ where: { id: active.id }, data: { lifecycle: PerformanceArtifactLifecycle.RETIRED, retiredAt: now } });
      await tx.performanceCriterionVersion.update({ where: { id: version.id }, data: { lifecycle: PerformanceArtifactLifecycle.ACTIVE } });
      await tx.performanceAuditEvent.create({ data: {
        aggregateType: 'CRITERION_VERSION', aggregateId: version.id, eventType: 'ACTIVATED', actorUserId: input.actorUserId,
        authorityHash: input.actorUserId === null ? systemActorAuthorityHash : undefined,
        reason: version.publicationReason, eventHash: canonicalPerformanceHash({ type: 'CRITERION_VERSION', id: version.id, event: 'ACTIVATED', at: now.toISOString() }), occurredAt: now,
      } });
    }
    const templates = await tx.performanceTemplateVersion.findMany({
      where: { lifecycle: PerformanceArtifactLifecycle.SCHEDULED, effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
    });
    const templateOwners = new Set<string>();
    for (const version of templates) {
      const ownerKey = `${version.templateKind}:${version.ownerType}:${version.ownerId}`;
      if (templateOwners.has(ownerKey)) throw policyError('بیش از یک نسخه هم‌زمان برای یک الگو آماده فعال‌سازی است.', 'PERFORMANCE_ARTIFACT_ACTIVATION_CONFLICT', 409);
      templateOwners.add(ownerKey);
      await acquireVersionLock(tx, `performance-template:${version.templateKind}:${version.ownerType}:${version.ownerId}`);
      const active = await tx.performanceTemplateVersion.findFirst({
        where: {
          templateKind: version.templateKind, ownerType: version.ownerType, ownerId: version.ownerId,
          lifecycle: PerformanceArtifactLifecycle.ACTIVE,
        },
      });
      if (active) await tx.performanceTemplateVersion.update({ where: { id: active.id }, data: { lifecycle: PerformanceArtifactLifecycle.RETIRED, retiredAt: now } });
      await tx.performanceTemplateVersion.update({ where: { id: version.id }, data: { lifecycle: PerformanceArtifactLifecycle.ACTIVE } });
      await tx.performanceAuditEvent.create({ data: {
        aggregateType: 'TEMPLATE_VERSION', aggregateId: version.id, eventType: 'ACTIVATED', actorUserId: input.actorUserId,
        authorityHash: input.actorUserId === null ? systemActorAuthorityHash : undefined,
        reason: version.publicationReason, eventHash: canonicalPerformanceHash({ type: 'TEMPLATE_VERSION', id: version.id, event: 'ACTIVATED', at: now.toISOString() }), occurredAt: now,
      } });
    }
    const response = { activatedCriterionVersionIds: criteria.map(({ id }) => id), activatedTemplateVersionIds: templates.map(({ id }) => id) };
    const receiptId = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_OPERATION_RECEIPT', aggregateId: receiptId, payloadKind: 'ARTIFACT_ACTIVATION_RESULT', schemaVersion: 1,
      payload: response, keyring,
    });
    await tx.performanceOperationReceipt.create({ data: {
      id: receiptId, idempotencyKeyHash, operationKind: 'ACTIVATE_DUE_ARTIFACTS', intentHash,
      encryptedPayloadId: encrypted.id, completedAt: now,
    } });
    return response;
  });
};

export const freezePerformanceTemplateSnapshot = async (tx: Prisma.TransactionClient, input: {
  evaluationId: string;
  sectionId: string;
  jobTemplateVersionId: string;
  positionAddendumVersionId?: string;
  sectionStartedAt: Date;
  capturedAt?: Date;
  keyring: PerformanceVaultKey;
}) => {
  const templateIds = [input.jobTemplateVersionId, ...(input.positionAddendumVersionId ? [input.positionAddendumVersionId] : [])];
  const templates = await tx.performanceTemplateVersion.findMany({ where: { id: { in: templateIds } } });
  const publishedBySectionStart = (version: { effectiveFrom: Date | null; retiredAt: Date | null; lifecycle: PerformanceArtifactLifecycle }) => (
    version.effectiveFrom !== null
    && version.effectiveFrom.getTime() <= input.sectionStartedAt.getTime()
    && (version.retiredAt === null || version.retiredAt.getTime() > input.sectionStartedAt.getTime())
    && (version.lifecycle === PerformanceArtifactLifecycle.ACTIVE || version.lifecycle === PerformanceArtifactLifecycle.RETIRED)
  );
  if (templates.length !== templateIds.length || templates.some((template) => !template.encryptedPayloadId || !publishedBySectionStart(template))) {
    throw policyError('نسخه معتبر الگوی ارزیابی برای ابتدای بخش وجود ندارد.', 'PERFORMANCE_TEMPLATE_VERSION_MISSING', 409);
  }
  for (const template of templates) {
    const replacement = await tx.performanceTemplateVersion.findFirst({ where: {
      templateKind: template.templateKind, ownerType: template.ownerType, ownerId: template.ownerId,
      version: { gt: template.version }, effectiveFrom: { lte: input.sectionStartedAt },
      lifecycle: { in: [PerformanceArtifactLifecycle.ACTIVE, PerformanceArtifactLifecycle.RETIRED] },
    } });
    if (replacement) throw policyError('نسخه انتخاب‌شده الگو در ابتدای بخش نسخه مؤثر نبوده است.', 'PERFORMANCE_TEMPLATE_VERSION_NOT_EFFECTIVE', 409);
  }
  const job = templates.find((template) => template.id === input.jobTemplateVersionId)!;
  const addendum = input.positionAddendumVersionId ? templates.find((template) => template.id === input.positionAddendumVersionId) : null;
  const jobContent = await readPerformancePayload<PerformanceTemplatePolicyContent>(tx, job.encryptedPayloadId!, input.keyring);
  const addendumContent = addendum ? await readPerformancePayload<PerformanceTemplatePolicyContent>(tx, addendum.encryptedPayloadId!, input.keyring) : null;
  const criterionIds = [...new Set([
    ...jobContent.categories.flatMap((category) => category.criteria.map((criterion) => criterion.criterionVersionId)),
    ...(addendumContent?.categories.flatMap((category) => category.criteria.map((criterion) => criterion.criterionVersionId)) ?? []),
  ])];
  if (addendumContent) {
    const base = new Set(jobContent.categories.flatMap((category) => category.criteria.map((criterion) => criterion.criterionVersionId)));
    if (addendumContent.categories.some((category) => category.criteria.some((criterion) => base.has(criterion.criterionVersionId)))) {
      throw policyError('افزوده جایگاه نمی‌تواند معیار پایه الگوی شغل را حذف، جایگزین یا کم‌وزن کند.', 'PERFORMANCE_ADDENDUM_OVERRIDE', 409);
    }
  }
  const criteria = await tx.performanceCriterionVersion.findMany({ where: { id: { in: criterionIds } } });
  if (criteria.length !== criterionIds.length || criteria.some((criterion) => !criterion.encryptedPayloadId || !publishedBySectionStart(criterion))) {
    throw policyError('نسخه معیار ارجاع‌شده برای تصویر ثابت موجود نیست.', 'PERFORMANCE_CRITERION_VERSION_MISSING', 409);
  }
  for (const criterion of criteria) {
    const replacement = await tx.performanceCriterionVersion.findFirst({ where: {
      criterionIdentityId: criterion.criterionIdentityId, version: { gt: criterion.version },
      effectiveFrom: { lte: input.sectionStartedAt },
      lifecycle: { in: [PerformanceArtifactLifecycle.ACTIVE, PerformanceArtifactLifecycle.RETIRED] },
    } });
    if (replacement) throw policyError('نسخه انتخاب‌شده معیار در ابتدای بخش نسخه مؤثر نبوده است.', 'PERFORMANCE_CRITERION_VERSION_NOT_EFFECTIVE', 409);
  }
  const criterionContent = new Map<string, PerformanceCriterionPolicyContent>();
  for (const criterion of criteria) criterionContent.set(
    criterion.id,
    await readPerformancePayload<PerformanceCriterionPolicyContent>(tx, criterion.encryptedPayloadId!, input.keyring),
  );
  const scoringRow = await tx.performancePolicyVersion.findFirst({
    where: {
      policyKind: PerformancePolicyKind.SCORING,
      lifecycle: { in: [PerformanceArtifactLifecycle.ACTIVE, PerformanceArtifactLifecycle.RETIRED] },
      effectiveFrom: { lte: input.sectionStartedAt },
      OR: [{ retiredAt: null }, { retiredAt: { gt: input.sectionStartedAt } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!scoringRow?.encryptedPayloadId) {
    throw policyError('در ابتدای بخش هیچ نسخه مؤثر سیاست امتیازدهی وجود ندارد.', 'PERFORMANCE_SCORING_POLICY_MISSING', 409);
  }
  const scoring = {
    id: scoringRow.id,
    content: await readPerformancePayload<ScoringPolicyContent>(tx, scoringRow.encryptedPayloadId, input.keyring),
  };
  const addendumShare = new Prisma.Decimal(addendumContent ? scoring.content.defaultAddendumSharePercent : 0).toFixed(6);
  const jobShare = new Prisma.Decimal(addendumContent ? scoring.content.defaultJobSharePercent : 100).toFixed(6);
  const sourceCategories = [
    ...jobContent.categories.map((category) => ({ ...category, sourceShare: jobShare, source: 'JOB' })),
    ...(addendumContent?.categories.map((category) => ({ ...category, sourceShare: addendumShare, source: 'ADDENDUM' })) ?? []),
  ];
  const snapshot: PerformanceTemplateSnapshot = {
    schemaVersion: 1,
    templateVersionId: templateIds.join('+'),
    scoringPolicyVersionId: scoring.id,
    jobSharePercent: jobShare,
    addendumSharePercent: addendumShare,
    categories: sourceCategories.map((category) => ({
      id: `${category.source}:${category.id}`,
      titleFa: category.titleFa,
      weightPercent: new Prisma.Decimal(category.weightPercent).mul(category.sourceShare).div(100).toFixed(6),
      required: category.required,
      criteria: category.criteria.map((criterion) => {
        const content = criterionContent.get(criterion.criterionVersionId)!;
        return {
          criterionVersionId: criterion.criterionVersionId,
          titleFa: content.titleFa,
          weightPercent: criterion.weightPercent,
          kind: content.kind,
          anchorsFa: content.anchorsFa,
          applicability: content.applicability,
          evidence: {
            minimumReliableCount: content.evidence.minimumReliableCount,
            allowedKinds: content.evidence.allowedKinds,
            lookbackDays: content.evidence.lookbackDays,
            required: content.evidence.required,
          },
        };
      }),
    })),
  };
  const snapshotId = randomUUID();
  const encrypted = await persistPerformancePayload(tx, {
    aggregateType: 'TEMPLATE_SNAPSHOT', aggregateId: snapshotId, payloadKind: 'FROZEN_TEMPLATE', schemaVersion: 1,
    payload: snapshot, keyring: input.keyring,
  });
  await tx.performanceSnapshot.create({ data: {
    id: snapshotId,
    evaluationId: input.evaluationId,
    sectionId: input.sectionId,
    snapshotKind: 'TEMPLATE',
    version: 1,
    contentHash: encrypted.contentHash,
    encryptedPayloadId: encrypted.id,
    capturedAt: input.capturedAt ?? new Date(),
  } });
  await tx.performanceArtifactSnapshotBinding.createMany({ data: [
    ...templates.map((template) => ({
      snapshotId, artifactType: template.templateKind, templateVersionId: template.id, contentHash: template.contentHash,
    })),
    ...criteria.map((criterion) => ({
      snapshotId, artifactType: 'CRITERION', criterionVersionId: criterion.id, contentHash: criterion.contentHash,
    })),
    ...[{
      snapshotId, artifactType: 'SCORING_POLICY', policyVersionId: scoringRow.id, contentHash: canonicalPerformanceHash(scoring.content),
    }],
  ] });
  return { snapshotId, snapshot, contentHash: encrypted.contentHash };
};
