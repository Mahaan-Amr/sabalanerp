import assert from "node:assert/strict";
import type { RequestHandler } from "express";
import router, {
  initialInterviewCompletionErrorResponse,
  initialInterviewCompletionTransactionError,
  initialInterviewTrackingId,
} from "../hr-hiring";

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

assert.deepEqual(
  initialInterviewCompletionErrorResponse(Object.assign(new Error("پاسخ معیار «صداقت» کامل نیست. این معیار را بررسی کنید."), {
    code: "HR_INTERVIEW_EVIDENCE_INVALID",
    target: "criterion",
    criterionId: "honesty",
    isOperational: true,
  }), "request-123"),
  {
    success: false,
    code: "HR_INTERVIEW_EVIDENCE_INVALID",
    error: "پاسخ معیار «صداقت» کامل نیست. این معیار را بررسی کنید.",
    target: "criterion",
    criterionId: "honesty",
  },
  "completion validation errors must retain their safe operational target",
);
assert.deepEqual(
  initialInterviewCompletionErrorResponse(Object.assign(new Error("نسخه معیارهای این مصاحبه قابل اعتبارسنجی نیست. اطلاعات حفظ شده است؛ با پشتیبانی تماس بگیرید."), {
    code: "HR_INTERVIEW_EVIDENCE_INVALID",
    target: "snapshot",
    isOperational: true,
  }), "request-123"),
  {
    success: false,
    code: "HR_INTERVIEW_EVIDENCE_INVALID",
    error: "نسخه معیارهای این مصاحبه قابل اعتبارسنجی نیست. اطلاعات حفظ شده است؛ با پشتیبانی تماس بگیرید. کد پیگیری: request-123",
    target: "snapshot",
    trackingId: "request-123",
  },
  "snapshot failures must provide a safe support tracking identifier",
);
assert.equal(
  initialInterviewCompletionErrorResponse(Object.assign(new Error("internal"), {
    code: "HR_INTERVIEW_EVIDENCE_INVALID",
    target: "snapshot",
  }), "request-123"),
  null,
  "untrusted errors must not be exposed as operational interview failures",
);
assert.equal(initialInterviewTrackingId("request-123", "fallback-id"), "request-123");
assert.equal(initialInterviewTrackingId("unsafe tracking id with spaces", "fallback-id"), "fallback-id");
assert.equal(initialInterviewTrackingId("x".repeat(100), "fallback-id"), "fallback-id");
assert.match(initialInterviewCompletionTransactionError({ code: "P2034" }).message, /اطلاعات حفظ شده است/);
assert.equal(initialInterviewCompletionTransactionError({ code: "P2034" }).statusCode, 409);
const unrelatedTransactionError = new Error("unrelated");
assert.equal(initialInterviewCompletionTransactionError(unrelatedTransactionError), unrelatedTransactionError);

console.log("HR formal-assessment API route tests passed.");
