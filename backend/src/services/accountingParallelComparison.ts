import { AccountingReplacementError, hashAccountingReplacementEvidence } from './accountingReplacement';

export type ParallelEventLine = {
  accountId: string | null; partyId: string | null; financialAccountId: string | null;
  debit: string; credit: string;
  dimensions?: string[];
};
export type ParallelEventPair = { sourceKey: string; targetId: string; reason: string; actorId: string };
export type ParallelComparisonInput = {
  bookId: string; periodId: string; snapshotId: string; sourcePackageHash: string;
  sources: Array<{ key: string; hash: string; day: string; lines: ParallelEventLine[] }>;
  targets: Array<{ id: string; hash: string; day: string; status: string; sourceType: string; lines: ParallelEventLine[] }>;
  pairs: ParallelEventPair[];
};
const rials = (text: string) => {
  if (!/^\d+(?:\.0+)?$/.test(text)) throw new AccountingReplacementError('PARALLEL_AMOUNT_INVALID', 'مبلغ رویداد موازی باید ریال صحیح نامنفی باشد.', 409);
  return BigInt(text.split('.')[0]);
};
const lineKey = (line: ParallelEventLine) => JSON.stringify([
  line.accountId, line.partyId, line.financialAccountId, rials(line.debit).toString(), rials(line.credit).toString(), [...(line.dimensions ?? [])].sort(),
]);
const totals = (lines: ParallelEventLine[]) => lines.reduce((sum, line) => ({
  debit: sum.debit + rials(line.debit), credit: sum.credit + rials(line.credit),
}), { debit: 0n, credit: 0n });

