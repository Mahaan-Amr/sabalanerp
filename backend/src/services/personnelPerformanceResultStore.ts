import { createHash, randomUUID } from 'node:crypto';
import {
  PerformanceArtifactLifecycle,
  PerformancePolicyKind,
  PerformanceResultStatus,
  Prisma,
  type PerformanceCorrection,
  type PrismaClient,
} from '@prisma/client';
import {
  classifyExactPerformanceScore,
  calculatePerformanceEvaluation,
  performanceResultExpiry,
  reproducePerformanceCalculation,
  type PerformanceEvaluationInput,
  type PerformanceCalculationTrace,
} from './personnelPerformanceCalculation';
import {
  canonicalPerformanceHash,
  type LevelPolicyContent,
} from './personnelPerformancePolicy';
import {
  performanceVaultKeyFromEnvironment,
  persistPerformancePayload,
  readPerformancePayload,
  type PerformanceVaultKey,
} from './personnelPerformancePayloadStore';
import {
  recomputePerformanceProjectionsInTransaction,
  runPerformanceSerializableTransaction,
} from './personnelPerformancePolicyStore';
import { suspendPerformanceHandoffsForResult } from './personnelPerformanceDisclosureStore';

const resultError = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });
const systemActorAuthorityHash = canonicalPerformanceHash({ actorType: 'SYSTEM', actorCode: 'PERFORMANCE_MAINTENANCE' });

const loadLevelPolicy = async (tx: Prisma.TransactionClient, keyring: PerformanceVaultKey) => {
  const row = await tx.performancePolicyVersion.findFirst({
    where: { policyKind: PerformancePolicyKind.LEVEL_CLASSIFICATION, lifecycle: PerformanceArtifactLifecycle.ACTIVE },
    orderBy: { version: 'desc' },
  });
  if (!row?.encryptedPayloadId) {
    throw resultError('هیچ نسخه مؤثر سیاست سطح‌بندی برای پذیرش نتیجه وجود ندارد.', 'PERFORMANCE_LEVEL_POLICY_MISSING', 409);
  }
  return { id: row.id, content: await readPerformancePayload<LevelPolicyContent>(tx, row.encryptedPayloadId, keyring) };
};

const auditResultEvent = async (tx: Prisma.TransactionClient, input: {
  resultId: string;
  actorUserId: string | null;
  eventType: string;
  reason: string;
  evidence: unknown;
  occurredAt: Date;
  keyring: PerformanceVaultKey;
}) => {
  const id = randomUUID();
  const encrypted = await persistPerformancePayload(tx, {
    aggregateType: 'ACCEPTED_RESULT', aggregateId: id, payloadKind: 'AUDIT_EVENT', schemaVersion: 1,
    payload: input.evidence, keyring: input.keyring,
  });
  const previous = await tx.performanceAuditEvent.findFirst({
    where: { aggregateType: 'ACCEPTED_RESULT', aggregateId: input.resultId }, orderBy: { occurredAt: 'desc' },
  });
  return tx.performanceAuditEvent.create({ data: {
    id,
    aggregateType: 'ACCEPTED_RESULT',
    aggregateId: input.resultId,
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    authorityHash: input.actorUserId === null ? systemActorAuthorityHash : undefined,
    reason: input.reason,
    encryptedPayloadId: encrypted.id,
    previousEventHash: previous?.eventHash,
    eventHash: canonicalPerformanceHash({ id, resultId: input.resultId, eventType: input.eventType, evidenceHash: encrypted.contentHash }),
    occurredAt: input.occurredAt,
  } });
};

