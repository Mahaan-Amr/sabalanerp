import { createHash } from 'node:crypto';

export type CloseStepCode =
  | 'DOCUMENTS'
  | 'SUBLEDGERS'
  | 'TREASURY'
  | 'INVENTORY'
  | 'FIXED_ASSETS'
  | 'PAYROLL'
  | 'SCHEDULES'
  | 'TAX'
  | 'SUSPENSE'
  | 'TRIAL_BALANCE'
  | 'REPORT_SNAPSHOT';

export type CloseCheckInput = {
  code: CloseStepCode;
  status: 'ACCEPTED' | 'BLOCKED';
  evidenceHash: string;
  checkedAt: Date;
  blocker?: string;
};

export type CloseStep = Omit<CloseCheckInput, 'status'> & {
  status: 'WAITING' | 'ACCEPTED' | 'BLOCKED' | 'INVALIDATED';
  invalidatedBy?: CloseStepCode[];
};

export type CloseRun = {
  runId: string;
  status: 'IN_PROGRESS' | 'BLOCKED' | 'READY';
  steps: CloseStep[];
  blockers: string[];
};

const closeOrder: CloseStepCode[] = [
  'DOCUMENTS', 'SUBLEDGERS', 'TREASURY', 'INVENTORY', 'FIXED_ASSETS', 'PAYROLL',
  'SCHEDULES', 'TAX', 'SUSPENSE', 'TRIAL_BALANCE', 'REPORT_SNAPSHOT',
];

const dependencies: Record<CloseStepCode, CloseStepCode[]> = {
  DOCUMENTS: [],
  SUBLEDGERS: ['DOCUMENTS'],
  TREASURY: ['DOCUMENTS'],
  INVENTORY: ['DOCUMENTS'],
  FIXED_ASSETS: ['DOCUMENTS'],
  PAYROLL: ['DOCUMENTS'],
  SCHEDULES: ['DOCUMENTS'],
  TAX: ['DOCUMENTS'],
  SUSPENSE: ['SUBLEDGERS', 'TREASURY', 'INVENTORY', 'FIXED_ASSETS', 'PAYROLL', 'SCHEDULES', 'TAX'],
  TRIAL_BALANCE: ['SUSPENSE'],
  REPORT_SNAPSHOT: ['TRIAL_BALANCE'],
};

const dependsOn = (candidate: CloseStepCode, upstream: CloseStepCode): boolean => (
  dependencies[candidate].includes(upstream)
  || dependencies[candidate].some((parent) => dependsOn(parent, upstream))
);

export const advanceCloseRun = (input: {
  runId: string;
  previousSteps: CloseStep[];
  checks: CloseCheckInput[];
}): CloseRun => {
  const previous = new Map(input.previousSteps.map((step) => [step.code, step]));
  const incoming = new Map(input.checks.map((check) => [check.code, check]));
  const changed = closeOrder.filter((code) => {
    const before = previous.get(code);
    const after = incoming.get(code);
    return before?.status === 'ACCEPTED' && after != null && before.evidenceHash !== after.evidenceHash;
  });
  const next = new Map<CloseStepCode, CloseStep>();
  for (const code of closeOrder) {
    const check = incoming.get(code);
    const earlier = previous.get(code);
    const invalidatedBy = changed.filter((upstream) => upstream !== code && dependsOn(code, upstream));
    if (invalidatedBy.length > 0) {
      next.set(code, {
        code,
        status: 'INVALIDATED',
        evidenceHash: check?.evidenceHash ?? earlier?.evidenceHash ?? '',
        checkedAt: check?.checkedAt ?? earlier?.checkedAt ?? new Date(0),
        invalidatedBy,
      });
      continue;
    }
    const prerequisitesAccepted = dependencies[code].every((dependency) => next.get(dependency)?.status === 'ACCEPTED');
    if (!check || !prerequisitesAccepted) {
      next.set(code, {
        code,
        status: 'WAITING',
        evidenceHash: check?.evidenceHash ?? earlier?.evidenceHash ?? '',
        checkedAt: check?.checkedAt ?? earlier?.checkedAt ?? new Date(0),
      });
      continue;
    }
    next.set(code, { ...check });
  }
  const steps = closeOrder.map((code) => next.get(code)!);
  const blockers = steps.filter((step) => step.status === 'BLOCKED').map((step) => step.blocker || 'یک کنترل بستن دوره حل‌نشده است.');
  return {
    runId: input.runId,
    status: blockers.length > 0 ? 'BLOCKED' : steps.every((step) => step.status === 'ACCEPTED') ? 'READY' : 'IN_PROGRESS',
    steps,
    blockers,
  };
};

