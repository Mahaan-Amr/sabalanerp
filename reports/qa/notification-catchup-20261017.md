# Authoritative notification catch-up and browser ownership

Issue #405 remains open. This slice does not switch production users, certify
24-hour form compatibility or enable online migrations.

The notification inbox and shell preview reread the durable REST inbox on first
mount, reconnect, visibility/focus, read-state changes and a visible 30-second
poll. Socket messages are hints; their private payload and count increments are
not trusted. Bursts coalesce with a trailing read. Refresh follows fresh cursors
for the loaded page depth and does not overwrite unsaved preference fields.

Each private notification operation first probes the authoritative cookie
session for the expected account. Simultaneous operations share only that probe;
later operations probe again. Both expected account and exact session ID narrow
the following backend request. They never replace cookie authentication. A
cookie swap between probe and operation is rejected before the route runs.
Uninstrumented retained clients keep their existing authentication contract.
Responses are private/no-store. Socket handshakes optionally bind the expected
account too. A denied generation cannot repaint an older successful response.

Account-keyed components retire previous account state. Every scope-denied
mutation blocks the private page or clears the shell preview immediately.
Scope-denied requests do not automatically navigate away from unsaved input.
Other platform APIs and durable draft migration still need their own complete
handoff integration; this is not a platform-wide draft-preservation claim.

Actual PostgreSQL/HTTP/Socket.IO acceptance uses an isolated database in the
existing `sabalanerp-local` PostgreSQL service. The real auth router/middleware
checks legacy requests, bound mutations, wrong-account cookies, replaced sessions,
user-only mutation rejection, owner-only `/auth/me` probes and wrong-account
Socket.IO handshakes. Domain counters show rejected requests never mutate. The
provider/expiry/retirement regression remains included; no real provider contact.

The targeted SDS browser suite runs the worktree's compiled frontend in the
existing project's opt-in `frontend-candidate` slot on 127.0.0.1:3101. Its reviewed
build output/configuration is read-only. Canonical services are untouched. API
responses are controlled browser fixtures, explicitly separate from real backend
enforcement evidence. Five browser cases cover loaded-page and unsaved-field
preservation, page read-all/device rejection, and shell read-all/read-one denial.
Light/dark mobile at 200% zoom also checks overflow and serious Axe violations.
The first run caught low-contrast timestamps; semantic secondary text fixes it.
Mobile rows stack and preference labels wrap at narrow widths.

Final results on 2026-10-17: eight frontend unit cases and six backend runtime/
binding cases passed; the actual PostgreSQL/provider/HTTP/Socket.IO run passed
in 72.42 seconds with zero skips. All five browser cases passed in 15.2 seconds
against build `erp_notification_catchup_20261017`, after the final mobile layout
fix. Both retained light/dark 200% screenshots were visually inspected. The SDS
foundation (25) and adoption (14) suites, changed-source check, architecture
check and frontend/backend compilation passed. Existing unrelated frontend
hook warnings remain. No canonical service was restarted for this work.

Validation commands:

- `npm --prefix frontend run test:notification-catchup`
- `npm --prefix backend run test:online-delivery`
- `ONLINE_DEPLOYMENT_TEST_DATABASE_URL=<existing-local-url> npm --prefix backend run test:online-delivery:db`
- `DESIGN_SYSTEM_E2E_BASE_URL=http://127.0.0.1:3101 npm run test:design-system:e2e -- notification-catchup.spec.ts`
- `npm run design-system:check`, foundation/adoption suites, frontend/backend
  builds and `npm run architecture:check`.

Independent Standards and Spec review verified request/session ownership and
the mutation-denial fixes. Final compiled artifacts are diagnostic mounts;
production still requires frozen immutable candidate images and the remaining
recovery, migration, fencing, browser-retention and failure-matrix gates.