export const persistAcceptedPerformanceResult = async (tx: Prisma.TransactionClient, input: {
  evaluationId: string;
  calculationInput: PerformanceEvaluationInput;
  acceptedByUserId: string;
  idempotencyKey: string;
  acceptedAt?: Date;
  correctionId?: string;
  keyring: PerformanceVaultKey;
}) => {
  const acceptedAt = input.acceptedAt ?? new Date();
  const idempotencyKeyHash = createHash('sha256').update(input.idempotencyKey.trim()).digest('hex');
  const intentHash = canonicalPerformanceHash({
    operation: 'ACCEPT_PERFORMANCE_RESULT',
    evaluationId: input.evaluationId,
    correctionId: input.correctionId ?? null,
    acceptedByUserId: input.acceptedByUserId,
    calculationInput: input.calculationInput,
  });
  if (!input.idempotencyKey.trim()) throw resultError('کلید تکرارپذیری پذیرش نتیجه الزامی است.', 'PERFORMANCE_IDEMPOTENCY_KEY_REQUIRED', 422);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-operation:' + idempotencyKeyHash}, 0))`;
  const existingReceipt = await tx.performanceOperationReceipt.findUnique({ where: { idempotencyKeyHash } });
  if (existingReceipt) {
    if (existingReceipt.intentHash !== intentHash) throw resultError('کلید تکرار با درخواست دیگری استفاده شده است.', 'PERFORMANCE_IDEMPOTENCY_CONFLICT', 409);
    return readPerformancePayload<Record<string, unknown>>(tx, existingReceipt.encryptedPayloadId, input.keyring);
  }
  const evaluation = await tx.performanceEvaluation.findUnique({ where: { id: input.evaluationId } });
  if (!evaluation) throw resultError('پرونده ارزیابی عملکرد پیدا نشد.', 'PERFORMANCE_EVALUATION_NOT_FOUND', 404);
  const calculation = calculatePerformanceEvaluation(input.calculationInput);
  if (calculation.status !== 'SCORED' || !calculation.exactScore) {
    throw resultError(
      calculation.status === 'BLOCKED'
        ? 'نتیجه به‌علت مانع ساختاری قابل محاسبه نیست.'
        : 'این دوره کف پوشش لازم برای نتیجه امتیازدار را ندارد.',
      calculation.status === 'BLOCKED' ? 'PERFORMANCE_CALCULATION_BLOCKED' : 'PERFORMANCE_NOT_EVALUABLE',
      409,
    );
  }
  const previous = await tx.performanceAcceptedResult.findFirst({
    where: { evaluationId: evaluation.id }, orderBy: { version: 'desc' },
  });
  let correction: PerformanceCorrection | null = null;
  if (input.correctionId) {
    correction = await tx.performanceCorrection.findUnique({ where: { id: input.correctionId } });
    if (!correction || correction.evaluationId !== evaluation.id || correction.status !== 'OPEN'
      || correction.targetResultId !== previous?.id) {
      throw resultError('درخواست اصلاح باز و منطبق با آخرین نتیجه وجود ندارد.', 'PERFORMANCE_CORRECTION_CONFLICT', 409);
    }
  } else if (previous) {
    throw resultError('برای جایگزینی نتیجه مصوب باید مسیر اصلاح دلیل‌دار استفاده شود.', 'PERFORMANCE_CORRECTION_REQUIRED', 409);
  }
  const levelPolicy = await loadLevelPolicy(tx, input.keyring);
  const expiry = performanceResultExpiry(evaluation.measurementTo);
  const historicalLevel = classifyExactPerformanceScore(
    { versionId: levelPolicy.id, thresholds: levelPolicy.content.thresholds },
    calculation.exactScore,
  );
  const traceId = randomUUID();
  const traceVersion = (previous?.version ?? 0) + 1;
  const tracePayload = {
    ...calculation.trace,
    acceptedAt: acceptedAt.toISOString(),
    evaluationMeasurementFrom: evaluation.measurementFrom.toISOString(),
    evaluationMeasurementTo: evaluation.measurementTo.toISOString(),
    levelPolicyVersionId: levelPolicy.id,
    levelPolicySnapshot: levelPolicy.content,
    historicalLevelCode: historicalLevel.levelCode,
    expiresAt: expiry.toISOString(),
  };
  const encryptedTrace = await persistPerformancePayload(tx, {
    aggregateType: 'CALCULATION_TRACE', aggregateId: traceId, payloadKind: 'REPRODUCIBLE_TRACE', schemaVersion: 2,
    payload: tracePayload, keyring: input.keyring,
  });
  await tx.performanceCalculationTrace.create({ data: {
    id: traceId,
    evaluationId: evaluation.id,
    traceVersion,
    contentHash: encryptedTrace.contentHash,
    encryptedPayloadId: encryptedTrace.id,
    createdAt: acceptedAt,
  } });
  if (previous) {
    await tx.performanceAcceptedResult.update({
      where: { id: previous.id }, data: { status: PerformanceResultStatus.SUPERSEDED },
    });
    await suspendPerformanceHandoffsForResult(tx, {
      resultId: previous.id, actorUserId: input.acceptedByUserId, reasonCode: 'PERFORMANCE_RESULT_SUPERSEDED', keyring: input.keyring,
    });
  }
  const resultId = randomUUID();
  const resultPayload = {
    schemaVersion: 1,
    exactScore: calculation.exactScore,
    displayScore: calculation.displayScore,
    measurementFrom: evaluation.measurementFrom.toISOString(),
    measurementTo: evaluation.measurementTo.toISOString(),
    acceptedAt: acceptedAt.toISOString(),
    expiresAt: expiry.toISOString(),
    levelCode: historicalLevel.levelCode,
    levelPolicyVersionId: levelPolicy.id,
    levelPolicySnapshot: levelPolicy.content,
    calculationTraceId: traceId,
    calculationTraceHash: encryptedTrace.contentHash,
    templateSnapshotHash: canonicalPerformanceHash(input.calculationInput.template),
  };
  const encryptedResult = await persistPerformancePayload(tx, {
    aggregateType: 'ACCEPTED_RESULT', aggregateId: resultId, payloadKind: 'IMMUTABLE_RESULT', schemaVersion: 1,
    payload: resultPayload, keyring: input.keyring,
  });
  let result = await tx.performanceAcceptedResult.create({ data: {
    id: resultId,
    evaluationId: evaluation.id,
    version: traceVersion,
    calculationTraceId: traceId,
    encryptedPayloadId: encryptedResult.id,
    exactScoreHash: canonicalPerformanceHash(calculation.exactScore),
    levelCode: historicalLevel.levelCode,
    levelPolicyVersionId: levelPolicy.id,
    supersedesResultId: previous?.id,
    acceptedByUserId: input.acceptedByUserId,
    acceptedAt,
    expiresAt: expiry,
  } });
  if (expiry.getTime() <= acceptedAt.getTime()) {
    result = await tx.performanceAcceptedResult.update({
      where: { id: result.id },
      data: { status: PerformanceResultStatus.EXPIRED },
    });
  }
  await tx.performanceEvaluation.update({
    where: { id: evaluation.id },
    data: {
      acceptedResultId: result.id,
      ...(evaluation.status === 'UNDER_REVIEW' ? { status: 'ACCEPTED' } : {}),
      writerVersion: { increment: 1 },
    },
  });
  if (correction) await tx.performanceCorrection.update({
    where: { id: correction.id },
    data: { status: 'ACCEPTED', decidedByUserId: input.acceptedByUserId, decidedAt: acceptedAt },
  });
  await auditResultEvent(tx, {
    resultId: result.id,
    actorUserId: input.acceptedByUserId,
    eventType: previous ? 'CORRECTION_ACCEPTED' : 'RESULT_ACCEPTED',
    reason: correction?.reason ?? 'پذیرش نتیجه محاسبه‌شده ارزیابی عملکرد',
    evidence: { previousResultId: previous?.id ?? null, resultPayloadHash: encryptedResult.contentHash, traceHash: encryptedTrace.contentHash },
    occurredAt: acceptedAt,
    keyring: input.keyring,
  });
  await recomputePerformanceProjectionsInTransaction(tx, {
    now: acceptedAt,
    actorUserId: input.acceptedByUserId,
    reason: previous ? 'پذیرش نتیجه اصلاحی' : 'پذیرش نتیجه ارزیابی عملکرد',
    keyring: input.keyring,
  });
  const response = { result, calculation, historicalLevel, traceContentHash: encryptedTrace.contentHash, idempotent: false };
  const receiptId = randomUUID();
  const encryptedReceipt = await persistPerformancePayload(tx, {
    aggregateType: 'PERFORMANCE_OPERATION_RECEIPT', aggregateId: receiptId, payloadKind: 'ACCEPTED_RESULT', schemaVersion: 1,
    payload: response, keyring: input.keyring,
  });
  await tx.performanceOperationReceipt.create({ data: {
    id: receiptId,
    idempotencyKeyHash,
    operationKind: input.correctionId ? 'ACCEPT_PERFORMANCE_CORRECTION' : 'ACCEPT_PERFORMANCE_RESULT',
    intentHash,
    encryptedPayloadId: encryptedReceipt.id,
    completedAt: acceptedAt,
  } });
  return response;
};

