import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';
import { accountingReadTiming, type AccountingReadTimings } from '../accountingReadTiming';
import type { AuthorizationDecisionAudit } from '../effectiveAuthorization/audit';
import { listSabalanPlanCandidates } from '../partnerSales/accounting/sabalanPlan';
import { historicalAccountingFixture } from './partnerAccountingHistoricalReadFixture';

const beforeExpiry = new Date('2026-10-12T08:00:00Z');
const afterExpiry = new Date('2026-10-12T08:02:00Z');

async function candidatePersistence(options: {
  scopedAccountant?: boolean;
  abort?: { controller: AbortController; after: 'case-lock' | 'clock' | 'hydration' | 'contention' | 'transaction-queue' };
  fenceContention?: boolean;
  expiringPaymentGrant?: boolean;
} = {}) {
  const fixture = await historicalAccountingFixture();
  const view = fixture.revision.internalProjection.accounting!;
  const eligible = { ...fixture.row, events: [{ id: 'commitment', caseRevision: 1,
    integrityHash: view.owner.integrityHash, evidence: { publicEvent: {
      schemaVersion: 1, type: 'CASE_COMMITTED', eventId: 'commitment', commandId: 'finalization',
      correlationId: 'finalization', actorId: 'historical-partner', recordedAt: beforeExpiry.toISOString(),
      effectiveDate: '2026-10-12', owner: view.owner, internalRecordId: view.recordId,
      trigger: 'FINALIZED', salesCreditOwnerId: 'historical-partner',
      sabalanNetAmount: { amount: view.totals.payable, currency: view.totals.currency },
    } } }] };
  const invalidCommitment = { ...eligible, id: 'invalid-commitment' };
  const deletedContract = { ...eligible, id: 'removed-contract-case', customerContractId: 'removed-contract' };
  const invalidProjection = { ...eligible, id: 'corrupt-projection', head: { ...eligible.head, graphHash: 'changed' } };
  const unlinked = { ...eligible, id: 'unlinked-case', customerContractId: null };
  const memberCases = [eligible, invalidCommitment, deletedContract, invalidProjection, unlinked];
  const existingPlan = { ...eligible, id: 'already-planned' };
  const existingDraft = { ...eligible, id: 'uncommitted', state: 'DRAFT' };
  const rows = [...memberCases, existingPlan, existingDraft];
  const audits: AuthorizationDecisionAudit[] = [];
  const transactions: Array<Prisma.TransactionIsolationLevel | undefined> = [];
  let queryCount = 0;
  let decisionClockReads = 0;
  let paymentClockReads = 0;
  let auditAppends = 0;
  let fenceReads = 0;
  let profileReads = 0;
  let rolloutReads = 0;
  let unscoped = 0;
  let paymentsDisabled = false;
  let pendingAudits: AuthorizationDecisionAudit[] = [];
  const disabledPayments = { permissionLevel: 'none', isActive: true, expiresAt: null, feature: 'accounting_payments_manage' };
  const paymentGrant = { ...disabledPayments, permissionLevel: 'edit', expiresAt: afterExpiry };
  const accountant = { id: 'historical-admin', role: 'USER', isActive: true, partnerProfile: null };
  const scopedGrant = { id: 'scoped-write', domain: 'PARTNER', principalKind: 'USER', principalId: accountant.id,
    action: 'ACCOUNTING_WRITE', rootKind: 'CASE', purpose: 'ACCOUNTING', effect: 'ALLOW', scope: 'COMPANY',
    boundRootId: null, effectiveFrom: beforeExpiry, expiresAt: afterExpiry };
  const workspace = { workspace: 'accounting', permissionLevel: options.expiringPaymentGrant ? 'edit' : 'admin',
    isActive: true, expiresAt: null, id: 'accounting-workspace' };
  const queryRaw = async (sql: TemplateStringsArray) => {
    const query = sql.join('?');
    if (query.includes('FROM partner_operations_controls')) rolloutReads += 1;
    if (query.includes('FOR SHARE OF c') && options.abort?.after === 'case-lock') options.abort.controller.abort();
    if (query.includes('FOR SHARE OF p')) profileReads += 1;
    if (query.includes('FROM effective_authorization_state') && query.includes('FOR SHARE')) {
      fenceReads += 1;
      if (options.fenceContention && fenceReads === 1) {
        paymentsDisabled = true;
        if (options.abort?.after === 'contention') options.abort.controller.abort();
        throw Object.assign(new Error('Authority revision changed during snapshot'), { code: 'P2034' });
      }
      return [{ revision: 7 }];
    }
    if (query.includes('clock_timestamp() AS now')) {
      decisionClockReads += 1;
      if (options.abort?.after === 'clock') options.abort.controller.abort();
      return [{ now: options.scopedAccountant && decisionClockReads > 1 ? afterExpiry : beforeExpiry }];
    }
    if (query.includes('clock_timestamp() AS "paymentNow"')) {
      paymentClockReads += 1;
      return [{ paymentNow: options.expiringPaymentGrant && paymentClockReads > 1 ? afterExpiry : beforeExpiry }];
    }
    if (options.scopedAccountant && query.includes('FROM effective_action_grants')) {
      // The expired scoped action is then replaced by an explicit denial,
      // which still blocks the workspace write fallback.
      return options.expiringPaymentGrant ? [{ ...scopedGrant, expiresAt: null }] :
        [scopedGrant, { ...scopedGrant, id: 'scoped-deny', effect: 'DENY', effectiveFrom: afterExpiry, expiresAt: null }];
    }
    return fixture.tx.$queryRaw(sql);
  };
  const findCases = async (args: { where?: Prisma.PartnerSaleCaseWhereInput; select?: Prisma.PartnerSaleCaseSelect }) => {
    const where = args.where;
    if (where?.state === 'COMMITTED' && where.paymentPlans) {
      assert.deepEqual(where.paymentPlans, { none: { purpose: 'SABALAN', installments: { some: {} } } });
      return memberCases;
    }
    const ids = typeof where?.id === 'object' ? where.id.in : undefined;
    assert(Array.isArray(ids));
    const loaded = rows.filter(row => ids.includes(row.id)).map(row => ({
      ...row, head: { ...row.head, predecessor: null },
    }));
    if (typeof args.select?.head === 'object' && args.select.head.select?.predecessor && options.abort?.after === 'hydration') {
      const head = loaded.at(-1)?.head;
      if (head) {
        const graphHash = head.graphHash;
        const controller = options.abort.controller;
        Object.defineProperty(head, 'graphHash', { get() { controller.abort(); return graphHash; } });
      }
    }
    return loaded;
  };
  // The generated Case fixture supplies the real validated document. Replace
  // persistence reads only, and count calls through the transaction boundary.
  const persistence = {
    partnerSaleCase: { findMany: findCases, findUnique: async (args: { where: { id: string } }) =>
      rows.find(row => row.id === args.where.id) },
    ...(options.scopedAccountant ? {
      user: { findMany: async () => (await fixture.tx.user.findMany()).map(user =>
        user.id === accountant.id ? accountant : user), findUnique: async () => accountant },
      workspacePermission: { findMany: async () => [workspace], findUnique: async () => workspace },
    } : {}),
    contractLifecycleRequest: { findMany: async () => [{ contractId: 'removed-contract' }],
      findFirst: async (args: { where: { contractId: string } }) =>
        args.where.contractId === 'removed-contract' ? { contractId: 'removed-contract' } : null },
    featurePermission: {
      findMany: async () => paymentsDisabled ? [disabledPayments] : options.expiringPaymentGrant ? [paymentGrant] : [],
      findUnique: async (args: { where: { userId_workspace_feature: { feature: string } } }) =>
        args.where.userId_workspace_feature.feature === disabledPayments.feature
          ? paymentsDisabled ? disabledPayments : options.expiringPaymentGrant ? paymentGrant : null : null,
    },
    effectiveAuthorizationAudit: { createMany: async (args: { data: AuthorizationDecisionAudit[] }) => {
      auditAppends += 1;
      pendingAudits.push(...args.data);
      return { count: args.data.length };
    } },
    $queryRaw: queryRaw,
  };
  const tx = new Proxy(fixture.tx, { get(target, key: keyof typeof persistence) {
    const value = persistence[key] ?? Reflect.get(target, key);
    if (typeof value === 'function') return (...args: unknown[]) => {
      queryCount += 1;
      return Reflect.apply(value, target, args);
    };
    return new Proxy(value, { get(delegate, method) {
      return (...args: unknown[]) => {
        queryCount += 1;
        return Reflect.apply(Reflect.get(delegate, method), delegate, args);
      };
    } });
  } });
  const abortOnTransactionEntry = options.abort?.after === 'transaction-queue' ? options.abort.controller : undefined;
  const database = {
    $transaction: async <T>(read: (value: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => {
      transactions.push(options?.isolationLevel);
      pendingAudits = [];
      abortOnTransactionEntry?.abort();
      const result = await read(tx);
      audits.push(...pendingAudits);
      return result;
    },
    partnerSaleCase: { findMany: async (args: Parameters<typeof findCases>[0]) => {
      unscoped += 1;
      return findCases(args);
    } },
  } as unknown as PrismaClient;
  return { database, view, memberCases, audits, transactions,
    stats: () => ({ queryCount, unscoped, decisionClockReads, paymentClockReads, auditAppends, fenceReads, profileReads, rolloutReads }),
    revokePayments: () => { paymentsDisabled = true; },
  };
}

test('plan candidates use one authorized snapshot and preserve exact membership and per-Case audit', async () => {
  const fixture = await candidatePersistence();
  const timings: AccountingReadTimings = {};
  const result = await accountingReadTiming.run(timings,
    () => listSabalanPlanCandidates(fixture.database, 'historical-admin', 'plan-list'));
  assert.deepEqual(result, { ok: true, value: [{
    expected: fixture.view.owner, caseNumber: 'historical-case-number',
    internalRecordNumber: 'historical-internal-number', partnerDisplayName: fixture.view.debtor.displayName,
    payable: { amount: fixture.view.totals.payable, currency: fixture.view.totals.currency },
  }] });
  assert.deepEqual(fixture.transactions, ['RepeatableRead']);
  assert.deepEqual(Object.keys(timings).sort(), ['authorization', 'authorizationAudit', 'lockWait', 'partnerEvidence', 'population']);
  assert.equal(fixture.stats().unscoped, 0);
  assert.deepEqual(fixture.audits.map(({ rootId, action, channel, allowed, correlationId }) =>
    ({ rootId, action, channel, allowed, correlationId })), fixture.memberCases.map(row => ({
      rootId: row.id, action: 'ACCOUNTING_WRITE', channel: 'API', allowed: row.customerContractId !== 'removed-contract', correlationId: 'plan-list',
    })));

  const single = await candidatePersistence();
  single.memberCases.splice(1);
  await listSabalanPlanCandidates(single.database, 'historical-admin', 'single-plan-list');
  assert.equal(fixture.stats().queryCount - single.stats().queryCount,
    fixture.stats().decisionClockReads - single.stats().decisionClockReads +
    fixture.stats().paymentClockReads - single.stats().paymentClockReads,
    'only the decision clocks grow with the Case count');
});

test('scoped writes respect a grant expiring and a denial activating during one candidate read', async () => {
  const fixture = await candidatePersistence({ scopedAccountant: true });
  const result = await listSabalanPlanCandidates(fixture.database, 'historical-admin', 'time-bounded-plan-list');
  assert.ok(result.ok);
  assert.deepEqual(result.value.map(row => row.expected.caseId), [fixture.view.owner.caseId]);
  assert.deepEqual(fixture.audits.map(({ allowed, evaluatedAt }) => ({ allowed, evaluatedAt })),
    fixture.memberCases.map((_, index) => ({ allowed: index === 0, evaluatedAt: index === 0 ? beforeExpiry : afterExpiry })));
});

test('a payments grant expiring after Case authorization leaves the Case out of the candidate list', async () => {
  const fixture = await candidatePersistence({ scopedAccountant: true, expiringPaymentGrant: true });
  fixture.memberCases.splice(1);
  assert.deepEqual(await listSabalanPlanCandidates(fixture.database, 'historical-admin', 'expired-payment-grant'),
    { ok: true, value: [] });
  assert.deepEqual(fixture.audits.map(({ allowed, evaluatedAt }) => ({ allowed, evaluatedAt })),
    [{ allowed: true, evaluatedAt: beforeExpiry }]);
});

test('each snapshot admits only a currently payment-authorized actor', async () => {
  const fixture = await candidatePersistence();
  assert.ok((await listSabalanPlanCandidates(fixture.database, 'historical-admin', 'before-revocation')).ok);
  const previousAudits = fixture.audits.length;
  fixture.revokePayments();
  const denied = await listSabalanPlanCandidates(fixture.database, 'historical-admin', 'after-revocation');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, 'FORBIDDEN');
  assert.equal(fixture.audits.length, previousAudits);
});

test('an abandoned candidate read stops before further Case decisions or projection hydration', async () => {
  const controller = new AbortController();
  const fixture = await candidatePersistence({ abort: { controller, after: 'clock' } });
  await assert.rejects(listSabalanPlanCandidates(fixture.database, 'historical-admin', 'abandoned-plan-list', controller.signal),
    { name: 'AbortError' });
  assert.equal(fixture.stats().decisionClockReads, 1);
  assert.equal(fixture.audits.length, 0);
});

test('an empty candidate snapshot retries when payment authority changes at the central fence', async () => {
  const fixture = await candidatePersistence({ fenceContention: true });
  fixture.memberCases.splice(0);
  const result = await listSabalanPlanCandidates(fixture.database, 'historical-admin', 'empty-after-revocation');
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'FORBIDDEN');
  assert.equal(fixture.stats().fenceReads, 2);
  assert.equal(fixture.audits.length, 0);
});

