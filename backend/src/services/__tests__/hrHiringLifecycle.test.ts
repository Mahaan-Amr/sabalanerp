import assert from "node:assert/strict";
import "./hrHiringDashboardMetrics.test";
import {
  buildHiringQueueItem,
  projectHiringTaskCapabilities,
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
  assessmentDecision: "APPROVED",
  preIdentityGrandfatheredAt: new Date(0),
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
  assert.equal(result.totalPhases, 9);
  assert.deepEqual(result.phases.map(({ id }) => id), [
    "APPLICATION",
    "INITIAL_HR_REVIEW",
    "FORMAL_ASSESSMENTS",
    "COMPANY_EVALUATION_PLAN",
    "IDENTITY",
    "OFFER",
    "CONVERSION",
    "ONBOARDING",
    "ACTIVATION",
  ]);
}

{
  const result = projectHiringLifecycle(base({
    preIdentityGrandfatheredAt: null,
    formRevisions: [submitted],
    hiringDecisions: [
      { kind: "HR_INTERVIEW", outcome: "POSITIVE", version: 1 },
      { kind: "HR_PRELIMINARY_APPROVAL", outcome: "POSITIVE", version: 1 },
    ],
    formalAssessmentPlans: [{
      version: 1,
      status: "ACTIVE",
      explicitlyNoAssessment: true,
      selections: [],
      results: [],
    }],
  }));
  assert.equal(result.phases[1].status, "COMPLETED");
  assert.equal(result.phases[2].status, "COMPLETED");
  assert.equal(result.currentPhaseId, "COMPANY_EVALUATION_PLAN");
}

{
  const result = projectHiringLifecycle(base({
    preIdentityGrandfatheredAt: null,
    formRevisions: [submitted],
    hiringDecisions: [
      { kind: "HR_INTERVIEW", outcome: "POSITIVE", version: 1 },
      { kind: "HR_PRELIMINARY_APPROVAL", outcome: "POSITIVE", version: 1 },
    ],
    formalAssessmentPlans: [{
      version: 2,
      status: "ACTIVE",
      explicitlyNoAssessment: false,
      selections: [
        { assessmentKind: "DISC", selected: true, executionMethod: "APPLICANT" },
        { assessmentKind: "EQ", selected: true, executionMethod: "COMPANY" },
      ],
      results: [
        { assessmentKind: "DISC", resultVersion: 1, status: "COMPLETED" },
        { assessmentKind: "EQ", resultVersion: 1, status: "PENDING" },
      ],
    }],
  }), ["HR_PROCESSOR"]);
  assert.equal(result.currentPhaseId, "FORMAL_ASSESSMENTS");
  assert.equal(result.phases[2].requiredComplete, 1);
  assert.equal(result.phases[2].requiredTotal, 2);
  assert.deepEqual(result.phases[2].blockers.map(({ code }) => code), [
    "FORMAL_ASSESSMENT_RESULT_MISSING:EQ",
  ]);
  assert.equal(result.phases[2].primaryAction?.id, "RECORD_COMPANY_ASSESSMENT_RESULT:EQ");
}

{
  const result = projectHiringLifecycle(base());
  assert.equal(result.currentPhaseId, "APPLICATION");
  assert.equal(result.phases[0].status, "WAITING");
  assert.equal(result.phases[1].status, "COMPLETED");
  assert.equal(result.phases[4].status, "UPCOMING");
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
  assert.equal(result.phases[5].status, "ACTION_REQUIRED");
  assert.equal(result.phases[5].primaryAction?.id, "PREPARE_OFFER_PAYROLL");
  assert.equal(result.phases[5].requiredComplete, 1);
  assert.equal(result.phases[5].requiredTotal, 5);
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
  assert.equal(result.phases[4].status, "ACTION_REQUIRED");
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
  assert.equal(result.phases[4].status, "BLOCKED");
  assert.deepEqual(
    result.phases[4].blockers.map((item) => item.code),
    ["IDENTITY_REJECTED"],
  );
}

{
  const result = projectHiringLifecycle(base({
    preIdentityGrandfatheredAt: null,
    formRevisions: [submitted],
    hiringDecisions: [
      { kind: "HR_INTERVIEW", outcome: "POSITIVE", version: 1 },
      { kind: "HR_PRELIMINARY_APPROVAL", outcome: "POSITIVE", version: 1 },
    ],
  }), ["COMPANY_MANAGER"]);
  assert.equal(result.currentPhaseId, "FORMAL_ASSESSMENTS");
  assert.equal(result.phases[2].status, "BLOCKED");
  assert.equal(result.phases[2].primaryAction, null);
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
  assert.equal(result.phases[5].status, "WAITING");
  assert.equal(result.phases[5].requiredComplete, 4);
  assert.equal(result.phases[5].requiredTotal, 5);
  assert.equal(result.phases[5].primaryAction, null);
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
      scheduledStartDate: new Date("2020-01-01"),
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
  assert.equal(result.phases[7].status, "COMPLETED");
  assert.equal(result.phases[8].status, "ACTION_REQUIRED");
  assert.equal(result.phases[8].primaryAction?.id, "ACTIVATE_EMPLOYMENT");
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
  assert.equal(result.phases[6].status, "ACTION_REQUIRED");
  assert.equal(result.phases[6].requiredComplete, 0);
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
  assert.equal(result.phases[6].status, "BLOCKED");
  assert.deepEqual(
    result.phases[6].blockers.map((item) => item.code),
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
    ["COMPANY_MANAGER"],
  );
  assert.equal(result.currentPhaseId, "OFFER");
  assert.equal(result.phases[0].status, "COMPLETED");
  assert.equal(result.phases[1].status, "COMPLETED");
  assert.equal(result.phases[4].status, "COMPLETED");
  assert.ok(result.phases.slice(5).every((phase) => phase.status === "ENDED"));
  assert.equal(result.phases[4].primaryAction, null);
}

