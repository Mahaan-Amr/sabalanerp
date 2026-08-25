import assert from "node:assert/strict";
import {
  assertPaperContractDraft,
  assertPaperContractReviewable,
  canReusePaperContractStoredEvidence,
  paperContractReviewState,
  projectPaperContractCorrectionTask,
  projectPaperContractWorkflowCapabilities,
  projectWithdrawalCorrectionTaskTransition,
} from "../hrEmploymentContract";

const storedEvidence = {
  uploadedBy: "recorder-1",
  submittedAt: new Date("2026-07-27T10:00:00.000Z"),
  returnedAt: new Date("2026-07-28T10:00:00.000Z"),
  approvedAt: null,
  storageName: "stored-contract.png",
  originalName: "contract.png",
  mimeType: "image/png",
  size: 2048,
  sha256: "digest",
  malwareScanStatus: "CLEAN",
};

assert.equal(canReusePaperContractStoredEvidence(storedEvidence), true);
assert.equal(canReusePaperContractStoredEvidence({
  ...storedEvidence,
  returnedAt: null,
}), false);
assert.equal(canReusePaperContractStoredEvidence({
  ...storedEvidence,
  storageName: null,
}), false);

assert.doesNotThrow(() =>
  assertPaperContractDraft({
    contractNumber: "HR-1405-001",
    effectiveFrom: new Date("2026-07-27T00:00:00.000Z"),
    effectiveTo: new Date("2027-07-26T00:00:00.000Z"),
    hasFile: true,
  }),
);

assert.throws(
  () =>
    assertPaperContractDraft({
      contractNumber: "HR-1405-001",
      effectiveFrom: new Date("2026-07-27T00:00:00.000Z"),
      effectiveTo: null,
      hasFile: true,
    }),
  /تاریخ پایان اعتبار قرارداد الزامی است/,
);

assert.throws(
  () =>
    assertPaperContractDraft({
      contractNumber: "HR-1405-001",
      effectiveFrom: new Date("2027-07-27T00:00:00.000Z"),
      effectiveTo: new Date("2026-07-26T00:00:00.000Z"),
      hasFile: true,
    }),
  /پیش از تاریخ شروع/,
);

const submitted = {
  uploadedBy: "recorder-1",
  submittedAt: new Date("2026-07-27T10:00:00.000Z"),
  returnedAt: null,
  approvedAt: null,
};

assert.equal(paperContractReviewState(submitted), "SUBMITTED");
assert.doesNotThrow(() =>
  assertPaperContractReviewable(submitted, {
    actorId: "manager-1",
    isLatest: true,
  }),
);
assert.throws(
  () =>
    assertPaperContractReviewable(
      { ...submitted, submittedAt: null },
      { actorId: "manager-1", isLatest: true },
    ),
  /ابتدا برای بررسی ارسال/,
);
assert.throws(
  () =>
    assertPaperContractReviewable(submitted, {
      actorId: "recorder-1",
      isLatest: true,
    }),
  /ثبت‌کننده.*تأیید/,
);
assert.equal(
  paperContractReviewState({
    ...submitted,
    returnedAt: new Date("2026-07-27T11:00:00.000Z"),
  }),
  "RETURNED",
);

const submittedCapabilities = projectPaperContractWorkflowCapabilities({
  actorId: "permitted-user-2",
  actorCanRecord: true,
  employmentStatus: "PLANNED",
  latestContract: {
    uploadedBy: "recorder-1",
    submittedAt: new Date("2026-07-27T10:00:00.000Z"),
  },
  correctionTask: null,
});
assert.equal(submittedCapabilities.canWithdraw, true);
assert.equal(submittedCapabilities.canRecordNewVersion, false);
assert.equal(submittedCapabilities.canSubmitLatestDraft, false);

assert.deepEqual(
  projectPaperContractWorkflowCapabilities({
    actorId: "permitted-user-2",
    actorCanRecord: true,
    employmentStatus: "ACTIVE",
    latestContract: {
      uploadedBy: "recorder-1",
      submittedAt: new Date("2026-07-27T10:00:00.000Z"),
    },
    correctionTask: null,
  }),
  {
    canClaimCorrectionTask: false,
    canRecordNewVersion: false,
    canSubmitLatestDraft: false,
    canWithdraw: false,
  },
);

