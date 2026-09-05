import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createPartnerInquiryHttpPorts } from '../inquiries/partnerInquiryHttpPorts';

test('inquiry HTTP ports validate commands and v2 queries before transport and reject corrupt success envelopes', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = { post: async (path: string, body: unknown) => {
    calls.push({ path, body });
    if (path.endsWith('commands')) return { data: { success: true, data: { commandId: 'command-1', replayed: false, eventIds: [] } } };
    return { data: { success: true, data: { schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: 'inquiry-1', rows: [] } } };
  } };
  const ports = createPartnerInquiryHttpPorts(client);
  const intent = { schemaVersion: 1 as const, type: 'INQUIRY_CANCEL' as const, inquiryId: 'inquiry-1', expectedRevision: 1,
    reason: 'لغو استعلام آزمایشی' };
  const command = { ...intent, commandId: 'command-1', correlationId: 'command-1', idempotency: {
    actorId: 'partner-1', operation: 'INQUIRY_CANCEL' as const, targetId: 'inquiry-1', key: 'command-1', payloadHash: await canonicalHash(intent) } };
  assert.equal((await ports.commands.execute(command)).ok, true);
  assert.equal((await ports.queries.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: 'inquiry-1' })).ok, true);
  assert.deepEqual(calls.map(call => call.path), ['/partner/inquiries/commands', '/partner/inquiries/query-v2']);
  assert.equal((await ports.commands.execute({ ...command, unexpected: true } as typeof command)).ok, false);
  assert.equal(calls.length, 2, 'invalid command is never sent');

  const corrupt = createPartnerInquiryHttpPorts({ post: async () => ({ data: { success: true, data: { commandId: 'wrong' } } }) });
  const result = await corrupt.commands.execute(command);
  assert.equal(result.ok ? null : result.error.code, 'INTEGRITY_CONFLICT');
});
