import assert from 'node:assert/strict';
import type { RequestHandler } from 'express';
import { HR_REDESIGN_CATALOG } from '../../services/hrRedesignDataContracts';
import router, { featureForPath } from '../hr';

for (const personnelPath of ['/personnel', '/relationships/relationship-1', '/assignments/assignment-1', '/supervisor-candidates']) {
  assert.equal(featureForPath(personnelPath), 'PERSONNEL', `${personnelPath} must use the Personnel feature boundary`);
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
]) assert.ok(registeredRoutes.includes(route), `missing HR redesign API route: ${route}`);

for (const legacyRoute of [
  'GET /migration/preview',
  'GET /migration/records/:category',
  'POST /migration/apply',
]) assert.ok(registeredRoutes.includes(legacyRoute), `legacy HR compatibility route changed: ${legacyRoute}`);

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
