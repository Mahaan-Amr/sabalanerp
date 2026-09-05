import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import express from 'express';
import { partnerError, type PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { createPartnerWorkspaceRouter } from '../../../backend/src/routes/partner-workspaces';

async function withServer(app: express.Express, run: (origin: string) => Promise<void>) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('Partner workspace transport authenticates and binds every query to the request actor', async () => {
  const observed: Array<{ actorId: string; input: unknown }> = [];
  const app = express();
  app.use(express.json());
  app.use('/partner/workspaces', createPartnerWorkspaceRouter({
    authenticate(request, response, next) {
      if (request.get('Authorization') !== 'Bearer integration-session') {
        response.status(401).json({ success: false });
        return;
      }
      (request as typeof request & { user?: { id: string } }).user = { id: 'responder-334' };
      next();
    },
    queryFor(request): PartnerQueryV2Port {
      const actorId = request.user!.id;
      return { async query(input) {
        observed.push({ actorId, input });
        if (input.purpose !== 'RESPONDER_WORKSPACE') {
          return { ok: false, error: partnerError('INVALID_PAYLOAD') } as never;
        }
        return { ok: true, value: {
          schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', actorId, inquiries: [],
        } } as never;
      } };
    },
  }));

  await withServer(app, async origin => {
    const unauthorized = await fetch(`${origin}/partner/workspaces/query-v2`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 20 }) });
    assert.equal(unauthorized.status, 401);
    const response = await fetch(`${origin}/partner/workspaces/query-v2`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer integration-session' },
      body: JSON.stringify({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 20 }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { success: true, data: {
      schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', actorId: 'responder-334', inquiries: [],
    } });
  });
  assert.deepEqual(observed, [{ actorId: 'responder-334', input: {
    schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 20,
  } }]);
});

test('Partner workspace transport rejects unknown fields before calling a producer', async () => {
  let called = false;
  const app = express();
  app.use(express.json());
  app.use('/partner/workspaces', createPartnerWorkspaceRouter({
    authenticate(request, _response, next) {
      (request as typeof request & { user?: { id: string } }).user = { id: 'manager-334' };
      next();
    },
    queryFor(): PartnerQueryV2Port {
      return { async query() { called = true; return { ok: false, error: partnerError('NOT_FOUND') } as never; } };
    },
  }));

  await withServer(app, async origin => {
    const response = await fetch(`${origin}/partner/workspaces/query-v2`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', role: 'ADMIN' }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, 'INVALID_PAYLOAD');
  });
  assert.equal(called, false);
});
