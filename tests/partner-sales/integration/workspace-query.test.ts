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
      assert.deepEqual(page, { limit: 2 });
      return { inquiryIds: ['inquiry-visible', 'inquiry-hidden', 'inquiry-visible-2'] };
    },
    readResponderInquiry: async (_tx, inquiryId) => {
      calls.push(inquiryId);
      if (inquiryId === 'inquiry-hidden') return { ok: false, error: partnerError('NOT_FOUND') };
      return { ok: true, value: {
        schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId, partnerDisplayName: 'فروشنده همکار', assignmentId: `assignment-${inquiryId}`,
        assignmentRevision: 1, actions: [], rows: [],
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
      assignmentId: 'assignment-corrupt', assignmentRevision: 1, actions: [], rows: [], privateRate: '1000',
    } as never }),
    readManagementWorkspace: async () => ({ ok: false, error: partnerError('FORBIDDEN') }),
  });
  const result = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
  assert.equal(!result.ok && result.error.code, 'INTEGRITY_CONFLICT');
});
