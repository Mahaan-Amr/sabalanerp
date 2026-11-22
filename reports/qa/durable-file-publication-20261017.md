# Durable file publication and multipart completion — 2026-10-17

Base: `de684e7c`. This implements local atomic file publication and actual upload
completion. It does **not** implement immutable file generations/deletion lineage
or admit online production changes. Production was not changed.

## Connected writers

`durableFilePublication` writes a private, exclusive stage; owns stream errors and
actual descriptor completion; syncs bytes; publishes by no-clobber link or atomic
replacement; and syncs directory entries before acknowledging. It never truncates
the prior inode. Preparation also syncs directory ancestry on the same filesystem,
including when another creator's mkdir is already visible but not yet persisted.
An uncertain post-publication outcome retains the new bytes and fails, without
restoring older content or silently replaying. Deletions sync their observed
absence. Windows development does not certify Linux directory durability and
refuses replacement of an open target instead of deleting it as a fallback.

The shared PDF writer, frozen Accounting outputs, Dispatch artifact port and
encrypted performance-export publication/cleanup now use this implementation.
Frozen output hash verification and the existing domain transaction/storage-key
locks remain in place. Performance export encryption, attempt names, evidence
locks, legal holds and backup-deletion policy retain their business meaning.

Eight disk-upload configurations across six routes now use `createDurableUpload`:
images, product spreadsheets, Hiring, HR duties, Guard photos and Support Ticket
attachments/staged attachments. Existing field names, file limits/filters,
generated names and permission middleware remain owned by those routes.

The wrapper owns actual stream/publication/cleanup promises independently of
Multer's pending counters. It removes only its request-owned published inode
before an error handoff, checks an opened descriptor's full device/inode identity,
and retains uncertain cleanup. An async business callback remains owned even if
its caller ignores the returned promise and sends an early response. The callback
is invoked once; rejection never replays it or deletes an already handed-off file.

## Actual acceptance

The authoritative native run is
[`file-publication-7511f019fabc7103e4cfb6b3c20b2d9e.json`](file-publication-7511f019fabc7103e4cfb6b3c20b2d9e.json)
and its TAP. It used the existing `sabalanerp-local` diagnostic slot and private
Linux volume. Canonical backend/frontend/PostgreSQL/Inquiry IDs, images and start
times were unchanged. No additional database/container/Compose project was made.

**7 native tests passed, zero skipped**:

- Frozen Accounting bytes, missing/corrupt-file refusal.
- Stream failure preserves prior content and an already-open reader.
- Concurrent create collision does not overwrite a complete artifact; incoming
  render-buffer mutation cannot change the admitted bytes.
- File/directory aliases cannot expose or replace another target.
- Real HTTP multipart size rejection, fixed-name collision and a streamed first
  **already-published** part followed by an unexpected field: no business handoff,
  exact previous file preserved, all newly owned rejected files removed before
  the error response.
- An ignored async upload callback sends HTTP 202, waits behind a barrier, then
  writes one real receipt. Drain times out while that work remains and completes
  only after its actual publication; no replay occurs.
- Client disconnect during a real partial multipart stage: the actual production
  error handler completes, file work drains and the private stage is removed.

The additional native fixture killed its exact unreaped child only after a real
1,048,576-byte private stage existed. The original target inode/content survived.
It then verified actual Dispatch create/collision/discard, zero remaining owned
file descriptors, and two actual Chromium PDF generations through the current
bundled PDF source. `pdfinfo` reported one page; extracted old/new markers and an
open reader proved different complete PDFs with the old reader unchanged. PDF
source/input hashes are retained. Successful diagnostic data was removed only
after the exact child had exited and the unchanged-target/inode proofs passed.

An initial Chromium launch failed because the diagnostic slot's root filesystem
is read-only. The fixture now gives Chromium private XDG profile/cache locations;
production PDF arguments were not altered. The earlier private failed workspace
`file-publication-4bcf0c3087dd9094f19a0a0d85c7077d` retains its diagnostic stage and
source for inspection; no healthy application recovery point references it.

Other gates:

- Full backend TypeScript `--noEmit` and architecture ownership check passed.
- Entire `test:dispatch-documents` passed (five scripts). An existing stale
  repository mock lacked the now-required ordinary-contract query/eligibility
  inputs. It now supplies explicitly signed ordinary contracts and matching
  financial evidence; it was not relabelled as partner data or allowed to skip
  the actual guard. Existing stale-pricing/publication assertions remain.
- Actual PostgreSQL performance-export lineage integration passed in a schema-only
  temporary database of the existing local service: source dependencies, legal
  holds, failed files, unrelated expiry, dual release and four deterministic
  cleanup/publication orderings. The test helper now uses the canonical Compose
  path override for runtime actions while retaining candidate migration sources.
- Four HR contract/authorization/route scripts, Support Ticket policy, Catalog
  spreadsheet tests and performance disclosure policy passed.
- No interactive or visual component changed. The native PDF check validates the
  unchanged renderer through the new persistence path, not new PDF layout design.

## Remaining admission

This is a prerequisite for retaining immutable file versions, not that retention
mechanism itself. Current path/transaction ownership remains the caller's duty;
cross-runtime file-version ownership, protected capture, PostgreSQL/SQLite/file
coherence, privacy replay and independent new-chain restoration remain required.
Remaining synchronous HR staging/deletion and native writers must participate in
that coherent capture contract. No completed backup, migration compatibility or
online routing authority is inferred from an atomic filesystem write.

The preceding native-runtime ownership commit `de684e7c` separately received
independent Standards and Spec PASS reviews. Issue #405 remains open.
