export type HrHiringMetricsPayload = {
  availability: "available" | "unavailable";
  actionableCollateralOrContractCases?: number;
  activeCollateralTemplates?: number;
  generatedAt: string;
};

export type HrHiringMetricsState =
  | { status: "pending" | "unavailable" | "failed" }
  | {
      status: "available";
      actionableCollateralOrContractCases: number;
      activeCollateralTemplates: number;
      generatedAt: string;
    };

export const pendingHrHiringMetrics = (): HrHiringMetricsState => ({ status: "pending" });

export const clearHrHiringMetrics = (
  status: "unavailable" | "failed",
): HrHiringMetricsState => ({ status });

export const resolveHrHiringMetrics = (
  payload: HrHiringMetricsPayload,
): HrHiringMetricsState => {
  if (
    payload.availability !== "available"
    || typeof payload.actionableCollateralOrContractCases !== "number"
    || typeof payload.activeCollateralTemplates !== "number"
  ) return clearHrHiringMetrics("unavailable");

  return {
    status: "available",
    actionableCollateralOrContractCases: payload.actionableCollateralOrContractCases,
    activeCollateralTemplates: payload.activeCollateralTemplates,
    generatedAt: payload.generatedAt,
  };
};
