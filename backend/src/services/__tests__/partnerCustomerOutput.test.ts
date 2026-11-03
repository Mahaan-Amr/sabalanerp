import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCustomerOutputSnapshots } from '../partnerSales/customerOutput/snapshots';
import { createCustomerConfirmationAdapter, ConfirmationSession, ConfirmationSource, CustomerConfirmationStore } from '../partnerSales/customerOutput/confirmation';
import { createCustomerOutputIssuer, CustomerIssuanceStore } from '../partnerSales/customerOutput/issuance';
import type { ContractRuntime, Notification, Output, Result, Snapshot } from '../partnerSales/customerOutput/contracts';
import { generateCustomerContractPdf } from '../../utils/pdf';

const packageRequire = createRequire(path.resolve(__dirname, '../../../../packages/partner-sales-contracts/package.json'));
const contract: ContractRuntime = packageRequire('@sabalanerp/partner-sales-contracts');
const fixtures = packageRequire('@sabalanerp/partner-sales-contracts/testing') as { createPartnerFixtures(): {
  customer: Output; case: { head: Snapshot['owner'] };
} };
const snapshots = createCustomerOutputSnapshots(contract);
const now = '2026-08-27T12:00:00.000Z';
const expiry = '2026-10-26T12:00:00.000Z';
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const unwrap = <T>(result: Result<T>): T => { if (!result.ok) assert.fail(result.error.code); return result.value; };

function source(): ConfirmationSource {
  const fixture = fixtures.createPartnerFixtures();
  const { outputHash, seller, ...retail } = fixture.customer;
  return {
    owner: fixture.case.head, contractNumber: retail.contractNumber,
    normalizedRecipient: '+989120000001', state: 'DRAFT', retail,
    business: { tradeName: 'سنگ آفتاب', legalName: 'شرکت آفتاب', businessPhone: '02111111111', businessAddress: 'نشانی تجاری' },
  };
}

async function snapshot() {
  const current = source();
  return snapshots.mint({ ...current, snapshotId: 'output-325', createdAt: now, expiresAt: expiry });
}

// Module fixture only. #334/#335 must prove these port contracts against the
// real Case/session/outbox schema, row locks, constraints and authorization.
function confirmationFixture() {
  let current = source();
  let session: ConfirmationSession | null = null;
  let instant = now;
  let counter = 0;
  let gate = Promise.resolve();
  let gatewayFails = true;
  let approvals = 0;
  let changeDuringVerification: Partial<ConfirmationSource> | null = null;
  const outbox = new Map<string, Notification>();
  const attempts: string[] = [];
  const store: CustomerConfirmationStore = {
    async transaction(action, work) {
      const previous = gate;
      let release!: () => void;
      gate = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const saved = structuredClone({ current, session });
      const oldOutbox = new Map(outbox);
      try {
        const value = await work({
          now: async () => instant, source: async () => structuredClone(current),
          session: async () => structuredClone(session),
          snapshotIdentity: async () => ({ snapshotId: `snapshot-325-${++counter}`, expiresAt: expiry }),
          invalidatePending: async () => { if (session && !session.verifiedAt) session.invalidated = true; },
          installSnapshot: async value => { session = { snapshot: structuredClone(value), verifiedAt: null, invalidated: false }; },
          queueConfirmation: async value => {
            const notification: Notification = { schemaVersion: 1, notificationId: `notification-325-${++counter}`,
              correlationId: 'correlation-325', kind: 'CUSTOMER_CONFIRMATION', recipientEvidenceId: 'recipient-325',
              projectionEvidenceId: value.snapshotId, notBefore: instant };
            outbox.set(notification.notificationId, notification);
            return notification;
          },
          verifyOtp: async code => {
            if (changeDuringVerification) current = { ...current, ...changeDuringVerification };
            return code === 'fixture-code' ? ok({ verifiedAt: instant }) : { ok: false, error: contract.partnerError('INVALID_PAYLOAD') };
          },
          markCustomerApproved: async (_snapshot, verifiedAt) => {
            assert.ok(session);
            session.verifiedAt = verifiedAt;
            current.state = 'CUSTOMER_APPROVED';
            approvals++;
          },
        });
        return ok(value);
      } catch (error) {
        current = saved.current; session = saved.session;
        outbox.clear(); oldOutbox.forEach((value, key) => outbox.set(key, value));
        throw error;
      } finally { release(); }
    },
    notification: async id => outbox.has(id) ? ok(outbox.get(id)!) : { ok: false, error: contract.partnerError('NOT_FOUND') },
    recordNotificationAttempt: async (_id, result) => { attempts.push(result); },
  };
  const adapter = createCustomerConfirmationAdapter(contract, store, {
    enqueue: async notification => {
      assert.deepEqual(Object.keys(notification).sort(), ['schemaVersion', 'notificationId', 'correlationId', 'kind', 'recipientEvidenceId', 'projectionEvidenceId', 'notBefore'].sort());
      if (gatewayFails) throw new Error('provider failure with secret payload must not escape');
      return ok({ deliveryId: 'sandbox-delivery-325', mode: 'SANDBOX' });
    },
  });
  return { adapter, attempts, approvals: () => approvals, change: (patch: Partial<ConfirmationSource>) => { current = { ...current, ...patch }; },
    time: (value: string) => { instant = value; }, gatewayReady: () => { gatewayFails = false; },
    duringVerification: (patch: Partial<ConfirmationSource>) => { changeDuringVerification = patch; } };
}

