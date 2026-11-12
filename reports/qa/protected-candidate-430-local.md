# Protected candidate #430: Accounting and Purchasing qualification

Date: 2026-11-12. This is local source acceptance in the existing `sabalanerp-local` Compose project, not production admission or a production-state rehearsal. No production system or original checkout was changed.

The unpushed Accounting read commit `a92a7635` was integrated on `codex/ticket-430` from protected integration `74955283`. Four content conflicts were reconciled. The dashboard retains the mainline authorization snapshot, Partner and ordinary work-queue population, and retry after authority change; it also returns compact invoice and audit summaries. The list retains the local commit's paged ordinary read and precision-safe fallback. Both branches' historical and dashboard assertions were kept. The feature inventory retains the current mainline extractor.

`docker compose -f docker-compose.local.yml ps` confirmed the existing PostgreSQL and Redis services before database work. The shared local database contains online migrations, so an isolated database `sabalanerp_qa_protected_430` was created inside the existing PostgreSQL service. `prisma migrate deploy` applied all 451 selected migrations; `prisma migrate status` reported the schema up to date. The five retired online migrations were absent from this catalog. This clean install does not establish upgrade compatibility with a copy of the measured production state.

Focused results against the isolated selected schema:

- Purchasing integration: 154 checks passed in one rolled-back transaction. The test seeds its minimal administrator, department and product inside that transaction; its separate historical contract `100312` reproduction runs only against the original local fixture database.
- Historical Partner Accounting read: 2 cases passed in schema-only copies of the isolated database, including authorized Partner visibility, compact dashboard evidence, authority-revocation retry and high-precision totals.
- Accounting scope scale: 2 cases passed with 35 Partner cases each, including effective authorization decisions.
- Accounting trend and private audit projection: 1 case passed in a rolled-back transaction.
- Partner Accounting purpose authority: 9 cases passed.
- Backend TypeScript build, database architecture check and design-system check passed.

These local durations are not a production latency claim. The temporary schema copies and isolated QA database were dropped after testing. Production ledger refresh, production-state migration rehearsal, protected checkpoint and rollback proof remain release gates owned by the integration workflow.
