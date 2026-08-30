import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createPartnerRuntimeCommandPort } from '../workspaces/partnerRuntimeCommandPort';

test('runtime command port dispatches only the owning authenticated transport', async () => {
  const calls: Array<[string, unknown]> = [];
  const port = createPartnerRuntimeCommandPort({ post: async (path, body) => {
    calls.push([path, body]);
    return { data: { success: true, data: { commandId: (body as { commandId: string }).commandId,
      replayed: false, eventIds: ['event-334'] } } };
  } });
  const profileIntent = { schemaVersion: 1 as const, type: 'PROFILE_TRANSITION' as const,
    profileId: 'profile-334', expectedRevision: 1, to: 'SUSPENDED' as const,
    gateEvidenceIds: [] as string[], reason: 'توقف برای بررسی وضعیت حساب' };
  const command = { ...profileIntent, commandId: 'command-334', correlationId: 'correlation-334',
    idempotency: { actorId: 'manager-334', operation: profileIntent.type, targetId: profileIntent.profileId,
      key: 'command-334', payloadHash: await canonicalHash(profileIntent) } };
  assert.equal((await port.execute(command)).ok, true);
  assert.equal(calls[0][0], '/partner/management/commands');
});
