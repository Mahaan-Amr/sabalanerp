import { Prisma } from '@prisma/client';
import { AccountingReplacementError, hashAccountingReplacementEvidence } from './accountingReplacement';
import { createAccountingReplacementPrismaRepository } from './accountingReplacementPrismaRepository';
import { recordAccountingParallelComparison } from './accountingParallelComparisonPrisma';
import { compareAccountingParallelEvents } from './accountingParallelComparison';

type Report = ReturnType<typeof compareAccountingParallelEvents>;
const sourceType = 'ACCOUNTING_PARALLEL_DIFFERENCE';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const fail = (code: string, message: string) => { throw new AccountingReplacementError(code, message, 409); };
const payload = (value: unknown): Report => {
  const report = value as Report;
  const { outputHash, predecessorComparisonId: _predecessor, ...evidence } = report as Report & { predecessorComparisonId?: string };
  if (report.format !== 'accounting-parallel-events-v2' || hashAccountingReplacementEvidence(evidence) !== outputHash) {
    return fail('PARALLEL_REPORT_INVALID', 'گزارش مقایسه معتبر نیست؛ مقایسه را دوباره اجرا کنید.');
  }
  return report;
};

/** A human explanation cannot erase a difference; current observed events must prove the correction. */
export const assertParallelDifferenceCorrection = (origin: Report, differenceIdentity: string, current: Report) => {
  const item = origin.differences.find((row) => row.identity === differenceIdentity);
  if (!item || origin.bookId !== current.bookId || origin.periodId !== current.periodId || origin.snapshotId !== current.snapshotId
    || origin.sourcePackageHash !== current.sourcePackageHash) return fail('PARALLEL_RESOLUTION_SCOPE_INVALID', 'شاهد اصلاح باید متعلق به همان اختلاف، دوره و نسخهٔ سپیدار باشد.');
  const persists = current.differences.some((row) => row.code === item.code && (
    item.code.startsWith('SOURCE_') ? row.sourceKey === item.sourceKey
      : item.code.startsWith('TARGET_') ? row.targetId === item.targetId
        : row.sourceKey === item.sourceKey && row.targetId === item.targetId));
  if (persists
    || (item.sourceKey && !current.sourceEvidence.some((row) => row.key === item.sourceKey))
    || (item.targetId && !current.targetEvidence.some((row) => row.id === item.targetId))
    || (!item.sourceKey && !item.targetId && !current.exact)
    || (item.sourceKey && item.targetId && !current.pairs.some((row) => row.sourceKey === item.sourceKey && row.targetId === item.targetId))) {
    return fail('PARALLEL_DIFFERENCE_STILL_PRESENT', 'اختلاف هنوز از روی شواهد واقعی رفع نشده است؛ توضیح به‌تنهایی مجوز رفع نیست.');
  }
};

