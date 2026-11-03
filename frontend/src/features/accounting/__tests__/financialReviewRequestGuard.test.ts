import assert from 'node:assert/strict';
import test from 'node:test';
import { FinancialReviewRequestGuard, loadFinancialReview, canSubmitFinancialReview } from '../financialReviewRequestGuard';

const record = (id: string) => ({ data: { success: true, data: { items: [{ id }], actionAvailability: { approve: true } } } });
const audit = { data: { success: true, data: { items: [], total: 0 } } };

test('actual record/audit load ignores earlier response after route switch and account switch', async () => {
  const guard = new FinancialReviewRequestGuard();
  let resolveAudit!: (v: typeof audit) => void;
  const delayedAudit = new Promise<typeof audit>(resolve => { resolveAudit = resolve; });
  guard.select('user-1:invoice-A');
  const a = guard.begin('user-1:invoice-A')!;
  const first = loadFinancialReview({ owner: 'user-1:invoice-A', recordId: 'invoice-A', epoch: a, guard,
    fetchRecord: async () => record('invoice-A'), fetchAudit: () => delayedAudit });
  await Promise.resolve();
  guard.select('user-1:invoice-B');
  const b = guard.begin('user-1:invoice-B')!;
  const second = await loadFinancialReview({ owner: 'user-1:invoice-B', recordId: 'invoice-B', epoch: b, guard,
    fetchRecord: async () => record('invoice-B'), fetchAudit: async () => audit });
  assert.equal(second?.kind, 'loaded');
  if (second?.kind === 'loaded') assert.equal(second.record.id, 'invoice-B');
  resolveAudit(audit);
  assert.equal(await first, null);
  const bRefresh = guard.begin('user-1:invoice-B')!;
  guard.select('user-2:invoice-B');
  assert.equal(guard.isCurrent('user-1:invoice-B', bRefresh), false);
  assert.equal(guard.begin('user-1:invoice-B'), null);
});

test('stale, differently owned, busy or unapproved reviews cannot submit approval', () => {
  const allowed = { loading: false, busy: false, owner: 'user-1:B', recordId: 'B', payloadId: 'B',
    review: { owner: 'user-1:B', record: { id: 'B' }, canApprove: true } };
  assert.equal(canSubmitFinancialReview(allowed), true);
  for (const change of [{ owner: 'user-2:B' }, { recordId: 'A' }, { payloadId: 'A' },
    { loading: true }, { busy: true }, { review: { ...allowed.review, canApprove: false } }]) {
    assert.equal(canSubmitFinancialReview({ ...allowed, ...change }), false);
  }
});

test('audit permission denial stays separate from failure and failed audit blocks approval', async () => {
  const guard = new FinancialReviewRequestGuard(); guard.select('u:A'); const epoch = guard.begin('u:A')!;
  const common = { owner: 'u:A', recordId: 'A', epoch, guard, fetchRecord: async () => record('A') };
  const denied = await loadFinancialReview({ ...common, fetchAudit: async () => { throw { response: { status: 403 } }; } });
  assert(denied?.kind === 'loaded'); assert.equal(denied.auditDenied, true); assert.equal(denied.canApprove, true);
  const failed = await loadFinancialReview({ ...common, fetchAudit: async () => { throw new Error('offline'); } });
  assert(failed?.kind === 'loaded'); assert.equal(failed.auditLoadError, true); assert.equal(failed.canApprove, false);
});