export const suspendAcceptedPerformanceResult = async (client: PrismaClient, input: {
  resultId: string;
  actorUserId: string;
  reason: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  if (input.reason.trim().length < 8) throw resultError('دلیل تعلیق اثر نتیجه الزامی است.', 'PERFORMANCE_SUSPENSION_REASON_REQUIRED', 422);
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const now = input.now ?? new Date();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-result:' + input.resultId}, 0))`;
    const result = await tx.performanceAcceptedResult.findUnique({ where: { id: input.resultId } });
    if (!result) throw resultError('نتیجه مصوب پیدا نشد.', 'PERFORMANCE_RESULT_NOT_FOUND', 404);
    if (result.status === PerformanceResultStatus.SUSPENDED) return { result, idempotent: true };
    if (result.status !== PerformanceResultStatus.EFFECTIVE) throw resultError('فقط اثر نتیجه معتبر جاری قابل تعلیق است.', 'PERFORMANCE_RESULT_NOT_SUSPENDABLE', 409);
    const suspended = await tx.performanceAcceptedResult.update({
      where: { id: result.id }, data: { status: PerformanceResultStatus.SUSPENDED },
    });
    await auditResultEvent(tx, {
      resultId: result.id, actorUserId: input.actorUserId, eventType: 'RESULT_SUSPENDED', reason: input.reason.trim(),
      evidence: { previousStatus: result.status, nextStatus: suspended.status }, occurredAt: now, keyring,
    });
    await suspendPerformanceHandoffsForResult(tx, {
      resultId: result.id, actorUserId: input.actorUserId, reasonCode: 'PERFORMANCE_RESULT_SUSPENDED', keyring,
    });
    const recomputation = await recomputePerformanceProjectionsInTransaction(tx, {
      now, actorUserId: input.actorUserId, reason: 'تعلیق دلیل‌دار اثر نتیجه', keyring,
    });
    return { result: suspended, recomputation, idempotent: false };
  });
};

