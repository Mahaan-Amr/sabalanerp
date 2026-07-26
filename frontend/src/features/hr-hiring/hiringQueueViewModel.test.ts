import assert from "node:assert/strict";
import { buildHiringQueueParams } from "./hiringQueueViewModel";

assert.deepEqual(
  buildHiringQueueParams({ attention: "", phase: "", outcome: "" }),
  {},
);
assert.deepEqual(
  buildHiringQueueParams({
    attention: "",
    phase: "",
    outcome: "",
    search: "  سارا  ",
    positionId: "position-1",
    disposition: "RESERVE",
    sortBy: "candidateName",
    sortDirection: "asc",
    page: 2,
  }),
  {
    search: "سارا",
    positionId: "position-1",
    disposition: "RESERVE",
    sortBy: "candidateName",
    sortDirection: "asc",
    page: "2",
    pageSize: "50",
  },
);
assert.deepEqual(
  buildHiringQueueParams({ attention: "", phase: "", outcome: "ALL" }),
  { includeHired: "true" },
);
assert.deepEqual(
  buildHiringQueueParams({
    attention: "MY_ACTIONS",
    phase: "OFFER",
    outcome: "",
  }),
  { myActions: "true", phase: "OFFER" },
);
assert.deepEqual(
  buildHiringQueueParams({
    attention: "BLOCKED",
    phase: "",
    outcome: "REJECTED",
  }),
  { lifecycleStatus: "BLOCKED", outcome: "REJECTED" },
);
assert.deepEqual(
  buildHiringQueueParams({
    attention: "WAITING",
    phase: "IDENTITY",
    outcome: "",
  }),
  { lifecycleStatus: "WAITING", phase: "IDENTITY" },
);

console.log("HR hiring queue view-model tests passed.");
