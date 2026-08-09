# Dispatch document audit and recovery

This module verifies and recovers dispatch-document evidence without becoming a second document workflow. Its public
ports consume immutable evidence owned by approved pricing, Logistics allocation finalization, `dispatchDocuments`,
Guard exit, and posted Dispatch Corrections.

## Invariants

- Replay follows stable identities from approved pricing through allocation, priced events, candidate decision,
  retained waybill/statement artifacts, successful byte handoff, physical exit, and statement adjustments.
- Every replay node and audit event retains actor, server/effective time, explicit nullable reason, correlation,
  idempotency identity, source hash, scale-three quantities, and scale-twelve amounts.
- Missing, hash-mismatched, wrongly linked, or audit-unbound evidence produces `UNRESOLVED_INCIDENT`; it is never
  zero-filled or repaired in the report.
- Reconciliation reads immutable artifact metadata but never edits it. Missing and corrupt referenced files are
  separate incidents. Unreferenced storage is only an orphan candidate until a second reference check confirms it.
- Restoration accepts bytes only from an encrypted recovery package and verifies the original byte length and SHA-256
  before and after writing. Historical PDFs are never regenerated.
- Quarantine rechecks that a key is unreferenced. Cleanup rechecks again and requires the configured safety window.
  Referenced metadata, source evidence, and issued files are never deleted.
- Every reconciliation, incident, restore, quarantine, rejection, and cleanup is appended through the audit port.

## Operational recovery drill

1. Verify `sabalanerp-local` with `npm run docker:local:ps` and capture current artifact metadata counts/hashes.
2. Create a COMPLETE encrypted system-recovery package. Dispatch artifact bytes are included under
   `files/dispatch-documents/<opaque storageKey>`; package validation fails if any referenced key is absent.
3. In isolated drill data, inject one missing file, one changed byte stream, one interrupted staging file, and one
   duplicate unreferenced staging file. Run reconciliation and retain its report hash and audit events.
4. Restore missing/corrupt artifacts only from the encrypted package. Verify exact original bytes, size, and SHA-256;
   a missing backup entry, wrong bytes, write failure, or post-write mismatch remains an unresolved incident.
5. Quarantine only a confirmed orphan after the reference recheck. Cleanup is a separate command after the safety
   window and another reference recheck.
6. Rerun replay and reconciliation. Acceptance requires `VERIFIED`, unchanged immutable metadata/source evidence,
   and a complete append-only audit trail. Otherwise keep the incident open and do not enable cutover.

The Accounting endpoint `GET /api/accounting/audit/dispatch-documents/recovery` exposes only the scoped recovery audit
stream to existing Accounting-view permission holders. Mutation authority remains outside the query.
