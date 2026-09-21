import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceCloseRun,
  buildYearEndTransition,
  classifyEstimateCase,
  classifyPriorPeriodError,
  finalizeCloseRun,
  type CloseCheckInput,
} from '../accountingPeriodClose';

const accepted = (code: CloseCheckInput['code'], hash: string): CloseCheckInput => ({
  code, status: 'ACCEPTED', evidenceHash: hash, checkedAt: new Date('2026-09-21T12:00:00.000Z'),
});

test('close run is resumable, blocks on unresolved duties and invalidates downstream evidence', () => {
  const first = advanceCloseRun({
    runId: 'close-1', previousSteps: [], checks: [
      accepted('DOCUMENTS', 'documents-v1'), accepted('SUBLEDGERS', 'subledgers-v1'),
      accepted('TREASURY', 'treasury-v1'), accepted('INVENTORY', 'inventory-v1'),
      accepted('FIXED_ASSETS', 'assets-v1'),
      { code: 'PAYROLL', status: 'BLOCKED', evidenceHash: 'payroll-v1', checkedAt: new Date(), blocker: 'تسویه حقوق باز است.' },
      accepted('SCHEDULES', 'schedules-v1'), accepted('TAX', 'tax-v1'), accepted('SUSPENSE', 'suspense-v1'),
    ],
  });
  assert.equal(first.status, 'BLOCKED');
  assert.deepEqual(first.blockers, ['تسویه حقوق باز است.']);
  assert.equal(first.steps.find((step) => step.code === 'TRIAL_BALANCE')?.status, 'WAITING');
  assert.equal(first.steps.find((step) => step.code === 'REPORT_SNAPSHOT')?.status, 'WAITING');

  const completed = advanceCloseRun({
    runId: 'close-1', previousSteps: first.steps, checks: [
      accepted('DOCUMENTS', 'documents-v1'), accepted('SUBLEDGERS', 'subledgers-v1'),
      accepted('TREASURY', 'treasury-v1'), accepted('INVENTORY', 'inventory-v1'),
      accepted('FIXED_ASSETS', 'assets-v1'), accepted('PAYROLL', 'payroll-v2'),
      accepted('SCHEDULES', 'schedules-v1'), accepted('TAX', 'tax-v1'), accepted('SUSPENSE', 'suspense-v1'),
      accepted('TRIAL_BALANCE', 'trial-v1'), accepted('REPORT_SNAPSHOT', 'snapshot-v1'),
    ],
  });
  assert.equal(completed.status, 'READY');

  const invalidated = advanceCloseRun({
    runId: 'close-1', previousSteps: completed.steps, checks: [
      accepted('DOCUMENTS', 'documents-v1'), accepted('SUBLEDGERS', 'subledgers-v1'),
      accepted('TREASURY', 'treasury-v1'), accepted('INVENTORY', 'inventory-v2'),
      accepted('FIXED_ASSETS', 'assets-v1'), accepted('PAYROLL', 'payroll-v2'),
      accepted('SCHEDULES', 'schedules-v1'), accepted('TAX', 'tax-v1'), accepted('SUSPENSE', 'suspense-v1'),
      accepted('TRIAL_BALANCE', 'trial-v1'), accepted('REPORT_SNAPSHOT', 'snapshot-v1'),
    ],
  });
  assert.equal(invalidated.status, 'IN_PROGRESS');
  assert.equal(invalidated.steps.find((step) => step.code === 'INVENTORY')?.status, 'ACCEPTED');
  assert.equal(invalidated.steps.find((step) => step.code === 'TRIAL_BALANCE')?.status, 'INVALIDATED');
  assert.equal(invalidated.steps.find((step) => step.code === 'REPORT_SNAPSHOT')?.status, 'INVALIDATED');
});

