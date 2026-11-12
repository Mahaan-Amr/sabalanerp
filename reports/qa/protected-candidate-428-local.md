# Protected candidate #428: isolated local schema and ERP read

Date: 2026-11-12. Source: `codex/ticket-428` after merging protected integration `e9ac2068`. This is local source acceptance, not production admission or a production-state rehearsal.

The existing `sabalanerp-local` Compose project was inspected before Docker actions. PostgreSQL, Redis, frontend and Inquiry were healthy. The existing backend image was restarting with `RUNTIME_NATIVE_AUTHORITY_UNPROVEN`; ClamAV was unhealthy. No service was rebuilt or replaced. The original local database and six existing service volumes were preserved.

An isolated database named `qa_protected_candidate_428` was created inside the existing PostgreSQL service. The candidate Prisma catalog applied all **451** migrations successfully, and `prisma migrate status` reported **Database schema is up to date**. The five retired online migrations were absent from its ledger. `online_releases` and `online_serving_epochs` were absent from the resulting database.

The focused integration test `backend/src/services/__tests__/protectedCandidateRead.integration.test.ts` constructed the candidate HTTP application with its shared Prisma client against that isolated database. It created one QA administrator and an authoritative session. `GET /api/users` returned **401** without the cookie and **200** with the cookie, including the QA identity. The test closed the HTTP/Socket.IO server, deleted its QA rows and disconnected Prisma. The isolated QA database was then dropped.

The schema-to-datamodel diff did not return empty: it reported numerous SQL/model differences, including manual index and foreign-key names and `performance_disclosure_revision`. Migration history success therefore proves this selected catalog is installable and the tested ERP read works; it does not prove complete structural parity or compatibility with a measured production-state copy. The protected release gates, production ledger refresh, checkpoint, independent remote verification, and rollback proof remain required before production use.
