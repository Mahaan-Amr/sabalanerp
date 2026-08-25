export const FORMAL_ASSESSMENT_KINDS = ["DISC", "EQ", "BIG_FIVE"] as const;
export type FormalAssessmentKind = (typeof FORMAL_ASSESSMENT_KINDS)[number];
export type FormalAssessmentExecutionMethod = "APPLICANT" | "COMPANY";

export const GUIDED_HR_INTERVIEW_CRITERION_IDS = [
  "appearance", "grooming", "resume", "address", "responsibility", "honesty", "teamwork",
  "resilience", "communication", "motivation", "previousJob", "stability", "selfView",
  "workplaceValues", "createdValues", "achievement", "companion",
] as const;

export type HrInterviewEvidenceErrorTarget = "criterion" | "custom-criterion" | "summary" | "snapshot";

export type HrInterviewEvidenceError = Error & {
  code: "HR_INTERVIEW_EVIDENCE_INVALID";
  target: HrInterviewEvidenceErrorTarget;
  criterionId?: string;
  isOperational: true;
};

const interviewEvidenceError = (
  message: string,
  target: HrInterviewEvidenceErrorTarget,
  criterionId?: string,
): HrInterviewEvidenceError => Object.assign(new Error(message), {
  code: "HR_INTERVIEW_EVIDENCE_INVALID" as const,
  target,
  ...(criterionId ? { criterionId } : {}),
  isOperational: true as const,
});

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const nonEmpty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const validJudgment = (value: unknown) => ["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(String(value));
const validYesNo = (value: unknown) => value === "YES" || value === "NO";
const validScore = (value: unknown, allowUnassessed: boolean) => (
  (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5)
  || (allowUnassessed && value === "UNASSESSED")
);

const v2CriterionIsComplete = (
  criterion: Record<string, unknown>,
  answer: Record<string, unknown> | null,
) => {
  if (!answer) return false;
  switch (criterion.answerType) {
    case "SCORE_1_TO_5":
      return validScore(answer.score, criterion.allowUnassessed === true);
    case "TEXT":
      return nonEmpty(answer.text);
    case "ADDRESS":
      return nonEmpty(answer.text)
        && validJudgment(answer.judgment)
        && (answer.judgment !== "NEGATIVE" || nonEmpty(answer.note));
    case "YES_NO":
    case "COMPANION":
      return validYesNo(answer.companionPresent)
        && validJudgment(answer.judgment)
        && (answer.judgment !== "NEGATIVE" || nonEmpty(answer.note));
    case "STRENGTHS_WEAKNESSES":
      return Array.isArray(answer.strengths)
        && answer.strengths.length === 5
        && answer.strengths.every(nonEmpty)
        && Array.isArray(answer.weaknesses)
        && answer.weaknesses.length === 5
        && answer.weaknesses.every(nonEmpty);
    default:
      return false;
  }
};

const assertSchemaTwoGuidedHrInterviewEvidence = (
  evidence: Record<string, unknown>,
  expectedCriteriaTemplateVersion?: number,
) => {
  const criteriaTemplateVersion = evidence.criteriaTemplateVersion;
  const criteriaSnapshot = Array.isArray(evidence.criteriaSnapshot) ? evidence.criteriaSnapshot : null;
  const state = record(evidence.state);
  const answers = record(state?.answers);
  if (
    typeof criteriaTemplateVersion !== "number"
    || !Number.isInteger(criteriaTemplateVersion)
    || criteriaTemplateVersion < 1
    || (expectedCriteriaTemplateVersion !== undefined && criteriaTemplateVersion !== expectedCriteriaTemplateVersion)
    || !criteriaSnapshot
    || !state
    || !answers
    || !Array.isArray(evidence.customCriteria)
  ) {
    throw interviewEvidenceError(
      "نسخه معیارهای این مصاحبه قابل اعتبارسنجی نیست. اطلاعات حفظ شده است؛ با پشتیبانی تماس بگیرید.",
      "snapshot",
    );
  }

  const snapshotCriteria = criteriaSnapshot.map(record);
  const supportedAnswerTypes = new Set(["SCORE_1_TO_5", "TEXT", "ADDRESS", "YES_NO", "COMPANION", "STRENGTHS_WEAKNESSES"]);
  const stableIds = snapshotCriteria.map((criterion) => criterion?.stableId);
  if (
    !snapshotCriteria.length
    || snapshotCriteria.some((criterion) => !criterion)
    || stableIds.some((stableId) => typeof stableId !== "string" || !stableId || stableId !== stableId.trim())
    || new Set(stableIds).size !== stableIds.length
    || snapshotCriteria.some((criterion, index) => (
      typeof criterion?.order !== "number"
      || !Number.isInteger(criterion.order)
      || criterion.order !== index + 1
      || typeof criterion.isActive !== "boolean"
      || typeof criterion.allowUnassessed !== "boolean"
      || !nonEmpty(criterion.title)
      || typeof criterion.answerType !== "string"
      || !supportedAnswerTypes.has(criterion.answerType)
    ))
  ) {
    throw interviewEvidenceError(
      "نسخه معیارهای این مصاحبه قابل اعتبارسنجی نیست. اطلاعات حفظ شده است؛ با پشتیبانی تماس بگیرید.",
      "snapshot",
    );
  }
  const activeCriteria = snapshotCriteria.filter(
    (criterion): criterion is Record<string, unknown> => Boolean(criterion) && criterion!.isActive !== false,
  );
  if (!activeCriteria.length) {
    throw interviewEvidenceError(
      "نسخه معیارهای این مصاحبه قابل اعتبارسنجی نیست. اطلاعات حفظ شده است؛ با پشتیبانی تماس بگیرید.",
      "snapshot",
    );
  }

  for (const criterion of activeCriteria) {
    const criterionId = String(criterion.stableId);
    if (!v2CriterionIsComplete(criterion, record(answers[criterionId]))) {
      const title = String(criterion.title).trim().slice(0, 160);
      throw interviewEvidenceError(`پاسخ معیار «${title}» کامل نیست. این معیار را بررسی کنید.`, "criterion", criterionId);
    }
  }

  const customCriteria = evidence.customCriteria;
  const customCriterionIds = new Set<string>();
  for (const rawCriterion of customCriteria) {
    const criterion = record(rawCriterion);
    const rawCriterionId = criterion?.id;
    const criterionId = typeof rawCriterionId === "string" && rawCriterionId === rawCriterionId.trim()
      ? rawCriterionId
      : "";
    const title = typeof criterion?.title === "string" ? criterion.title.trim().slice(0, 160) : "";
    const kind = criterion?.kind;
    const complete = Boolean(criterionId && title && !customCriterionIds.has(criterionId)) && (
      (kind === "score" && validScore(criterion?.score, true))
      || (kind === "text" && nonEmpty(criterion?.text))
      || (kind === "yes-no" && validYesNo(criterion?.yesNo))
    );
    if (!complete) {
      throw interviewEvidenceError(
        title ? `پاسخ معیار اختصاصی «${title}» کامل نیست. این معیار را بررسی کنید.` : "یکی از معیارهای اختصاصی مصاحبه معتبر نیست. آن معیار را بررسی کنید.",
        "custom-criterion",
        criterionId || undefined,
      );
    }
    customCriterionIds.add(criterionId);
  }

  if (!["POSITIVE", "NEGATIVE"].includes(String(state.decision)) || !nonEmpty(state.decisionReason)) {
    throw interviewEvidenceError("نتیجه و دلیل نهایی مصاحبه را کامل کنید.", "summary");
  }
};

export const assertGuidedHrInterviewEvidence = (input: unknown, expectedCriteriaTemplateVersion?: number) => {
  const evidence = input as Record<string, unknown> | null;
  if (evidence && Object.prototype.hasOwnProperty.call(evidence, "schemaVersion")) {
    if (evidence.schemaVersion !== 2) {
      throw interviewEvidenceError(
        "نسخه معیارهای این مصاحبه قابل اعتبارسنجی نیست. اطلاعات حفظ شده است؛ با پشتیبانی تماس بگیرید.",
        "snapshot",
      );
    }
    assertSchemaTwoGuidedHrInterviewEvidence(evidence, expectedCriteriaTemplateVersion);
    return;
  }
  const criteria = evidence && Array.isArray(evidence.criteria) ? evidence.criteria : [];
  const validScores = new Set<unknown>([1, 2, 3, 4, 5, "UNASSESSED"]);
  if (criteria.length !== GUIDED_HR_INTERVIEW_CRITERION_IDS.length || criteria.some((raw, index) => {
    const criterion = raw as Record<string, unknown>;
    return criterion.criterionId !== GUIDED_HR_INTERVIEW_CRITERION_IDS[index]
      || criterion.order !== index + 1
      || !validScores.has(criterion.score);
  })) {
    throw new Error("The guided interview must contain the canonical criteria in order with a valid score.");
  }
  const final = criteria[criteria.length - 1] as Record<string, unknown>;
  if (evidence!.finalCriterionId !== final.criterionId || evidence!.finalCriterionScore !== final.score) {
    throw new Error("The summary must retain the final criterion and its recorded score.");
  }
};

export interface FormalAssessmentPlanSelectionCommand {
  assessmentKind: FormalAssessmentKind;
  executionMethod: FormalAssessmentExecutionMethod;
}

export interface FormalAssessmentPlanCommand {
  explicitlyNoAssessment: boolean;
  executionMethod: FormalAssessmentExecutionMethod | null;
  selections: FormalAssessmentPlanSelectionCommand[];
  repeatKinds: FormalAssessmentKind[];
  reason: string;
}

const isKind = (value: unknown): value is FormalAssessmentKind =>
  FORMAL_ASSESSMENT_KINDS.includes(value as FormalAssessmentKind);

const isExecutionMethod = (value: unknown): value is FormalAssessmentExecutionMethod =>
  value === "APPLICANT" || value === "COMPANY";

export const normalizeFormalAssessmentPlanCommand = (
  input: Record<string, unknown>,
  revisesExistingPlan: boolean,
): FormalAssessmentPlanCommand => {
  const explicitlyNoAssessment = input.explicitlyNoAssessment === true;
  const requestedExecutionMethod = isExecutionMethod(input.executionMethod)
    ? input.executionMethod
    : null;
  const rawSelections = Array.isArray(input.selections) ? input.selections : [];
  const selections = rawSelections.map((raw) => {
    const selection = raw as Record<string, unknown>;
    if (!isKind(selection.assessmentKind)) throw new Error("A formal assessment kind is invalid.");
    const executionMethod = selection.executionMethod ?? requestedExecutionMethod;
    if (!isExecutionMethod(executionMethod)) throw new Error("One execution method is required for each selected assessment.");
    return {
      assessmentKind: selection.assessmentKind,
      executionMethod,
    };
  });
  if (new Set(selections.map(({ assessmentKind }) => assessmentKind)).size !== selections.length) {
    throw new Error("Each formal assessment kind may be selected only once.");
  }
  if (explicitlyNoAssessment && selections.length) {
    throw new Error("An explicit no-assessment plan cannot contain selections.");
  }
  if (!explicitlyNoAssessment && !selections.length) {
    throw new Error("An explicit decision is required: select assessments or confirm no assessment.");
  }
  const packageMethods = new Set(selections.map(({ executionMethod }) => executionMethod));
  if (packageMethods.size > 1) {
    throw new Error("All selected formal assessments must use the same execution method.");
  }
  const executionMethod = explicitlyNoAssessment
    ? null
    : selections[0]?.executionMethod ?? null;
  const repeatKinds = [...new Set(
    (Array.isArray(input.repeatKinds) ? input.repeatKinds : []).filter(isKind),
  )];
  if (repeatKinds.some((kind) => !selections.some(({ assessmentKind }) => assessmentKind === kind))) {
    throw new Error("Only a selected assessment can be repeated.");
  }
  const reason = String(input.reason || "").trim();
  if (revisesExistingPlan && !reason) throw new Error("A reason is required when revising an assessment plan.");
  return { explicitlyNoAssessment, executionMethod, selections, repeatKinds, reason };
};

export const authorizeFormalAssessmentResultCommand = (input: {
  executionMethod: FormalAssessmentExecutionMethod;
  actorKind: "APPLICANT" | "USER";
  actorAuthorities: Iterable<string>;
  hasCompletedResult: boolean;
  correctionReason: string;
}): "CREATE_INITIAL" | "CREATE_CORRECTION" => {
  const authorities = new Set(input.actorAuthorities);
  if (input.hasCompletedResult) {
    if (input.actorKind !== "USER" || !authorities.has("HR_MANAGER")) {
      throw new Error("Only an HR Manager may create a corrected assessment-result version.");
    }
    if (!input.correctionReason.trim()) throw new Error("A correction reason is required.");
    return "CREATE_CORRECTION";
  }
  if (input.executionMethod === "APPLICANT" && input.actorKind === "APPLICANT") return "CREATE_INITIAL";
  if (input.executionMethod === "COMPANY" && input.actorKind === "USER" && authorities.has("HR_PROCESSOR")) return "CREATE_INITIAL";
  throw new Error("The actor is not authorized to record this assessment result.");
};

export const assertFinalRejectionAuthority = (authorities: Iterable<string>) => {
  const assigned = new Set(authorities);
  if (!assigned.has("HR_MANAGER") && !assigned.has("COMPANY_MANAGER")) {
    throw new Error("The actor is not authorized to finally reject this Application.");
  }
};

export interface FormalAssessmentEvidencePlan {
  version: number;
  status: "ACTIVE" | "SUPERSEDED";
  explicitlyNoAssessment: boolean;
  selections?: Array<{
    assessmentKind: FormalAssessmentKind;
    selected: boolean;
    executionMethod?: FormalAssessmentExecutionMethod | null;
  }>;
  results?: Array<{
    assessmentKind: FormalAssessmentKind;
    resultVersion: number;
    status: "PENDING" | "COMPLETED" | "INVALIDATED";
  }>;
}

export const projectFormalAssessmentEvidenceGate = (
  plans: FormalAssessmentEvidencePlan[],
) => {
  const activePlan = [...plans]
    .sort((left, right) => right.version - left.version)
    .find((plan) => plan.status === "ACTIVE");
  if (!activePlan) return {
    complete: false,
    planVersion: null,
    explicitlyNoAssessment: false,
    selectedKinds: [] as FormalAssessmentKind[],
    missingKinds: [] as FormalAssessmentKind[],
    completedKinds: [] as FormalAssessmentKind[],
    executionMethodByKind: new Map<FormalAssessmentKind, FormalAssessmentExecutionMethod>(),
  };
  const selections = (activePlan.selections || []).filter((selection) => selection.selected);
  const latestResultByKind = new Map<FormalAssessmentKind, NonNullable<FormalAssessmentEvidencePlan["results"]>[number]>();
  for (const result of plans
    .flatMap((plan) => plan.results || [])
    .sort((left, right) => right.resultVersion - left.resultVersion)) {
    if (!latestResultByKind.has(result.assessmentKind)) latestResultByKind.set(result.assessmentKind, result);
  }
  const missingKinds = selections
    .filter(({ assessmentKind }) => latestResultByKind.get(assessmentKind)?.status !== "COMPLETED")
    .map(({ assessmentKind }) => assessmentKind);
  const completedKinds = selections
    .filter(({ assessmentKind }) => latestResultByKind.get(assessmentKind)?.status === "COMPLETED")
    .map(({ assessmentKind }) => assessmentKind);
  return {
    complete: activePlan.explicitlyNoAssessment || (selections.length > 0 && missingKinds.length === 0),
    planVersion: activePlan.version,
    explicitlyNoAssessment: activePlan.explicitlyNoAssessment,
    selectedKinds: selections.map(({ assessmentKind }) => assessmentKind),
    missingKinds,
    completedKinds,
    executionMethodByKind: new Map(selections.map(({ assessmentKind, executionMethod }) => [
      assessmentKind,
      executionMethod!,
    ])),
  };
};
