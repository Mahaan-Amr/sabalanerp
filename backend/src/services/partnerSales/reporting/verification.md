# Issue #326 verification — 2026-08-27

## Identity and boundary

- Review base: `ab3e842aa54d01bfdabc7ab17e19160480a9e74a` (confirmed by the user).
- Initial implementation: `bad2bb8ab7d2c43191350d931db6009447bc5a88`.
- Reviewed code: `a42cd3ec8557999959cfaec263823c402b07ae21`.
- Private review worktree: `codex/issue-326-reporting`.
- Consumed baseline: foundation 1.0.0, wire schema 1, `sha256-v1`.

This is fixture-driven reporting **module acceptance**, not production activation,
real authorization/database concurrency, UI, or E2E acceptance. No schema, shared
Prisma owner, shared route registration, manifest, deployment, or public SMS flow
was changed. The integration/source contract is recorded in [README](README.md)
and [the #334 handoff](https://github.com/Mahaan-Amr/sabalanerp/issues/334#issuecomment-5436205013).

## Checks

| Check | Result |
| --- | --- |
| Reporting service/revenue tests | 24 passed |
| Complete baseline v1 contract suite plus reporting tests, one invocation | 42 passed (18 + 24) |
| Strict ES2020 no-emit module/type-boundary check | Passed |
| `npm run architecture:check` | Passed; no additional runtime Prisma clients |
| Commit hook `npm run design-system:check` | Passed |
| Commit hook `npm run test:design-system-foundation` | 25 passed |
| `npm run test:partner-sales` in shared checkout before integration | 7 harness tests passed |
| Whole-backend host typecheck | Blocked by pre-existing incomplete backend dependencies/types, including Node/Express/Prisma |

Exact isolated checks (from the review worktree):

```sh
node frontend/node_modules/typescript/bin/tsc -p packages/partner-sales-contracts/tsconfig.build.json
node packages/partner-sales-contracts/node_modules/tsx/dist/cli.mjs --test packages/partner-sales-contracts/tests/*.test.ts backend/src/services/__tests__/partnerReporting.test.ts backend/src/services/__tests__/partnerReportingRevenue.test.ts
node frontend/node_modules/typescript/bin/tsc --noEmit --target ES2020 --lib ES2020 --module commonjs --moduleResolution node --strict --esModuleInterop --skipLibCheck --typeRoots packages/partner-sales-contracts/node_modules/@types backend/src/routes/partner-reports.ts backend/src/services/__tests__/partnerReporting.test.ts backend/src/services/__tests__/partnerReportingRevenue.test.ts
```

Only private worktree build artifacts were rebuilt for the final baseline run.
An earlier shared-package run encountered the coordinator's in-progress v2 export
tests; it was not treated as a reporting regression. A copied newer dist initially
failed the v1 version assertion; rebuilding the isolated baseline resolved that.
The isolated harness also cannot scan the uninitialized inquiry git submodule;
its seven unit tests were run successfully in the shared checkout instead. Neither
case was worked around by weakening tests or changing shared ownership.

## Standards review

Initial independent review identified a P2 error distinction for hidden exports
and a maintainability concern about duplicated correction-lineage validation.
Both were fixed. Authorization denials during download now become the same 404 as
missing/foreign exports. One history validator owns correction lineage.

Final independent re-review of `a42cd3ec`: **zero remaining documented-standard
violations or actionable baseline smells**. Reviewer independently reran the 24
module tests and strict ES2020 typecheck; both passed.

## Spec review

Initial independent review identified a P2 receipt/reversal ordering failure for
equal timestamps and reversed lexical IDs. Receipt identities are now indexed
before reversals resolve their references. Correction order likewise follows
revision lineage rather than event-ID order. Regression tests cover both ties.

Final independent re-review of `a42cd3ec`: **zero remaining Spec findings** within
the agreed module boundary, with no additional missing requirements or scope creep.
Reviewer independently reran the 24 module tests and strict typecheck; both passed.

## Remaining integration gates

#334 must bind the real central policy, historical snapshot transaction, Case and
Accounting/fulfillment sources, durable private export storage, and approved UI
transport. It must exclude explicit retail compatibility rows before unioning
ordinary Sales/BI with the internal revenue ledger. Comparable commercial bases
remain a producer-validated private seam until their owner approves the transport.
Recheck backend build and real-schema permission/revocation/race behavior after
that integration. #335/#336 retain combined QA and release approval.
