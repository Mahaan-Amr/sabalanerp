import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partnerError } from '@sabalanerp/partner-sales-contracts';
import { createPartnerWorkspaceQuery } from '../../../backend/src/services/partnerSales/workspaces/query';

test('responder workspace is assembled from currently authorized inquiry projections in one transaction', async () => {
  const calls: string[] = [];
  const query = createPartnerWorkspaceQuery({
    actorId: 'responder-334',
    transaction: async work => work({ snapshot: 'one' }),
    listResponderInquiryIds: async (tx, page) => {
      assert.deepEqual(tx, { snapshot: 'one' });
      assert.deepEqual(page, { limit: 20, contractId: undefined, view: 'all', status: 'all', search: undefined });
      return { inquiryIds: ['inquiry-visible', 'inquiry-hidden', 'inquiry-visible-2'] };
    },
    readResponderInquiry: async (_tx, inquiryId) => {
      calls.push(inquiryId);
      if (inquiryId === 'inquiry-hidden') return { ok: false, error: partnerError('NOT_FOUND') };
      return { ok: true, value: {
        schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId, partnerDisplayName: 'فروشنده همکار', assignmentId: `assignment-${inquiryId}`,
        assignmentRevision: 1, submittedAt: '2026-09-14T08:00:00.000Z', actions: [], rows: [],
      } };
    },
    readManagementWorkspace: async () => ({ ok: false, error: partnerError('FORBIDDEN') }),
  });

  const result = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 2 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.actorId, 'responder-334');
  assert.deepEqual(result.value.inquiries.map(item => item.inquiryId), ['inquiry-visible', 'inquiry-visible-2']);
  assert.deepEqual(calls, ['inquiry-visible', 'inquiry-hidden', 'inquiry-visible-2']);
});

test('workspace query rejects malformed producer projections instead of widening the wire', async () => {
  const query = createPartnerWorkspaceQuery({
    actorId: 'responder-334', transaction: async work => work({}),
    listResponderInquiryIds: async () => ({ inquiryIds: ['inquiry-corrupt'] }),
    readResponderInquiry: async () => ({ ok: true, value: {
      schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId: 'inquiry-corrupt', partnerDisplayName: 'فروشنده همکار',
      assignmentId: 'assignment-corrupt', assignmentRevision: 1, submittedAt: '2026-09-14T08:00:00.000Z',
      actions: [], rows: [], privateRate: '1000',
    } as never }),
    readManagementWorkspace: async () => ({ ok: false, error: partnerError('FORBIDDEN') }),
  });
  const result = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
  assert.equal(!result.ok && result.error.code, 'INTEGRITY_CONFLICT');
});


test('dashboard summary preserves admission and authorized counts without reading product details', async () => {
  let allowed = true;
  const query = createPartnerWorkspaceQuery({ actorId: 'responder', transaction: async work => work({}),
    canReadResponderWorkspace: async () => allowed,
    listResponderInquiryIds: async (_tx, page) => {
      assert.equal(page.summaryOnly, true);
      return { grouped: true, inquiryIds: ['private-inquiry'], contractCounts: { pending: 7, answered: 2, history: 1 } };
    }, readResponderInquiry: async () => { throw new Error('summary must not read details'); },
    readManagementWorkspace: async () => ({ ok: false, error: partnerError('FORBIDDEN') }) });
  const input = { schemaVersion: 2 as const, purpose: 'RESPONDER_WORKSPACE' as const, summaryOnly: true };
  const result = await query.query(input);
  assert.equal(result.ok, true);
  if (result.ok) { assert.deepEqual(result.value.inquiries, []); assert.equal(result.value.contractCounts?.pending, 7); }
  allowed = false;
  const denied = await query.query(input);
  assert.equal(!denied.ok && denied.error.code, 'FORBIDDEN');
});

test('contract list returns authorized summaries without hydrating product or response details', async () => {
  const contract = { id: 'case-summary', customer: 'مشتری', partnerDisplayName: 'فروشنده همکار',
    label: 'کد پیگیری ۸۱۹', pending: true, requestedAt: '2026-10-07T08:00:00.000Z',
    answeredRows: 1, currentRows: 2, cancelled: false };
  const query = createPartnerWorkspaceQuery({ actorId: 'responder', transaction: async work => work({}),
    canReadResponderWorkspace: async () => true,
    listResponderInquiryIds: async () => ({ grouped: true, inquiryIds: ['private-details'], contracts: [contract],
      contractCounts: { pending: 1, answered: 0, history: 0 } }),
    readResponderInquiry: async () => { throw new Error('list must not hydrate product details'); },
    readManagementWorkspace: async () => ({ ok: false, error: partnerError('FORBIDDEN') }) });
  const result = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.inquiries, []);
    assert.deepEqual(result.value.contracts, [contract]);
  }
});

test('contract summaries reject private product facts and cannot replace dedicated contract details', async () => {
  const contract = { id: 'case-summary', customer: 'مشتری', partnerDisplayName: 'فروشنده همکار', label: 'کد پیگیری ۸۱۹',
    pending: true, requestedAt: '2026-10-07T08:00:00.000Z', answeredRows: 0, currentRows: 1, cancelled: false };
  let details = 0;
  const query = createPartnerWorkspaceQuery({ actorId: 'responder', transaction: async work => work({}),
    listResponderInquiryIds: async () => ({ grouped: true, inquiryIds: ['private-details'],
      contracts: [{ ...contract, privateRate: '120000' }] }),
    readResponderInquiry: async () => { details++; return { ok: false, error: partnerError('FORBIDDEN') }; },
    readManagementWorkspace: async () => ({ ok: false, error: partnerError('FORBIDDEN') }) });
  const list = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
  assert.equal(!list.ok && list.error.code, 'INTEGRITY_CONFLICT');
  assert.equal(details, 0);
  const detail = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', contractId: contract.id });
  assert.equal(detail.ok, true);
  if (detail.ok) assert.deepEqual(detail.value.inquiries, []);
  assert.equal(details, 1, 'dedicated details must still check current inquiry authority');
});
