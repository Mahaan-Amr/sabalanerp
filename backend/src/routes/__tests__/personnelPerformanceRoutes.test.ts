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

assert.deepEqual(registeredRoutes, [
  'POST /compensation-agreements',
  'GET /capabilities',
  'GET /rollout',
  'POST /readiness/reconstruct',
  'GET /readiness/:runId',
  'POST /readiness/:runId/retry',
  'GET /supervisor/sections',
  'GET /supervisor/sections/:sectionId',
  'PUT /supervisor/sections/:sectionId/draft',
  'POST /supervisor/sections/:sectionId/submit',
  'GET /reviews',
  'GET /lifecycle/sections',
  'GET /reviews/:submissionId',
  'POST /reviews/:submissionId/claim',
  'POST /reviews/:submissionId/decision',
  'POST /sections/:sectionId/not-evaluable',
  'POST /sections/:sectionId/extend',
  'POST /evaluations/:evaluationId/cancel',
  'POST /evaluations/:evaluationId/invalidate',
  'POST /reminders/run',
  'GET /badge/me',
  'POST /badges',
  'GET /history/:personnelId',
  'POST /analytics',
  'POST /ranking',
  'GET /calibration/evaluators',
  'POST /calibration',
  'POST /exports',
  'GET /exports/:exportId',
  'GET /exports/:exportId/download',
  'POST /consequence-handoffs',
  'GET /consequence-handoffs/eligible-results/:personnelId',
  'GET /consequence-handoffs/:handoffId',
  'POST /results/:resultId/suspend',
  'POST /evaluations/:evaluationId/corrections',
  'GET /criteria',
  'POST /criteria',
  'PUT /criteria/:versionId',
  'POST /criteria/:versionId/schedule',
  'GET /templates',
  'POST /templates',
  'PUT /templates/:versionId',
  'POST /templates/:versionId/schedule',
  'GET /policies',
  'POST /policies',
  'PUT /policies/:versionId',
  'POST /policies/:versionId/preview',
  'POST /policies/:versionId/schedule',
  'POST /:artifactType/:versionId/cancel',
  'POST /:artifactType/:versionId/retire',
  'POST /activation/run-due-policies',
  'POST /activation/run-due-artifacts',
  'GET /traces/:traceId',
]);

const rolloutLayer = (router as unknown as {
  stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.find((layer) => layer.route?.path === '/rollout');
assert.ok(rolloutLayer && rolloutLayer.route!.stack.length >= 2, 'rollout metadata must retain server-side authorization middleware');

for (const path of ['/readiness/reconstruct', '/readiness/:runId/retry', '/supervisor/sections/:sectionId/submit', '/reviews/:submissionId/decision', '/sections/:sectionId/not-evaluable', '/evaluations/:evaluationId/invalidate', '/exports', '/consequence-handoffs', '/results/:resultId/suspend', '/evaluations/:evaluationId/corrections', '/criteria', '/templates', '/policies', '/activation/run-due-policies', '/activation/run-due-artifacts']) {
  const writeLayer = (router as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
  }).stack.find((layer) => layer.route?.path === path && layer.route.methods.post);
  assert.ok(writeLayer && writeLayer.route!.stack.length >= 3, `${path} writes require permission and server-side rollout middleware`);
}

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
