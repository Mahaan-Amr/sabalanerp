import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';
import router from '../hr-duties';

const stack = (router as unknown as {
  stack: Array<{
    name?: string;
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> };
  }>;
}).stack;
const routes = stack.flatMap((layer) => layer.route
  ? Object.entries(layer.route.methods)
    .filter(([, enabled]) => enabled)
    .map(([method]) => ({ key: `${method.toUpperCase()} ${layer.route!.path}`, handlers: layer.route!.stack.length }))
  : []);

for (const expected of [
  'GET /workspaces/:workspaceCode/summary',
  'GET /workspaces/:workspaceCode/duties',
  'GET /workspaces/:workspaceCode/duties/:id',
  'POST /legacy-work-items/:id/duties',
  'POST /:id/respond',
  'POST /:id/reconcile',
]) assert.ok(routes.some(({ key }) => key === expected), `missing HR duty route: ${expected}`);

assert.ok(stack.some((layer) => layer.name === 'protect'), 'all HR duty routes require an authenticated session');
for (const route of routes) {
  assert.ok(route.handlers >= 2, `${route.key} must retain route-specific authorization or idempotency enforcement`);
}

const source = fs.readFileSync(path.resolve(__dirname, '../hr-duties.ts'), 'utf8');
assert.match(source, /HR_LEGACY_DUTY_ROUTING_RETIRED/, 'legacy work items cannot create live named-responsibility duties');
assert.match(source, /HR_NAMED_RESPONSIBILITY_ROUTING_RETIRED/, 'named-responsibility reconciliation cannot mutate live routing');

console.log('HR duty route tests passed.');
