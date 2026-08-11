# Database connection ownership

Sabalan ERP's long-running backend owns one canonical Prisma client in `backend/src/lib/prisma.ts`. Every HTTP route, middleware, application worker, and runtime service reuses that instance, which means the process owns one reusable PostgreSQL connection pool rather than one pool per imported module.

Standalone maintenance and data scripts may create a temporary client only when they close it in `finally`. System Recovery owns exactly three explicitly scoped alternate clients: checkpoint restore validation, promoted restore validation, and sanitized recovery bootstrap. They must never replace, disconnect, or leak into callers of the canonical application client, and every one closes in `finally`.

Integration and concurrency tests may create isolated clients for temporary databases or transaction harnesses. Test lifecycle code owns their disconnection and database cleanup; this exception never applies to application runtime modules.

The process marks readiness unavailable as soon as it receives `SIGTERM` or `SIGINT`, drains HTTP and Socket.IO work, and then asks the ownership module to close the canonical pool. Callers must never disconnect that shared client themselves.

Both local and production Compose URLs declare `connection_limit` and `pool_timeout`. The limit is a capacity budget, not a target connection count: increasing it requires evidence from database saturation, query latency, pool wait time, application concurrency, and PostgreSQL memory headroom.

`npm run architecture:check` enforces the construction-site allowlist, temporary-client cleanup, and explicit Compose pool configuration. ESLint rejects new runtime construction at authoring time. Any new exception requires an architectural decision and an update to the guard; an allowlist entry is not a routine workaround.
