# Historical Accounting drilldowns (#485)

The comparison uses authenticated HTTP requests to the Accounting router on the existing `sabalanerp-local` PostgreSQL service. The harness applies the repository migrations to an isolated database and drops it after the test. The baseline and candidate use the same synthetic workload and a persisted administrator session.

The measured inputs are page 1 of outstanding receivables and page 1 with size 1 of received movements, for Tehran period `1405-05` capped at `2026-08-06T20:30:00.000Z`. The fixture adds 24 later invoices, 24 later payments, and 24 unrelated audit events. It uses 4,096 bytes of padding per evidence field. The fixture also includes a legacy invoice without its own effective date, an invoice voided at the cutoff, a fractional receipt, a stored collection with a legacy reversal, and a receipt attached to an excluded Partner retail contract.

For both requests the fixture counts rows returned by Prisma `findMany` on financial records, payments, and audit logs. The byte count is the UTF-8 length of those serialized results, including authorization preparation on those models. This measures data transferred to the application. PostgreSQL scan counts and production-scale timings need separate evidence.

| Request | Baseline rows | Candidate rows | Baseline bytes | Candidate bytes |
| --- | ---: | ---: | ---: | ---: |
| Historical outstanding receivables | 82 | 9 | 460,996 | 4,977 |
| Received movements, one visible movement | 30 | 6 | 126,874 | 8,604 |

Both builds passed the common result assertions for Tehran cutoff boundaries, voids, reversals, fractional and imported evidence, Partner retail exclusion, and exact page totals. The baseline then failed the bounded-read assertion. The candidate passed the complete probe, including dated evidence with a payment header outside the period and fallback to the creation date for an undated legacy receipt.

The API and edge logs use fixed `/api/accounting/receivables` and `/api/accounting/payments` labels. The API additionally records numeric `readWork` counters for historical sources, projected Partner balances, receipt candidates, and page hydration. Request arguments and financial evidence contents are omitted from these measurements.

Run from the repository root with `CONTRACT_RECOVERY_TEST_DATABASE_URL` set privately to the canonical local service. Set `SABALAN_LOCAL_REPOSITORY_ROOT` to the canonical Compose checkout when testing from a worktree.

```powershell
backend/node_modules/.bin/tsx.cmd --test backend/src/services/__tests__/accountingHistoricalDrilldown.integration.test.ts
```
