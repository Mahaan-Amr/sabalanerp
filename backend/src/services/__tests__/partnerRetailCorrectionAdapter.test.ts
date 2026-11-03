import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PartnerCommandSchema, canonicalHash, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { createPartnerRetailCorrectionAdapter } from '../crossWorkspaceDutyAdapters/partnerRetailCorrectionAdapter';

const predecessor = { caseId: 'case-328-adapter', revision: 1,
  integrityHash: `sha256-v1:${'a'.repeat(64)}` };

async function request(actorId: string): Promise<PartnerCommand> {
  const intent = { type: 'CORRECTION_REQUEST' as const, expected: predecessor,
    expectedState: 'COMMITTED' as const, scope: 'RETAIL_ONLY' as const,
    reason: 'اصلاح خرده‌فروشی' };
  return PartnerCommandSchema.parse({ schemaVersion: 1, commandId: 'command-328-adapter',
    correlationId: 'correlation-328-adapter', ...intent,
    idempotency: { actorId, operation: intent.type, targetId: predecessor.caseId,
      key: 'key-328-adapter', payloadHash: await canonicalHash(intent) } });
}

test('adapter binds the authenticated actor and never forwards impersonated Partner evidence', async () => {
  const forwarded: PartnerCommand[] = [];
  const adapter = createPartnerRetailCorrectionAdapter({ execute: async command => {
    forwarded.push(command);
    return { ok: true, value: { commandId: command.commandId, replayed: false,
      head: predecessor, effective: predecessor, eventIds: [] } };
  } });
  const partnerCommand = await request('partner-328');
  const impersonated = await adapter.execute('sales-manager-328', partnerCommand);
  assert.equal(impersonated.ok, false);
  if (!impersonated.ok) assert.equal(impersonated.error.code, 'FORBIDDEN');
  assert.deepEqual(forwarded, []);

  const accepted = await adapter.execute('partner-328', partnerCommand);
  assert.equal(accepted.ok, true);
  assert.deepEqual(forwarded, [partnerCommand]);
});

test('adapter rejects unrelated Partner commands at this module boundary', async () => {
  const adapter = createPartnerRetailCorrectionAdapter({ execute: async () => {
    throw new Error('must not forward');
  } });
  const requestCommand = await request('partner-328');
  const unrelated = { ...requestCommand, type: 'CASE_CANCEL' } as unknown as PartnerCommand;
  const result = await adapter.execute('partner-328', unrelated);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INVALID_PAYLOAD');
});
