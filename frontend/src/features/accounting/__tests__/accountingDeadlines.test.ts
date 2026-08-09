import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deadlineRegisterHref,
  deadlineRowHref,
  reduceAccountingWorkspaceLoad,
} from '../accountingDeadlines';

test('type-specific buckets open canonical registers even for an explicit empty result', () => {
  assert.equal(
    deadlineRegisterHref('receivable', 'days8to30'),
    '/dashboard/accounting/receivables?view=open&due=days8to30',
  );
  assert.equal(
    deadlineRegisterHref('check', 'later30'),
    '/dashboard/accounting/payments?view=unsettled-checks&due=later30',
  );
  assert.equal(
    deadlineRegisterHref('receivable'),
    '/dashboard/accounting/receivables?view=open',
  );
});

test('deadline rows use contract collection focus or legacy register identity focus', () => {
  assert.equal(deadlineRowHref({
    id: 'receivable-1', type: 'receivable', bucket: 'overdue', contractId: 'contract-1',
  }), '/dashboard/accounting/contracts/contract-1?focus=receivable&recordId=receivable-1#collections');
  assert.equal(deadlineRowHref({
    id: 'check-1', type: 'check', bucket: 'next7', contractId: null,
  }), '/dashboard/accounting/payments?view=unsettled-checks&due=next7&recordId=check-1');
});

test('refresh failure preserves the Last Successful View while first-load failure is an error', () => {
  const initial = reduceAccountingWorkspaceLoad(undefined, { type: 'start' });
  assert.deepEqual(initial, { data: null, loading: true, stale: false, error: null });

  const failedInitial = reduceAccountingWorkspaceLoad(initial, { type: 'failure', message: 'offline' });
  assert.deepEqual(failedInitial, { data: null, loading: false, stale: false, error: 'offline' });

  const loaded = reduceAccountingWorkspaceLoad(initial, { type: 'success', data: { deadlines: { items: [] } } });
  const refreshing = reduceAccountingWorkspaceLoad(loaded, { type: 'start' });
  const stale = reduceAccountingWorkspaceLoad(refreshing, { type: 'failure', message: 'offline' });
  assert.deepEqual(stale, {
    data: { deadlines: { items: [] } },
    loading: false,
    stale: true,
    error: 'offline',
  });
});
