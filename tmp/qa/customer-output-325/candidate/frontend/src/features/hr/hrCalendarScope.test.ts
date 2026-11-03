import assert from "node:assert/strict";
import { withAuthenticatedHrCalendarDefaults } from "./HrPersianCalendar";

const projected = withAuthenticatedHrCalendarDefaults({
  value: "1405/05/05",
  onChange: () => undefined,
});

assert.equal(projected.enableYearSelection, true);
assert.equal(projected.value, "1405/05/05");

const attemptedOverride = withAuthenticatedHrCalendarDefaults({
  value: "",
  onChange: () => undefined,
  enableYearSelection: false,
});

assert.equal(attemptedOverride.enableYearSelection, true);

console.log("Authenticated HR calendar scope tests passed.");
