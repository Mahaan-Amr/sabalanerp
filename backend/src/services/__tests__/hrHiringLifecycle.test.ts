import assert from "node:assert/strict";
import {
  buildHiringQueueItem,
  projectHiringLifecycle,
  summarizeHiringLifecycle,
  type HiringLifecycleSource,
} from "../hrHiringLifecycle";

const submitted = { status: "SUBMITTED" };
const base = (
  overrides: Partial<HiringLifecycleSource> = {},
): HiringLifecycleSource => ({
  stage: "RECEIVED",
  formRevisions: [],
  identityClearance: "NOT_STARTED",
  assessments: [],
  compensationClearance: "NOT_STARTED",
  compensationSnapshots: [],
  collateralClearance: "NOT_STARTED",
  collateralItems: [],
  contracts: [],
  onboardingTasks: [],
  ...overrides,
});

{
  const result = projectHiringLifecycle(base());
  assert.equal(result.currentPhaseId, "APPLICATION");
  assert.equal(result.phases[0].status, "WAITING");
  assert.equal(result.phases[1].status, "UPCOMING");
}

{
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "OFFER",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
      compensationSnapshots: [{ proposedBy: "hiring-manager" }],
    }),
    ["HR_PAYROLL_PROCESSOR"],
  );
  assert.equal(result.phases[3].status, "ACTION_REQUIRED");
  assert.equal(result.phases[3].primaryAction?.id, "PREPARE_OFFER_PAYROLL");
  assert.equal(result.phases[3].requiredComplete, 1);
  assert.equal(result.phases[3].requiredTotal, 5);
}

{
  const result = projectHiringLifecycle(
    base({ formRevisions: [{ status: "RETURNED" }, submitted] }),
  );
  assert.equal(result.currentPhaseId, "APPLICATION");
  assert.equal(result.phases[0].status, "WAITING");
}

{
  const result = projectHiringLifecycle(
    base({ formRevisions: [submitted], stage: "SCREENING" }),
    ["HR_PROCESSOR"],
  );
  assert.equal(result.currentPhaseId, "IDENTITY");
  assert.equal(result.phases[0].status, "COMPLETED");
  assert.equal(result.phases[1].status, "ACTION_REQUIRED");
}

{
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "SCREENING",
      identityClearance: "REJECTED",
    }),
    ["HR_PROCESSOR"],
  );
  assert.equal(result.phases[1].status, "BLOCKED");
  assert.deepEqual(
    result.phases[1].blockers.map((item) => item.code),
    ["IDENTITY_REJECTED"],
  );
}

{
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "ASSESSMENT",
      identityClearance: "APPROVED",
    }),
    ["HR_PROCESSOR"],
  );
  assert.equal(result.currentPhaseId, "ASSESSMENT");
  assert.equal(result.phases[2].status, "ACTION_REQUIRED");
  assert.equal(result.phases[2].primaryAction?.id, "COMPLETE_ASSESSMENT");
}

{
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "OFFER",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
      compensationSnapshots: [
        {
          proposedBy: "hiring-manager",
          preparedAt: new Date(),
          hrApprovedAt: new Date(),
          financeApprovedAt: new Date(),
        },
      ],
    }),
  );
  assert.equal(result.currentPhaseId, "OFFER");
  assert.equal(result.phases[3].status, "WAITING");
  assert.equal(result.phases[3].requiredComplete, 4);
  assert.equal(result.phases[3].requiredTotal, 5);
  assert.equal(result.phases[3].primaryAction, null);
}

{
  const acceptedOffer = [
    {
      proposedBy: "hiring-manager",
      preparedAt: new Date(),
      hrApprovedAt: new Date(),
      financeApprovedAt: new Date(),
      candidateAcceptedAt: new Date(),
    },
  ];
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "CLOSED",
      outcome: "HIRED",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
      compensationClearance: "APPROVED",
      compensationSnapshots: acceptedOffer,
      collateralClearance: "APPROVED",
      collateralItems: [{ required: true, status: "VERIFIED" }],
      convertedAt: new Date(),
      employmentRelationship: { status: "PLANNED" },
      contractClearance: "APPROVED",
      contracts: [{ approvedAt: new Date() }],
      payrollParticipation: {},
      onboardingTasks: [
        {
          activationBlocker: true,
          status: "WAIVED",
          ownerAuthority: "HR_MANAGER",
        },
      ],
    }),
    ["HR_MANAGER"],
  );
  assert.equal(result.currentPhaseId, "ACTIVATION");
  assert.equal(result.phases[5].status, "COMPLETED");
  assert.equal(result.phases[6].status, "ACTION_REQUIRED");
  assert.equal(result.phases[6].primaryAction?.id, "ACTIVATE_EMPLOYMENT");
}

{
  const acceptedOffer = [
    {
      proposedBy: "hiring-manager",
      preparedAt: new Date(),
      hrApprovedAt: new Date(),
      financeApprovedAt: new Date(),
      candidateAcceptedAt: new Date(),
    },
  ];
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "OFFER",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
      compensationClearance: "APPROVED",
      compensationSnapshots: acceptedOffer,
      collateralClearance: "IN_PROGRESS",
      collateralItems: [{ required: true, status: "RECEIVED" }],
    }),
    ["FINANCE_MANAGER"],
  );
  assert.equal(result.currentPhaseId, "CONVERSION");
  assert.equal(result.phases[4].status, "ACTION_REQUIRED");
  assert.equal(result.phases[4].requiredComplete, 0);
}

