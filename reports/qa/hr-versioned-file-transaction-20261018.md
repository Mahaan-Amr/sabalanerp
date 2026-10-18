# Private HR file transaction adapter

The explicit root-bound `createVersionedHiringFileTransaction` adapter now stages
one HR document through the two-key move primitive, returns immutable version
receipts, and uses the exact staged version for restore or logical removal.
Restoration never replaces a new original file, and stale cleanup never removes
a newer staged file. Legacy absolute-path records are not reinterpreted.

The domain/controller must durably persist plans before staging, persist version
receipts for recovery, await actual work and prove native actor closure. This
adapter provides no expired-lease takeover or implicit batch rollback. Ordinary
HR routes and cleanup database rows remain unchanged pending that integration.

The absent factory first failed the new HR seam while six move cases passed:
[RED evidence](versioned-hr-file-transaction-red-20261018.json).
The final suite passed **8/8** native Linux cases, zero skips:
[GREEN evidence](versioned-file-move-9894327efc2cd378d679888bf35c3f66.json).
It covers stage/restore, occupied-original protection, retained original bytes,
stale commit, replaced staging data, root mismatch, escaped/unknown receipt
fields, concurrent move ownership, capacity refusal and actual process death.
The canonical services retained their identities. Backend TypeScript passed.

Commit explicitly returns `LIVE_REMOVED_RETAINED_COPIES_PENDING` and
`physicalErasure: UNPROVEN`. It removes only the current staged copy and does not
certify physical erasure of immutable history or independent backups. Complete
copy inventory and physical erasure remain separate required work.
