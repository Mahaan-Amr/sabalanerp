# Read-only production migration inventory

At 2026-10-17 07:27:42 UTC, a read-only transaction inspected the native production `_prisma_migrations` ledger and PostgreSQL identity. [Raw measured inventory](production-migration-inventory-20261017.json) contains operational identities and migration metadata, not business rows or credentials.

All 425 successful migration names exist in the candidate checkout, and every SQL file's exact byte SHA-256 matches its successful production ledger entry. There is one historical rolled-back ledger row and no unfinished, non-rolled-back entry. No migration history was repaired, rewritten or normalized.

Exactly two candidate migrations were pending:

| Migration | Bytes | SHA-256 |
| --- | ---: | --- |
| `20261014120000_hr_vehicle_assignment_plans` | 1,312 | `c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289` |
| `20261014140000_online_deployment_control` | 8,765 | `872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2` |

These add tables, indexes, constraints and registry guards. Their additive appearance is not semantic compatibility, bounded lock-time or online admission evidence. Actual overlapping old/new runtime/domain behavior, native failure/ledger recovery and the coherent recovery/fencing gates remain required.

Production retained release `20261014T054528Z-cce0fa8da6b3-release`. The backend ID/image/start time were unchanged from the earlier inspection; its restart count remained four. PostgreSQL system identifier was `7609810350852628513`, database size 326,458,727 bytes, `wal_level=replica` and `archive_mode=off`. Free host capacity was 35,066,380,288 bytes. No setting, slot, migration, application, service or routing was changed. This inventory is not a replacement for both-host cleanup/capacity preflight immediately before real update work.
