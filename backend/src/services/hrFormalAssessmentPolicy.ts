export const FORMAL_ASSESSMENT_KINDS = ["DISC", "EQ", "BIG_FIVE"] as const;
export type FormalAssessmentKind = (typeof FORMAL_ASSESSMENT_KINDS)[number];
export type FormalAssessmentExecutionMethod = "APPLICANT" | "COMPANY";

export const GUIDED_HR_INTERVIEW_CRITERION_IDS = [
  "appearance", "grooming", "resume", "address", "responsibility", "honesty", "teamwork",
  "resilience", "communication", "motivation", "previousJob", "stability", "selfView",
  "workplaceValues", "createdValues", "achievement", "companion",
] as const;

export const assertGuidedHrInterviewEvidence = (input: unknown) => {
  const evidence = input as Record<string, unknown> | null;
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