{
  const result = projectHiringLifecycle(
    base({ formRevisions: [submitted], stage: "SCREENING" }),
    ["HR_MANAGER"],
  );
  assert.equal(result.phases[4].status, "WAITING");
  assert.equal(result.phases[4].primaryAction, null);
  assert.equal(result.phases[4].secondaryActions.length, 0);
  assert.doesNotMatch(JSON.stringify(result.phases[4]), /REVIEW_IDENTITY/);
  const summary = summarizeHiringLifecycle(result);
  assert.equal(summary.phaseId, "IDENTITY");
  assert.equal(summary.actionLabel, null);
  assert.equal(summary.stepLabel, "مرحله 5 از 9");
}

{
  const result = projectHiringLifecycle(
    base({ formRevisions: [submitted], stage: "SCREENING" }),
  );
  assert.equal(result.phases[4].responsibleFunction, "کارشناس منابع انسانی");
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
  assert.equal(result.phases[5].status, "BLOCKED");
  assert.equal(result.phases[5].primaryAction, null);
  assert.equal(result.phases[5].secondaryActions.length, 0);
  assert.equal(
    result.phases[5].responsibleFunction,
    "مدیریت شرکت یا مدیریت حقوق و دستمزد",
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
    "decisionDetailsVisible",
    "decisionHistory",
    "decisions",
    "disposition",
    "dispositionReason",
    "id",
    "lifecycleSummary",
    "outcome",
    "position",
    "stage",
    "updatedAt",
  ]);
  assert.doesNotMatch(JSON.stringify(item), /must-not-leak/);
}

{
  const result = projectHiringLifecycle(
    base({
      preIdentityGrandfatheredAt: null,
      formRevisions: [submitted],
      hiringDecisions: [
        { kind: "HR_INTERVIEW", outcome: "POSITIVE", version: 1 },
        { kind: "HR_PRELIMINARY_APPROVAL", outcome: "POSITIVE", version: 1 },
      ],
      preIdentityRequirementsFinalizedAt: new Date(),
      preIdentityChecklistItems: [{ status: "POSITIVE" }],
      formalAssessmentPlans: [{ version: 1, status: "ACTIVE", explicitlyNoAssessment: true }],
    }),
    ["COMPANY_MANAGER"],
  );
  assert.equal(result.currentPhaseId, "COMPANY_EVALUATION_PLAN");
  assert.equal(result.phases[3].status, "ACTION_REQUIRED");
  assert.equal(result.phases[3].primaryAction?.id, "APPROVE_PRE_IDENTITY");
}

{
  const result = projectHiringLifecycle(
    base({
      disposition: "RESERVE",
      preIdentityGrandfatheredAt: null,
      formRevisions: [submitted],
      hiringDecisions: [
        { kind: "HR_INTERVIEW", outcome: "POSITIVE", version: 1 },
        { kind: "HR_PRELIMINARY_APPROVAL", outcome: "POSITIVE", version: 1 },
      ],
      formalAssessmentPlans: [{ version: 1, status: "ACTIVE", explicitlyNoAssessment: true }],
    }),
  );
  assert.equal(result.currentPhaseId, "COMPANY_EVALUATION_PLAN");
  assert.equal(result.phases[3].status, "PAUSED");
  assert.equal(result.phases[3].primaryAction, null);
  assert.equal(result.phases[3].secondaryActions.length, 0);
}

