import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerCommandSession } from '../management/commandSession';

test('an uncertain response retries the identical command without allowing a changed intent', async () => {
  const received: unknown[] = [];
  const session = new PartnerCommandSession({ execute: async (command) => {
    received.push(command);
    if (received.length === 1) throw new Error('private network diagnostic');
    return { ok: true, value: { commandId: command.commandId, replayed: true, eventIds: [] } };
  } }, 'fixture-331-actor');
  const intent = { type: 'PROFILE_TRANSITION' as const, profileId: 'fixture-331-profile', expectedRevision: 1,
    to: 'SUSPENDED' as const, reason: 'درخواست توقف همکاری', gateEvidenceIds: [] };
  const first = await session.submit(intent, intent.profileId);
  assert.equal(first.kind, 'uncertain');
  assert.doesNotMatch(JSON.stringify(first), /private network/);
  assert.equal((await session.submit({ ...intent, to: 'TERMINATED' }, intent.profileId)).kind, 'blocked');
  assert.equal(received.length, 1);
  assert.equal((await session.retry()).kind, 'success');
  assert.deepEqual(received[1], received[0]);
});
