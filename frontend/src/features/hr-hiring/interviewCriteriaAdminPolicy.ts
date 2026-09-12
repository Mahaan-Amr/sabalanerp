export const PERSONALITY_TEST_SUMMARY_STABLE_ID = 'personalityTestSummary';

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
