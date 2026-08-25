export type ContractWorkflowPrimaryAction =
  | "RECORD_VERSION"
  | "SUBMIT_DRAFT"
  | "WITHDRAW"
  | "CLAIM_CORRECTION"
  | "NONE";

export const projectContractWorkflowPresentation = (input: {
  latestContract: null | {
    reviewState: string;
    canWithdraw: boolean;
    canSubmit: boolean;
  };
  correctionTask: null | { canClaim: boolean; isClaimant: boolean };
  canRecordNewVersion: boolean;
}) => {
  let primaryAction: ContractWorkflowPrimaryAction = "NONE";
  if (input.latestContract?.canWithdraw) primaryAction = "WITHDRAW";
  else if (input.latestContract?.canSubmit) primaryAction = "SUBMIT_DRAFT";
  else if (input.correctionTask?.canClaim) primaryAction = "CLAIM_CORRECTION";
  else if (input.canRecordNewVersion) primaryAction = "RECORD_VERSION";

  return {
    primaryAction,
    showContractFields: primaryAction === "RECORD_VERSION",
    showClaimCorrection: primaryAction === "CLAIM_CORRECTION",
  };
};
