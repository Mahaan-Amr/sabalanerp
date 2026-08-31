import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import router, { projectPersonnelPerformanceCapabilities } from '../personnel-performance';

const registeredRoutes = (router as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.flatMap((layer) => layer.route
  ? Object.entries(layer.route.methods)
    .filter(([, enabled]) => enabled)
    .map(([method]) => `${method.toUpperCase()} ${layer.route!.path}`)
  : []);

assert.deepEqual(registeredRoutes, ['GET /capabilities', 'GET /rollout']);

const rolloutLayer = (router as unknown as {
  stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.find((layer) => layer.route?.path === '/rollout');
assert.ok(rolloutLayer && rolloutLayer.route!.stack.length >= 2, 'rollout metadata must retain server-side authorization middleware');

assert.deepEqual(projectPersonnelPerformanceCapabilities([
  'PERSONNEL',
  'VIEW_PERFORMANCE_HISTORY',
  'VIEW_NAMED_PERFORMANCE_RANKING',
  'RECORD_INITIAL_INTERVIEW',
]), {
  VIEW_PERFORMANCE_HISTORY: true,
  VIEW_NAMED_PERFORMANCE_RANKING: true,
});
assert.deepEqual(projectPersonnelPerformanceCapabilities([]), {});

console.log('Personnel performance route contract tests passed.');