{
  const source = base({
    convertedAt: new Date(),
    employmentRelationship: { status: "PLANNED" },
    contractClearance: "IN_PROGRESS",
    contracts: [{ approvedAt: null }],
    insuranceEnrollment: { status: "IN_PROGRESS" },
    payrollParticipation: null,
    onboardingTasks: [
      {
        title: "آموزش ایمنی",
        status: "PENDING",
        ownerAuthority: "HR_PROCESSOR",
        activationBlocker: true,
      },
    ],
  });

  const hrManager = projectHiringTaskCapabilities(source, ["HR_MANAGER"], "hr-manager");
  assert.deepEqual(
    hrManager.map(({ id, status, detailVisible, actionIds }) => ({
      id,
      status,
      detailVisible,
      actionIds,
    })),
    [
      { id: "SIGNED_CONTRACT", status: "IN_PROGRESS", detailVisible: false, actionIds: [] },
      { id: "INSURANCE", status: "IN_PROGRESS", detailVisible: false, actionIds: [] },
      { id: "PAYROLL_PARTICIPATION", status: "PENDING", detailVisible: false, actionIds: [] },
      { id: "EMPLOYMENT_ACTIVATION", status: "BLOCKED", detailVisible: true, actionIds: [] },
      { id: "ONBOARDING_TASK", status: "PENDING", detailVisible: false, actionIds: [] },
    ],
  );

  const hrProcessor = projectHiringTaskCapabilities(source, ["HR_PROCESSOR"]);
  assert.equal(
    hrProcessor.find((task) => task.id === "INSURANCE")?.detailVisible,
    true,
  );
  assert.deepEqual(
    hrProcessor.find((task) => task.id === "INSURANCE")?.actionIds,
    ["UPDATE_INSURANCE"],
  );
  assert.equal(
    projectHiringTaskCapabilities(
      base({
        ...source,
        insuranceEnrollment: {
          registrationPath: "COMPANY",
          status: "IN_PROGRESS",
          dueDate: new Date("2020-01-01"),
        },
      }),
      ["HR_PROCESSOR"],
      "processor-1",
    ).find((task) => task.id === "INSURANCE")?.overdue,
    true,
  );
  assert.equal(
    hrProcessor.find((task) => task.id === "SIGNED_CONTRACT")?.detailVisible,
    false,
  );

  const genericViewer = projectHiringTaskCapabilities(source, []);
  assert.ok(genericViewer.every((task) => !task.detailVisible));
  assert.ok(genericViewer.every((task) => task.actionIds.length === 0));
}

{
  const onboardingSource = base({
    formRevisions: [submitted],
    identityClearance: "APPROVED",
    assessmentCompletedAt: new Date(),
    assessmentDecision: "APPROVED",
    compensationClearance: "APPROVED",
    compensationSnapshots: [
      {
        proposedBy: "hiring-manager",
        preparedAt: new Date(),
        hrApprovedAt: new Date(),
        financeApprovedAt: new Date(),
        candidateAcceptedAt: new Date(),
      },
    ],
    collateralClearance: "APPROVED",
    collateralItems: [{ required: true, status: "VERIFIED" }],
    convertedAt: new Date(),
    employmentRelationship: { status: "PLANNED" },
    contractClearance: "IN_PROGRESS",
    contracts: [{ uploadedBy: "recorder-1", approvedAt: null }],
  });
  const recorder = projectHiringLifecycle(onboardingSource, ["FINANCE_RECORDER"]);
  assert.equal(recorder.phases[7].primaryAction?.id, "SUBMIT_CONTRACT");

  const submittedSource = base({
    ...onboardingSource,
    contracts: [
      {
        uploadedBy: "recorder-1",
        submittedAt: new Date(),
        approvedAt: null,
      },
    ],
  });
  const manager = projectHiringLifecycle(submittedSource, ["FINANCE_MANAGER"], "manager-2");
  assert.equal(manager.phases[7].primaryAction?.id, "APPROVE_CONTRACT");
  const selfReview = projectHiringLifecycle(submittedSource, ["FINANCE_MANAGER"], "recorder-1");
  assert.equal(selfReview.phases[7].primaryAction, null);
  assert.deepEqual(
    projectHiringTaskCapabilities(submittedSource, ["FINANCE_MANAGER"], "recorder-1")
      .find((task) => task.id === "SIGNED_CONTRACT")?.actionIds,
    [],
  );
  assert.deepEqual(
    projectHiringTaskCapabilities(submittedSource, ["FINANCE_MANAGER"], "manager-2")
      .find((task) => task.id === "SIGNED_CONTRACT")?.actionIds,
    ["REVIEW_CONTRACT"],
  );

  const returned = projectHiringLifecycle(
    base({
      ...submittedSource,
      contractClearance: "REJECTED",
      contracts: [
        {
          uploadedBy: "recorder-1",
          submittedAt: new Date(),
          returnedAt: new Date(),
          approvedAt: null,
        },
      ],
    }),
    ["FINANCE_RECORDER"],
  );
  assert.deepEqual(
    projectHiringTaskCapabilities(
      base({
        ...submittedSource,
        contractClearance: "REJECTED",
        contracts: [
          {
            uploadedBy: "recorder-1",
            submittedAt: new Date(),
            returnedAt: new Date(),
            approvedAt: null,
          },
        ],
      }),
      ["FINANCE_RECORDER"],
    ).find((task) => task.id === "SIGNED_CONTRACT")?.actionIds,
    ["RECORD_CONTRACT"],
  );
  assert.ok(
    returned.phases[7].blockers.some(
      (item) => item.code === "CONTRACT_REJECTED",
    ),
  );
}

console.log("HR hiring lifecycle tests passed.");
