import assert from "node:assert/strict";
import {
  assertFinalRejectionAuthority,
  assertGuidedHrInterviewEvidence,
  authorizeFormalAssessmentResultCommand,
  GUIDED_HR_INTERVIEW_CRITERION_IDS,
  normalizeFormalAssessmentPlanCommand,
  projectFormalAssessmentEvidenceGate,
} from "../hrFormalAssessmentPolicy";

assert.deepEqual(normalizeFormalAssessmentPlanCommand({
  explicitlyNoAssessment: true,
  selections: [],
  reason: "برای این جایگاه لازم نیست",
}, false), {
  explicitlyNoAssessment: true,
  executionMethod: null,
  selections: [],
  repeatKinds: [],
  reason: "برای این جایگاه لازم نیست",
});

assert.deepEqual(normalizeFormalAssessmentPlanCommand({
  explicitlyNoAssessment: false,
  executionMethod: "COMPANY",
  selections: [
    { assessmentKind: "DISC" },
    { assessmentKind: "EQ" },
  ],
  repeatKinds: ["EQ"],
  reason: "دامنه ارزیابی اصلاح شد",
}, true).selections, [
  { assessmentKind: "DISC", executionMethod: "COMPANY" },
  { assessmentKind: "EQ", executionMethod: "COMPANY" },
]);

assert.throws(() => normalizeFormalAssessmentPlanCommand({
  explicitlyNoAssessment: false,
  selections: [
    { assessmentKind: "DISC", executionMethod: "APPLICANT" },
    { assessmentKind: "EQ", executionMethod: "COMPANY" },
  ],
}, false), /one package execution method/i);

assert.throws(
  () => normalizeFormalAssessmentPlanCommand({ explicitlyNoAssessment: false, selections: [] }, false),
  /explicit decision/i,
);
assert.throws(
  () => normalizeFormalAssessmentPlanCommand({
    explicitlyNoAssessment: true,
    selections: [{ assessmentKind: "DISC", executionMethod: "COMPANY" }],
  }, false),
  /cannot contain selections/i,
);
assert.throws(
  () => normalizeFormalAssessmentPlanCommand({
    explicitlyNoAssessment: false,
    selections: [{ assessmentKind: "DISC", executionMethod: "APPLICANT" }],
  }, true),
  /reason is required/i,
);

assert.equal(authorizeFormalAssessmentResultCommand({
  executionMethod: "APPLICANT",
  actorKind: "APPLICANT",
  actorAuthorities: [],
  hasCompletedResult: false,
  correctionReason: "",
}), "CREATE_INITIAL");
assert.equal(authorizeFormalAssessmentResultCommand({
  executionMethod: "COMPANY",
  actorKind: "USER",
  actorAuthorities: ["HR_PROCESSOR"],
  hasCompletedResult: false,
  correctionReason: "",
}), "CREATE_INITIAL");
assert.equal(authorizeFormalAssessmentResultCommand({
  executionMethod: "COMPANY",
  actorKind: "USER",
  actorAuthorities: ["HR_MANAGER"],
  hasCompletedResult: true,
  correctionReason: "نتیجه منبع اصلاح شد",
}), "CREATE_CORRECTION");
assert.throws(() => authorizeFormalAssessmentResultCommand({
  executionMethod: "COMPANY",
  actorKind: "USER",
  actorAuthorities: ["HR_PROCESSOR"],
  hasCompletedResult: true,
  correctionReason: "",
}), /HR Manager/i);

assert.doesNotThrow(() => assertFinalRejectionAuthority(["HR_MANAGER"]));
assert.doesNotThrow(() => assertFinalRejectionAuthority(["COMPANY_MANAGER"]));
assert.throws(() => assertFinalRejectionAuthority(["HR_PROCESSOR"]), /not authorized/i);

const guidedCriteria = GUIDED_HR_INTERVIEW_CRITERION_IDS.map((criterionId, index) => ({
  criterionId,
  order: index + 1,
  score: index === GUIDED_HR_INTERVIEW_CRITERION_IDS.length - 1 ? "UNASSESSED" : 3,
}));
assert.doesNotThrow(() => assertGuidedHrInterviewEvidence({
  criteria: guidedCriteria,
  finalCriterionId: "companion",
  finalCriterionScore: "UNASSESSED",
}));
assert.throws(() => assertGuidedHrInterviewEvidence({
  criteria: guidedCriteria.map((criterion, index) => index === 0 ? { ...criterion, criterionId: "invented" } : criterion),
  finalCriterionId: "companion",
  finalCriterionScore: "UNASSESSED",
}), /canonical criteria/i);

const revisedEvidence = projectFormalAssessmentEvidenceGate([
  {
    version: 2,
    status: "ACTIVE",
    explicitlyNoAssessment: false,
    selections: [{ assessmentKind: "DISC", selected: true, executionMethod: "APPLICANT" }],
    results: [],
  },
  {
    version: 1,
    status: "SUPERSEDED",
    explicitlyNoAssessment: false,
    results: [{ assessmentKind: "DISC", resultVersion: 1, status: "COMPLETED" }],
  },
]);
assert.equal(revisedEvidence.complete, true);
assert.deepEqual(revisedEvidence.completedKinds, ["DISC"]);

console.log("HR formal-assessment policy tests passed.");
