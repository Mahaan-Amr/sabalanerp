# Private versioned Personnel erasure, 2026-10-19

This adds an admitted private command, not production route activation. The
caller still owns administrator password/name confirmation. The command itself
requires a current active system administrator, refuses self deletion and
preserves an active administrator outside the target graph.

All configured roots must belong to the same genuine RuntimeWorkContext. Every
file in the actual Personnel plan must have an explicitly enrolled publication
root before a parent receipt or file mutation. All durable child plans precede
the first stage. Unsupported roots, raw source generations and ambiguous file
operations do not fall back to path-only work.

The target advisory lock and fresh READ COMMITTED owner check serialize initial
receipt creation. Each later bounded SERIALIZABLE transaction locks the original
parent/token before writes. Access revocation and graph deletion are separate
committed phases. The durable ACCESS_PREPARED snapshot binds the fresh graph
fingerprint, exact affected users/sessions, post-update timestamps and a unique
receipt-specific revocation reason. Row counts must match the original set.

After a failed SQL result, a fresh parent FOR UPDATE observes its committed
outcome. An observed committed phase is not compensated. Otherwise the original
actor fences the next phase with COMPENSATING before restoring exact file
versions. Access restoration uses compare-and-set timestamps, state and unique
revocation ownership in one transaction. A later user/session change retains
COMPENSATING and its original token; it is not overwritten or adopted by legacy
expiry/retry. Unknown outcomes retain receipts rather than authorize a successor.
Actual lost-transport acknowledgement remains unqualified.

Committed deletion retains immutable file copies and child receipts. Its parent
remains FILE_CLEANUP_PENDING with a declared versioned protocol. This does not
certify physical erasure, authorize clearing holds, or restore an older database.

## Real-schema graph defect found during qualification

Original native reproduction `dba0572e362c861e13bbaba237842f64` failed before the
new command: Personnel graph discovery selected `id` from the real
ContractApprovedPricingHead model, whose primary key is contractId. It was not
safe to omit that model. Graph discovery, record digests, file projection,
optional unlinking and deletion now use actual generated-client primary keys.
String/enum single keys retain their values; compound and integer keys encode
their complete typed tuple. Unsupported identities fail closed.

Declared relations retain the full foreign-key tuple, including alternate parent
keys. Only nullable foreign-key fields are cleared for optional relationships;
non-null tuple members remain intact. Queries use bounded 500-key batches and
the existing 50,000-node limit. Immutable/retention triggers and graph cycle
refusal are unchanged. Actual selected compound-domain record erasure and every
financial/privacy stratum remain outside this component's demonstrated coverage.

## Acceptance

- `3cc29150c8843f37625856345d2d8f20`: graph discovery passed after the key fix;
  the new command stub then failed as expected.
- `69a8df64d0e1dad5a90aad369f308c7d`: initial real Personnel/User deletion passed.
- `c77f767085ac92700ce22aaf3d09721b`: actual non-id enum-key authority-owner
  deletion, session handling, late SQL rollback and changed-access refusal passed.
- `cbfaf4df881e98a947e07ca33e4a5f6e`: enrolled actual hiring-file removal,
  retained original bytes, unenrolled-root refusal before receipt, and exact
  file restoration together with access compensation passed.
- `9f76b3e03e0b20700b42c678f0d23627`: final native cases plus nonadministrator
  refusal and exact access-update cardinality checks passed.

The late fault is a real SQL trigger rejecting the final parent transition after
graph deletion statements. The changed-access case commits a real user-row
change after access preparation; compensation refuses it and preserves the
original revocation. No SQL acknowledgement, private state or return value is
mocked. Synthetic triggers exist only in isolated test databases.

All six runs closed the original Prisma/work owner and normally retired only
their own isolated database after zero-session/OID checks. Existing canonical
and candidate identities were preserved. The native process uses private umask
077 before creating its own test storage; it does not change the candidate
service or relax publication permissions. Six existing retention policy/graph/
recovery/decision tests, full backend typecheck and architecture checks passed.

Full multi-root writer/reference/privacy coverage, compound financial strata,
public routing/upload composition, native crash reconciliation, coherent new
recovery-chain restoration, production switching and whole-platform 24-hour
browser compatibility remain required. No production operation was admitted.
