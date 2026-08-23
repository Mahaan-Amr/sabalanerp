import {
  createInitialInterviewState,
  type CriterionAnswer,
  type InterviewCriterion,
  type InterviewState,
  type Score,
} from "./interviewPrototypeData";

export type CustomCriterion = {
  id: string;
  title: string;
  kind: "score" | "text" | "yes-no";
  score: Score;
  text: string;
  yesNo: "YES" | "NO" | null;
};

export type PublishedInterviewCriterion = {
  stableId: string;
  title: string;
  description?: string | null;
  answerType: string;
  isActive: boolean;
  order: number;
  allowUnassessed: boolean;
};

export type ProductionInterviewPayload = {
  schemaVersion: 2;
  state: InterviewState;
  customCriteria: CustomCriterion[];
  criteriaTemplateVersion?: number;
  criteriaSnapshot?: PublishedInterviewCriterion[];
};

export type LegacyInterviewCriterion = {
  criterionId: string;
  order: number;
  score: Score;
  note?: string;
};

export type LegacyInterviewPayload = {
  version?: 1;
  criteria: LegacyInterviewCriterion[];
  finalCriterionId?: string;
  finalCriterionScore?: Score;
  criteriaTemplateVersion?: number;
  criteriaSnapshot?: PublishedInterviewCriterion[];
};

export type InterviewEvidencePayload = ProductionInterviewPayload | LegacyInterviewPayload;

export const INVALID_INTERVIEW_SNAPSHOT_MESSAGE =
  "نسخه معیارهای این مصاحبه معتبر یا قابل بازیابی نیست. اطلاعات شما حفظ شده است؛ با پشتیبانی تماس بگیرید.";

export class InterviewSnapshotError extends Error {
  constructor(message = INVALID_INTERVIEW_SNAPSHOT_MESSAGE) {
    super(message);
    this.name = "InterviewSnapshotError";
  }
}

const INVALID_INTERVIEW_DRAFT_MESSAGE =
  "ساختار پیش‌نویس مصاحبه معتبر نیست. اطلاعات ذخیره‌شده حفظ شده است؛ با پشتیبانی تماس بگیرید.";

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const kindByAnswerType: Record<string, InterviewCriterion["kind"]> = {
  TEXT: "text",
  SCORE_1_TO_5: "score",
  YES_NO: "yesNo",
  ADDRESS: "address",
  STRENGTHS_WEAKNESSES: "strengthsWeaknesses",
  COMPANION: "companion",
};

const fiveTextAnswers = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  return Array.from({ length: 5 }, (_, index) => (
    typeof value[index] === "string" ? value[index] : ""
  ));
};

export const publishedCriteriaForInterview = (snapshot: unknown): InterviewCriterion[] => {
  if (!Array.isArray(snapshot) || snapshot.length === 0) throw new InterviewSnapshotError();
  const stableIds = new Set<string>();
  const criteria = snapshot.map((rawCriterion, index) => {
    const criterion = record(rawCriterion);
    const stableId = typeof criterion?.stableId === "string" ? criterion.stableId : "";
    const title = typeof criterion?.title === "string" ? criterion.title.trim() : "";
    const answerType = typeof criterion?.answerType === "string" ? criterion.answerType : "";
    if (
      !criterion
      || !stableId
      || stableId !== stableId.trim()
      || stableIds.has(stableId)
      || !title
      || !Number.isInteger(criterion.order)
      || criterion.order !== index + 1
      || typeof criterion.isActive !== "boolean"
      || typeof criterion.allowUnassessed !== "boolean"
      || !kindByAnswerType[answerType]
    ) {
      throw new InterviewSnapshotError();
    }
    stableIds.add(stableId);
    return {
      id: stableId,
      order: criterion.order as number,
      title,
      prompt: typeof criterion.description === "string" && criterion.description.trim()
        ? criterion.description
        : undefined,
      kind: kindByAnswerType[answerType],
      allowUnassessed: criterion.allowUnassessed === true,
      active: criterion.isActive,
    };
  }).filter(({ active }) => active)
    .map(({ active: _active, ...criterion }) => criterion);
  if (criteria.length === 0) throw new InterviewSnapshotError();
  return criteria;
};

export const hydrateInterviewState = (
  state: InterviewState | undefined,
  criteria: InterviewCriterion[],
) => {
  const empty = createInitialInterviewState(criteria);
  if (!state) return empty;
  const rawState = record(state);
  const rawAnswers = record(rawState?.answers);
  const answers = Object.fromEntries(criteria.map((criterion) => {
    const fallback = empty.answers[criterion.id];
    const candidate = record(rawAnswers?.[criterion.id]);
    if (!candidate) return [criterion.id, fallback];
    const strengths = fiveTextAnswers(candidate.strengths, fallback.strengths);
    const weaknesses = fiveTextAnswers(candidate.weaknesses, fallback.weaknesses);
    const answer: CriterionAnswer = {
      score: validLegacyScore(candidate.score) ? candidate.score : null,
      text: typeof candidate.text === "string" ? candidate.text : "",
      note: typeof candidate.note === "string" ? candidate.note : "",
      judgment: candidate.judgment === "POSITIVE"
        || candidate.judgment === "NEUTRAL"
        || candidate.judgment === "NEGATIVE"
        ? candidate.judgment
        : null,
      companionPresent: candidate.companionPresent === "YES" || candidate.companionPresent === "NO"
        ? candidate.companionPresent
        : null,
      strengths,
      weaknesses,
      legacyScore: validLegacyScore(candidate.legacyScore) ? candidate.legacyScore : undefined,
      legacyNote: typeof candidate.legacyNote === "string" ? candidate.legacyNote : undefined,
    };
    return [criterion.id, answer];
  }));
  const decision: InterviewState["decision"] = rawState?.decision === "POSITIVE"
    || rawState?.decision === "NEGATIVE"
    ? rawState.decision
    : null;
  return {
    answers,
    decision,
    decisionReason: typeof rawState?.decisionReason === "string" ? rawState.decisionReason : "",
  };
};

