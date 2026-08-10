import assert from "node:assert/strict";
import type { RequestHandler } from "express";
import router from "../hr-hiring";

const routes = (router as unknown as {
  stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }>;
}).stack.flatMap((layer) => layer.route
  ? Object.entries(layer.route.methods)
    .filter(([, enabled]) => enabled)
    .map(([method]) => ({ key: `${method.toUpperCase()} ${layer.route!.path}`, stack: layer.route!.stack }))
  : []);

for (const expected of [
  "POST /applications/:id/formal-assessment-plans",
  "POST /applications/:id/formal-assessments/:kind/result",
  "POST /public/application/formal-assessments/:kind/result",
  "POST /applications/:id/final-rejection",
]) {
  assert.ok(routes.some(({ key }) => key === expected), `missing formal-assessment API route: ${expected}`);
}

assert.ok(
  routes.find(({ key }) => key === "POST /public/application/formal-assessments/:kind/result")!.stack.length >= 2,
  "Applicant result submission must enforce the authenticated Applicant-session boundary",
);
assert.ok(
  routes.find(({ key }) => key === "POST /applications/:id/formal-assessment-plans")!.stack.length >= 2,
  "Plan finalization must enforce Company Manager authority before its command handler",
);

console.log("HR formal-assessment API route tests passed.");
