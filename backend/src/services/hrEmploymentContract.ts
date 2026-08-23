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

export const paperContractReviewState = (
  contract: PaperContractEvidenceState,
): PaperContractReviewState => {
  if (contract.approvedAt) return "APPROVED";
  if (contract.returnedAt) return "RETURNED";
  if (contract.withdrawnAt) return "WITHDRAWN";
  if (contract.submittedAt) return "SUBMITTED";
  return "DRAFT";
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