export const expirePerformanceResults = async (client: PrismaClient, input: {
  actorUserId: string | null;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const now = input.now ?? new Date();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-expiry:' + now.toISOString().slice(0, 10)}, 0))`;
    const due = await tx.performanceAcceptedResult.findMany({
      where: { status: PerformanceResultStatus.EFFECTIVE, expiresAt: { lte: now } }, orderBy: { id: 'asc' },
    });
    for (const result of due) {
      await tx.performanceAcceptedResult.update({ where: { id: result.id }, data: { status: PerformanceResultStatus.EXPIRED } });
      await auditResultEvent(tx, {
        resultId: result.id,
        actorUserId: input.actorUserId,
        eventType: 'RESULT_EXPIRED',
        reason: 'پایان اعتبار ۳۶۵ روزه نتیجه در انتهای روز تهران',
        evidence: { expiresAt: result.expiresAt.toISOString() },
        occurredAt: now,
        keyring,
      });
      await suspendPerformanceHandoffsForResult(tx, {
        resultId: result.id, actorUserId: input.actorUserId, reasonCode: 'PERFORMANCE_RESULT_EXPIRED', keyring,
      });
    }
    const recomputation = due.length > 0 ? await recomputePerformanceProjectionsInTransaction(tx, {
      now, actorUserId: input.actorUserId, reason: 'انقضای روزانه نتیجه‌های عملکرد', keyring,
    }) : { subjectCount: 0, resultHash: canonicalPerformanceHash([]) };
    return { expiredResultIds: due.map(({ id }) => id), recomputation };
  });
};

export const reproduceAcceptedPerformanceResult = async (client: PrismaClient, input: {
  traceId: string;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const trace = await client.performanceCalculationTrace.findUnique({ where: { id: input.traceId } });
  if (!trace) throw resultError('ردپای محاسبه پیدا نشد.', 'PERFORMANCE_TRACE_NOT_FOUND', 404);
  const payload = await readPerformancePayload<PerformanceCalculationTrace & {
    levelPolicyVersionId: string;
    levelPolicySnapshot: LevelPolicyContent;
    historicalLevelCode: string;
  }>(
    client,
    trace.encryptedPayloadId,
    keyring,
  );
  const reproduction = reproducePerformanceCalculation(payload);
  const historicalLevel = reproduction.exactScore === null ? null : classifyExactPerformanceScore(
    { versionId: payload.levelPolicyVersionId, thresholds: payload.levelPolicySnapshot.thresholds },
    reproduction.exactScore,
  );
  const acceptedResult = await client.performanceAcceptedResult.findUnique({ where: { calculationTraceId: trace.id } });
  return {
    traceId: trace.id,
    contentHash: trace.contentHash,
    reproduction,
    historicalLevel: historicalLevel ? {
      ...historicalLevel,
      matchesStoredLevel: historicalLevel.levelCode === payload.historicalLevelCode
        && historicalLevel.levelCode === acceptedResult?.levelCode,
    } : null,
    acceptedResult: acceptedResult ? {
      id: acceptedResult.id,
      version: acceptedResult.version,
      matchesStoredScore: reproduction.exactScore !== null
        && canonicalPerformanceHash(reproduction.exactScore) === acceptedResult.exactScoreHash,
    } : null,
    trace: payload,
  };
};
