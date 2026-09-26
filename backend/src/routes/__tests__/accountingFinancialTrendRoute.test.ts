import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestHandler } from 'express';
import router, { createAccountingDashboardResponse, createAccountingFinancialTrendResponse } from '../accounting';

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
  let cacheControl: unknown;
  const handler = createAccountingFinancialTrendResponse(async (range, _now, actor) => {
    requestedRange = range;
    requestedActor = actor;
    return data as never;
  });
  await handler(
    { query: { range: '3m' }, user: { id: 'authenticated-accountant' } } as never,
    { json(body: unknown) { responseBody = body; return this; }, status() { return this; },
      set(name: string, value: string) { if (name === 'Cache-Control') cacheControl = value; return this; } } as never,
  );
  assert.equal(requestedRange, '3m');
  assert.deepEqual(requestedActor, { userId: 'authenticated-accountant' });
  assert.deepEqual(responseBody, { success: true, data });
  assert.equal(cacheControl, 'private, no-store');
});

test('complete dashboard uses the accounting view permission and passes one actor and chart range', async () => {
  const workspace = route('/workspace');
  const dashboard = route('/dashboard');
  assert.ok(workspace);
  assert.ok(dashboard);
  assert.deepEqual(dashboard.stack.slice(0, 3).map((layer) => layer.handle), workspace.stack.slice(0, 3).map((layer) => layer.handle));
  let requested: unknown;
  let responseBody: unknown;
  let cacheControl: unknown;
  const data = { workspace: { commandCenter: {} }, trend: { range: '1y', points: [] }, trendError: false };
  const handler = createAccountingDashboardResponse(async (query, range, _now, actor) => {
    requested = { query, range, actor };
    return data as never;
  });
  await handler(
    { query: { range: '1y', due: 'overdue' }, user: { id: 'accountant-1' } } as never,
    { json(body: unknown) { responseBody = body; return this; }, status() { return this; },
      set(name: string, value: string) { if (name === 'Cache-Control') cacheControl = value; return this; } } as never,
  );
  assert.deepEqual(requested, { query: { range: '1y', due: 'overdue' }, range: '1y', actor: { userId: 'accountant-1' } });
  assert.deepEqual(responseBody, { success: true, data });
  assert.equal(cacheControl, 'private, no-store');
});
