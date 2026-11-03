import assert from "node:assert/strict";
import {
  clearHrHiringMetrics,
  pendingHrHiringMetrics,
  resolveHrHiringMetrics,
} from "./hrHiringMetricsState";

assert.deepEqual(pendingHrHiringMetrics(), { status: "pending" });

assert.deepEqual(resolveHrHiringMetrics({
  availability: "available",
  actionableCollateralOrContractCases: 0,
  activeCollateralTemplates: 0,
  generatedAt: "2026-08-08T08:00:00.000Z",
}), {
  status: "available",
  actionableCollateralOrContractCases: 0,
  activeCollateralTemplates: 0,
  generatedAt: "2026-08-08T08:00:00.000Z",
});

assert.deepEqual(resolveHrHiringMetrics({
  availability: "unavailable",
  generatedAt: "2026-08-08T08:00:00.000Z",
}), { status: "unavailable" });

assert.deepEqual(clearHrHiringMetrics("failed"), { status: "failed" });
assert.deepEqual(clearHrHiringMetrics("unavailable"), { status: "unavailable" });

console.log("Accounting HR hiring metric state tests passed.");
