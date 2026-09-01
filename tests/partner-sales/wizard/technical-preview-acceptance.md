# Technical preview binding checkpoint (issue 330)

Candidate: `ec6b95aa4cf50016801f26e1d4f650b44a289ff6`, public contracts 1.4.0.
Review baseline: `1609c4637f2cd28b1cae14f876bc5005291547b4`.

This checkpoint integrates the original wizard/inquiry module and binds canonical
rate-free operations, longitudinal and slab inputs plus revision-bound stair-layer
summary results. It does **not** complete issue 330 or activate Partner transport.

## Verified component behavior

- Strict public draft/catalog preview preserves input revision and incomplete
  editing values; preview never grants saved configuration references.
- Operations expose actual automatic/final quantities and usable sibling facts.
  Keeping an override acknowledges only the current calculation; the next geometry
  change requires another decision. Choosing calculation cannot be undone by a
  stale editor blur.
- Longitudinal area entry preserves the existing canonical width/length intent.
  Slab source consumption uses the supplied kerf, not a fabricated rate or a
  hard-coded technical default. Ordinary priced forms retain their existing path.
- Invalid decimal and fractional piece-count text remains visible on blur with
  field-associated errors. This is local control retention, **not** proof of
  durable incomplete-text checkpointing across reload.
- Technical layer summaries reject mismatched input revisions and retain the
  last valid same-layer result while recalculating.

## Evidence

- Full frontend production build: PASS (existing lint/Browserslist warnings).
- Focused wizard/product-state/presentation command: 37/37 PASS.
- Full `npm --prefix frontend run test:contract-creation`: PASS.
- Design-system check, semantic foundation 25/25, adoption 14/14 and Partner
  route/action inventory freshness: PASS without changing their baselines.
- `node tests/partner-sales/wizard/run-browser.mjs`: PASS on the candidate.
  Four light/dark × 390/1440 scenarios run the technical interactions, 200% zoom
  and the original inquiry/wizard retry/recovery flow. No browser errors.
- Browser execution: `2026-08-28T22:15:59.614Z`.
  Compiled fixture SHA-256:
  `da4d2fd36d4f81be48083a5670a8a6000c573887ce093535c62abc3b8c9a77b4`.
  Stylesheet SHA-256:
  `d031573de66d73d1dcd762c32766a87b54f3d90a9ea972092bf36cc1bbd2c5c8`.
- Light/mobile and dark/desktop technical screenshots were inspected. These are
  component fixtures intercepted on the existing local origin, not route-mounted
  Partner flows. They neither mutate DB data nor send external messages.
- Independent Standards review: 0 hard violations, 0 remaining smells.
- Independent Spec review: invalid-text retention finding resolved; 0 remaining
  findings within this bounded preview checkpoint.

## Existing local runtime regression

Built and recreated **only frontend** in the existing `sabalanerp-local` project.
Frontend image: `sha256:d155e6051ca3a544112cec90164be9b1a936fc3d532a3ae000f882b2b06b96ac`.
Backend `b496f2a20ac3` and Inquiry `5d5953c1bf91` remained unchanged; all five
services were healthy. No migration, production deployment or activation ran.

Executed the normal Design System runner directly (PowerShell/npm argument
forwarding dropped flags) with `reference-surfaces.spec.ts`, one worker and grep
`Sales landing|Contract recovery|Product Selection|Stair layer summary|Contract Creation keeps|Contract submission`.
Five tests passed first attempt. Product Selection initially measured a 3px
alignment difference against its unchanged 1px threshold, then passed its retry.
The retained screenshot showed an opening overlay transition; that is a timing
inference, not a proven root cause. A separate run of Product Selection with
`--retries=0 --repeat-each=3` passed all three attempts. The initial flake is not
erased or represented as a first-attempt pass; no threshold was relaxed.

The isolated worktree initially lacked its read-only `@axe-core` dependency link;
the first invocation stopped before tests. Restoring that local dependency view
required no manifest change. Six exact test-created recovery drafts were verified
against the pre-run ledger, owner, run interval and fixture identity, then discarded
through the authenticated owner API. Pre-existing drafts were preserved; only
normal minimal discard audit remains. No Partner business rows were created.

The historical `browser-acceptance.md` and `evidence/browser.json` remain unchanged;
their August 27 results do not certify this new technical implementation.

## Module completion and integration handoff

The follow-up adapter checkpoint adds one revisioned writer for prepared,
volumetric, longitudinal, slab and stair rows plus remainder/layer dependents.
It takes stable caller-issued row, allocation, layer, source and stair identities;
it never derives relationships from array position or catalog identity. Removing
a parent cascades only its exact dependents, while unfinished field text remains
in `editingValues` until the same entity/field commits a canonical value.

Follow-up candidate identity: `8baaca1b` plus integrity fixes `40efb64f`,
`8f03ce93` and `1c6bb443`, merged with `origin/main` `92da4d8b` by `e74264ee`.
Public interface: `@sabalanerp/partner-sales-contracts@1.9.0`, wire `schemaVersion: 1`,
canonical graph `@sabalanerp/contract-product-graph@0.1.0`.

Verified after the `origin/main` merge: 4 focused adapter tests, all 41 wizard
tests, 51 shared-contract tests, the full contract-creation and canonical
graph suites, frontend no-emit typecheck and production build, Design System
check, foundation 25/25 and adoption 14/14. Existing repository lint warnings
remain unchanged.

Production host/persona binding, a real Case command transport, customer/delivery/
payment host adapters, authoritative private pricing-policy production and final
route-level integration remain outside this completed module ticket. No
configuration reference, pricing identity or permission may be invented by UI.
Full integration and release acceptance remain issues 334–336.
