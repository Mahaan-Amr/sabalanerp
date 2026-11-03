# Customer output module acceptance — #325

Verified on 2026-08-27. Review base: `ab3e842aa54d01bfdabc7ab17e19160480a9e74a`.
Implementation reviewed at `4fa7d564` (`b868ed37` plus the print/type correction).
Interface baseline: `@sabalanerp/partner-sales-contracts@1.0.0`, customer wire
schema 1, `sha256-v1`. No schema, manifest, route inventory or activation change
belongs to this delivery.

## Automated checks

All checks below passed. The full customer-output suite and the full foundation
package suite were rerun at the end; unrelated database suites were not run.

| Check | Command / outcome |
| --- | --- |
| Snapshot, confirmation, retry, issuance fixtures | `node frontend/node_modules/tsx/dist/cli.mjs --test backend/src/services/__tests__/partnerCustomerOutput.test.ts` — 11 tests |
| Existing-service container execution | `node tests/partner-sales/output/run-local.mjs` — same 11 tests |
| Output template and ordinary print regressions | `node frontend/node_modules/tsx/dist/cli.mjs --test backend/src/utils/__tests__/printTemplate*.test.ts tests/partner-sales/output/print-template.test.ts` — 6 tests/files |
| Confirmation UI | `node frontend/node_modules/tsx/dist/cli.mjs --tsconfig frontend/tsconfig.json --test tests/partner-sales/output/confirmation-view.test.tsx` — 2 tests |
| Complete foundation package suite | `npm --prefix packages/partner-sales-contracts test` — 18 tests on the isolated version-1 baseline |
| Harness unit contracts | `npm run test:partner-sales` — 7 tests in the shared checkout |
| Semantic foundation / adoption | `npm run test:design-system-foundation` / `npm run test:design-system-adoption` — 25 / 14 tests |
| Design-system enforcement | `npm run design-system:check` — no new violations |
| Database-client ownership | `npm run architecture:check` — passed |
| Backend compilation | `npm run build:backend` — passed on isolated baseline plus owned patch |
| Frontend typecheck / production build | `tsc --noEmit -p frontend/tsconfig.json` / `npm run build:frontend` — passed on isolated baseline plus owned patch; existing hook warnings remain |
| Existing public-flow browser regressions | `node scripts/run-design-system-e2e.mjs --grep "public, identity, and confirmation\|public verification workflows"` — 2 passed |

The Windows isolated worktree uses read-only dependency junctions to the existing
installed toolchain; no dependency manifest was changed by this lane. Early runs
failed because dependencies/submodule contents were absent, and one compile found
an optional-hook error union; the dependency paths and typed error helper were
corrected. The isolated harness runner lacked the inquiry submodule, so its final
unit run used the complete shared checkout. No failed run is counted as passing.

## Render and visual evidence

The existing healthy `sabalanerp-local` backend rendered actual PDFs from a source
copy under `/tmp/customer-output-325`. `docker compose -f docker-compose.local.yml ps`
preceded every Docker action. No service, `/app`, database or dependency writes.

After the local runner copies the sources, the render command is:

```text
docker compose -f docker-compose.local.yml exec -T backend node -r /tmp/customer-output-325/tests/partner-sales/output/typescript-loader.cjs /tmp/customer-output-325/tests/partner-sales/output/render-local.ts
```

`render-local.ts` checks PDF bytes, embedded Yekan font and forbidden text, then
uses Poppler to render every page. Samples: 1 product / 2 A4 pages and 45 products /
8 A4 pages. All pages were inspected as a montage, with full-size checks of short
page 1 and long pages 5 and 8. RTL text, frozen business identity, retail totals,
ordinary section/column structure, page numbers and signatures are retained.
Delivery descriptions and quantities stay together across page breaks. Missing
dimensional facts remain empty; they are not inferred from contractual quantity.

`render-confirmation-ui.tsx` renders the real component with the candidate's built
CSS; `screenshot-ui.cjs` checks 390/1440 widths in both themes, no page overflow,
and both OTP controls. Mobile screenshots also inspect the far edge of the
existing horizontally scrolling table. These are component renders, not live
Partner route integration. Existing-route browser tests above cover regression.

Local artifacts (not committed): `tmp/qa/customer-output-325/artifacts-latest/`
and `tmp/qa/customer-output-325/ui/`. The renderer was run again after fixing long
delivery row pagination; only the latest artifacts represent final acceptance.

## Standards

Independent standards review initially identified a product-table structure
deviation. The original column structure was restored, with no fabricated
dimensions/counts. Re-review at `4fa7d564`: resolved, no new actionable findings.

## Spec

Independent spec review found no actionable module-scope gaps or scope creep.
Real session/Case persistence, transactional authorization/CAS, durable outbox,
private artifact storage and shared SIGNED/PRINTED financial realization are
explicit adapter obligations for #334; their real-schema/race acceptance is #335.

Final review totals: Standards 0 open (1 resolved); Spec 0 open.

## Acceptance boundary

Fixture races prove adapter call ordering/failure handling, not database locks or
exactly-once financial effects. OTP does not call final issuance. Preview and
redownload do not call the commitment port. SMS uses a safe fixture gateway.
Production SMS, Partner activation, deployment and release acceptance were not
performed or authorized by this ticket. The default runtime hooks remain unbound
until the coordinated #334 integration.