test('mint seals only retail content and frozen commercial identity with legal fallback', async () => {
  const input = source();
  input.business.tradeName = '  ';
  Object.assign(input.business, { personalName: 'PRIVATE_PERSON', taxId: 'PRIVATE_TAX', logo: 'PRIVATE_LOGO' });
  const sealed = await snapshots.mint({ ...input, snapshotId: 'output-325', createdAt: now, expiresAt: expiry });
  assert.deepEqual(sealed.content.seller, { displayName: 'شرکت آفتاب', phone: '02111111111', address: 'نشانی تجاری' });
  input.retail.products[0].retailUnitPrice = '9999';
  assert.equal(sealed.content.products[0].retailUnitPrice, '1000');
  const publicJson = JSON.stringify(await snapshots.content(sealed.content));
  for (const secret of ['PRIVATE_', 'FIXTURE-CASE', 'FIXTURE-INTERNAL', 'caseId', 'owner', 'normalizedRecipient']) assert.ok(!publicJson.includes(secret));
  await assert.rejects(() => snapshots.content({ ...sealed.content, totals: { ...sealed.content.totals, payable: '1' } }));
});

test('snapshot arithmetic validates the full exact decimal wire range without global rounding', async () => {
  const input = source();
  input.retail.totals = { net: '1000000000000000000000000000000', discount: '0', tax: '1', charges: '0',
    payable: '1000000000000000000000000000001', currency: 'IRR' };
  input.retail.customerPaymentPlan.installments[0].amount.amount = input.retail.totals.payable;
  const sealed = await snapshots.mint({ ...input, snapshotId: 'large-output', createdAt: now, expiresAt: expiry });
  assert.equal(sealed.content.totals.payable, '1000000000000000000000000000001');
});

test('recursive strict allowlist rejects forbidden fields at every object boundary', async () => {
  const input = source();
  input.retail.signatures = [{ name: 'امضاکننده آزمایشی', signedAt: now }];
  input.retail.customerPaymentPlan.installments[0].check = { number: 'synthetic-check', bank: 'بانک آزمایشی', dueDate: '2026-08-30' };
  const sealed = await snapshots.mint({ ...input, snapshotId: 'output-325', createdAt: now, expiresAt: expiry });
  const paths: (string | number)[][] = [];
  function visit(value: unknown, prefix: (string | number)[] = []) {
    if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, [...prefix, index]));
    else if (value && typeof value === 'object') {
      paths.push(prefix);
      Object.entries(value).forEach(([key, entry]) => visit(entry, [...prefix, key]));
    }
  }
  visit(sealed.content);
  for (const field of ['wholesaleUnitPrice', 'inquiry', 'margin', 'caseNumber', 'recordId', 'accounting', 'contractData', 'graph', 'responder', 'sabalanPaymentPlan']) {
    for (const keys of paths) {
      const input = structuredClone(sealed.content);
      let target: any = input;
      for (const key of keys) target = target[key];
      target[field] = 'PRIVATE';
      await assert.rejects(() => snapshots.content(input), `${field} at ${keys.join('.')}`);
      await assert.rejects(() => generateCustomerContractPdf(contract, input), `PDF ${field} at ${keys.join('.')}`);
    }
  }
});

