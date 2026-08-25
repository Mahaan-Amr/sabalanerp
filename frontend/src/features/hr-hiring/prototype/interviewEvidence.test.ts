import assert from "node:assert/strict";
import {
  customCriteriaAreComplete,
  InterviewSnapshotError,
  normalizeInitialInterviewPayload,
  publishedCriteriaForInterview,
  type PublishedInterviewCriterion,
} from "./interviewEvidence";

const snapshot: PublishedInterviewCriterion[] = [
  { stableId: "appearance", title: "نوع پوشش", answerType: "SCORE_1_TO_5", isActive: true, order: 1, allowUnassessed: true },
  { stableId: "motivation", title: "انگیزه شغلی", answerType: "TEXT", isActive: true, order: 2, allowUnassessed: false },
];

assert.throws(() => publishedCriteriaForInterview(undefined), InterviewSnapshotError);
assert.throws(() => publishedCriteriaForInterview([{ ...snapshot[0], answerType: "UNKNOWN" }]), InterviewSnapshotError);
assert.deepEqual(publishedCriteriaForInterview(snapshot).map(({ id, kind }) => ({ id, kind })), [
  { id: "appearance", kind: "score" },
  { id: "motivation", kind: "text" },
]);

const migrated = normalizeInitialInterviewPayload({
  version: 1,
  criteriaTemplateVersion: 7,
  criteriaSnapshot: snapshot,
  criteria: [
    { criterionId: "appearance", order: 1, score: 4, note: "مرتب" },
    { criterionId: "motivation", order: 2, score: 3, note: "یادداشت قدیمی" },
  ],
  finalCriterionId: "motivation",
  finalCriterionScore: 3,
});
assert.equal(migrated?.schemaVersion, 2);
assert.equal(migrated?.state.answers.appearance.score, 4);
assert.equal(migrated?.state.answers.appearance.note, "مرتب");
assert.equal(migrated?.state.answers.motivation.legacyScore, 3);
assert.equal(migrated?.state.answers.motivation.legacyNote, "یادداشت قدیمی");

assert.throws(() => normalizeInitialInterviewPayload({
  schemaVersion: 2,
  state: { answers: {}, decision: null, decisionReason: "" },
  customCriteria: [],
  criteriaSnapshot: snapshot,
} as any), InterviewSnapshotError);

const hydrated = normalizeInitialInterviewPayload({
  schemaVersion: 2,
  criteriaTemplateVersion: 7,
  criteriaSnapshot: snapshot,
  state: {
    answers: {
      appearance: { score: 9, strengths: [null] },
      motivation: { text: 42 },
    },
    decision: "UNKNOWN",
    decisionReason: null,
  },
  customCriteria: [],
} as any);
assert.equal(hydrated?.state.answers.appearance.score, null);
assert.deepEqual(hydrated?.state.answers.appearance.strengths, ["", "", "", "", ""]);
assert.equal(hydrated?.state.answers.motivation.text, "");
assert.equal(hydrated?.state.decision, null);
assert.equal(hydrated?.state.decisionReason, "");

assert.throws(() => normalizeInitialInterviewPayload({
  schemaVersion: 2,
  criteriaTemplateVersion: 7,
  criteriaSnapshot: snapshot,
  state: { answers: {}, decision: null, decisionReason: "" },
  customCriteria: [{ id: "custom", title: "معیار", kind: "unknown" }],
} as any), InterviewSnapshotError);

assert.equal(customCriteriaAreComplete([{ id: "x", title: "معیار", kind: "score", score: 6 as any, text: "", yesNo: null }]), false);
assert.equal(customCriteriaAreComplete([
  { id: "x", title: "اول", kind: "text", score: null, text: "پاسخ", yesNo: null },
  { id: "x", title: "دوم", kind: "yes-no", score: null, text: "", yesNo: "YES" },
]), false);

console.log("HR interview evidence compatibility tests passed.");
