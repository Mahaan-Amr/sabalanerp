import assert from "node:assert/strict";
import {
  buildHrHiringDashboardMetrics,
  type HrHiringMetricApplication,
} from "../hrHiringDashboardMetrics";

const submitted = { status: "SUBMITTED" };
const onboardingSource = (overrides: Partial<HrHiringMetricApplication> = {}): HrHiringMetricApplication => ({
  id: "application-1",
  stage: "ONBOARDING",
  formRevisions: [submitted],
  preIdentityGrandfatheredAt: new Date(0),
  identityClearance: "APPROVED",
  assessmentCompletedAt: new Date(),
  assessmentDecision: "APPROVED",
  compensationClearance: "APPROVED",
  compensationSnapshots: [{
    proposedBy: "hiring-manager",
    preparedAt: new Date(),
    hrApprovedAt: new Date(),
    financeApprovedAt: new Date(),
    candidateAcceptedAt: new Date(),
  }],
  collateralClearance: "APPROVED",
  collateralItems: [{ required: true, status: "VERIFIED" }],
  convertedAt: new Date(),
  employmentRelationship: { status: "PLANNED" },
  contractClearance: "IN_PROGRESS",
  contracts: [{ uploadedBy: "recorder-1" }],
  onboardingTasks: [],
  ...overrides,
});

{
  const generatedAt = new Date("2026-08-08T08:00:00.000Z");
  const result = buildHrHiringDashboardMetrics({
    viewerUserId: "recorder-1",
    viewerAuthorities: ["FINANCE_RECORDER"],
    applications: [
      onboardingSource(),
      onboardingSource({ id: "application-2", contracts: [] }),
      onboardingSource({ id: "application-3", contractClearance: "APPROVED", contracts: [{ uploadedBy: "recorder-2", approvedAt: new Date() }], payrollParticipation: {} }),
    ],
    activeCollateralTemplates: 4,
    generatedAt,
  });

  assert.deepEqual(result, {
    availability: "available",
    actionableCollateralOrContractCases: 2,
    activeCollateralTemplates: 4,
    generatedAt: generatedAt.toISOString(),
  });
}

{
  const submittedForReview = onboardingSource({
    contracts: [{ uploadedBy: "recorder-1", submittedAt: new Date() }],
  });
  const managerResult = buildHrHiringDashboardMetrics({
    viewerUserId: "manager-1",
    viewerAuthorities: ["FINANCE_MANAGER"],
    applications: [submittedForReview],
    activeCollateralTemplates: 0,
    generatedAt: new Date(0),
  });
  const uploaderResult = buildHrHiringDashboardMetrics({
    viewerUserId: "recorder-1",
    viewerAuthorities: ["FINANCE_MANAGER"],
    applications: [submittedForReview],
    activeCollateralTemplates: 0,
    generatedAt: new Date(0),
  });

  assert.equal(managerResult.actionableCollateralOrContractCases, 1);
  assert.equal(uploaderResult.actionableCollateralOrContractCases, 0);
}

{
  const result = buildHrHiringDashboardMetrics({
    viewerUserId: "accounting-only-user",
    viewerAuthorities: ["HR_PROCESSOR"],
    applications: [onboardingSource()],
    activeCollateralTemplates: 9,
    generatedAt: new Date(0),
  });

  assert.deepEqual(result, {
    availability: "unavailable",
    generatedAt: new Date(0).toISOString(),
  });
  assert.deepEqual(Object.keys(result).sort(), ["availability", "generatedAt"]);
}

console.log("HR hiring dashboard metric tests passed.");