test('resend keeps the snapshot and expiry; SMS retry never recreates commercial evidence', async () => {
  const f = confirmationFixture();
  const first = unwrap(await f.adapter.sendForConfirmation());
  const displayed = unwrap(await f.adapter.getPublicContract());
  assert.deepEqual(unwrap(await f.adapter.dispatchNotification(first.notificationId)), { queued: false });
  f.change({ business: { ...source().business, tradeName: 'LIVE_CHANGED_NAME' } });
  f.time('2026-08-27T12:02:00.000Z');
  const resent = unwrap(await f.adapter.sendForConfirmation());
  assert.equal(resent.snapshotId, first.snapshotId);
  assert.deepEqual(unwrap(await f.adapter.getPublicContract()), displayed);
  f.gatewayReady();
  assert.deepEqual(unwrap(await f.adapter.dispatchNotification(first.notificationId)), { queued: true });
  assert.deepEqual(f.attempts, ['RETRY', 'QUEUED']);
  assert.equal(f.approvals(), 0);
});

test('send freezes pending confirmation state and rejects a changed hash at the same revision', async () => {
  const f = confirmationFixture();
  unwrap(await f.adapter.sendForConfirmation());
  const view = unwrap(await f.adapter.getPublicContract()).contract;
  assert.equal(view.status, 'PENDING_APPROVAL');
  assert.equal(view.confirmation, 'PENDING');
  f.change({ owner: { ...source().owner, integrityHash: 'sha256-v1:' + 'b'.repeat(64) } });
  assert.equal((await f.adapter.sendForConfirmation()).ok, false);
});

test('recipient/revision change rejects stale OTP and invalidates pending evidence on send', async () => {
  const f = confirmationFixture();
  const first = unwrap(await f.adapter.sendForConfirmation());
  f.change({ normalizedRecipient: '+989120000002' });
  assert.equal((await f.adapter.getPublicContract()).ok, false);
  assert.equal((await f.adapter.verifyPublicOtp('fixture-code')).ok, false);
  const second = unwrap(await f.adapter.sendForConfirmation());
  assert.notEqual(first.snapshotId, second.snapshotId);
  const owner = { ...source().owner, revision: 2 };
  f.change({ owner, retail: { ...source().retail, revision: 2 } });
  assert.equal((await f.adapter.verifyPublicOtp('fixture-code')).ok, false);
  assert.notEqual(unwrap(await f.adapter.sendForConfirmation()).snapshotId, second.snapshotId);
});

test('OTP approves exactly once; verified historical content is read-only through expiry', async () => {
  const f = confirmationFixture();
  await f.adapter.sendForConfirmation();
  assert.equal((await f.adapter.verifyPublicOtp('wrong')).ok, false);
  const before = unwrap(await f.adapter.getPublicContract()).contract;
  const results = await Promise.all([f.adapter.verifyPublicOtp('fixture-code'), f.adapter.verifyPublicOtp('fixture-code')]);
  results.forEach(result => assert.deepEqual(unwrap(result), { status: 'APPROVED' }));
  assert.equal(f.approvals(), 1);
  f.change({ owner: { ...source().owner, revision: 2 }, state: 'COMMITTED' });
  let historical = unwrap(await f.adapter.getPublicContract());
  assert.equal(historical.banner, 'SUPERSEDED');
  assert.equal(historical.readOnly, true);
  assert.deepEqual(historical.contract, before);
  f.change({ state: 'VOIDED' });
  historical = unwrap(await f.adapter.getPublicContract());
  assert.equal(historical.banner, 'CANCELLED');
  assert.equal((await f.adapter.verifyPublicOtp('fixture-code')).ok, false);
  f.time(expiry);
  assert.equal((await f.adapter.getPublicContract()).ok, false);
});

