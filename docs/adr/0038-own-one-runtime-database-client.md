# Own one runtime database client

The long-running backend reuses one canonical `PrismaClient` and therefore one application connection pool. Standalone scripts and System Recovery connections to alternate databases are the only explicit exceptions and must disconnect deterministically; architecture checks enforce this ownership because module-local clients previously multiplied pools until PostgreSQL exhausted its connection limit. Pool limits remain explicit deployment capacity budgets rather than a substitute for client ownership.
