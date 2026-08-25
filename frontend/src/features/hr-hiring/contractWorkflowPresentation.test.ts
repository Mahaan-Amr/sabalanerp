import assert from "node:assert/strict";
import {
  contractDraftDefaultsFromLatest,
  projectContractCorrectionEditor,
  projectLatestContractStatus,
  projectContractWorkflowPresentation,
} from "./contractWorkflowPresentation";

assert.deepEqual(projectContractCorrectionEditor({
  showContractFields: true,
  latestReviewState: "WITHDRAWN",
  dismissed: false,
}), {
  isCorrection: true,
  showEditor: true,
  showCancel: true,
  showResume: false,
});

assert.deepEqual(projectContractCorrectionEditor({
  showContractFields: true,
  latestReviewState: "WITHDRAWN",
  dismissed: true,
}), {
  isCorrection: true,
  showEditor: false,
  showCancel: false,
  showResume: true,
});

assert.deepEqual(projectContractCorrectionEditor({
  showContractFields: true,
  latestReviewState: null,
  dismissed: true,
}), {
  isCorrection: false,
  showEditor: true,
  showCancel: false,
  showResume: false,
});

assert.deepEqual(
  projectLatestContractStatus({
    reviewState: "APPROVED",
    contractClearance: "IN_PROGRESS",
    correctionTaskStatus: "PENDING",
  }),
  {
    label: "تأیید قبلی؛ نیازمند نسخه اصلاحی",
    priorApprovalRequiresCorrection: true,
    preparationLabel: "نیازمند اصلاح قرارداد",
    preparationHint: "منابع انسانی · نسخه جدید برای بررسی مالی ارسال شود",
  },
);

assert.deepEqual(
  projectLatestContractStatus({
    reviewState: "APPROVED",
    contractClearance: "APPROVED",
    correctionTaskStatus: "COMPLETE",
  }),
  {
    label: "تأییدشده",
    priorApprovalRequiresCorrection: false,
    preparationLabel: null,
    preparationHint: null,
  },
);

assert.deepEqual(
  projectContractWorkflowPresentation({
    latestContract: { reviewState: "SUBMITTED", canWithdraw: true, canSubmit: false },
    correctionTask: null,
    canRecordNewVersion: false,
  }),
  {
    primaryAction: "WITHDRAW",
    showContractFields: false,
    showClaimCorrection: false,
  },
);

assert.deepEqual(contractDraftDefaultsFromLatest({
  contractNumber: "HR-1405-27",
  effectiveFrom: "2026-08-25T00:00:00.000Z",
  effectiveTo: "2027-08-25T00:00:00.000Z",
}, (value) => value.slice(0, 10)), {
  contractNumber: "HR-1405-27",
  effectiveFrom: "2026-08-25",
  effectiveTo: "2027-08-25",
  file: null,
});

assert.deepEqual(
  projectContractWorkflowPresentation({
    latestContract: { reviewState: "WITHDRAWN", canWithdraw: false, canSubmit: false },
    correctionTask: { canClaim: true, isClaimant: false },
    canRecordNewVersion: false,
  }),
  {
    primaryAction: "CLAIM_CORRECTION",
    showContractFields: false,
    showClaimCorrection: true,
  },
);

assert.deepEqual(
  projectContractWorkflowPresentation({
    latestContract: { reviewState: "WITHDRAWN", canWithdraw: false, canSubmit: false },
    correctionTask: { canClaim: false, isClaimant: true },
    canRecordNewVersion: true,
  }),
  {
    primaryAction: "RECORD_VERSION",
    showContractFields: true,
    showClaimCorrection: false,
  },
);

assert.deepEqual(
  projectContractWorkflowPresentation({
    latestContract: { reviewState: "DRAFT", canWithdraw: false, canSubmit: true },
    correctionTask: { canClaim: false, isClaimant: true },
    canRecordNewVersion: false,
  }),
  {
    primaryAction: "SUBMIT_DRAFT",
    showContractFields: false,
    showClaimCorrection: false,
  },
);

console.log("Contract workflow presentation tests passed.");
