export type PartnerCreationDraftCandidate = {
  recoveryId: string;
  caseId?: string;
  meaningfulUpdatedAt: number;
  sessionUpdatedAt?: number;
};

export function reconcilePartnerCreationDrafts<T extends PartnerCreationDraftCandidate>(candidates: readonly T[]): {
  unnumbered?: T;
  numbered: T[];
  discardRecoveryIds: string[];
} {
  const numbered = candidates.filter(candidate => Boolean(candidate.caseId));
  const unnumbered = candidates
    .filter(candidate => !candidate.caseId)
    .sort((left, right) => right.meaningfulUpdatedAt - left.meaningfulUpdatedAt ||
      left.recoveryId.localeCompare(right.recoveryId));

  return {
    ...(unnumbered[0] ? { unnumbered: unnumbered[0] } : {}),
    numbered,
    discardRecoveryIds: unnumbered.slice(1).map(candidate => candidate.recoveryId),
  };
}

export function meaningfulPartnerWizardUpdatedAt(input: {
  previousIntent?: unknown;
  nextIntent: unknown;
  previousMeaningfulUpdatedAt: number;
  now: number;
}) {
  return input.previousIntent !== undefined &&
    JSON.stringify(input.previousIntent) === JSON.stringify(input.nextIntent)
    ? input.previousMeaningfulUpdatedAt
    : input.now;
}
