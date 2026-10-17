# Contract draft preservation before revision refresh

Frozen application scope: `0f88a092..e1ddaca2`. Browser identity: `erp_draft_handoff_20261017`. Issue #405 remains open; this is one workflow's preservation path, not complete 24-hour retained-runtime admission.

Contract navigation fallbacks now use owner-scoped sessionStorage; autosave fallbacks use owner/draft-scoped localStorage envelopes. Missing ownership, unverified writes and unknown envelopes cannot authorize leaving through the save-and-navigate path. Unowned legacy keys are neither adopted into a different account nor removed. Existing server recovery envelopes remain canonical. Opening or committing another contract no longer deletes global legacy navigation/draft bytes.

Revision refresh captures the current draft with its producer build, workflow, schema and original base revision. It waits for a completed strict IndexedDB transaction, independent read-back and SHA-256 verification, with owner checks throughout. Failure retains the form. The original revision's existing recovery envelope remains. A refreshed authorized editor can inspect and download the opaque original-version copy; it never silently merges that copy into a newer canonical contract.

Reads use the original version-1 database/index, bounded primary-key pages and verified exact-record retrieval. UI state retains summaries instead of every payload. Pagination does not delete old copies or claim a global chronological order. Scope changes and unmounts deny stale pagination/download results. A single banner opens the canonical focused archive sheet.

## Acceptance

- Final frontend production build passed on `e1ddaca2`; existing unrelated hook warnings remain. No application source changed during this final build.
- Native IndexedDB/browser acceptance passed in 2.316 seconds with no skipped case. It seeded the previous v1 schema and archive before the new writer opened it, retained an old reader connection through the new write, and verified unchanged version/index/original bytes. It also checked reload persistence, owner isolation, concurrent saves, no age-based deletion, 275 snapshots across all bounded pages, exact retrieval of the newest snapshot and corruption rejection.
- Final compiled application browser command: `node scripts/run-design-system-e2e.mjs contract-draft-handoff.spec.ts notification-catchup.spec.ts --retries=0 --max-failures=1`, with canonical repository `D:/sabalanerp` and candidate URL `http://localhost:3101`. **8 passed in 25.9 seconds**, zero retries/skips. API responses were controlled; this is distinct from the native backend/session database evidence linked in the session-continuation report.
- The real contract editor changed a date, received a revision conflict, and refused refresh under native Chromium quota denial. After quota restoration it retained the original revision, refreshed, paginated nine older fixtures plus the new archive, and downloaded the exact original draft/build/schema/revision without saving a contract. Light/dark 390px/200% checks included actual download clicks, horizontal bounds and no serious/critical Axe violations. Both final images were visually inspected.
- The complete `npm run test:contract-creation` suite passed. Focused contract-party, recovery-journal, mutation-failure, browser ownership/storage and HTTP/session tests passed. Design-system enforcement, 25 foundation tests, 14 adoption tests and architecture ownership checks passed.
- Independent Standards and Spec reviews passed after addressing the archive listing limit and preserving the old index. The final presentation change also passed both reviews.

An initial browser fixture listened to the wrong checkpoint URL; it was corrected to the real `/recovery` endpoint. Quota zero did not prove denial, and a preallocated database could accept a small write despite a tiny override; the final denial scenario uses quota one before seeding history. Earlier visual acceptance exposed clipped actions despite the overflow check; canonical feedback wrapping and the focused archive sheet corrected that defect. Only the final frozen run above is acceptance.

## Environment and limits

The existing `sabalanerp-local` canonical backend, frontend, Inquiry and PostgreSQL were not restarted or replaced. The owned frontend candidate uses an existing immutable base image with reviewed compiled worktree output mounted read-only. This is not attestation of a complete immutable release image. The two owned passive backend diagnostic slots exited zero and were removed without force; their private evidence volume remains.

Browser-local storage is not an independent server backup. This slice does not establish every workflow's durable handoff, in-flight upload completion, retained ERP/Inquiry action/runtime compatibility, 24-hour routing, distributed activation, current-data rollback or continuous coherent recovery. Those remain required before production online mutation or switching. No production application/schema/routing changed.
