# Exact-generation conditional publication

Private recovery owners can publish bytes only if a root's current head still equals their observed generation. The check holds the existing durable per-key claim, before reserving capacity or creating objects. `null` selects no history. A DELETE is an existing generation and requires its exact hash. This prevents delayed compensation from replacing later user writes or treating a deletion as a virgin key.

The native scope suite first failed because `publishIfCurrent` was absent, then passed all eight cases in `versioned-file-scopes-13b11ebf8e416b5cfa216506b1a1625d.json`, against writer SHA-256 `6a0263fd` (the receipt contains the full hash). It proves stale refusal leaves bytes, object inventory and pending claims unchanged; resurrection requires the deletion receipt. Full backend TypeScript passed. Standards and Spec independently matched the frozen two-source snapshot and found no actionable defect.

The long core regression was started against these exact source bytes and remains pending at this commit. Prior core, move and legacy tests remain scoped to their recorded source identities. This is a recovery prerequisite, not full repair integration, physical erasure, production deployment or independent application restore. No production mutation was performed.
