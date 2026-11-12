# Legacy e407 work reconciliation: first-release decision

Issue #429 remains blocked for the first protected update. This is a read-only
code and evidence review, not a production admission receipt. The protected
runner's `LEGACY_WORK_COMPLETION_UNPROVEN` preflight must remain in force.

## Bound evidence

- The running backend was observed with immutable image
  `sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3`
  and `/app/dist/index.js` SHA-256
  `6ef91091d24e43798cd704cf66889f8e16155eae0ef91006bb7bfe7308dffe0c`.
  Its image source labels are `unattested`. The copied image's 1,165 compiled
  JavaScript files match a local transpilation of historical commit `b58c53c0`
  byte-for-byte, but that comparison is not full image provenance. See the
  production-update roadmap entries 492 and 584 in the working evidence.
- That entry point starts fifteen producer categories after recovery
  initialization. Its SIGTERM handler stops only the biometric and vehicle
  timers, then closes Socket.IO/HTTP and Prisma and explicitly exits zero.
  A controlled reproduction of this handler exited zero with admitted work
  unfinished (roadmap entry 622). The other producers are not joined.
- The measured production environment has live SMS.ir configuration. The
  taxpayer broker endpoint was absent at inspection time, but this is a
  time-specific observation and does not disable SMS or Web Push. See
  `docs/operations/legacy-backend-work-closure.md`.

## Concrete unresolved effect

The image-matched `smsService.sendTemplate` POSTs to `/send/verify` with the
mobile, template ID and parameters. It sends no durable application operation
ID or idempotency header. A successful response supplies a provider message
ID; the available delivery-report lookup requires that ID. If the provider
accepts the POST but the response is lost, the application does not have that
ID for lookup. The dispatch SMS worker records some ambiguous results as
`UNKNOWN`, but a stopped promise can remain `SENDING` until later recovery,
and other SMS callers need separate analysis. An empty or settled database
query cannot establish that the provider did not accept such a request.

The notification worker also sends Web Push. Its scheduled work and external
submission need their own claim and recipient-level reconciliation. The tax
outbox has a request identity for its broker, but its absent endpoint on one
inspection cannot qualify other effects or future configuration.

## Required evidence before changing admission

1. A complete inventory against the immutable image of every startup and
   recovery path that can claim work or produce an external effect, including
   each path's claim identity, transaction boundary, retry behavior, and
   candidate and rollback behavior.
2. A demonstrated admission fence for *every* producer before the terminal
   census. The existing e407 process has no completion-aware drain or
   worker-wide stop control; HTTP maintenance and polling for zero rows do
   not fence its timers.
3. Provider-side receipts or a proven lookup by application intent for every
   possibly accepted SMS and other external effect, including lost responses.
   Any unresolvable effect needs durable quarantine that suppresses automatic
   retry in both candidate and rollback releases until reviewed reconciliation.
4. An interruption-safe receipt bound to the image, process incarnation,
   maintenance lease, census identities, provider evidence and exceptions,
   checked before the existing checkpoint and before mutation. A focused
   exact-image rehearsal needs to inject a lost provider response and prove
   the resulting hold or safe reconciliation with isolated data and fake
   providers.

None of these missing facts can be inferred from exit status, SQL closure,
elapsed time, or the current database snapshot. Until they are independently
demonstrated, the finite safe gate is unavailable. No production container,
database, provider, or Docker service was changed in this review.
