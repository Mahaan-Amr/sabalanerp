export type PaperContractReviewState =
  | "DRAFT"
  | "SUBMITTED"
  | "WITHDRAWN"
  | "RETURNED"
  | "APPROVED";

export interface PaperContractEvidenceState {
  uploadedBy: string;
  submittedAt?: Date | string | null;
  returnedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  withdrawnAt?: Date | string | null;
}

export interface PaperContractCorrectionTaskState {
  status: string;
  assignedToUserId: string | null;
}

export interface PaperContractWorkflowCapabilities {
  canClaimCorrectionTask: boolean;
  canRecordNewVersion: boolean;
  canSubmitLatestDraft: boolean;
  canWithdraw: boolean;
}

export const projectWithdrawalCorrectionTaskTransition = (input: {
  actorId: string;
  dueDate: Date;
  reason: string;
}) => ({
  status: "IN_PROGRESS" as const,
  dueDate: input.dueDate,
  description: input.reason,
  assignedToUserId: input.actorId,
  assignmentReason: "AUTO_ASSIGNED_AFTER_CONTRACT_WITHDRAWAL",
  completedAt: null,
  completedByUserId: null,
  waivedAt: null,
  waivedByUserId: null,
  waiverReason: null,
});

export const projectPaperContractCorrectionTask = <T extends {
  assignedToUserId: string | null;
}>(input: {
  canSeeContracts: boolean;
  task?: T | null;
  capabilities: PaperContractWorkflowCapabilities;
  actorId: string;
}) => input.canSeeContracts && input.task ? {
  ...input.task,
  canClaim: input.capabilities.canClaimCorrectionTask,
  isClaimant: input.task.assignedToUserId === input.actorId,
} : null;

export const paperContractReviewState = (
  contract: PaperContractEvidenceState,
): PaperContractReviewState => {
  if (contract.approvedAt) return "APPROVED";
  if (contract.returnedAt) return "RETURNED";
  if (contract.withdrawnAt) return "WITHDRAWN";
  if (contract.submittedAt) return "SUBMITTED";
  return "DRAFT";
};

export const canReusePaperContractStoredEvidence = (
  contract: (PaperContractEvidenceState & {
    storageName?: string | null;
    originalName?: string | null;
    mimeType?: string | null;
    size?: number | null;
    sha256?: string | null;
    malwareScanStatus?: string | null;
  }) | null | undefined,
) => Boolean(
  contract &&
  ["RETURNED", "WITHDRAWN"].includes(paperContractReviewState(contract)) &&
  contract.storageName &&
  contract.originalName &&
  contract.mimeType &&
  contract.size !== null &&
  contract.size !== undefined &&
  contract.sha256 &&
  contract.malwareScanStatus,
);

export const projectPaperContractWorkflowCapabilities = (input: {
  actorId: string;
  actorCanRecord: boolean;
  employmentStatus?: string | null;
  latestContract?: PaperContractEvidenceState | null;
  correctionTask?: PaperContractCorrectionTaskState | null;
}): PaperContractWorkflowCapabilities => {
  const isPlanned = input.employmentStatus === "PLANNED";
  if (!input.actorCanRecord || !isPlanned) {
    return {
      canClaimCorrectionTask: false,
      canRecordNewVersion: false,
      canSubmitLatestDraft: false,
      canWithdraw: false,
    };
  }

  if (!input.latestContract) {
    return {
      canClaimCorrectionTask: false,
      canRecordNewVersion: true,
      canSubmitLatestDraft: false,
      canWithdraw: false,
    };
  }

  const reviewState = paperContractReviewState(input.latestContract);
  const correctionTask = input.correctionTask;
  const correctionTaskOpen =
    correctionTask?.status === "PENDING" ||
    correctionTask?.status === "IN_PROGRESS";
  const correctionNeeded =
    reviewState === "RETURNED" ||
    reviewState === "WITHDRAWN" ||
    (reviewState === "APPROVED" && correctionTaskOpen);
  return {
    canClaimCorrectionTask:
      correctionNeeded &&
      correctionTask?.status === "PENDING" &&
      correctionTask.assignedToUserId === null,
    canRecordNewVersion:
      correctionNeeded &&
      correctionTask?.status === "IN_PROGRESS" &&
      correctionTask.assignedToUserId === input.actorId,
    canSubmitLatestDraft:
      reviewState === "DRAFT" && input.latestContract.uploadedBy === input.actorId,
    canWithdraw: reviewState === "SUBMITTED",
  };
};

export const assertPaperContractDraft = (input: {
  contractNumber: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  hasFile: boolean;
}) => {
  if (!input.contractNumber.trim()) throw new Error("شماره قرارداد الزامی است.");
  if (!input.effectiveFrom)
    throw new Error("تاریخ شروع اعتبار قرارداد الزامی است.");
  if (!input.effectiveTo)
    throw new Error("تاریخ پایان اعتبار قرارداد الزامی است.");
  if (input.effectiveTo < input.effectiveFrom)
    throw new Error("تاریخ پایان اعتبار قرارداد نمی‌تواند پیش از تاریخ شروع باشد.");
  if (!input.hasFile) throw new Error("اسکن قرارداد امضاشده الزامی است.");
};

export const assertPaperContractReviewable = (
  contract: PaperContractEvidenceState,
  context: { actorId: string; isLatest: boolean },
) => {
  if (!context.isLatest)
    throw new Error("فقط آخرین نسخه قرارداد قابل بررسی است.");
  if (!contract.submittedAt)
    throw new Error("قرارداد باید ابتدا برای بررسی ارسال شود.");
  if (contract.returnedAt)
    throw new Error("نسخه بازگردانده‌شده قابل تأیید نیست؛ نسخه اصلاح‌شده ثبت شود.");
  if (contract.approvedAt) throw new Error("این نسخه قبلاً تأیید شده است.");
  if (contract.uploadedBy === context.actorId)
    throw new Error("ثبت‌کننده قرارداد نمی‌تواند همان نسخه را تأیید کند.");
};