export const manageAccountingParallelDifference = async (tx: Prisma.TransactionClient, command: {
  bookId: string; comparisonId: string; differenceIdentity: string; actorId: string;
  action: 'OPEN' | 'NOTE' | 'RESOLVE'; cause?: string; resolution?: string;
}) => {
  const originRow = await tx.accountingOperationalReconciliation.findUnique({ where: { id: command.comparisonId } });
  if (!originRow || originRow.bookId !== command.bookId || originRow.reconciliationCode !== 'PARALLEL_EVENTS') return fail('PARALLEL_REPORT_NOT_FOUND', 'گزارش مقایسه در این دفتر پیدا نشد.');
  const origin = payload(originRow.controlPayload);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`accounting-parallel:${command.bookId}:${origin.periodId}:${origin.snapshotId}`}))`;
  const difference = origin.differences.find((item) => item.identity === command.differenceIdentity);
  if (!difference || !command.actorId.trim()) return fail('PARALLEL_DIFFERENCE_NOT_FOUND', 'اختلاف و مسئول معتبر باید مشخص شوند.');
  const sourceId = `${originRow.id}:${difference.identity}`;
  const existing = await tx.accountingExceptionCase.findUnique({ where: { sourceType_sourceId_sourceVersion_code: {
    sourceType, sourceId, sourceVersion: 1, code: difference.code,
  } } });
  if (command.action === 'OPEN') {
    if (existing) return existing;
    const latest = await tx.accountingOperationalReconciliation.findFirst({ where: { bookId: command.bookId, periodId: origin.periodId,
      reconciliationCode: 'PARALLEL_EVENTS', sourceSystem: origin.snapshotId }, orderBy: [{ reconciledAt: 'desc' }, { id: 'desc' }] });
    if (latest?.id !== originRow.id) return fail('PARALLEL_REPORT_STALE', 'گزارش جدیدتری وجود دارد؛ اختلاف‌های مقایسهٔ فعلی را باز کنید.');
    const saved = await tx.accountingExceptionCase.create({ data: { sourceType, sourceId, sourceVersion: 1, code: difference.code,
      messagePersian: difference.message, assignedProfile: 'ACCOUNTING_MANAGER', assignedUserId: command.actorId,
      evidenceHash: origin.outputHash, resolutionEvidence: json({ bookId: command.bookId, periodId: origin.periodId, snapshotId: origin.snapshotId, comparisonId: originRow.id,
        difference, cause: null, resolution: null, history: [{ action: 'OPEN', actorId: command.actorId, at: new Date().toISOString() }] }) } });
    await createAccountingReplacementPrismaRepository(tx).appendAudit('PARALLEL_DIFFERENCE_OPENED', { actorId: command.actorId, caseId: saved.id,
      comparisonId: originRow.id, differenceIdentity: difference.identity, outputHash: origin.outputHash });
    return saved;
  }
  if (!existing) return fail('PARALLEL_DIFFERENCE_CASE_REQUIRED', 'ابتدا اختلاف را برای رسیدگی به عهده بگیرید.');
  const cause = command.cause?.trim(); const resolution = command.resolution?.trim();
  if (!cause || !resolution || cause.length > 2000 || resolution.length > 2000) return fail('PARALLEL_RESOLUTION_REQUIRED', 'علت و اقدام مستند برای رسیدگی الزامی‌اند و هر کدام حداکثر ۲۰۰۰ نویسه دارند.');
  const prior = existing.resolutionEvidence as { cause?: string; resolution?: string; history: unknown[] };
  if (existing.status === 'RESOLVED') {
    if (command.action === 'RESOLVE' && prior.cause === cause && prior.resolution === resolution) return existing;
    return fail('PARALLEL_RESOLUTION_IMMUTABLE', 'پروندهٔ رفع‌شده تغییرپذیر نیست؛ اختلاف جدید پروندهٔ مستقل دارد.');
  }
  const lastAction = prior.history.at(-1) as { action?: string; actorId?: string } | undefined;
  if (command.action === 'NOTE' && lastAction?.action === 'NOTE' && lastAction.actorId === command.actorId && prior.cause === cause && prior.resolution === resolution) return existing;
  let correction: { id: string; outputHash: string } | null = null;
  if (command.action === 'RESOLVE') {
    const observed = await recordAccountingParallelComparison(tx, { bookId: command.bookId, periodId: origin.periodId, snapshotId: origin.snapshotId, actorId: command.actorId });
    assertParallelDifferenceCorrection(origin, difference.identity, observed);
    correction = { id: observed.id, outputHash: observed.outputHash };
  }
  const saved = await tx.accountingExceptionCase.update({ where: { id: existing.id }, data: {
    status: command.action === 'RESOLVE' ? 'RESOLVED' : 'IN_PROGRESS',
    resolvedAt: command.action === 'RESOLVE' ? new Date() : null,
    resolutionEvidence: json({ ...prior, cause, resolution, correction,
      history: [...prior.history, { action: command.action, actorId: command.actorId, cause, resolution, correction, at: new Date().toISOString() }] }),
  } });
  await createAccountingReplacementPrismaRepository(tx).appendAudit(`PARALLEL_DIFFERENCE_${command.action}`, {
    actorId: command.actorId, caseId: saved.id, comparisonId: originRow.id, differenceIdentity: difference.identity,
    evidenceHash: hashAccountingReplacementEvidence(saved.resolutionEvidence), correction,
  });
  return saved;
};
