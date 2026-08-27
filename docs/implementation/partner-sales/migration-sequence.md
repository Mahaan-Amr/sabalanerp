# Partner migration sequence and schema ownership

Contract 1.0.0, schema version 1. Sole Prisma/SQL writer: [#315](https://github.com/Mahaan-Amr/sabalanerp/issues/315). No migration executes or changes in #313. Timestamp names below are reserved suffixes: #315 allocates strictly increasing real timestamps against the then-current migration ledger, not invented historical timestamps.

| Order | Reserved suffix | Required structures / gate |
| --- | --- | --- |
| 0 | No mutation | #314 baseline; #315 read-only schema/data/legacy-contract inventory, exact counts and hashes; rollout closed. |
| 1 | `partner_profiles_and_cohort` | Profile, one-to-one Commercial Account, versioned identity/terms, eligibility/cohort/pause and conversion dispositions; explicit User linkage; no historical semantic conversion. |
| 2 | `partner_inquiry_evidence` | Inquiry ownership/assignment, immutable row definition/decisions, single-open-successor lineage, 48h DB timestamps, append-only audit, idempotency outcome ledger. |
| 3 | `partner_case_pair_and_revisions` | Case/head/revisions, one internal record and one explicit PARTNER_CUSTOMER contract, reciprocal links and immutable numbers; Case-owned canonical graph snapshot, row bindings and delivery ownership. |
| 4 | `partner_pair_commit_constraints` | Commit-time exact-pair/reciprocal-link enforcement, unique non-null purposes, immutable links/numbers and append-only evidence constraints; blocked writes until all are proven. |
| 5 | `partner_payments_outputs_and_corrections` | Distinct plan purposes and receipt histories, immutable output snapshots, commitment/realization uniqueness, correction opportunities/gates/dependencies, dated adjustment events, safe outbox. |
| 6 | No automatic activation | Audit all new constraints against real schema; invalid pair/orphan/link mutation and failpoint tests; reconciliation and backwards-compatible Standard/Collaboration checks. |

Circular Case↔record links require a commit-time database invariant, not merely service ordering. #315 chooses the concrete deferrable constraints/constraint triggers in its reviewed migration while proving that a transaction cannot commit a Case with a missing/wrong-purpose record, a mismatched reciprocal Case link, swapped record links or reused numbers. Separate ordinary foreign keys alone do not prove exact-pair completeness.

Mutation writers remain closed until all constraints, immutable evidence, central authorization, graph binding, output confidentiality and downstream eligibility gates exist. #320 performs one transaction for Case/revision/pair/graph/evidence/audit or none. #318 bulk rows deliberately have independent outcomes; this is not permission for partial Case creation.

Runtime reuses `backend/src/lib/prisma.ts`; no new long-lived clients. Temporary audit/test clients close in finally and clean only their own namespaced records. Use only the existing `sabalanerp-local` Compose; verify `docker compose -f docker-compose.local.yml ps` before every Docker action. No parallel stack or disposable database service.

Customer/Project ownership transfers, internal User conversion, and canonical technical graph migration remain separate explicit workflows. Do not infer Partner kind, wholesale price or ownership from historical roles, creators, prices, names or JSON. Unrelated data and historical financial evidence remain unchanged.

Integration #334 connects the ports under closed activation, then #335 proves migrated-schema transactions/concurrency and whole user paths. #336 follows ADR-0039 and `docs/operations/zero-data-loss-deployment.md`: lease, maintenance boundary, checkpoint, encrypted remote verification, immutable image identity and fail-closed rollback remain mandatory. After accepted new writes, pause/fix-forward preserves evidence; restoring a stale checkpoint is not a Partner pause. No deployment/SMS/activation authority is granted by these contracts.
