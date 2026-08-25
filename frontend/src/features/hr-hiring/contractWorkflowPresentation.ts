export type ContractWorkflowPrimaryAction =
  | "RECORD_VERSION"
  | "SUBMIT_DRAFT"
  | "WITHDRAW"
  | "CLAIM_CORRECTION"
  | "NONE";

const contractReviewLabels: Record<string, string> = {
  DRAFT: "ثبت‌شده؛ در انتظار ارسال",
  SUBMITTED: "ارسال‌شده؛ در انتظار بررسی مدیر مالی",
  WITHDRAWN: "پس‌گرفته‌شده؛ در انتظار نسخه اصلاح‌شده",
  RETURNED: "برای اصلاح بازگردانده شده",
  APPROVED: "تأییدشده",
};

export const projectLatestContractStatus = (input: {
  reviewState: string;
  contractClearance: string;
  correctionTaskStatus?: string | null;
}) => {
  const correctionTaskOpen = ["PENDING", "IN_PROGRESS"].includes(
    input.correctionTaskStatus || "",
  );
  const priorApprovalRequiresCorrection =
    input.reviewState === "APPROVED" &&
    input.contractClearance !== "APPROVED" &&
    correctionTaskOpen;

  return {
    label: priorApprovalRequiresCorrection
      ? "تأیید قبلی؛ نیازمند نسخه اصلاحی"
      : contractReviewLabels[input.reviewState] || input.reviewState,
    priorApprovalRequiresCorrection,
    preparationLabel: priorApprovalRequiresCorrection
      ? "نیازمند اصلاح قرارداد"
      : null,
    preparationHint: priorApprovalRequiresCorrection
      ? "منابع انسانی · نسخه جدید برای بررسی مالی ارسال شود"
      : null,
  };
};

export const contractDraftDefaultsFromLatest = (
  latestContract: null | {
    contractNumber?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  },
  toFieldDate: (value: string) => string,
) => ({
  contractNumber: latestContract?.contractNumber || "",
  effectiveFrom: latestContract?.effectiveFrom
    ? toFieldDate(latestContract.effectiveFrom)
    : "",
  effectiveTo: latestContract?.effectiveTo
    ? toFieldDate(latestContract.effectiveTo)
    : "",
  file: null,
});

export const projectContractCorrectionEditor = (input: {
  showContractFields: boolean;
  latestReviewState: string | null;
  dismissed: boolean;
}) => {
  const isCorrection = ["RETURNED", "WITHDRAWN"].includes(
    input.latestReviewState || "",
  );
  const showEditor =
    input.showContractFields && (!isCorrection || !input.dismissed);

  return {
    isCorrection,
    showEditor,
    showCancel: showEditor && isCorrection,
    showResume: input.showContractFields && isCorrection && input.dismissed,
  };
};

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
