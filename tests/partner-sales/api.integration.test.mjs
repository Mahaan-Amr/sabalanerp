import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { withFixture } from './harness/fixtures.mjs';
import { preflight } from './harness/safety.mjs';

test('internal Sales create grant permits Standard and Collaboration entry, but not edit; session identity is isolated', async () => {
  const { target } = await preflight();
  await withFixture(`partner-qa-${randomUUID()}`, async ({ namespace, token }) => {
    const get = async (path, authenticated = true) => {
      const response = await fetch(`${target.backend}${path}`, {
        headers: { Connection: 'close', ...(authenticated ? { cookie: `sabalan_session=${token}` } : {}) },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    assert.equal((await get('/api/auth/me', false)).status, 401);
    const identity = await get('/api/auth/me');
    assert.equal(identity.status, 200);
    assert.equal(identity.body.data.id, namespace);
    for (const path of ['/dashboard/sales/contracts/create', '/dashboard/sales/contracts/collaboration/create']) {
      const availability = await get(`/api/dashboard/route-availability?path=${encodeURIComponent(path)}`);
      assert.equal(availability.status, 200);
      assert.equal(availability.headers.get('cache-control'), 'private, no-store');
      assert.match(availability.headers.get('vary') || '', /Cookie/);
      assert.equal(availability.body.data.allowed, true);
    }
    const denied = await get('/api/dashboard/route-availability?path=%2Fdashboard%2Fsales%2Fcontracts%2Funowned%2Fedit');
    assert.equal(denied.body.data.allowed, false);
    assert.equal((await get('/api/dashboard/route-availability?path=%2Foutside')).status, 400);
  });
});