/** Comparison evidence only: it never certifies a complete month, close or accountant acceptance. */
export const compareAccountingParallelEvents = (input: ParallelComparisonInput) => {
  const sourceKeys = new Set(input.sources.map((source) => source.key));
  const targetIds = new Set(input.targets.map((target) => target.id));
  const pairedSources = new Set<string>(); const pairedTargets = new Set<string>();
  if (sourceKeys.size !== input.sources.length || targetIds.size !== input.targets.length) {
    throw new AccountingReplacementError('PARALLEL_IDENTITY_DUPLICATE', 'هویت رویدادهای موازی باید یکتا باشد.', 409);
  }
  for (const pair of input.pairs) {
    if (pairedSources.has(pair.sourceKey) || pairedTargets.has(pair.targetId)) throw new AccountingReplacementError('PARALLEL_PAIR_DUPLICATE', 'پیوند رویداد موازی باید یکتا باشد.', 409);
    if (!sourceKeys.has(pair.sourceKey) || !targetIds.has(pair.targetId) || !pair.reason.trim() || !pair.actorId.trim()) {
      throw new AccountingReplacementError('PARALLEL_PAIR_INVALID', 'هر پیوند به دو رویداد همین دوره، مسئول و دلیل بررسی نیاز دارد.', 409);
    }
    pairedSources.add(pair.sourceKey); pairedTargets.add(pair.targetId);
  }
  const differences: Array<{ code: string; sourceKey: string | null; targetId: string | null; message: string }> = [];
  const difference = (code: string, sourceKey: string | null, targetId: string | null, message: string) => differences.push({ code, sourceKey, targetId, message });
  for (const source of input.sources) {
    const pair = input.pairs.find((item) => item.sourceKey === source.key);
    if (!pair) difference('SOURCE_UNMATCHED', source.key, null, 'رویداد سپیدار هنوز به سند مستقل سبلان پیوند ندارد.');
    if (source.lines.some((line) => !line.accountId)) difference('SOURCE_MAPPING_MISSING', source.key, pair?.targetId ?? null, 'نگاشت تأییدشدهٔ حساب منبع موجود نیست.');
    const sum = totals(source.lines);
    if (source.lines.length < 2 || sum.debit !== sum.credit || sum.debit === 0n || source.lines.some((line) => (rials(line.debit) > 0n) === (rials(line.credit) > 0n))) difference('SOURCE_UNBALANCED', source.key, pair?.targetId ?? null, 'خطوط منبع کامل و متوازن نیستند.');
  }
  for (const target of input.targets) {
    const pair = input.pairs.find((item) => item.targetId === target.id);
    if (!pair) difference('TARGET_UNMATCHED', null, target.id, 'سند سبلان هنوز به رویداد سپیدار پیوند ندارد.');
    if (target.status !== 'POSTED' || !target.sourceType || /SEPIDAR|MIGRATION|OPENING/i.test(target.sourceType)) difference('TARGET_NOT_INDEPENDENT', pair?.sourceKey ?? null, target.id, 'شاهد اجرای موازی باید سند قطعی عملیاتی مستقل باشد؛ کپی تاریخچه یا افتتاحیه پذیرفته نیست.');
    const sum = totals(target.lines);
    if (target.lines.length < 2 || sum.debit !== sum.credit || sum.debit === 0n || target.lines.some((line) => (rials(line.debit) > 0n) === (rials(line.credit) > 0n))) difference('TARGET_UNBALANCED', pair?.sourceKey ?? null, target.id, 'خطوط سند مقصد کامل و متوازن نیستند.');
    if (pair) {
      const source = input.sources.find((item) => item.key === pair.sourceKey)!;
      if (source.day !== target.day) difference('DATES_DIFFER', source.key, target.id, 'روز ثبت رویداد در دو سامانه متفاوت است.');
      const sourceLines = source.lines.map(lineKey).sort(); const targetLines = target.lines.map(lineKey).sort();
      if (JSON.stringify(sourceLines) !== JSON.stringify(targetLines)) difference('LINES_DIFFER', source.key, target.id, 'حساب، طرف حساب، حساب مالی یا مبلغ خطوط دو سامانه متفاوت است.');
    }
  }
  if (!input.sources.length || !input.targets.length) difference('EVENTS_MISSING', null, null, 'رویداد واقعی در هر دو سامانه برای مقایسه موجود نیست.');
  const sourceTotals = totals(input.sources.flatMap((source) => source.lines));
  const targetTotals = totals(input.targets.flatMap((target) => target.lines));
  differences.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const observedDifferences = differences.map((item) => {
    const source = input.sources.find((row) => row.key === item.sourceKey);
    const target = input.targets.find((row) => row.id === item.targetId);
    const sourceDebit = source ? totals(source.lines).debit : 0n;
    const targetDebit = target ? totals(target.lines).debit : 0n;
    return { ...item, identity: hashAccountingReplacementEvidence({ code: item.code, sourceKey: item.sourceKey, targetId: item.targetId }),
      sourceDebitRials: source ? sourceDebit.toString() : null, targetDebitRials: target ? targetDebit.toString() : null,
      amountRials: item.code === 'EVENTS_MISSING' ? null : (sourceDebit - targetDebit).toString(),
      itemCount: (source?.lines.length ?? 0) + (target?.lines.length ?? 0) };
  });
  const evidence = {
    format: 'accounting-parallel-events-v2', bookId: input.bookId, periodId: input.periodId, snapshotId: input.snapshotId,
    sourcePackageHash: input.sourcePackageHash, acceptedPeriod: false as const,
    exact: differences.length === 0, sourceCount: input.sources.length, targetCount: input.targets.length,
    sourceDebitRials: sourceTotals.debit.toString(), sourceCreditRials: sourceTotals.credit.toString(),
    targetDebitRials: targetTotals.debit.toString(), targetCreditRials: targetTotals.credit.toString(), differences: observedDifferences,
    pairs: [...input.pairs].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
    sourceEvidence: input.sources.map((item) => ({ key: item.key, hash: item.hash, observedHash: hashAccountingReplacementEvidence({ ...item, lines: item.lines.map(lineKey).sort() }) })).sort((a, b) => a.key.localeCompare(b.key)),
    targetEvidence: input.targets.map((item) => ({ id: item.id, hash: item.hash, observedHash: hashAccountingReplacementEvidence({ ...item, lines: item.lines.map(lineKey).sort() }) })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return { ...evidence, outputHash: hashAccountingReplacementEvidence(evidence) };
};
