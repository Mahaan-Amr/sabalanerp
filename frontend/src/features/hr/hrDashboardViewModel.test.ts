import assert from "node:assert/strict";
import { positionCapacityCoverage } from "./hrDashboardViewModel";

assert.deepEqual(positionCapacityCoverage(8, 20), {
  committed: 8,
  total: 28,
  percentage: 29,
});

assert.deepEqual(positionCapacityCoverage(0, 0), {
  committed: 0,
  total: 0,
  percentage: 0,
});

assert.deepEqual(positionCapacityCoverage(-3, 7), {
  committed: 0,
  total: 7,
  percentage: 0,
});

assert.deepEqual(positionCapacityCoverage(Number.NaN, Number.NaN), {
  committed: 0,
  total: 0,
  percentage: 0,
});

console.log("HR dashboard view-model tests passed.");
