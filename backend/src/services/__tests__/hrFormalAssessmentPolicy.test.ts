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

assert.throws(
  () => normalizeFormalAssessmentPlanCommand({
    explicitlyNoAssessment: false,
    selections: [
      { assessmentKind: "DISC", executionMethod: "APPLICANT" },
      { assessmentKind: "EQ", executionMethod: "COMPANY" },
    ],
  }, false),
  /same execution method/i,
);

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
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  state: {
    answers: Object.fromEntries(GUIDED_HR_INTERVIEW_CRITERION_IDS.map((criterionId) => [criterionId, {}])),
    decision: "POSITIVE",
    decisionReason: "Prototype payload must not bypass canonical score validation.",
  },
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID" && error?.target === "snapshot");
const schemaTwoCriteria = GUIDED_HR_INTERVIEW_CRITERION_IDS.map((stableId, index) => ({
  stableId,
  order: index + 1,
  title: `Criterion ${index + 1}`,
  answerType: "SCORE_1_TO_5",
  isActive: true,
  allowUnassessed: false,
}));
const schemaTwoAnswers = Object.fromEntries(GUIDED_HR_INTERVIEW_CRITERION_IDS.map((criterionId) => [criterionId, {
  score: 3,
  text: "",
  note: "",
  judgment: null,
  companionPresent: null,
  strengths: [],
  weaknesses: [],
}]));
assert.doesNotThrow(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: {
    answers: schemaTwoAnswers,
    decision: "POSITIVE",
    decisionReason: "Valid schema-two interview evidence.",
  },
  customCriteria: [
    { id: "custom-text", title: "Custom text", kind: "text", score: null, text: "Recorded answer", yesNo: null },
  ],
}));
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: {
    answers: { ...schemaTwoAnswers, appearance: { ...schemaTwoAnswers.appearance, score: null } },
    decision: "POSITIVE",
    decisionReason: "Invalid criterion should be identified.",
  },
  customCriteria: [],
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID"
  && error?.target === "criterion"
  && error?.criterionId === "appearance"
  && /Criterion 1/.test(error.message));
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: {
    answers: schemaTwoAnswers,
    decision: "POSITIVE",
    decisionReason: "Invalid custom criterion should be identified.",
  },
  customCriteria: [
    { id: "custom-text", title: "Custom text", kind: "text", score: null, text: "", yesNo: null },
  ],
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID"
  && error?.target === "custom-criterion"
  && error?.criterionId === "custom-text"
  && /Custom text/.test(error.message));
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 3,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: { answers: schemaTwoAnswers, decision: "POSITIVE", decisionReason: "Unknown evidence version." },
  customCriteria: [],
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID" && error?.target === "snapshot");
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: { answers: schemaTwoAnswers, decision: "POSITIVE", decisionReason: "Malformed custom criteria must fail closed." },
  customCriteria: { id: "not-an-array" },
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID" && error?.target === "snapshot");
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: { answers: schemaTwoAnswers, decision: "POSITIVE", decisionReason: "Mismatched frozen criteria version." },
  customCriteria: [],
}, 2), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID" && error?.target === "snapshot");
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria.map((criterion, index) => index === 1
    ? { ...criterion, stableId: "", isActive: false }
    : criterion),
  state: { answers: schemaTwoAnswers, decision: "POSITIVE", decisionReason: "Malformed inactive criteria must fail closed." },
  customCriteria: [],
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID" && error?.target === "snapshot");
for (const malformedCriteria of [
  schemaTwoCriteria.map((criterion, index) => index === 0 ? { ...criterion, order: "1" } : criterion),
  schemaTwoCriteria.map((criterion, index) => index === 1 ? { ...criterion, order: 20 } : criterion),
  schemaTwoCriteria.map((criterion, index) => index === 0 ? { ...criterion, isActive: "yes" } : criterion),
  schemaTwoCriteria.map((criterion, index) => index === 0 ? { ...criterion, allowUnassessed: "false" } : criterion),
  schemaTwoCriteria.map((criterion, index) => index === 0 ? { ...criterion, stableId: 123 } : criterion),
  schemaTwoCriteria.map((criterion, index) => index === 0 ? { ...criterion, stableId: ` ${criterion.stableId}` } : criterion),
]) {
  assert.throws(() => assertGuidedHrInterviewEvidence({
    schemaVersion: 2,
    criteriaTemplateVersion: 1,
    criteriaSnapshot: malformedCriteria,
    state: { answers: schemaTwoAnswers, decision: "POSITIVE", decisionReason: "Malformed snapshot must fail closed." },
    customCriteria: [],
  }), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID" && error?.target === "snapshot");
}
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: { answers: schemaTwoAnswers, decision: "POSITIVE", decisionReason: "Duplicate custom criteria must fail closed." },
  customCriteria: [
    { id: "duplicate", title: "First", kind: "text", text: "One" },
    { id: "duplicate", title: "Second", kind: "text", text: "Two" },
  ],
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID" && error?.target === "custom-criterion");
assert.throws(() => assertGuidedHrInterviewEvidence({
  schemaVersion: 2,
  criteriaTemplateVersion: 1,
  criteriaSnapshot: schemaTwoCriteria,
  state: { answers: schemaTwoAnswers, decision: "POSITIVE", decisionReason: "Non-canonical custom ID must fail closed." },
  customCriteria: [{ id: " custom", title: "Custom", kind: "text", text: "Answer" }],
}), (error: any) => error?.code === "HR_INTERVIEW_EVIDENCE_INVALID"
  && error?.target === "custom-criterion"
  && error?.criterionId === undefined);

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
