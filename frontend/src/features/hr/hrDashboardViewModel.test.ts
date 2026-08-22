import assert from "node:assert/strict";
import {
  hasHrWorkspaceAccess,
  positionCapacityCoverage,
  shouldShowHrPersonalDashboard,
} from "./hrDashboardViewModel";

assert.equal(
  hasHrWorkspaceAccess([{ workspace: "hr", permissionLevel: "view" }]),
  true,
  "the personal HR dashboard surface belongs to every user with HR workspace access",
);

assert.equal(
  hasHrWorkspaceAccess([{ workspace: "accounting", permissionLevel: "admin" }]),
  false,
  "access to another workspace must not expose the HR dashboard surface",
);

assert.equal(
  shouldShowHrPersonalDashboard(
    [{ workspace: "hr", permissionLevel: "view" }],
    "limited",
  ),
  true,
  "HR workspace users keep the personal progress and follow-up dashboard even with a limited landing",
);

assert.equal(
  shouldShowHrPersonalDashboard(
    [{ workspace: "accounting", permissionLevel: "admin" }],
    "limited",
  ),
  false,
  "an unrelated workspace must not expose the HR personal dashboard",
);

assert.equal(
  shouldShowHrPersonalDashboard([], "dashboard"),
  true,
  "the full HR dashboard landing continues to show its dashboard surface",
);

assert.deepEqual(positionCapacityCoverage(8, 20), {
  committed: 8,
  total: 28,
  percentage: 29,
});

assert.deepEqual(positionCapacityCoverage(0, 0), {
  committed: 0,
  total: 0,
  percentage: null,
});

assert.deepEqual(positionCapacityCoverage(-3, 7), {
  committed: 0,
  total: 7,
  percentage: 0,
});

assert.deepEqual(positionCapacityCoverage(Number.NaN, Number.NaN), {
  committed: 0,
  total: 0,
  percentage: null,
});

console.log("HR dashboard view-model tests passed.");
