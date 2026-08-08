import {
  projectHiringLifecycle,
  type HiringLifecycleProjection,
  type HiringLifecycleSource,
} from "./hrHiringLifecycle";

const FINANCE_AUTHORITIES = new Set(["FINANCE_RECORDER", "FINANCE_MANAGER"]);
const ACTIONABLE_COLLATERAL_OR_CONTRACT_ACTIONS = new Set([
  "COMPLETE_COLLATERAL",
  "UPLOAD_CONTRACT",
  "SUBMIT_CONTRACT",
  "APPROVE_CONTRACT",
]);

export const HR_HIRING_DASHBOARD_METRICS_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export type HrHiringAuthorityGrant = {
  authority: string;
  isActive: boolean;
  expiresAt?: Date | string | null;
};

export type HrHiringMetricApplication = HiringLifecycleSource & { id: string };

export type HrHiringDashboardMetrics = {
  availability: "available" | "unavailable";
  actionableCollateralOrContractCases?: number;
  activeCollateralTemplates?: number;
  generatedAt: string;
};

export const activeHiringAuthoritiesAt = (
  grants: HrHiringAuthorityGrant[],
  at: Date,
) => grants
  .filter((grant) => grant.isActive && (!grant.expiresAt || new Date(grant.expiresAt) > at))
  .map((grant) => grant.authority);

export const hrHiringDashboardMetricsResponse = (data: HrHiringDashboardMetrics) => ({
  success: true as const,
  data,
});

export const hiringLifecycleHasActionableCollateralOrContract = (
  lifecycle: HiringLifecycleProjection,
) => lifecycle.phases.some((phase) =>
  [phase.primaryAction, ...phase.secondaryActions].some(
    (action) => action && ACTIONABLE_COLLATERAL_OR_CONTRACT_ACTIONS.has(action.id),
  ),
);

export const buildHrHiringDashboardMetrics = ({
  viewerUserId,
  viewerAuthorities,
  applications,
  activeCollateralTemplates,
  generatedAt,
}: {
  viewerUserId: string;
  viewerAuthorities: Iterable<string>;
  applications: HrHiringMetricApplication[];
  activeCollateralTemplates: number;
  generatedAt: Date;
}): HrHiringDashboardMetrics => {
  const authorities = new Set(viewerAuthorities);
  if (![...authorities].some((authority) => FINANCE_AUTHORITIES.has(authority))) {
    return {
      availability: "unavailable",
      generatedAt: generatedAt.toISOString(),
    };
  }

  const actionableApplicationIds = new Set(
    applications
      .filter((application) => hiringLifecycleHasActionableCollateralOrContract(
        projectHiringLifecycle(application, authorities, viewerUserId),
      ))
      .map((application) => application.id),
  );

  return {
    availability: "available",
    actionableCollateralOrContractCases: actionableApplicationIds.size,
    activeCollateralTemplates,
    generatedAt: generatedAt.toISOString(),
  };
};
