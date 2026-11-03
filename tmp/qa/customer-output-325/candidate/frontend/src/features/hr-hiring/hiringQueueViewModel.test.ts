import assert from "node:assert/strict";
import {
  buildHiringCaseHref,
  buildHiringQueueHref,
  buildHiringQueueParams,
  parseHiringQueueContext,
  validateHiringQueueReturnHref,
} from "./hiringQueueViewModel";

assert.deepEqual(
  buildHiringQueueParams({ attention: "", phase: "", outcome: "" }),
  {},
);

assert.deepEqual(parseHiringQueueContext(new URLSearchParams("archived=true&attention=BLOCKED&search=%D8%B3%D8%A7%D8%B1%D8%A7&page=3&sortBy=candidateName&sortDirection=desc")), {
  archived: true,
  filters: {
    attention: "BLOCKED",
    phase: "",
    outcome: "",
    search: "سارا",
    positionId: "",
    disposition: "",
    sortBy: "candidateName",
    sortDirection: "desc",
    page: 3,
  },
});
assert.equal(
  buildHiringQueueHref({
    attention: "BLOCKED",
    phase: "",
    outcome: "REJECTED",
    search: "سارا",
    positionId: "",
    disposition: "",
    sortBy: "priority",
    sortDirection: "asc",
    page: 2,
  }, false),
  "/dashboard/hr/hiring?attention=BLOCKED&outcome=REJECTED&search=%D8%B3%D8%A7%D8%B1%D8%A7&page=2",
);
assert.equal(validateHiringQueueReturnHref("/dashboard/hr/hiring?search=سارا&page=2"), "/dashboard/hr/hiring?search=%D8%B3%D8%A7%D8%B1%D8%A7&page=2");
assert.equal(validateHiringQueueReturnHref("/dashboard/hr/hiring/other?search=سارا"), "/dashboard/hr/hiring");
assert.equal(validateHiringQueueReturnHref("/dashboard/hr/hiring?unknown=secret"), "/dashboard/hr/hiring");
assert.equal(
  buildHiringCaseHref("application-1", "/dashboard/hr/hiring?archived=true&search=%D8%B3%D8%A7%D8%B1%D8%A7"),
  "/dashboard/hr/hiring/application-1?returnTo=%2Fdashboard%2Fhr%2Fhiring%3Farchived%3Dtrue%26search%3D%25D8%25B3%25D8%25A7%25D8%25B1%25D8%25A7",
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
