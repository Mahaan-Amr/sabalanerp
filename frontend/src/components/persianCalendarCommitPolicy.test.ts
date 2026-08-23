import assert from "node:assert/strict";
import {
  resolveDateTimeSelection,
} from "./persianCalendarCommitPolicy";

assert.deepEqual(
  resolveDateTimeSelection({
    initialValue: "",
    draftDate: "",
    draftTime: "",
    changedPart: "date",
    nextValue: "1405/06/01",
  }),
  { date: "1405/06/01", time: "", commitValue: "1405/06/01" },
);

assert.deepEqual(
  resolveDateTimeSelection({
    initialValue: "",
    draftDate: "1405/06/01",
    draftTime: "",
    changedPart: "time",
    nextValue: "14:30",
  }),
  {
    date: "1405/06/01",
    time: "14:30",
    commitValue: "1405/06/01 14:30",
  },
);

assert.deepEqual(
  resolveDateTimeSelection({
    initialValue: "1405/06/01 14:30",
    draftDate: "1405/06/01",
    draftTime: "15:45",
    changedPart: "date",
    nextValue: "1405/06/02",
  }),
  {
    date: "1405/06/02",
    time: "14:30",
    commitValue: "1405/06/02 14:30",
  },
);

assert.deepEqual(
  resolveDateTimeSelection({
    initialValue: "1405/06/01 14:30",
    draftDate: "1405/06/01",
    draftTime: "14:30",
    changedPart: "time",
    nextValue: "15:45",
  }),
  {
    date: "1405/06/01",
    time: "15:45",
    commitValue: "1405/06/01 15:45",
  },
);

console.log("Persian calendar auto-commit policy tests passed.");
