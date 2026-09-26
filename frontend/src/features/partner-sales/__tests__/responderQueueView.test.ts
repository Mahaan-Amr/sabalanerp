import assert from 'node:assert/strict';
import test from 'node:test';
import { createResponderFixture } from '../responder/fixturePorts';
import { responderInquiriesForView } from '../responder/responderQueueView';

test('mixed inquiry rows appear in the right active view and old outcomes stay in history', async () => {
  const { queryPort } = createResponderFixture('MULTIPLE');
  const result = await queryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 20 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const inquiries = result.value.inquiries;
  const mixed = inquiries[0];
  const old = inquiries[1];
  mixed.rows[0].state = 'REJECTED';
  mixed.rows[0].noteOrReason = 'نیازمند اصلاح محصول';
  old.rows[0].state = 'EXPIRED';
  old.rows[1].state = 'CANCELLED';
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  assert.deepEqual(responderInquiriesForView(inquiries, 'pending', now).map(item => item.rows.map(row => row.rowId)),
    [[mixed.rows[1].rowId]]);
  assert.deepEqual(responderInquiriesForView(inquiries, 'answered', now).map(item => item.rows.map(row => row.rowId)),
    [[mixed.rows[0].rowId]]);
  assert.deepEqual(responderInquiriesForView(inquiries, 'history', now).map(item => item.rows.map(row => row.rowId)),
    [old.rows.map(row => row.rowId)]);
});
