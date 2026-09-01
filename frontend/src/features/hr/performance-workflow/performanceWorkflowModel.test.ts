import assert from "node:assert/strict";
import { buildSupervisorDraft, hasCompleteEvidence, workflowStatusPresentation } from "./performanceWorkflowModel";

assert.deepEqual(workflowStatusPresentation("REJECTED"), { label: "نیازمند اصلاح", tone: "danger" });
assert.deepEqual(workflowStatusPresentation("ACCEPTED"), { label: "پذیرفته‌شده", tone: "success" });

assert.deepEqual(buildSupervisorDraft({
  narrative: "جمع‌بندی رفتاری دوره",
  responses: {
    "criterion-1": {
      grade: 4,
      evidenceKind: "STRUCTURED_OBSERVATION",
      evidenceQuality: "RELIABLE",
      evidenceReference: "OBS-1405-12",
      sourceVersion: "1",
      occurredAt: "2026-03-01T08:00:00.000Z",
      contentHash: "a".repeat(64),
    },
  },
}), {
  narrative: "جمع‌بندی رفتاری دوره",
  responses: [{
    criterionVersionId: "criterion-1",
    grade: 4,
    evidence: [{
      kind: "STRUCTURED_OBSERVATION",
      quality: "RELIABLE",
      referenceId: "OBS-1405-12",
      sourceVersion: "1",
      occurredAt: "2026-03-01T08:00:00.000Z",
      contentHash: "a".repeat(64),
    }],
  }],
});

const completeEvidence = {
  evidenceKind: "STRUCTURED_OBSERVATION" as const,
  evidenceQuality: "RELIABLE" as const,
  evidenceReference: "OBS-42",
  sourceVersion: "3",
  occurredAt: "2026-08-31T12:30",
  contentHash: "a".repeat(64),
};
assert.equal(hasCompleteEvidence(completeEvidence), true);
assert.equal(hasCompleteEvidence({ ...completeEvidence, sourceVersion: "" }), false);
assert.equal(hasCompleteEvidence({ ...completeEvidence, contentHash: "abc" }), false);

console.log("Personnel performance workflow frontend model tests passed.");
