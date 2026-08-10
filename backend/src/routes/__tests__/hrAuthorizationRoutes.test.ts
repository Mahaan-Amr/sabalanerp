import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import router from '../hr-authorization';

const registeredRoutes = (router as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.flatMap((layer) => layer.route
  ? Object.entries(layer.route.methods)
    .filter(([, enabled]) => enabled)
    .map(([method]) => `${method.toUpperCase()} ${layer.route!.path}`)
  : []);

for (const route of [
  'GET /me',
  'GET /context',
  'POST /workspace-grants',
  'POST /feature-grants',
  'POST /business-authorities',
  'POST /business-authorities/:id/revoke',
  'POST /responsibilities',
  'POST /responsibilities/:id/end',
  'POST /destinations',
]) assert.ok(registeredRoutes.includes(route), `missing HR authorization route: ${route}`);

for (const guardedRoute of ['/context', '/workspace-grants', '/feature-grants', '/business-authorities', '/responsibilities', '/destinations']) {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: unknown[] } }> }).stack
    .find((candidate) => candidate.route?.path === guardedRoute);
  assert.ok(layer && layer.route!.stack.length >= 2, `${guardedRoute} must retain server-side authorization middleware`);
}

console.log('HR authorization administration route tests passed.');
