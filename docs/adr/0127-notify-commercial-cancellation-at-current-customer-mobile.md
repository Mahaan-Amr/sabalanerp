---
status: accepted
---

# Notify commercial cancellation at the current Customer mobile

On 2026-10-12 the owner confirmed notification for every newly committed commercial cancellation of ordinary and Partner customer Contracts with digital Customer acceptance in the current activation period. Acceptance of an earlier commercial version in that period qualifies; SMS submission alone and paper-only acceptance do not. Reactivation starts a fresh period. Expiry and administrative deactivation are excluded, and historical cancellations are not backfilled.

Cancellation and a durable notification intent commit together. External delivery happens afterward and failures cannot undo cancellation. Each cancellation event has one intent with retained attempt history; replay cannot create another notice. Reactivation suppresses unsent notices while preserving history.

The owner explicitly chose the current active Customer mobile over the historical accepted recipient because the Customer may have lost access to the old number. Select the active primary mobile, or the sole active valid mobile. Several mobiles without a primary require Seller selection; no valid mobile leaves the notice waiting for Customer contact correction. Every retry resolves current contact data again and records its actual destination. Acceptance evidence remains immutable under ADR-0123; this decision changes notification destination only.

The SMS template contains only ContractNumber and fixed cancellation information, without cancellation reason. Sellers receive a small success status for four seconds after successful initial or repeated Customer confirmation SMS submission in both sales flows. Provider acceptance is distinct from handset delivery. Local implementation is authorized by the completed design interview; this decision does not authorize production deployment or attest validation.
