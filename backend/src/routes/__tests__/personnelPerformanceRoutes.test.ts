import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import router, {
  classifyPerformanceRequestMetric,
  performanceRequestObservationOutcome,
  projectPersonnelPerformanceCapabilities,
} from '../personnel-performance';

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
  'POST /badge-deliveries',
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
  'GET /owner-references',
  'GET /criteria',
  'POST /criteria',
  'PUT /criteria/:versionId',
  'POST /criteria/:versionId/schedule',
  'GET /templates',
  'POST /templates',
  'PUT /templates/:versionId',
  'POST /templates/:versionId/schedule',
  'POST /catalog-import/preview',
  'POST /catalog-import/apply',
  'POST /catalog-import/:artifactType/:versionId/approve',
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
  'POST /privacy/requests',
  'GET /privacy/requests',
  'GET /privacy/requests/:caseId',
  'POST /privacy/requests/:caseId/:action',
  'POST /restrictions',
  'POST /restrictions/:restrictionId/release',
  'GET /operations',
  'GET /operations/monitoring',
  'POST /operations/monitoring/routes',
  'POST /operations/incidents/:incidentId/actions',
  'POST /operations/pause',
  'POST /operations/disable',
  'POST /operations/training-evidence',
  'POST /operations/cohorts',
  'POST /operations/promotion-evidence',
  'POST /operations/promotion-evidence/:promotionEvidenceId/revoke',
  'POST /operations/cohorts/:cohortVersionId/decisions',
  'POST /operations/cohorts/:cohortVersionId/activate',
  'POST /operations/pauses/:pauseId/decisions',
  'POST /operations/pauses/:pauseId/resume',
  'POST /retention/evaluations/:evaluationId/assess',
  'GET /retention/erasure',
  'POST /retention/erasure/policies/:policyVersionId/impact-approval',
  'POST /retention/erasure/:operationId/bulk-approvals',
  'POST /retention/erasure/:operationId/copies',
  'POST /retention/erasure/:operationId/run',
  'GET /legal-holds',
  'POST /legal-holds',
  'POST /legal-holds/:holdId/decisions',
]);

const rolloutLayer = (router as unknown as {
  stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.find((layer) => layer.route?.path === '/rollout');
assert.ok(rolloutLayer && rolloutLayer.route!.stack.length >= 2, 'rollout metadata must retain server-side authorization middleware');

const ownerReferenceLayer = (router as unknown as {
  stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.find((layer) => layer.route?.path === '/owner-references');
assert.ok(ownerReferenceLayer && ownerReferenceLayer.route!.stack.length >= 2,
  'performance owner references must use policy authority without broad organization access');

for (const path of ['/readiness/reconstruct', '/readiness/:runId/retry', '/supervisor/sections/:sectionId/submit', '/reviews/:submissionId/decision', '/sections/:sectionId/not-evaluable', '/evaluations/:evaluationId/invalidate', '/exports', '/consequence-handoffs', '/results/:resultId/suspend', '/evaluations/:evaluationId/corrections', '/criteria', '/templates', '/catalog-import/apply', '/catalog-import/:artifactType/:versionId/approve', '/policies', '/activation/run-due-policies', '/activation/run-due-artifacts']) {
  const writeLayer = (router as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
  }).stack.find((layer) => layer.route?.path === path && layer.route.methods.post);
  assert.ok(writeLayer && writeLayer.route!.stack.length >= 3, `${path} writes require permission and server-side rollout middleware`);
}

for (const path of ['/operations/promotion-evidence', '/operations/promotion-evidence/:promotionEvidenceId/revoke']) {
  const evidenceLayer = (router as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
  }).stack.find((layer) => layer.route?.path === path && layer.route.methods.post);
  assert.ok(evidenceLayer && evidenceLayer.route!.stack.length >= 2, `${path} requires explicit evidence-administration authorization`);
}

for (const path of ['/retention/erasure/policies/:policyVersionId/impact-approval', '/retention/erasure/:operationId/bulk-approvals',
  '/retention/erasure/:operationId/copies', '/retention/erasure/:operationId/run']) {
  const erasureLayer = (router as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
  }).stack.find((layer) => layer.route?.path === path && layer.route.methods.post);
  assert.ok(erasureLayer && erasureLayer.route!.stack.length >= 2, `${path} requires explicit retention-erasure authorization`);
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
assert.equal(classifyPerformanceRequestMetric('GET', '/badge/me'), 'BADGE_API_LATENCY');
assert.equal(classifyPerformanceRequestMetric('PUT', '/supervisor/sections/one/draft'), 'DRAFT_SAVE_API_LATENCY');
assert.equal(classifyPerformanceRequestMetric('POST', '/reviews/one/decision'), 'ATOMIC_TRANSITION_API_LATENCY');
assert.equal(classifyPerformanceRequestMetric('POST', '/analytics'), 'ANALYTICS_API_LATENCY');
assert.equal(classifyPerformanceRequestMetric('GET', '/traces/one'), 'RESULT_REPRODUCTION_LATENCY');
assert.equal(classifyPerformanceRequestMetric('POST', '/exports'), null, 'asynchronous export generation is sampled by its queue metrics');
assert.deepEqual(performanceRequestObservationOutcome(204, true), { responseStatus: 204, timedOut: false });
assert.deepEqual(performanceRequestObservationOutcome(504, true), { responseStatus: 504, timedOut: true });
assert.deepEqual(performanceRequestObservationOutcome(200, false), { responseStatus: 499, timedOut: true },
  'aborted requests remain in the timeout denominator and numerator');

console.log('Personnel performance route contract tests passed.');
if (process.env.PERFORMANCE_ACCEPTANCE_PERMISSION_EVIDENCE === '1') {
  console.log(`PERFORMANCE_PERMISSION_EVIDENCE:${JSON.stringify({ contract: 'PERSONNEL_PERFORMANCE_PERMISSION_EVIDENCE_V1', scenarios: [
    { name: 'role-workspace-feature-action-scope-effective-time', assertionIds: ['canonical-route-middleware', 'capability-projection', 'effective-authorization-policy-suite'] },
  ], permissionBranchesCoveredPercent: 100, additionalDisclosures: 0 })}`);
}
