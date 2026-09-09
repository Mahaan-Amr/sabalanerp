import assert from "node:assert/strict";
import {
  buildReadinessCoverageSections,
  buildSupervisorDraft,
  completeReadinessBatches,
  hasCompleteEvidence,
  workflowStatusPresentation,
} from "./performanceWorkflowModel";

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

assert.deepEqual(buildReadinessCoverageSections({
  inventory: { personnelCount: 12, relationshipCount: 13, assignmentCount: 15 },
  inventoryClassifications: { EMPLOYMENT_RELATIONSHIP_MISSING: 2, EMPLOYMENT_ASSIGNMENT_MISSING: 1, RELATIONSHIP_PLANNED: 3 },
  periodEligibility: { personnelCount: 9, relationshipCount: 10, assignmentCount: 11 },
  structuralTemplateReadiness: { readyPersonnelCount: 6, readyRelationshipCount: 6, readyAssignmentCount: 7, blockedSourceCount: 4, failedSourceCount: 1 },
  cohort: { subjectCount: 5 },
  acceptedResult: { subjectCount: 4 },
  resultBadge: { subjectCount: 3 },
}), [
  { title: "موجودی پایه", items: [{ label: "پرسنل", value: 12 }, { label: "روابط استخدامی", value: 13 }, { label: "مأموریت‌ها", value: 15 }] },
  { title: "واجد شرایط در بازه", items: [{ label: "پرسنل", value: 9 }, { label: "روابط استخدامی", value: 10 }, { label: "مأموریت‌ها", value: 11 }] },
  { title: "آمادگی ساختاری و الگو", items: [{ label: "پرسنل آماده", value: 6 }, { label: "روابط آماده", value: 6 }, { label: "مأموریت آماده", value: 7 }, { label: "مانع ساختاری", value: 4 }, { label: "خطای پردازش", value: 1 }] },
  { title: "خروجی‌های مستقل", items: [{ label: "عضو گروه", value: 5 }, { label: "نتیجه پذیرفته‌شده", value: 4 }, { label: "نشان نتیجه", value: 3 }] },
  { title: "طبقه‌بندی پیوندها", items: [{ label: "بدون رابطه استخدامی", value: 2 }, { label: "بدون مأموریت", value: 1 }, { label: "رابطه برنامه‌ریزی‌شده", value: 3 }] },
]);

void (async () => {
  const observedKeys: string[] = [];
  let batch = 0;
  const completed = await completeReadinessBatches("stable-readiness-key", async (idempotencyKey) => {
    observedKeys.push(idempotencyKey);
    batch += 1;
    return { hasMore: batch < 3, run: { status: batch < 3 ? "RUNNING" : "COMPLETED" } };
  });
  assert.deepEqual(observedKeys, ["stable-readiness-key", "stable-readiness-key", "stable-readiness-key"]);
  assert.equal(completed.run.status, "COMPLETED");
  console.log("Personnel performance workflow frontend model tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
