# Partner management and responder UI — #331

This lane owns `frontend/src/features/partner-sales/management/`, `responder/`,
`__tests__/management*.test.tsx` and this test directory. The UI consumes public
Partner contract exports and synthetic fixtures. It does not authorize release,
activation, SMS, or real backend integration; those remain #334–#336.

## Confirmed test seams

- Public management/responder components: only purpose-projected sections and
  server-provided actions are rendered. Role names never grant authority.
- Command ports: exact-intent retry after uncertain transport, explicit stale
  refresh, independent per-row decisions, partial success, and no duplicate write.
- Browser workflows: RTL, 390px, 200% zoom, light/dark, focus restoration and
  pending protection through the canonical ERP controls.

The fixed review base is `ab3e842aa54d01bfdabc7ab17e19160480a9e74a`.

## Contract and route boundaries

The package root at version 1.1.0 supplies strict v2 workspace queries and
management commands. Existing lifecycle, transfer, reassignment and response
commands retain their v1 port. The UI sends producer-issued evidence references;
it does not manufacture identity records, gate truth or permission grants.
Reporting remains separately owned by issues 326/332; no reporting DTO is invented.
The shared dependency and frontend wiring were published in
`678359aa8ade8abc0e69e44dc4c5285936b3942d` (remote main verified). The public-package
Next development interoperability fix is published in
`5f04a46d4d2149f1b61be69e248d07b0744c6243`. No source aliases or deep imports are used.

The HR and Sales routes require `NEXT_PUBLIC_ENABLE_PROTOTYPES=1` and an explicit
known `fixture` query. Without both they return not-found. Fixtures are synthetic
in-memory adapters with no backend, database, SMS or activation connection. They
are not evidence that production authorization or business transactions work.

## Verification status (2026-08-27)

- Focused tests: 11 passed; whole frontend no-emit typecheck passed.
- `npm run build:frontend` passed (exit 0, 115 pages). The build reports lint
  warnings, including the request-generation ref invalidation cleanup; it does
  not report type or compilation errors. Final log:
  `tmp/qa/issue-331-frontend-build-final.log`.
- Design-system check passed, foundation 25 passed, adoption 14 passed.
- Existing frontend regression scripts passed: contract-party-identity,
  contract-creation, hr-hiring-lifecycle, hr-assessment-score, hr-date-boundary,
  hr-display, hr-dashboard, accounting-dispatch-documents,
  hr-personnel-collection and hr-duty-surfaces.
- Independent Standards review found draft loss on inquiry switching and missing
  danger tone on termination confirmation. Both were fixed and rechecked.
- Independent Spec review found a recovery lock retained after a denied refresh.
  Unmount cleanup fixes it. Both reviewers report no unresolved source findings
  in snapshot `15ee07e11b9b6fa653cda3100bc41f6102c60029`; both also cleared the
  browser/contrast delta in `fedb5fe1b6509f26a36ca42d40553a5698357364`.
- Twelve browser cases passed (1.7 minutes), covering role visibility, onboarding
  through termination, masked CRM transfers, independent partial results, exact
  retry, keyboard focus, stale assignment/pause, denied-refresh recovery, inquiry
  draft retention, RTL, 390px and 200% in both themes. Axe found no serious or
  critical violations in either workspace/theme. Eight screenshots were inspected.
  Log: `tmp/qa/issue-331-browser-final.log`; images: `test-results/partner-management/`.
  A final toolbar alignment adjustment avoids the shared side-rail handle at
  200%; both theme/zoom cases passed again (39.7 seconds), including clicking
  Refresh at 200%. The updated screenshots were inspected.
  Log: `tmp/qa/issue-331-browser-toolbar-final.log`.
- Required shared-interaction regression command
  `npm run test:design-system:e2e -- shared-operational-overlays.spec.ts` passed
  both cases (39.2 seconds); this is a scoped run, not the entire platform suite.
- Browser QA first exposed a shared CommonJS/Fast Refresh compilation error,
  then light-theme helper-text contrast and a focus-test keyboard-modality issue.
  All were corrected and the twelve-case run passed. Original failures remain in
  `tmp/qa/issue-331-dev-package-failure/` and `tmp/qa/issue-331-browser-first-full/`.
- The final tested frontend-only Compose image was
  `4f002a90c829c21683bd0f848ecde600fabae9326fd2849640e39057f9b0f34d`.
  All five services were healthy; direct backend/database, frontend proxy/database
  and Inquiry HTTP checks passed. `docker:verify` was stopped during image build
  when its full-stack rebuild behavior was discovered; it is not a passed check.
  Backend image `b496f2a20ac3bb2940dda44b150ea87063db3131db9a3073a1765aad4edb2de5`
  and the other non-frontend containers remained unchanged. No migration was run.

Module fixture acceptance is complete. These checks do not constitute real
integration or release readiness. The runtime was handed back to issue 330;
publication is serialized by the coordinator and this lane does not own deployment.

## Local focused checks

```powershell
node frontend/node_modules/tsx/dist/cli.mjs --tsconfig frontend/tsconfig.json --test frontend/src/features/partner-sales/__tests__/management*.test.tsx
node frontend/node_modules/typescript/bin/tsc -p frontend/tsconfig.json --noEmit --incremental false
npm run design-system:check
npm run test:design-system-foundation
npm run test:design-system-adoption
npm run build:frontend
node node_modules/@playwright/test/cli.js test --config tests/partner-sales/management/playwright.config.ts
npm run test:design-system:e2e -- shared-operational-overlays.spec.ts
```

Browser QA must use the existing `sabalanerp-local` project. Verify with
`docker compose -f docker-compose.local.yml ps` before every Docker action.
Do not start another database or test stack. Shared package/manifest/shell and
inventory changes remain coordinated with #313/#314/#334.
