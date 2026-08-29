# Partner inquiry and creation module (issue 330)

Consumes `@sabalanerp/partner-sales-contracts@1.8.0` through its public root.
Inquiry reads use `PartnerQueryV2Port` and the strict v2 inquiry projection;
commands retain wire version 1. `/testing` is used only by explicit test fixtures.

## Acceptance status

**Not ready for full module completion or activation.** The original checkpoint
was blocked on public technical contracts. Versions 1.2–1.4 subsequently supplied
canonical rate-free calculation, safe catalog, leased recovery and validated-save
interfaces. Current work binds these public interfaces into the canonical forms.
Inquiry owner 318 consumes saved configurations; integration owner 334 composes
real producers. Hiding rates alone is not evidence of product-form parity.

The operations, longitudinal and slab sections now accept canonical technical
inputs directly; the layer summary accepts revision-bound technical results.
Ordinary priced inputs retain their existing path. `TechnicalProductConfiguration`
can preview a strict public draft/catalog without issuing saved references.
Remaining work includes public row/input adapters, all-family editing and
remainder interactions, durable incomplete-text checkpoint binding, validated
save/inquiry linkage, private pricing-policy production and actual transport.
The legacy whole modal's priced save gate is not a Partner save adapter. Do not
inject fake rates, expose private inputs or call `bindCanonicalCaseGraph` in the
browser to bypass these remaining gates.

`createPartnerTechnicalSession` now coordinates the public leased checkpoint and
validated-save ports without introducing a browser journal. It serializes writes,
retains the exact request after an uncertain response, blocks a revoked/stale
writer, ignores acknowledgements after the actor/recovery session is disposed,
and restores only a saved view whose recovery and input revisions match. Newer
visible edits cannot be replaced by an older acknowledgement. Owner-issued saved
references remain visible as historical evidence, but are current only for their
exact input revision; the browser does not infer approval impact from quantity or
geometry changes. The host still has to bind this coordinator to the existing
creator-private recovery hook and real authenticated ports before it is runtime
evidence. Automatic checkpoint scheduling alone is not a durable acknowledgement.

After the shared runtime handoff, the fixture browser passed all four theme/width
scenarios, including actual progression at 200% zoom and fixture Case submission.
The six relevant existing Design System reference-surface regressions also passed.
See `browser-acceptance.md` for that historical checkpoint's scope and evidence;
it does not certify the new technical bindings or full product parity.

## Delivered module boundaries

- `PartnerInquiryWorkspace` composes canonical technical product forms, durable
  bulk inquiry submission, independent row outcomes, exact predecessor/successor
  evidence, inline re-inquiry and one Contract Dock entry action.
- `TechnicalProductConfiguration` suppresses internal pricing controls in the
  existing longitudinal, slab, prepared/volumetric, stair, layer and operations
  components. Existing remainder selection and canonical graph callbacks remain
  unchanged. This presentation context is not a data redaction or permission layer
  and does not yet establish rate-free technical calculation parity (see blocker).
- `enterPartnerWizard` uses server-resolved product-row references, never inferred
  inquiry/catalog IDs. Only usable approvals enter the wizard; quantity is separate.
- `PartnerContractWizard` owns progression, retail defaults/overrides, retail-only
  discount, exact-decimal loss preview and confirmation, expiry/mismatch recovery,
  takeover/discard presentation and final submission orchestration. Its customer,
  delivery, payment and review slots consume the existing editors and validators.
- Submission controllers checkpoint before transport, deduplicate double clicks,
  retain uncertain commands for exact replay and preserve inputs on failure.
  Committed Case truth is terminal even if local recovery cleanup fails.
- The create route uses `PartnerCreationBoundary`. A supplied Partner channel
  cannot fall through to ordinary Sales. An absent binding preserves the existing
  internal route while Partner activation remains disabled.

## Integration handoff (issue 334; not a live fallback)

The authenticated shell must provide `PartnerCreationChannelProvider` before
activating a Partner persona. It must provide loading/blocked state until policy,
profile and ownership are resolved, never infer eligibility in this module.

Bind real public query/command adapters and the existing creator-private recovery
lease. `savePending` must await a durable checkpoint under the current writer
lease and reject revoked writers. Keep pending commands and the entire wizard
draft scoped by authenticated creator/recovery; on actor or recovery change,
replace the controller. `finalizeCommitted` clears only the matching local
recovery after the server's atomic Case commit. No second local persistence
protocol is introduced here.

Supply technical-only catalog/graph projections to the canonical editors and
their original identity, cutting, remainder and operations controllers. Do not
send private rates or pricing hashes to the browser, and do not offer catalog
editing. Save the graph before providing `configuredRows`; `prepareSuccessor`
must save a new exact configuration reference and new inquiry row ID without
rewriting its predecessor. Pass authoritative mismatch IDs to both inquiry and
wizard, reconcile approvals after server reads, and preserve customer, retail,
payment and delivery inputs during re-inquiry. Quantities and delivery edits do
not themselves invalidate pricing approval.

The host must validate the graph closure, quantity/delivery allocation and all
existing customer/payment rules. The server remains authoritative for pricing,
permissions, expiry, leases and final financial amounts. A supplied wizard draft
does not authorize a Case command. Committed Draft Case editing belongs to the
Case workspace and must use frozen snapshots, not this pre-submit controller.

The intentional create-route boundary change needs the integration owner's
route/action inventory update. No baseline is regenerated by this module.

## Commands

Run from repository root:

```text
node frontend/node_modules/tsx/dist/cli.mjs --tsconfig tests/partner-sales/wizard/tsconfig.json --test frontend/src/features/partner-sales/__tests__/wizard*.test.tsx
node frontend/node_modules/typescript/bin/tsc --project frontend/tsconfig.json --noEmit --incremental false
npm --prefix frontend run test:contract-creation
npm run design-system:check
npm run test:design-system-foundation
npm run test:design-system-adoption
npm run build:frontend
node tests/partner-sales/wizard/run-browser.mjs
npm run test:design-system:e2e
```

Browser checks use only the existing `sabalanerp-local` service, with the shared
readiness preflight. The wizard fixture is compiled from production components
and intercepted in the test browser; it starts no service, writes no database
rows and sends no messages. Evidence is under `test-results/partner-sales/wizard`.
Customer/delivery/payment fixture slots are synthetic: this is module interaction
evidence, not real policy/inquiry/Case or full product-graph E2E acceptance.
Real integration, combined QA and release approval remain issues 334–336.