test('one accounting manager can hard-close with strong confirmation and a reason', () => {
  const ready = advanceCloseRun({
    runId: 'close-2', previousSteps: [], checks: [
      accepted('DOCUMENTS', '1'), accepted('SUBLEDGERS', '2'), accepted('TREASURY', '3'),
      accepted('INVENTORY', '4'), accepted('FIXED_ASSETS', '5'), accepted('PAYROLL', '6'),
      accepted('SCHEDULES', '7'), accepted('TAX', '8'), accepted('SUSPENSE', '9'),
      accepted('TRIAL_BALANCE', '10'), accepted('REPORT_SNAPSHOT', '11'),
    ],
  });
  assert.throws(() => finalizeCloseRun(ready, { actorId: 'accountant', profile: 'ACCOUNTANT', confirmed: true, reason: 'بستن قطعی دوره شهریور' }), /مدیر حسابداری/);
  assert.throws(() => finalizeCloseRun(ready, { actorId: 'manager', profile: 'ACCOUNTING_MANAGER', confirmed: false, reason: 'بستن قطعی دوره شهریور' }), /تأیید صریح/);
  assert.throws(() => finalizeCloseRun(ready, {
    actorId: 'manager', profile: 'ACCOUNTING_MANAGER', confirmed: true, reason: 'بستن قطعی دوره شهریور',
    now: new Date('2026-09-23T12:00:01.000Z'),
  }), /کهنه/);
  const closed = finalizeCloseRun(ready, {
    actorId: 'manager', profile: 'ACCOUNTING_MANAGER', confirmed: true, reason: 'بستن قطعی دوره شهریور',
    now: new Date('2026-09-21T13:00:00.000Z'),
  });
  assert.equal(closed.status, 'HARD_CLOSED');
  assert.match(closed.evidenceHash, /^[a-f0-9]{64}$/);
});

test('year end closes temporary accounts and carries permanent balances plus detailed open items', () => {
  const transition = buildYearEndTransition({
    retainedResultAccountId: 'retained-result',
    balances: [
      { accountId: 'revenue', role: 'TEMPORARY', debitRials: 0n, creditRials: 100_000n },
      { accountId: 'expense', role: 'TEMPORARY', debitRials: 60_000n, creditRials: 0n },
      { accountId: 'cash', role: 'PERMANENT', debitRials: 80_000n, creditRials: 0n },
      { accountId: 'payable', role: 'PERMANENT', debitRials: 0n, creditRials: 40_000n },
    ],
    openItems: [{ identity: 'payable:invoice-1', accountId: 'payable', partyId: 'supplier-1', debitRials: 0n, creditRials: 40_000n }],
  });
  assert.deepEqual(transition.closingLines, [
    { accountId: 'revenue', debitRials: 100_000n, creditRials: 0n, sourceIdentity: 'YEAR_END:revenue' },
    { accountId: 'expense', debitRials: 0n, creditRials: 60_000n, sourceIdentity: 'YEAR_END:expense' },
    { accountId: 'retained-result', debitRials: 0n, creditRials: 40_000n, sourceIdentity: 'YEAR_END:RESULT' },
  ]);
  assert.equal(transition.openingLines.some((line) => line.accountId === 'revenue'), false);
  assert.deepEqual(transition.openingLines.find((line) => line.accountId === 'payable'), {
    accountId: 'payable', debitRials: 0n, creditRials: 40_000n, sourceIdentity: 'OPEN_ITEM:payable:invoice-1',
  });
  assert.deepEqual(transition.openingLines.find((line) => line.accountId === 'cash'), {
    accountId: 'cash', debitRials: 80_000n, creditRials: 0n, sourceIdentity: 'OPENING:cash',
  });
  assert.equal(transition.openingOpenItems[0].identity, 'payable:invoice-1');
  assert.equal(transition.closingDebitRials, transition.closingCreditRials);
});

test('materiality and uncertainty policies distinguish adjustment, restatement, provision and disclosure', () => {
  assert.equal(classifyPriorPeriodError({ amountRials: 90n, quantitativeThresholdRials: 100n, qualitativeMaterial: false }), 'OPEN_PERIOD_ADJUSTMENT');
  assert.equal(classifyPriorPeriodError({ amountRials: 90n, quantitativeThresholdRials: 100n, qualitativeMaterial: true }), 'PRIOR_PERIOD_RESTATEMENT');
  assert.equal(classifyEstimateCase({ probability: 'PROBABLE', reliablyMeasurable: true }), 'RECOGNIZED_PROVISION');
  assert.equal(classifyEstimateCase({ probability: 'POSSIBLE', reliablyMeasurable: false }), 'DISCLOSURE_ONLY');
  assert.equal(classifyEstimateCase({ probability: 'REMOTE', reliablyMeasurable: true }), 'REMOTE_ITEM');
});
