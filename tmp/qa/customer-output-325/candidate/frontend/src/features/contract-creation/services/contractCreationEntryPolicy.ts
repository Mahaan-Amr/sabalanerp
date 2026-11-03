export type ContractCreationEntryDecision = 'START_EMPTY' | 'OFFER_RESUME';

export const contractCreationEntryDecision = ({
  hasRecoverableDraft,
  freshRequested,
}: {
  hasRecoverableDraft: boolean;
  freshRequested: boolean;
}): ContractCreationEntryDecision => (
  hasRecoverableDraft && !freshRequested ? 'OFFER_RESUME' : 'START_EMPTY'
);

export const contractCreationPrimaryPending = ({
  creationComplete,
  mutationPending,
  recoveryReady,
}: {
  creationComplete: boolean;
  mutationPending: boolean;
  recoveryReady: boolean;
}): boolean => mutationPending || (!creationComplete && !recoveryReady);
