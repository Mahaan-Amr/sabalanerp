# Security instant reports and attendance operations

## Scope

This specification covers the Security workspace changes agreed on 2026-07-20:

- richer instant-report classification and conditional fields;
- multiple physical attendance intervals per personnel-day;
- Security-owned attendance exceptions and missions;
- consistent on-screen, PDF, and Excel reporting;
- staged retirement of the legacy day/night `Shift` label from company attendance.

## Instant reports

1. Every report stores its category directly. Report type is optional.
2. A category controls whether report types are used. When enabled, a type is required; when disabled, the type selector is hidden.
3. A category controls related-personnel visibility for category-only reports. A selected type controls it when types are enabled.
4. Related personnel are optional whenever the selector is visible.
5. Description is always visible and optional. Images are always visible and optional.
6. A report must contain at least one meaningful detail: description, image, or related personnel when enabled.
7. Category/type names are snapshotted on the report. Later renames, moves, activation changes, or policy changes never rewrite historical classification.
8. Disabling types or personnel selection affects new entry only; it never deletes configuration or history.

## Personnel attendance

1. A personnel-day contains an ordered collection of physical-presence intervals, each with one entry and an optional exit.
2. A new entry is allowed after the prior interval is closed. Only one interval may be open for a person across all dates.
3. An overnight interval belongs to the date of its entry. Its real entry and exit instants are retained.
4. Rest, temporary departure, and other off-site time are generic gaps between intervals; no fixed 13:00-15:00 break is hard-coded.
5. The daily summary uses first entry, final exit, summed completed presence, and summed gaps. An open interval makes totals pending.
6. First entry determines lateness. Final exit determines scheduled overtime under the existing policy.
7. New manually selected entry/exit times may have an optional reason. Closing a previous-day interval, correcting a saved movement, or voiding a movement requires a reason and audit history.
8. Existing attendance rows migrate to one interval without changing their visible historical meaning.
9. The legacy registrar shift is removed from company-attendance UI, filters, PDF, and Excel. Recording actor and actual Security planned-slot context remain audit metadata.

## Attendance exceptions and missions

1. For this phase these workflows are fully owned by Security users. Personnel do not submit requests.
2. The canonical terms are `Attendance Exception` (`استثنای حضور و غیاب`) and `Mission` (`ماموریت`).
3. Every authorized Security user may create, view, edit pending items, delete pending items, approve, reject, cancel, and correct items.
4. New items start pending. The UI may provide a create-and-approve shortcut, but creation and approval remain distinct audit events.
5. Pending items are editable and deletable. Approved/rejected/cancelled or attendance-linked history is never hard-deleted or silently overwritten.
6. Rejection, cancellation, and approved-history correction require reasons.
7. Approved full-day leave exempts absence and lateness but may coexist with real physical intervals.
8. Approved hourly leave is a precise window. Matching gaps are labelled hourly leave; a window covering scheduled start excuses lateness through its end.
9. Approved missions are precise windows and count as authorized work, not physical presence. Physical intervals before, during, or after remain factual evidence.
10. Pending, rejected, and cancelled items have no attendance effect. Approval never fabricates movement records.
11. Pending overlaps are warnings. Approval is blocked for overlapping approved leaves, overlapping approved missions, or leave/mission conflicts. Adjacent missions are allowed.
12. Total accounted work is the union of physical-presence and mission windows; overlapping time is counted once. Leave exempts expected time but does not add worked time.

## Output consistency

Daily UI, date-range reporting, personnel history, PDF, and Excel outputs must expose the same facts:

- first entry and final exit;
- complete movement timeline;
- physical-presence duration and off-site duration;
- approved exception and mission windows;
- accounted work without double-counting;
- pending/open states and audit reasons where the viewer is authorized.

## Compatibility and migration

- Existing report rows receive direct category links and immutable name snapshots from their current report types.
- Existing attendance rows receive one physical interval from their existing entry/exit values.
- Existing user-based exceptions and missions are linked to organizational personnel where a user-personnel link exists; legacy user identity remains readable.
- The legacy `Shift` entity remains temporarily for Security-personnel compatibility and historical reads, but it no longer classifies company attendance.
