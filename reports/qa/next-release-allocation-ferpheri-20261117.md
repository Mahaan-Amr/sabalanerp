# November 17 release preparation

**Status:** integration for review. Production admission and grouped financial posting remain closed.

## Source

- Production was rechecked after the financial amount hotfix and runs `6e8d91fc66007f967809646f5ccec061cd7d9ea1`. That hotfix is merged into this integration. It adds no migrations. Refresh the running image set before operator handoff.
- GitHub main and Ferpheri both resolved to `917e044419cd9eb88483fad96d83544d545c9579`. The dispatch and attachment scanning changes are already included. The Inquiry gitlink is `92b96e265cb1a32deeeed3da494501df3db9a544`.
- The integration merges allocation candidate `95c270717`. PR #462 is an older deny-only review branch. Its deployment code is not the base for this integration.
- The protected migration catalog appends eleven byte-pinned migrations in one new receipt epoch. The prior three epochs retain their identities. Nine migrations install allocation intent recovery, grouped lineage, database fences and the dormant controller transition. One relaxes attachment scan metadata requirements, and one adds a nullable dispatch OTP column.

## Verified in this integration

- The migration compiler and its drift-rejection tests pass (4 tests). Database client ownership and the design-system adoption check pass. Design-system foundation and adoption suites pass (25 and 14 tests).
- The targeted deployment, capture and scanner-transition fixtures pass under WSL Linux (43 tests). These are controller fixtures, not a protected production-state rehearsal.
- Prisma client generation, backend build and shared package builds pass. Two authenticated HTTP tests pass on isolated databases in the existing local PostgreSQL service. The grouped-posting test replaces the admission decision within the test process and does not qualify the production activation control.
- Next.js compiled, completed its type check, generated 145 static pages and produced its browser identity artifact.
- All 11 external vehicle integration tests passed on an isolated local PostgreSQL database after the OTP change. The fallback test verifies that the numeric code reaches the SMS sender, the stored raw code is null, and the same code still completes verification.
- The lineage branch imports the existing closed-control work. Against isolated PostgreSQL, a bypassed application decision still could not commit the grouped child, voucher or parent intent outcome while the database is closed. The HTTP posting test still passes under its isolated test-only admission substitutions.
- A populated fixture initialized from the production `b43fc1f0` migration catalog preserved its profile, debt, receipt and voucher rows through Prisma migration. The candidate then read the original balances and posted an ordinary one-rial settlement. The test compares shared ledger rows directly before migration because the candidate Prisma reader selects new lineage columns. This test did not use the protected runner, retained image or production data.
- Six controller and signature tests and four isolated PostgreSQL tests passed after the controller integration. The PostgreSQL test impersonates a no-login controller in an isolated fixture to verify the lock and one-time transition. Deployment wiring and actual runtime credential separation remain open.
- The protected migrator passed on a populated, temporary database in the existing local PostgreSQL service. The old runners established the 22 and 2 historical receipts, then the candidate with inherited Linux FD9 installed all eleven pending migrations. Both same-operation retry and a later operation reported zero pending migrations. Voucher rows and exact balances (41 rials debt, 30 rials unapplied receipt) were unchanged. The fixture uses a synthetic lease and checkpoint binding, so this evidence covers the migration runner and receipt history, not a protected production-state rehearsal.
- The local Git hook launcher could not start its shell. All three checks in the hook were run explicitly before the integration commit.

## Remaining release evidence

1. **Allocation.** Implement and review the canonical admission and database role controls described in [the activation plan](../../docs/operations/customer-allocation-activation-plan.md). Prove real grouped posting with receipt and independent credit, replay after a lost response, concurrent writers, and reversal. Qualify the exact retained readers and current-data rollback with acknowledged financial writes. If the current predecessor fails, qualify a compatible predecessor with posting still closed before activation.
2. **Scanner transition.** Build and identify the five-service candidate. Before reopening, exercise abort and rollback to the exact six-service release with its original scanner. Separately test a later rollback with newly accepted scanner-free records. The prior backend requires clean scan evidence for some accounting archive reads and the prior client expects scan status on several attachment models. Retaining the scanner container alone does not establish that these records remain readable. Keep the existing scanner and its dependencies while referenced.
3. **Protected execution.** Requalify the final candidate once activation and compatibility changes land. Use the [next-update runbook](../../docs/operations/protected-maintenance-next-update.md) for both hosts' storage, independent checkpoint readback, drill currency, immutable images and health gates. This preparation does not start production maintenance.

## Dispatch OTP decision

The owner approved digest-only storage. The application sends the code by SMS and stores its keyed digest. The published migration remains byte-identical and the nullable column is left empty by the application.
