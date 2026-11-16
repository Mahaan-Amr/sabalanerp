# #431 legacy client compatibility, local selected schema

Date: 2026-11-12. This is a focused schema compatibility check, not the production-state rollback rehearsal owned by #432.

The test created an isolated database in the existing healthy `sabalanerp-local` PostgreSQL service and applied the candidate's exact ordered 451-migration catalog from empty. It asserted that the five online-only migrations were absent. The shared local `sabalanerp` database has a different 452-migration ledger, including online migrations, and was not used as a production baseline or migrated.

The detached `b58c53c0` source-generated Prisma 5.22 client passed first. The exact generated Prisma client, schema and JavaScript wrapper extracted from the retained `e407ff125c6f...` image passed next. The latter files were checked against the inventoried SHA-256 hashes (`b0b5f65f...`, `2134693d...`, `9ab29d2d...`). The image's Linux query engine cannot execute on Windows, so the local check used a Windows Prisma 5.22 engine with the same engine commit. It did not start the old backend, jobs or external providers.

With each old client, one rollback transaction created and read a Sales Contract, a Dispatch Loading, and an Attendance Record through the old Prisma model API. The old client also read the waybill model. After rollback, those three business row counts were zero. Both isolated databases were removed by the harness after checking for outstanding sessions and prepared transactions.

The check demonstrates that these representative old-client reads and writes can execute against the selected schema. It does not demonstrate full old application behavior, historical production data compatibility, immutable old-image execution on Linux, provider effects, or recovery from a failed production release. Those remain release qualification work under #432.