export const finalizeCloseRun = (run: CloseRun, command: {
  actorId: string;
  profile: 'VIEWER' | 'ACCOUNTANT' | 'ACCOUNTING_MANAGER';
  confirmed: boolean;
  reason: string;
  now?: Date;
}) => {
  if (run.status !== 'READY') throw new Error('کنترل‌های بستن دوره هنوز کامل نشده‌اند.');
  if (command.profile !== 'ACCOUNTING_MANAGER') throw new Error('فقط مدیر حسابداری مجاز به بستن قطعی دوره است.');
  if (!command.confirmed) throw new Error('تأیید صریح برای بستن قطعی دوره الزامی است.');
  if (command.reason.trim().length < 8) throw new Error('دلیل بستن قطعی دوره باید ثبت شود.');
  const now = command.now ?? new Date();
  const staleBefore = now.getTime() - 24 * 60 * 60 * 1000;
  if (run.steps.some((step) => !step.evidenceHash.trim() || step.checkedAt.getTime() < staleBefore || step.checkedAt > now)) {
    throw new Error('حداقل یکی از کنترل‌های بستن دوره کهنه یا فاقد شاهد معتبر است و باید دوباره اجرا شود.');
  }
  const evidenceHash = createHash('sha256').update(JSON.stringify({
    runId: run.runId,
    actorId: command.actorId,
    reason: command.reason.trim(),
    steps: run.steps.map((step) => ({ code: step.code, evidenceHash: step.evidenceHash })),
  })).digest('hex');
  return { ...run, status: 'HARD_CLOSED' as const, actorId: command.actorId, reason: command.reason.trim(), evidenceHash };
};

type BalanceInput = {
  accountId: string;
  role: 'TEMPORARY' | 'PERMANENT';
  debitRials: bigint;
  creditRials: bigint;
};

type TransitionLine = {
  accountId: string;
  debitRials: bigint;
  creditRials: bigint;
  sourceIdentity: string;
};

const totals = (lines: TransitionLine[]) => ({
  debit: lines.reduce((total, line) => total + line.debitRials, 0n),
  credit: lines.reduce((total, line) => total + line.creditRials, 0n),
});

export const buildYearEndTransition = (input: {
  retainedResultAccountId: string;
  balances: BalanceInput[];
  openItems: Array<{
    identity: string;
    accountId: string;
    partyId?: string;
    debitRials: bigint;
    creditRials: bigint;
  }>;
}) => {
  const closingLines: TransitionLine[] = input.balances.filter((balance) => balance.role === 'TEMPORARY').map((balance) => ({
    accountId: balance.accountId,
    debitRials: balance.creditRials,
    creditRials: balance.debitRials,
    sourceIdentity: `YEAR_END:${balance.accountId}`,
  }));
  const closingBeforeResult = totals(closingLines);
  const resultDifference = closingBeforeResult.debit - closingBeforeResult.credit;
  closingLines.push({
    accountId: input.retainedResultAccountId,
    debitRials: resultDifference < 0n ? -resultDifference : 0n,
    creditRials: resultDifference > 0n ? resultDifference : 0n,
    sourceIdentity: 'YEAR_END:RESULT',
  });
  const openingLines: TransitionLine[] = input.balances.filter((balance) => balance.role === 'PERMANENT').map((balance) => ({
    accountId: balance.accountId,
    debitRials: balance.debitRials,
    creditRials: balance.creditRials,
    sourceIdentity: `OPENING:${balance.accountId}`,
  }));
  if (resultDifference !== 0n) openingLines.push({
    accountId: input.retainedResultAccountId,
    debitRials: resultDifference < 0n ? -resultDifference : 0n,
    creditRials: resultDifference > 0n ? resultDifference : 0n,
    sourceIdentity: 'OPENING:RETAINED_RESULT',
  });
  const closingTotals = totals(closingLines);
  return {
    closingLines,
    openingLines,
    openingOpenItems: input.openItems.map((item) => ({ ...item })),
    closingDebitRials: closingTotals.debit,
    closingCreditRials: closingTotals.credit,
  };
};

export const classifyPriorPeriodError = (input: {
  amountRials: bigint;
  quantitativeThresholdRials: bigint;
  qualitativeMaterial: boolean;
}) => (
  input.qualitativeMaterial || (input.amountRials < 0n ? -input.amountRials : input.amountRials) >= input.quantitativeThresholdRials
    ? 'PRIOR_PERIOD_RESTATEMENT' as const
    : 'OPEN_PERIOD_ADJUSTMENT' as const
);

export const classifyEstimateCase = (input: {
  probability: 'PROBABLE' | 'POSSIBLE' | 'REMOTE';
  reliablyMeasurable: boolean;
}) => {
  if (input.probability === 'PROBABLE' && input.reliablyMeasurable) return 'RECOGNIZED_PROVISION' as const;
  if (input.probability === 'REMOTE') return 'REMOTE_ITEM' as const;
  return 'DISCLOSURE_ONLY' as const;
};
