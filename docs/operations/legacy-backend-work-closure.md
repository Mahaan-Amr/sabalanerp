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

## Admission decision

The protected launcher calls `legacy-backend-signal.py --preflight` before
preparing a deployment session or entering maintenance. The known legacy image
now returns `LEGACY_WORK_COMPLETION_UNPROVEN` there. The signal path checks the
same gate again, including for an older saved plan. A prior clean-exit record
cannot satisfy the resolution check. Thus this image cannot receive SIGTERM
through the protected update, and migrations cannot begin on the strength of a
zero exit code, vanished SQL sessions, or an empty queue sample. A timeout or
unknown result remains a hold; it never authorizes a retry of an external
effect or public reopening.

The native runtime wrapper path remains eligible for its existing completion
owner and release gates. For the measured legacy image, first-release admission
is blocked until a separately reviewed, bounded, independent protocol proves
completion of **all** admitted work and reconciles every uncertain provider
effect. It must bind the actual image and process incarnation, establish that
no producer can start new work after the boundary, and persist a result that
survives interruption before any signal or migration. Current image behavior
does not expose such a completion signal. Database sessions, HTTP maintenance,
container exit, and a quiet network interval do not supply it. Do not claim a
successful first-release rehearsal from fixture results or restart this image
as a supposedly passive retained runtime.
