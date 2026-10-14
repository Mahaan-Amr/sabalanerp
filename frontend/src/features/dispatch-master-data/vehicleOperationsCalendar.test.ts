import test from "node:test";
import assert from "node:assert/strict";
import {
  vehicleOperationsCalendarMaxYear,
  tehranToday,
  assignmentDateTime,
} from "./vehicleOperationsCalendar";
test("fleet calendar ceiling rolls once at Nowruz in Tehran rather than January or host midnight", () => {
  assert.equal(
    vehicleOperationsCalendarMaxYear(new Date("2026-10-14T12:00Z")),
    1420,
  );
  assert.equal(
    vehicleOperationsCalendarMaxYear(new Date("2027-01-01T12:00Z")),
    1420,
  );
  assert.equal(
    vehicleOperationsCalendarMaxYear(new Date("2027-03-22T12:00Z")),
    1421,
  );
  assert.equal(tehranToday(new Date("2026-10-14T21:00Z")), "2026-10-15");
});

test("assignment wall time is interpreted in Tehran independently of the host timezone", () => {
  assert.equal(
    assignmentDateTime("2026-10-14", "08:00"),
    "2026-10-14T04:30:00.000Z",
  );
});
