# HTTP control completion and error survival

Production read-only evidence observed backend restart count three at
2026-10-15T07:20:19.07001305Z. A P2028 exception and fatal Node footer share
07:20:18.706Z in the bounded log. The complete production failure chain remains
unproven; no application deployment or restart was issued by this task.

Express 4 ignores promises returned by middleware. Recovery routes and probes
previously fell outside the lifecycle adapter's rejection forwarding. Recovery
HTTP now participates in completion tracking; excluded health/readiness probes
also forward promise errors. A failed request can return its normal error while
the process continues serving. No global unhandled-rejection swallowing is added.

The actual recovery download route reserves completion before streaming. Its
download timestamp and audit commit in one shared-Prisma transaction. Completion
or proven download cancellation releases the reservation. Receipt failures log
only a bounded error code and do not escape an async response callback. Detached
recovery operations retain their separate existing completion owner.

Actual Linux fixtures ran inside the healthy canonical `sabalanerp-local`
backend, using its existing PostgreSQL service. The real Prisma experiment runs
only a read-only transaction that deliberately expires, then verifies HTTP error
responses and a successful following request on business, recovery and readiness
paths. Before the fix, the control request produced an unhandled P2028 and hung;
after the fix all four fixtures pass, without skips (1.25 seconds in Linux;
2.76 seconds including the outer harness).

Other fixtures load the actual transpiled recovery router into real Express,
with isolated mocked persistence gates and an owned temporary archive. They prove
that response completion cannot hide unfinished receipt/audit persistence, a
failed receipt is contained, and the backup POST returns and leaves its own HTTP
scope before its detached snapshot waits for the write drain. No additional
Compose project, database container or application runtime was started.

The nine existing HTTP/recovery retirement and operation-admission tests also
passed without skips. Database client ownership passed. Independent Standards
and Spec reviews found no actionable regression. This evidence does not certify
distributed fencing, 24-hour browser compatibility or production deployment.
