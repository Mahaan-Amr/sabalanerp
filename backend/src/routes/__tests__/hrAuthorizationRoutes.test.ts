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
  'POST /workspace-grants/:id/revoke',
  'POST /feature-grants',
  'POST /feature-grants/:id/revoke',
  'POST /user-access/:userId',
  'POST /business-authorities',
  'POST /business-authorities/:id/revoke',
  'POST /responsibilities',
  'POST /responsibilities/:id/end',
  'POST /destinations',
]) assert.ok(registeredRoutes.includes(route), `missing HR authorization route: ${route}`);

for (const guardedRoute of ['/context', '/user-access/:userId', '/workspace-grants', '/feature-grants']) {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: unknown[] } }> }).stack
    .find((candidate) => candidate.route?.path === guardedRoute);
  assert.ok(layer && layer.route!.stack.length >= 2, `${guardedRoute} must retain server-side authorization middleware`);
}

for (const historicalMutation of ['/business-authorities', '/business-authorities/:id/revoke', '/responsibilities', '/responsibilities/:id/end', '/destinations']) {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }> }).stack
    .find((candidate) => candidate.route?.path === historicalMutation);
  assert.equal(layer?.route?.stack[0]?.handle.name, 'legacyAuthorizationReadOnly', `${historicalMutation} must be a read-only historical endpoint`);
}

console.log('HR authorization administration route tests passed.');