test('a removed Case uses the current fenced revision even when no other Case can be authorized', async () => {
  const fixture = await candidatePersistence();
  fixture.memberCases.splice(0, fixture.memberCases.length, fixture.memberCases.find(row => row.customerContractId === 'removed-contract')!);
  assert.deepEqual(await listSabalanPlanCandidates(fixture.database, 'historical-admin', 'only-removed-case'), { ok: true, value: [] });
  assert.deepEqual(fixture.audits.map(({ allowed, authorizationRevision }) => ({ allowed, authorizationRevision })),
    [{ allowed: false, authorizationRevision: 7 }]);
});

test('an abandoned candidate read stops before Profile authority after waiting on a Case lock', async () => {
  const controller = new AbortController();
  const fixture = await candidatePersistence({ abort: { controller, after: 'case-lock' } });
  await assert.rejects(listSabalanPlanCandidates(fixture.database, 'historical-admin', 'abandoned-case-lock', controller.signal),
    { name: 'AbortError' });
  assert.equal(fixture.stats().profileReads, 0);
});

test('a disconnect during the last candidate integrity check rolls back the staged authorization audit', async () => {
  const controller = new AbortController();
  const fixture = await candidatePersistence({ abort: { controller, after: 'hydration' } });
  fixture.memberCases.splice(1);
  await assert.rejects(listSabalanPlanCandidates(fixture.database, 'historical-admin', 'abandoned-final-candidate', controller.signal),
    { name: 'AbortError' });
  assert.equal(fixture.stats().auditAppends, 1);
  assert.equal(fixture.audits.length, 0);
});

test('an abandoned candidate snapshot does not retry authority contention', async () => {
  const controller = new AbortController();
  const fixture = await candidatePersistence({ fenceContention: true, abort: { controller, after: 'contention' } });
  await assert.rejects(listSabalanPlanCandidates(fixture.database, 'historical-admin', 'abandoned-contention', controller.signal),
    { name: 'AbortError' });
  assert.deepEqual(fixture.transactions, ['RepeatableRead']);
});

test('a disconnect while queued for a transaction skips the rollout lock', async () => {
  const controller = new AbortController();
  const fixture = await candidatePersistence({ abort: { controller, after: 'transaction-queue' } });
  await assert.rejects(listSabalanPlanCandidates(fixture.database, 'historical-admin', 'abandoned-transaction-queue', controller.signal),
    { name: 'AbortError' });
  assert.equal(fixture.stats().rolloutReads, 0);
});
