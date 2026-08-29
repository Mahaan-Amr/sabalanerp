import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createPartnerManagementHttpPort } from '../management/partnerManagementHttpPort';

test('management HTTP port validates strict v2 commands and success receipts', async () => {
  const calls: unknown[] = [];
  const port = createPartnerManagementHttpPort({ post: async (path, body) => { calls.push([path, body]);
    return { data: { success: true, data: { commandId: 'command-1', replayed: false,
      profileId: 'profile-1', revision: 2, eventIds: ['event-1'] } } }; } });
  const intent = { schemaVersion: 2 as const, type: 'RESPONDER_ASSIGN' as const, profileId: 'profile-1', expectedRevision: 1,
    responderId: 'responder-1', reason: 'تخصیص پاسخ‌دهنده مصوب' };
  const command = { ...intent, commandId: 'command-1', correlationId: 'command-1', idempotency: { actorId: 'manager-1',
    operation: 'RESPONDER_ASSIGN' as const, targetId: 'profile-1', key: 'command-1', payloadHash: await canonicalHash(intent) } };
  assert.equal((await port.execute(command)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal((await port.execute({ ...command, unexpected: true } as typeof command)).ok, false);
  const corrupt = createPartnerManagementHttpPort({ post: async () => ({ data: { success: true,
    data: { commandId: 'wrong', replayed: false, profileId: 'profile-1', revision: 2, eventIds: [] } } }) });
  assert.equal((await corrupt.execute(command)).ok, false);
});