const validLegacyScore = (value: unknown): value is Exclude<Score, null> => (
  value === "UNASSESSED"
  || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5)
);

const normalizeCustomCriteria = (input: unknown[]): CustomCriterion[] => {
  const ids = new Set<string>();
  return input.map((rawCriterion) => {
    const criterion = record(rawCriterion);
    const id = typeof criterion?.id === "string" ? criterion.id : "";
    const title = typeof criterion?.title === "string" ? criterion.title : "";
    const kind = criterion?.kind;
    const score = criterion?.score;
    const text = criterion?.text;
    const yesNo = criterion?.yesNo;
    if (
      !criterion
      || !id
      || id !== id.trim()
      || ids.has(id)
      || !title.trim()
      || (kind !== "score" && kind !== "text" && kind !== "yes-no")
      || (score !== null && !validLegacyScore(score))
      || typeof text !== "string"
      || (yesNo !== null && yesNo !== "YES" && yesNo !== "NO")
    ) {
      throw new InterviewSnapshotError(INVALID_INTERVIEW_DRAFT_MESSAGE);
    }
    ids.add(id);
    return { id, title, kind, score, text, yesNo };
  });
};

export const upgradeLegacyInterviewDraft = (
  payload: LegacyInterviewPayload,
): ProductionInterviewPayload => {
  const criteria = publishedCriteriaForInterview(payload.criteriaSnapshot);
  const state = createInitialInterviewState(criteria);
  const legacyById = new Map(
    (Array.isArray(payload.criteria) ? payload.criteria : [])
      .filter((item) => item && typeof item.criterionId === "string")
      .map((item) => [item.criterionId, item]),
  );
  for (const criterion of criteria) {
    const legacy = legacyById.get(criterion.id);
    if (!legacy) continue;
    const answer = state.answers[criterion.id];
    const score = validLegacyScore(legacy.score) ? legacy.score : null;
    const note = typeof legacy.note === "string" ? legacy.note : "";
    if (criterion.kind === "score") {
      answer.score = score;
      answer.note = note;
    } else {
      answer.legacyScore = score;
      answer.legacyNote = note;
    }
  }
  return {
    schemaVersion: 2,
    state,
    customCriteria: [],
    criteriaTemplateVersion: payload.criteriaTemplateVersion,
    criteriaSnapshot: payload.criteriaSnapshot,
  };
};

export const normalizeInitialInterviewPayload = (
  input: InterviewEvidencePayload | null | undefined,
): ProductionInterviewPayload | null => {
  if (!input) return null;
  if ((input as ProductionInterviewPayload).schemaVersion === 2) {
    const payload = input as ProductionInterviewPayload;
    const rawPayload = record(payload);
    const rawState = record(rawPayload?.state);
    if (
      !Number.isInteger(rawPayload?.criteriaTemplateVersion)
      || Number(rawPayload?.criteriaTemplateVersion) < 1
      || !rawState
      || !record(rawState.answers)
      || !Array.isArray(rawPayload?.customCriteria)
    ) {
      throw new InterviewSnapshotError();
    }
    const criteria = publishedCriteriaForInterview(payload.criteriaSnapshot);
    return {
      ...payload,
      state: hydrateInterviewState(payload.state, criteria),
      customCriteria: normalizeCustomCriteria(payload.customCriteria),
    };
  }
  return upgradeLegacyInterviewDraft(input as LegacyInterviewPayload);
};

export const customCriterionIsComplete = (criterion: CustomCriterion) => {
  if (
    typeof criterion.id !== "string"
    || !criterion.id.trim()
    || criterion.id !== criterion.id.trim()
    || typeof criterion.title !== "string"
    || !criterion.title.trim()
  ) return false;
  if (criterion.kind === "score") {
    return criterion.score === "UNASSESSED"
      || (typeof criterion.score === "number"
        && Number.isInteger(criterion.score)
        && criterion.score >= 1
        && criterion.score <= 5);
  }
  if (criterion.kind === "yes-no") return criterion.yesNo === "YES" || criterion.yesNo === "NO";
  return criterion.kind === "text"
    && typeof criterion.text === "string"
    && criterion.text.trim().length > 0;
};

export const customCriteriaAreComplete = (criteria: CustomCriterion[]) => {
  const ids = criteria.map(({ id }) => id);
  return new Set(ids).size === ids.length && criteria.every(customCriterionIsComplete);
};
