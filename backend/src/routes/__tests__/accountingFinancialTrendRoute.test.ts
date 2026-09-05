import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestHandler } from 'express';
import router, { createAccountingFinancialTrendResponse } from '../accounting';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
};

const layers = (router as unknown as { stack: RouteLayer[] }).stack;
const route = (path: string) => layers.find((layer) => layer.route?.path === path)?.route;

test('financial trend API is authenticated with the same accounting-view permission scope as the workspace', () => {
  const workspace = route('/workspace');
  const trend = route('/financial-trend');
  assert.ok(workspace);
  assert.ok(trend);
  assert.equal(trend.methods.get, true);
  assert.equal(trend.stack.length, 4);
  assert.deepEqual(
    trend.stack.slice(0, 3).map((layer) => layer.handle),
    workspace.stack.slice(0, 3).map((layer) => layer.handle),
  );
});

test('financial trend handler returns the requested serialized series payload', async () => {
  const data = { range: '3m', currency: 'RIAL', points: [{ periodKey: '1405-05', invoicedRial: 100 }] };
  let requestedRange: unknown;
  let requestedActor: unknown;
  let responseBody: unknown;
  const handler = createAccountingFinancialTrendResponse(async (range, _now, actor) => {
    requestedRange = range;
    requestedActor = actor;
    return data as never;
  });
  await handler(
    { query: { range: '3m' }, user: { id: 'authenticated-accountant' } } as never,
    { json(body: unknown) { responseBody = body; return this; }, status() { return this; } } as never,
  );
  assert.equal(requestedRange, '3m');
  assert.deepEqual(requestedActor, { userId: 'authenticated-accountant' });
  assert.deepEqual(responseBody, { success: true, data });
});
