import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import { HR_REDESIGN_CATALOG } from '../../services/hrRedesignDataContracts';
import router, { canLinkPersonnelUserAccount, featureForPath, filterFoundationPositions, hrBaseFeatureLevelForRequest } from '../hr';
import hrHiringRouter, { hrHiringBaseFeatureLevelForRequest } from '../hr-hiring';

for (const personnelPath of ['/personnel', '/relationships/relationship-1', '/assignments/assignment-1', '/supervisor-candidates']) {
  assert.equal(featureForPath(personnelPath), 'PERSONNEL', `${personnelPath} must use the Personnel feature boundary`);
}
assert.equal(featureForPath('/operational-reference/personnel'), 'PERSONNEL', 'Personnel operational reference must use the Personnel feature boundary');
assert.equal(featureForPath('/operational-reference/recruitment'), 'RECRUITMENT_CASES', 'Recruitment operational reference must use the Recruitment Cases feature boundary');
assert.equal(hrBaseFeatureLevelForRequest('POST', '/personnel/person-1/archive'), 'VIEW');
assert.equal(hrBaseFeatureLevelForRequest('POST', '/personnel/exceptional'), 'VIEW');
assert.equal(hrBaseFeatureLevelForRequest('POST', '/personnel/person-1/work-schedule/changes/change-1/approve'), 'VIEW');
assert.equal(hrBaseFeatureLevelForRequest('PUT', '/personnel/person-1'), 'EDIT');
assert.equal(hrHiringBaseFeatureLevelForRequest('POST', '/applications'), 'VIEW');
assert.equal(hrHiringBaseFeatureLevelForRequest('POST', '/applications/app-1/decisions/HR_PRELIMINARY_APPROVAL'), 'VIEW');
assert.equal(hrHiringBaseFeatureLevelForRequest('PUT', '/applications/app-1/onboarding-tasks/task-1'), 'VIEW');
assert.equal(hrHiringBaseFeatureLevelForRequest('POST', '/authorities'), 'ADMIN');
assert.equal(hrHiringBaseFeatureLevelForRequest('POST', '/unclassified-mutation'), 'EDIT');
assert.equal(canLinkPersonnelUserAccount('USER', true), false, 'User Administration also requires an eligible system role');
assert.equal(canLinkPersonnelUserAccount('MANAGER', false), false, 'system role alone cannot cross User Administration');
assert.equal(canLinkPersonnelUserAccount('MANAGER', true), true, 'both User Administration boundaries permit account linking');

const concreteHiringPath = (path: string) => path.replace(/:[^/]+/g, 'sample');
for (const layer of (hrHiringRouter as unknown as {
  stack: Array<{ route?: { path: string | string[]; methods: Record<string, boolean> } }>;
}).stack) {
  if (!layer.route) continue;
  const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
  for (const path of paths) {
    if (path.startsWith('/public/')) continue;
    for (const method of Object.keys(layer.route.methods).filter((candidate) => candidate !== 'get')) {
      const level = hrHiringBaseFeatureLevelForRequest(method.toUpperCase(), concreteHiringPath(path));
      assert.notEqual(level, 'EDIT', `${method.toUpperCase()} ${path} must be explicitly classified as action-protected or administrative`);
    }
  }
}

const registeredRoutes = (router as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.flatMap((layer) => layer.route
  ? Object.entries(layer.route.methods)
    .filter(([, enabled]) => enabled)
    .map(([method]) => `${method.toUpperCase()} ${layer.route!.path}`)
  : []);

for (const route of [
  'GET /redesign/data-contracts',
  'GET /redesign/compatibility/access/:userId',
  'GET /redesign/compatibility/positions',
  'GET /redesign/compatibility/work-items',
  'GET /redesign/compatibility/applications/:applicationId/assessments',
  'GET /migration/redesign-preview',
  'POST /migration/redesign-backfill',
  'GET /migration/reconciliation',
  'POST /migration/reconciliation/:id/reviews',
]) assert.ok(registeredRoutes.includes(route), `missing HR redesign API route: ${route}`);

for (const route of [
  'GET /operational-reference/:surface',
  'GET /positions',
  'GET /positions/capacity-summary',
  'GET /positions/:id/history',
  'POST /positions/:id/capacity-changes',
  'GET /foundation/:entityType/:id/dependencies',
  'POST /foundation/:entityType/:id/lifecycle',
  'DELETE /foundation/:entityType/:id/permanent',
]) assert.ok(registeredRoutes.includes(route), `missing lifecycle-safe organization route: ${route}`);

const drilldownPositions = [
  { id: 'p1', supervisorPositionId: 's1', organizationalUnitId: 'u1', jobId: 'j1', workplaceId: 'w1', costCenterId: 'c1', isActive: true, capacityBreakdown: { vacancy: 0, inUse: 1, reservedForStart: 0, acting: 0, ended: 0, future: 0 }, _count: { subordinatePositions: 0 } },
  { id: 'p2', supervisorPositionId: null, organizationalUnitId: 'u2', jobId: 'j2', workplaceId: null, costCenterId: null, isActive: true, capacityBreakdown: { vacancy: 1, inUse: 0, reservedForStart: 0, acting: 0, ended: 0, future: 0 }, _count: { subordinatePositions: 0 } },
] as any;
for (const filter of ['supervisor:s1', 'organizational-unit:u1', 'job:j1', 'workplace:w1', 'cost_center:c1']) {
  assert.deepEqual(filterFoundationPositions(drilldownPositions, filter).map((position) => position.id), ['p1'], `${filter} must be server-filtered`);
}

for (const legacyRoute of [
  'GET /migration/preview',
  'GET /migration/records/:category',
  'POST /migration/apply',
]) assert.ok(registeredRoutes.includes(legacyRoute), `legacy HR compatibility route changed: ${legacyRoute}`);

for (const governedRoute of [
  '/personnel/:id/archive',
  '/personnel/:id/restore',
  '/personnel/exceptional',
  '/personnel/:id/work-schedule/changes/:changeId/prepare',
  '/personnel/:id/work-schedule/changes/:changeId/submit',
  '/personnel/:id/work-schedule/changes/:changeId/return',
  '/personnel/:id/work-schedule/changes/:changeId/approve',
]) {
  const route = (router as unknown as { stack: Array<{ route?: { path: string; stack: unknown[] } }> }).stack
    .find((layer) => layer.route?.path === governedRoute)?.route;
  assert.ok(route && route.stack.length >= 3, `${governedRoute} must enforce authority/responsibility server-side`);
}

assert.ok(
  registeredRoutes.includes('GET /personnel/:id/work-schedule'),
  'schedule details must be fetched only from the explicit disclosure route',
);

const dataContractsLayer = (router as unknown as {
  stack: Array<{ route?: { path: string; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.find((layer) => layer.route?.path === '/redesign/data-contracts')?.route;
assert.ok(dataContractsLayer, 'data-contract endpoint must be registered');
let statusCode = 200;
let responseBody: unknown;
const response = {
  status(code: number) { statusCode = code; return this; },
  json(body: unknown) { responseBody = body; return this; },
};
const handlerResult = dataContractsLayer.stack.at(-1)!.handle(
  {} as never,
  response as never,
  (() => undefined) as never,
);
assert.equal(handlerResult, undefined);
assert.equal(statusCode, 200);
assert.deepEqual(responseBody, { success: true, data: HR_REDESIGN_CATALOG });

console.log('HR redesign API and compatibility route tests passed.');
