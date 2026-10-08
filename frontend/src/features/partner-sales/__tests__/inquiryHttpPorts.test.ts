import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createPartnerInquiryHttpPorts, INQUIRY_DECISION_REQUEST_TIMEOUT_MS } from '../inquiries/partnerInquiryHttpPorts';
import { PartnerCommandSession } from '../management/commandSession';

test('a decision transport timeout keeps the exact command for receipt retry and bounds request duration', async () => {
  const calls: unknown[] = [];
  const ports = createPartnerInquiryHttpPorts({ async post(_path, body, options) {
    calls.push(body);
    assert.equal(options?.timeout, INQUIRY_DECISION_REQUEST_TIMEOUT_MS);
    if (calls.length === 1) throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    const command = body as { commandId: string };
    return { data: { success: true, data: { commandId: command.commandId, replayed: true, eventIds: ['event'],
      batch: { schemaVersion: 1, commandId: command.commandId,
        outcomes: [{ ok: true, rowId: 'row', outcomeId: 'outcome', revision: 2, outcome: 'APPROVED' }] } } } };
  } });
  const session = new PartnerCommandSession(ports.commands, 'responder');
  const intent = { type: 'INQUIRY_DECIDE' as const, inquiryId: 'inquiry', expectedAssignmentRevision: 1,
    decisions: [{ rowId: 'row', expectedRevision: 1, outcome: 'APPROVED' as const,
      wholesaleUnitPrice: { amount: '2500000', currency: 'IRT' as const } }] };
  assert.equal((await session.submit(intent, 'inquiry')).kind, 'uncertain');
  assert.equal((await session.submit(intent, 'inquiry')).kind, 'blocked');
  assert.equal((await session.retry()).kind, 'success');
  assert.deepEqual(calls[0], calls[1]);
});

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

test('case-scoped repricing reaches the inquiry command endpoint', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = { post: async (path: string, body: unknown) => {
    calls.push({ path, body });
    return { data: { success: true, data: { commandId: 'pricing-command', replayed: false, eventIds: [] } } };
  } };
  const ports = createPartnerInquiryHttpPorts(client);
  const intent = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const,
    caseId: 'case-1', expected: { caseId: 'case-1', revision: 1, integrityHash: `sha256-v1:${'a'.repeat(64)}` },
    inquiryId: 'partner-case-pricing:case-1:1', rows: [{ rowId: 'pricing-row-1',
      configuration: { recoveryId: 'recovery-1', recoveryRevision: 1, productRowId: 'product-row-1' } }] };
  const command = { ...intent, commandId: 'pricing-command', correlationId: 'pricing-command', idempotency: {
    actorId: 'partner-1', operation: 'CASE_PRICING_SUBMIT' as const, targetId: 'case-1',
    key: 'pricing-command', payloadHash: await canonicalHash(intent) } };
  const result = await ports.commands.execute(command);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(call => call.path), ['/partner/inquiries/commands']);
});