{
  const acceptedOffer = [
    {
      proposedBy: "hiring-manager",
      preparedAt: new Date(),
      hrApprovedAt: new Date(),
      financeApprovedAt: new Date(),
      candidateAcceptedAt: new Date(),
    },
  ];
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "CLOSED",
      outcome: "HIRED",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
      compensationClearance: "APPROVED",
      compensationSnapshots: acceptedOffer,
      collateralClearance: "APPROVED",
      collateralItems: [{ required: true, status: "VERIFIED" }],
      convertedAt: new Date(),
    }),
  );
  assert.equal(result.currentPhaseId, "CONVERSION");
  assert.equal(result.phases[4].status, "BLOCKED");
  assert.deepEqual(
    result.phases[4].blockers.map((item) => item.code),
    ["EMPLOYMENT_LINK_MISSING"],
  );
}

{
  const acceptedOffer = [
    {
      proposedBy: "hiring-manager",
      preparedAt: new Date(),
      hrApprovedAt: new Date(),
      financeApprovedAt: new Date(),
      candidateAcceptedAt: new Date(),
    },
  ];
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "CLOSED",
      outcome: "HIRED",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
      compensationClearance: "APPROVED",
      compensationSnapshots: acceptedOffer,
      collateralClearance: "APPROVED",
      collateralItems: [{ required: true, status: "VERIFIED" }],
      convertedAt: new Date(),
      employmentRelationship: { status: "ACTIVE" },
      contractClearance: "APPROVED",
      contracts: [{ approvedAt: new Date() }],
      payrollParticipation: {},
      onboardingTasks: [
        {
          activationBlocker: true,
          status: "COMPLETE",
          ownerAuthority: "HR_MANAGER",
        },
      ],
    }),
  );
  assert.equal(result.currentPhaseId, "ACTIVATION");
  assert.ok(result.phases.every((phase) => phase.status === "COMPLETED"));
}

{
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "CLOSED",
      outcome: "REJECTED",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
    }),
    ["HIRING_MANAGER"],
  );
  assert.equal(result.currentPhaseId, "OFFER");
  assert.equal(result.phases[0].status, "COMPLETED");
  assert.equal(result.phases[1].status, "COMPLETED");
  assert.equal(result.phases[2].status, "COMPLETED");
  assert.ok(result.phases.slice(3).every((phase) => phase.status === "ENDED"));
  assert.equal(result.phases[2].primaryAction, null);
}

{
  const result = projectHiringLifecycle(
    base({ formRevisions: [submitted], stage: "SCREENING" }),
    ["HR_MANAGER"],
  );
  assert.equal(result.phases[1].status, "WAITING");
  assert.equal(result.phases[1].primaryAction, null);
  assert.equal(result.phases[1].secondaryActions.length, 0);
  assert.doesNotMatch(JSON.stringify(result.phases[1]), /REVIEW_IDENTITY/);
  const summary = summarizeHiringLifecycle(result);
  assert.equal(summary.phaseId, "IDENTITY");
  assert.equal(summary.actionLabel, null);
  assert.equal(summary.stepLabel, "مرحله 2 از 7");
}

{
  const result = projectHiringLifecycle(
    base({ formRevisions: [submitted], stage: "SCREENING" }),
  );
  assert.equal(result.phases[1].responsibleFunction, "کارشناس منابع انسانی");
}

{
  const result = projectHiringLifecycle(
    base({
      formRevisions: [submitted],
      stage: "OFFER",
      identityClearance: "APPROVED",
      assessmentCompletedAt: new Date(),
      compensationClearance: "REJECTED",
      compensationSnapshots: [
        {
          proposedBy: "hiring-manager",
          preparedAt: new Date(),
          hrApprovedAt: new Date(),
          financeApprovedAt: new Date(),
        },
      ],
    }),
    ["FINANCE_MANAGER"],
  );
  assert.equal(result.phases[3].status, "BLOCKED");
  assert.equal(result.phases[3].primaryAction, null);
  assert.equal(result.phases[3].secondaryActions.length, 0);
  assert.equal(
    result.phases[3].responsibleFunction,
    "مدیر استخدام‌کننده یا مدیریت حقوق و دستمزد",
  );
  assert.equal(summarizeHiringLifecycle(result).actionLabel, null);
}

{
  const lifecycleSummary = summarizeHiringLifecycle(
    projectHiringLifecycle(base()),
  );
  const item = buildHiringQueueItem(
    {
      id: "application-1",
      stage: "RECEIVED",
      outcome: null,
      updatedAt: new Date(0),
      candidate: {
        id: "candidate-1",
        firstName: "A",
        lastName: "B",
        mobile: "09120000000",
      },
      position: { id: "position-1", title: "Role" },
      secretAssessmentIds: ["must-not-leak"],
    } as any,
    lifecycleSummary,
  );
  assert.deepEqual(Object.keys(item).sort(), [
    "candidate",
    "id",
    "lifecycleSummary",
    "outcome",
    "position",
    "stage",
    "updatedAt",
  ]);
  assert.doesNotMatch(JSON.stringify(item), /must-not-leak/);
}

console.log("HR hiring lifecycle tests passed.");
