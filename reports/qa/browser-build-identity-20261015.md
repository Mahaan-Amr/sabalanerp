# Browser build identity — 2026-10-15

This is incremental evidence for Issue #405, not full online-release or 24-hour
form acceptance. Frozen r14 is based on
`2b8094d1181a924ea23b143dad3da944a6bef3ba`, patch SHA-256
`551f7f59c46917fa7b3d51158c609fd15cbd1fe521808cd11fd143f6d32719b0`.
Both independent Standards and Spec reviews reported no remaining actionable
finding. The production code is identical to r13; r14 adds a reproducible real
browser/vendor integration test.

## Implemented boundaries

- The protected release runner assigns a distinct ERP browser identity before
  building its image. Next compiles it into deployment/RSC/chunk identity and
  its native BUILD_ID. Both npm and Docker build paths finalize a durable
  `browser-build-identity.json` artifact alongside the built output.
- Production Next configuration derives identity from that artifact, compares
  actual BUILD_ID bytes and rejects either `SABALAN_BROWSER_BUILD_ID` or
  `NEXT_DEPLOYMENT_ID` when it conflicts. Omitting runtime variables retains
  the compiled identity. The identity module, finalizer and configuration are
  included in source attestation.
- A private routing selector resolves per-request identity, versioned assets,
  headerless legacy RSC and Inquiry native action descriptors. It never uses
  a shared version cookie or guesses the newest implementation for an
  ambiguous legacy action. Bound argument ciphertext is not decoded/replaced.
  Conflicting identities, unknown builds/actions and asset path/content
  collisions fail closed. Expiry signals a required draft handoff and retains
  the old target; this selector does not perform the handoff or remove slots.

## Actual build and runtime evidence

The final production frontend build passed compilation, lint/type validation,
140 static pages and finalization. Existing React hook warnings remain. Built
identity is `erp_20261015t062600z_2b8094d1_release` in native BUILD_ID and the
matching artifact. Temporary Next-generated source/tsconfig edits were restored.

The diagnostic `frontend-candidate` ran inside **sabalanerp-local**, alongside
the unchanged canonical frontend/backend/PostgreSQL services. It used read-only
reviewed compiled/configuration mounts and an already-available immutable image:
`sabalanerp-local-frontend@sha256:80e45810d8d80bea984d8bac8c69ab6036b7b66946143e2955ea159bd7f3823a`.
Its complete package-lock SHA-256 matched this worktree:
`ea48c513fad8f1144ce36936adc455ecad7c97cd38d0a2ad651bc4bec43c4597`;
Next was 15.5.25 and React 18.3.1. An initial attempt to reuse the old running
container's no-longer-resolvable image reference failed before container
creation. The successful attempt inspected the available immutable image and
disabled pulling/building. It did not substitute a mutable rollback image.

Seven pure tests passed with no skips. The actual integration suite then passed
two tests with no skips in 5,869 ms:

1. Installed Next's production configuration loader accepted the built identity
   without overrides and rejected both conflicting deployment environment
   variables before serving. No second HTTP listener was started by this test.
2. An isolated headless Edge browser loaded the public landing page and clicked
   About. Actual JS/CSS asset URLs carried the compiled `dpl` identity; actual
   RSC navigation/prefetch requests carried matching `x-deployment-id`; there
   were no page errors.

The full deployment-control suite and design-system adoption check passed.
Its existing Linux-only host-lock test is skipped on Windows; the previous
foundation's Linux ownership evidence remains separate from this browser test.

Reproduce with `ONLINE_BROWSER_ACCEPTANCE_URL=http://127.0.0.1:3101` and
`ONLINE_BROWSER_ACCEPTANCE_BUILD_ID` set to the finalized candidate identity,
then run `node --test tests/online-deployment/browser-identity.integration.test.mjs`
after starting the opt-in existing-project candidate. The harness verifies the
canonical healthy project before Docker actions. It currently targets the
configured Windows workspace and does not claim portable acceptance.

The owned diagnostic container was stopped and removed by its verified exact
identity after the test; all canonical local services remained healthy. No
application database or business data was changed by these browser tests.

## Remaining admission

The selector has no public proxy/controller caller. Persistent journaled traffic
switching, actual retained-build routing/availability, Inquiry native actions
through multiple real builds, authenticated domain overlap, scoped durable
draft preservation, expiry handoff, session revocation and realtime catch-up
remain required. A 24-hour timestamp constraint or public navigation test is
not evidence that those user workflows work for 24 hours. Production traffic
has not been switched by this increment.