const returnedWithUnclaimedTask = projectPaperContractWorkflowCapabilities({
  actorId: "permitted-user-2",
  actorCanRecord: true,
  employmentStatus: "PLANNED",
  latestContract: {
    uploadedBy: "recorder-1",
    submittedAt: new Date("2026-07-27T10:00:00.000Z"),
    returnedAt: new Date("2026-07-28T10:00:00.000Z"),
  },
  correctionTask: { status: "PENDING", assignedToUserId: null },
});
assert.equal(returnedWithUnclaimedTask.canClaimCorrectionTask, true);
assert.equal(returnedWithUnclaimedTask.canRecordNewVersion, false);

const claimedCorrection = projectPaperContractWorkflowCapabilities({
  actorId: "permitted-user-2",
  actorCanRecord: true,
  employmentStatus: "PLANNED",
  latestContract: {
    uploadedBy: "recorder-1",
    submittedAt: new Date("2026-07-27T10:00:00.000Z"),
    withdrawnAt: new Date("2026-07-28T10:00:00.000Z"),
  },
  correctionTask: {
    status: "IN_PROGRESS",
    assignedToUserId: "permitted-user-2",
  },
});
assert.equal(claimedCorrection.canRecordNewVersion, true);
assert.equal(claimedCorrection.canClaimCorrectionTask, false);

const approvedContractInvalidatedByPlannedStartRevision =
  projectPaperContractWorkflowCapabilities({
    actorId: "permitted-user-2",
    actorCanRecord: true,
    employmentStatus: "PLANNED",
    latestContract: {
      uploadedBy: "recorder-1",
      submittedAt: new Date("2026-07-27T10:00:00.000Z"),
      approvedAt: new Date("2026-07-28T10:00:00.000Z"),
    },
    correctionTask: { status: "PENDING", assignedToUserId: null },
  });
assert.equal(
  approvedContractInvalidatedByPlannedStartRevision.canClaimCorrectionTask,
  true,
);
assert.equal(
  approvedContractInvalidatedByPlannedStartRevision.canRecordNewVersion,
  false,
);

const claimedApprovedContractCorrection =
  projectPaperContractWorkflowCapabilities({
    actorId: "permitted-user-2",
    actorCanRecord: true,
    employmentStatus: "PLANNED",
    latestContract: {
      uploadedBy: "recorder-1",
      submittedAt: new Date("2026-07-27T10:00:00.000Z"),
      approvedAt: new Date("2026-07-28T10:00:00.000Z"),
    },
    correctionTask: {
      status: "IN_PROGRESS",
      assignedToUserId: "permitted-user-2",
    },
  });
assert.equal(claimedApprovedContractCorrection.canRecordNewVersion, true);
assert.equal(claimedApprovedContractCorrection.canClaimCorrectionTask, false);

const draftSuccessor = projectPaperContractWorkflowCapabilities({
  actorId: "permitted-user-2",
  actorCanRecord: true,
  employmentStatus: "PLANNED",
  latestContract: { uploadedBy: "permitted-user-2" },
  correctionTask: {
    status: "IN_PROGRESS",
    assignedToUserId: "permitted-user-2",
  },
});
assert.equal(draftSuccessor.canRecordNewVersion, false);
assert.equal(draftSuccessor.canSubmitLatestDraft, true);

const sensitiveCorrectionTask = {
  id: "task-1",
  assignedToUserId: null,
  description: "دلیل محرمانه اصلاح قرارداد",
};
assert.equal(projectPaperContractCorrectionTask({
  canSeeContracts: false,
  task: sensitiveCorrectionTask,
  capabilities: returnedWithUnclaimedTask,
  actorId: "permitted-user-2",
}), null);
assert.deepEqual(projectPaperContractCorrectionTask({
  canSeeContracts: true,
  task: sensitiveCorrectionTask,
  capabilities: returnedWithUnclaimedTask,
  actorId: "permitted-user-2",
}), {
  ...sensitiveCorrectionTask,
  canClaim: true,
  isClaimant: false,
});

assert.deepEqual(projectWithdrawalCorrectionTaskTransition({
  actorId: "withdrawing-user",
  dueDate: new Date("2026-08-28T12:00:00.000Z"),
  reason: "اصلاح شماره قرارداد",
}), {
  status: "IN_PROGRESS",
  dueDate: new Date("2026-08-28T12:00:00.000Z"),
  description: "اصلاح شماره قرارداد",
  assignedToUserId: "withdrawing-user",
  assignmentReason: "AUTO_ASSIGNED_AFTER_CONTRACT_WITHDRAWAL",
  completedAt: null,
  completedByUserId: null,
  waivedAt: null,
  waivedByUserId: null,
  waiverReason: null,
});

console.log("HR employment contract policy tests passed.");
