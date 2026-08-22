import assert from "node:assert/strict";
import {
  hasHrWorkspaceAccess,
  positionCapacityCoverage,
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
