export const PERSONALITY_TEST_SUMMARY_STABLE_ID = 'personalityTestSummary';

export const INTERVIEW_CRITERIA_ANSWER_TYPE_OPTIONS = [
  ['TEXT', 'پاسخ تشریحی'],
  ['SCORE_1_TO_5', 'امتیاز ۱ تا ۵'],
  ['YES_NO', 'بله یا خیر'],
  ['ADDRESS', 'نشانی'],
  ['STRENGTHS_WEAKNESSES', 'نقاط قوت و ضعف'],
  ['COMPANION', 'همراه'],
] as const;

export const isProtectedPersonalityTestCriterion = (criterion: { stableId: string } | undefined) => (
  criterion?.stableId === PERSONALITY_TEST_SUMMARY_STABLE_ID
);

export const canMoveInterviewCriterion = (
  criteria: Array<{ stableId: string }>,
  from: number,
  to: number,
) => (
  from >= 0
  && to >= 0
  && from < criteria.length
  && to < criteria.length
  && !isProtectedPersonalityTestCriterion(criteria[from])
  && !isProtectedPersonalityTestCriterion(criteria[to])
);
