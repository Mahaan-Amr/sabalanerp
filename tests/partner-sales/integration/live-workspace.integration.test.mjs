import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withFixture } from '../harness/fixtures.mjs';
import { preflight } from '../harness/safety.mjs';

test('live Partner workspace uses the current session and real local schema', async () => {
  const { target } = await preflight();
  await withFixture(`partner-qa-${randomUUID()}`, async ({ namespace, token }) => {
    const get = async path => {
      const response = await fetch(`${target.backend}${path}`, {
        headers: { Connection: 'close', cookie: `sabalan_session=${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, body: await response.json() };
    };
    const post = async (body, authenticated = true) => {
      const response = await fetch(`${target.backend}/api/partner/workspaces/query-v2`, {
        method: 'POST', headers: { Connection: 'close', 'content-type': 'application/json',
          ...(authenticated ? { cookie: `sabalan_session=${token}` } : {}) },
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
    };

    for (const path of ['/dashboard/sales/partners', '/dashboard/sales/partner-inquiries']) {
      const availability = await get(`/api/dashboard/route-availability?path=${encodeURIComponent(path)}`);
      assert.equal(availability.status, 200);
      assert.equal(availability.body.data.allowed, false,
        'ordinary Sales workspace membership must not opt the actor into Partner rollout');
    }
    const query = { schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', limit: 20 };
    assert.equal((await post(query, false)).status, 401);
    const workspace = await post(query);
    assert.equal(workspace.status, 200);
    assert.equal(workspace.cacheControl, 'private, no-store');
    assert.equal(workspace.body.data.actorId, namespace);
    assert.equal(workspace.body.data.purpose, 'PARTNER_MANAGEMENT');
    assert.deepEqual(workspace.body.data.profiles, []);
    assert.equal((await post({ ...query, actorId: 'browser-override' })).status, 400);
  });
});
