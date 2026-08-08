import assert from 'node:assert/strict';
import router from '../hr';

const registeredRoutes = (router as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
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

console.log('HR redesign API route contract tests passed.');
