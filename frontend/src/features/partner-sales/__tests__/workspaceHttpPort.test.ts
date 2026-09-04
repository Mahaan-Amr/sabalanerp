import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPartnerWorkspaceHttpPort } from '../workspaces/partnerWorkspaceHttpPort';

test('workspace HTTP port preserves the explicit purpose and validates the matching response', async () => {
  const calls: Array<[string, unknown]> = [];
  const port = createPartnerWorkspaceHttpPort({ post: async (path, body) => {
    calls.push([path, body]);
    return { data: { success: true, data: body && (body as { purpose?: string }).purpose === 'PARTNER_MANAGEMENT'
      ? { schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', actorId: 'manager-334',
        personaLabel: 'مدیریت فروش همکار', actions: [], profiles: [], transfers: [] }
      : { schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', actorId: 'responder-334', inquiries: [] } } };
  } });

  const management = await port.query({ schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', limit: 20 });
  const responder = await port.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 20 });
  assert.equal(management.ok, true);
  assert.equal(responder.ok, true);
  assert.deepEqual(calls, [
    ['/partner/workspaces/query-v2', { schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', limit: 20 }],
    ['/partner/workspaces/query-v2', { schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 20 }],
  ]);
});

test('workspace HTTP port rejects a purpose-confused or widened response', async () => {
  const confused = createPartnerWorkspaceHttpPort({ post: async () => ({ data: { success: true, data: {
    schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', actorId: 'responder-334', inquiries: [], privateRole: 'ADMIN',
  } } }) });
  const result = await confused.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
  assert.equal(!result.ok && result.error.code, 'INTEGRITY_CONFLICT');
});

test('workspace HTTP port retries one transient read failure but never widens the response', async () => {
  let calls = 0;
  const port = createPartnerWorkspaceHttpPort({ post: async () => {
    calls += 1;
    if (calls === 1) throw new Error('replaced local upstream connection');
    return { data: { success: true, data: { schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE',
      actorId: 'responder-334', inquiries: [] } } };
  } });
  assert.equal((await port.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' })).ok, true);
  assert.equal(calls, 2);
});
