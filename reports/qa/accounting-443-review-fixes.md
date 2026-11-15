# Accounting #443 review fixes — local evidence

Observed 2026-11-15 on `codex/accounting-443-review-fixes`, based on integration `be696471`.

The dashboard change check uses transactional, 32-bucket write versions for ordinary and authorized Partner data. It always resolves current per-Case authority, including committed Cases without an invoice. Older row edits that retain `updatedAt`, inserts, deletes, customer presentation edits, and an authorized invoice-free Case with a false client hint were covered by focused service tests. Repeated unchanged checks did not advance revisions. The Partner payment grouping and Accounting return-route predicate were deduplicated without changing their callers' behavior.

The four additive migrations cover Sales Contracts and their list children, financial records, receivables, payment statuses, tax, correction requests, Accounting audit and flags, Partner Case/profile/revision/payment-plan sources, CRM customer presentation fields, user names, Accounting settings, and periods. The Partner revision trigger uses its composite `(caseId, revision)` identity. A fresh-schema lifecycle fixture applied the migrations in order with no trigger bypass.

The final lifecycle-backed authenticated HTTP fixture made twenty sequential requests per surface on the existing `sabalanerp-local` PostgreSQL service. Dashboard nearest-rank p95 was **2,107 ms** (maximum 2,210 ms); reviewable-list p95 was **2,022 ms** (maximum 2,026 ms). Exact parity covered 965 IDs; an in-flight mutation yielded 966, both in-flight requests returned 200, subsequent actor revocation returned 401, and no P2028 occurred. A prior run before the presentation-source migration measured 2,160 ms and 2,010 ms respectively. These are isolated local fixture results, not production admission or a concurrent-load guarantee.

Five warm service calls on the ordinary local population after the first revision change were 2,954, 2,781, 2,702, 2,658, and 3,063 ms for a complete dashboard. Ten unchanged checks were 89–112 ms. The historical pre-migration four-endpoint test took 9,743 ms; the same test after the migration took 9,395 ms. These small observations do not establish the production-state three-second gate.

The focused browser focus/scroll spec passed on the existing Compose frontend and backend images. Those images predate this branch, so this is legacy behavior coverage only; browser proof of the revised request and server change signal remains for the merged candidate. No production deployment or release admission was performed.

The #448 source migration catalog count and identity predate these four migrations. Release preparation must regenerate the inventory from the final merged candidate and repeat the protected migration checks before promotion.
