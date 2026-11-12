# First protected update: legacy backend work boundary

Issue #429 applies to the measured production backend image
`sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3`.
The image's source labels say `unattested`; the production checkout commit does
not identify its compiled contents. This inventory comes from the copied image
artifact, not from current TypeScript. Confirm the running immutable image and
container incarnation again at release preflight.

The observed `/app/dist/index.js` has SHA-256
`6ef91091d24e43798cd704cf66889f8e16155eae0ef91006bb7bfe7308dffe0c`.
After recovery initialization in `NORMAL` mode it starts 15 producers before
opening HTTP: authentication retention, hiring invitation delivery, personnel
erasure recovery, system recovery maintenance, notification outbox delivery,
support ticket maintenance, dispatch buyer SMS delivery, HR vehicle assignment
maintenance, contract cancellation notice delivery, Accounting taxpayer outbox
delivery, cross-workspace duty deadline maintenance, personnel performance
maintenance, ordinary contract expiry, biometric staged-capture maintenance,
and partner Inquiry notification delivery. Startup and the recovery initializer
can themselves change database state.

The observed SIGTERM handler stops the biometric and vehicle timers only. It
then closes Socket.IO/HTTP, disconnects Prisma, and calls `process.exit(0)`.
It does not join the remaining workers or their pending provider calls. The
observed dispatch buyer SMS worker (SHA-256
`9bb2c182e90012674371c158636e2d06422b54bb5ffbe6464892c98780bc145a`)
runs immediately and every 15 seconds; an uncertain SMS result has a distinct
`UNKNOWN` state. The observed taxpayer outbox worker (SHA-256
`b9744abf3eb559a4fe6f9987cb49f1e1c81aebea01bf20fb6ccd4a5e3978015b`)
runs immediately and every 5 seconds and can POST to its delivery broker with
a 20-second request timeout. Other producers may also cause external effects;
the three extracted files are not a complete external-effect inventory.

Read-only inspection of the running e407 container on 12 November 2026 found
`NODE_ENV=production` and `SMS_IR_ENVIRONMENT=production`, with the SMS API key,
URL and several templates configured. `TAXPAYER_DELIVERY_BROKER_ENDPOINT` was
absent, so this particular taxpayer worker cannot submit to its broker under
that measured environment. `BACKEND_RUNTIME_ROLE` was absent. These flags are
time-specific and do not disable the other producers. In particular, live SMS
configuration prevents treating all provider effects as inactive.

## First-update admission decision

On 12 November 2026, the owner accepted possible duplicate or unknown SMS
outcomes for the first database-preserving update. The protected launcher calls
`legacy-backend-signal.py --preflight` before preparing a session or entering
maintenance. It binds an explicit risk receipt to the measured image, running
container, start time and Node process birth. The receipt says external-effect
completion and exactly-once SMS are **unproven**. It also discloses Web Push
notification uncertainty. A newly enabled taxpayer delivery broker remains a
hold because the SMS decision did not authorize a financial provider effect.
The tax endpoint is checked again against the exact running container at signal
time, rather than inferred from the earlier environment observation.

After the deployment lease and both public 503 responses are proven, the runner
rechecks that exact runtime and sends one SIGTERM through its pidfd. A failed or
ambiguous signal, nonzero exit, replaced process, missing lease, or failed
maintenance boundary stops the release. The protected runner then stops the
services, verifies process closure and zero old-backend SQL sessions, captures
and independently verifies local and off-server checkpoints, and only then
permits migration. A zero exit and vanished SQL sessions are database-boundary
evidence, never proof of SMS or Web Push completion. An interrupted attempt is
durably held; no stale result can silently authorize reopening.

The native runtime wrapper path retains its completion owner and release gates.
The legacy receipt is a first-update risk record, not a general waiver or a
claim that the e407 application has completion-aware shutdown. The previous
strict external-effect reconciliation analysis remains in
`reports/qa/legacy-e407-work-reconciliation-blocker.md` as historical evidence
of the limitation; its pre-decision admission conclusion is superseded here.
