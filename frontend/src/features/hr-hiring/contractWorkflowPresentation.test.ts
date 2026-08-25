import assert from "node:assert/strict";
import { projectContractWorkflowPresentation } from "./contractWorkflowPresentation";

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