test('same-revision hash corruption and cancellation fail closed for pending sessions', async () => {
  for (const patch of [{ state: 'CANCELLED' as const }, { owner: { ...source().owner, integrityHash: 'sha256-v1:' + 'b'.repeat(64) } }]) {
    const f = confirmationFixture();
    await f.adapter.sendForConfirmation();
    f.change(patch);
    assert.equal((await f.adapter.getPublicContract()).ok, false);
    assert.equal((await f.adapter.verifyPublicOtp('fixture-code')).ok, false);
  }
});

test('cancellation or recipient change observed after OTP validation still blocks approval', async () => {
  for (const change of [{ state: 'CANCELLED' as const }, { normalizedRecipient: '+989120000002' }]) {
    const f = confirmationFixture();
    unwrap(await f.adapter.sendForConfirmation());
    f.duringVerification(change);
    assert.equal((await f.adapter.verifyPublicOtp('fixture-code')).ok, false);
    assert.equal(f.approvals(), 0);
  }
});

test('final issuance races share one publication; preview, redownload and failed renders do not commit', async () => {
  const sealed = await snapshot();
  let published: { artifactId: string; outputHash: string } | null = null;
  let commits = 0;
  let renders = 0;
  let failRender = false;
  let allowed = true;
  let stale = false;
  const store: CustomerIssuanceStore = {
    resolveAuthorized: async () => allowed ? ok(sealed) : { ok: false, error: contract.partnerError('FORBIDDEN') },
    findIssued: async () => published,
    publishFinal: async (_snapshot, artifact) => {
      if (stale) return { ok: false, error: contract.partnerError('ROW_STALE') };
      if (!published) { published = artifact; commits++; }
      return ok(published);
    },
  };
  const issuer = createCustomerOutputIssuer(contract, store, {
    prepare: async (content, mode) => {
      renders++;
      assert.equal(content.purpose, 'CUSTOMER_OUTPUT');
      if (failRender) throw new Error('PRIVATE renderer detail');
      return { artifactId: `${mode}-${renders}`, outputHash: content.outputHash };
    },
  });
  unwrap(await issuer.issue(sealed.content, 'PREVIEW'));
  assert.equal(commits, 0);
  failRender = true;
  const failed = await issuer.issue(sealed.content, 'FINAL');
  assert.equal(failed.ok, false);
  assert.ok(!JSON.stringify(failed).includes('PRIVATE'));
  assert.equal(commits, 0);
  failRender = false;
  stale = true;
  assert.equal((await issuer.issue(sealed.content, 'FINAL')).ok, false);
  assert.equal(commits, 0);
  stale = false;
  const issued = await Promise.all(Array.from({ length: 8 }, () => issuer.issue(sealed.content, 'FINAL')));
  assert.equal(new Set(issued.map(result => unwrap(result).artifactId)).size, 1);
  assert.equal(commits, 1);
  const rendered = renders;
  assert.deepEqual(unwrap(await issuer.issue(sealed.content, 'DOWNLOAD_EXISTING')), unwrap(issued[0]));
  assert.equal(renders, rendered);
  assert.equal(commits, 1);
  allowed = false;
  assert.equal((await issuer.issue(sealed.content, 'DOWNLOAD_EXISTING')).ok, false);
  assert.equal((await issuer.issue(sealed.content, 'PREVIEW')).ok, false);
});

test('issuer rejects retail DTO corruption before invoking any consumer', async () => {
  const sealed = await snapshot();
  let touched = false;
  const issuer = createCustomerOutputIssuer(contract, {
    resolveAuthorized: async () => { touched = true; return ok(sealed); },
    findIssued: async () => null,
    publishFinal: async (_snapshot, artifact) => ok(artifact),
  }, { prepare: async () => { throw new Error('must not render'); } });
  const input = { ...sealed.content, contractData: { wholesale: 'PRIVATE' } } as Output;
  assert.equal((await issuer.issue(input, 'FINAL')).ok, false);
  assert.equal(touched, false);
});
