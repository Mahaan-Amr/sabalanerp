# Version-bound Dispatch quarantine and live cleanup

The real Dispatch recovery operations factory accepts an explicit orphan storage owner inside its existing database key lock/transaction. The factory scopes commands by phase, key, actor, reason, idempotency and authority; transport retries retain that scope. Configured owner rejection propagates and never falls back to raw legacy writes. Ordinary construction is unchanged.

The new private owner binds four disjoint existing roots through one actual file publisher. It records append-only selection, intent, result, compensation and finalization evidence. Reads durably select the exact generation checked against reconciliation; quarantine's pair-CAS cannot select newer bytes. Quarantine returns a typed operation/version/move receipt, persisted in its completion audit and carried through both database evidence readers into cleanup. Cleanup verifies the original quarantine intent/result and requires that authorized generation. Identical replacement bytes are still a different generation. Legacy/malformed audit evidence cannot authorize versioned cleanup.

Compensation requires both original generations. Restoring staged cleanup creates a new quarantine generation, so old authorization remains held; an elapsed safety window does not authorize that new generation. Finalization and retries are bound to the original command/result. A live tombstone leaves immutable copies pending separate privacy accounting.

State reads distinguish virgin absence from DELETE history and reject malformed JSON values. They use the publisher's bounded `readSettled` primitive: a durable READ claim atomically excludes concurrent or unresolved key ownership, covers absent heads, and remains held through exact immutable reading and final head/live/claim validation. It never clears another owner's intent. Known oversize refusal settles only its untouched own claim; uncertain reads retain it. Independent historical reads remain available.

Validation against frozen r4:

- Writer SHA-256: `e12a8b988d8a90d45ef9ee66860c4053c11d204efdb8aaa26cd0ffcaff82ef83`.
- Orphan owner SHA-256: `4192d05896f2933b6f63e003bf478a3932e0da7197a6c2c1a3eb2df427e00959`.
- Ten native orphan cases passed: `versioned-file-orphan-d6dea03389201245f89b21a66a73484f.json`.
- Nine native root/conditional/settled-read cases passed: `versioned-file-scopes-5675e39a8701a77687276e0222f20926.json`.
- Native tests cover reconstruction, stale compensation/finalizers, lost acknowledgement, malformed and tombstoned state, changed checked bytes, identical quarantine replacement, missing audit-generation evidence, and actual failed state publication before/after durable head creation. Original unknown intents retain their bytes and inode. Held settled reads exclude same-key writers while another key continues.
- All 36 domain tests passed, including audit receipt forwarding and configured-owner rejection. Two stale backup-test database fakes were repaired to include the already-required empty performance-export query; runtime validation was not weakened.
- Full backend TypeScript passed. Independent Standards and Spec reviews matched all nine source hashes and passed after the discovered races and unknown-state defects were fixed. Canonical service identities remained unchanged in the native receipts.

This is not full Dispatch restoration/repair coverage, complete protected-root coverage, physical erasure, a coherent application recovery point, public online activation or a completed 24-hour browser acceptance test. Database integration of the new JSON receipt, full-domain restored acceptance and controller-wide native completion remain release gates. No production configuration, routing, migration or application startup was changed.
