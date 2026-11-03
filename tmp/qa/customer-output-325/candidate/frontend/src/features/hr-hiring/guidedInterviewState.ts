export type GuidedScore = 1 | 2 | 3 | 4 | 5 | "UNASSESSED";

export const advanceGuidedCriterion = (
  criterionIds: string[],
  currentCriterionId: string,
  scoredCriterionId: string,
) => {
  if (currentCriterionId !== scoredCriterionId) return currentCriterionId;
  const index = criterionIds.indexOf(scoredCriterionId);
  if (index < 0 || index === criterionIds.length - 1) return currentCriterionId;
  return criterionIds[index + 1];
};

export const guidedInterviewSummary = (
  criterionIds: string[],
  answers: Partial<Record<string, GuidedScore>>,
) => {
  const finalCriterionId = criterionIds[criterionIds.length - 1] || "";
  return {
    completed: criterionIds.filter((id) => answers[id] !== undefined).length,
    total: criterionIds.length,
    finalCriterionId,
    finalCriterionValue: answers[finalCriterionId] ?? null,
  };
};

export const shouldShowNextCriterion = (activeIndex: number, criterionCount: number) => (
  activeIndex >= 0 && activeIndex < criterionCount - 1
);

export const interviewCompletionFocusTarget = ({
  criteriaComplete,
  customCriteriaComplete,
  summaryComplete,
}: {
  criteriaComplete: boolean;
  customCriteriaComplete: boolean;
  summaryComplete: boolean;
}) => {
  if (!criteriaComplete) return 'criterion' as const;
  if (!customCriteriaComplete) return 'custom-criterion' as const;
  if (!summaryComplete) return 'summary' as const;
  return 'completion' as const;
};
