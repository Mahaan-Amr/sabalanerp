# Customer output adapter — issue #325

Consumes `@sabalanerp/partner-sales-contracts@1.0.0`, wire schema 1 and `sha256-v1`.
This delivery is module acceptance, not live Partner activation. #334 supplies
the real Case, session, outbox, policy and private artifact persistence adapters;
#335 proves their combined behavior against real constraints and races.

## Boundaries

- `snapshots.ts`: strict retail evidence, hash validation, frozen business identity,
  recipient/revision binding, expiry and historical read disposition.
- `confirmation.ts`: one store transaction for send/resend/OTP. Existing token,
  manual lookup, recipient selection, cooldown, attempt limits and cryptographic
  OTP policy remain with the existing session owner. Outbox references commit
  before gateway calls; delivery failure is retryable without commercial rollback.
- `issuance.ts`: validate and authorize before any rendering/download. Prepare a
  durable private artifact before final publication. `publishFinal` must recheck
  current authority/revision and atomically append PRINTED through the Case port
  plus artifact/audit evidence. It must share the Case's SIGNED/PRINTED realization
  constraint. Preview and redownload never call that commitment boundary.
- `existingFlow.ts`: optional hooks on `ContractConfirmationService`; no new routes
  or public actions. An explicit persisted ordinary kind is the only allowed
  fallback. Unknown/hidden/stale/unsupported Partner requests fail closed.
- `generateCustomerContractPdf`: validates content, renders the same print template,
  returns bytes only. It never writes to the existing public contract directory.
  The existing confirmation card/table renders only the retail DTO for this flow.

## Integration requirements for #315/#321/#327/#334

1. Persist immutable `CustomerOutputSnapshotSchema` evidence when sending, with
   a unique binding to the session, Case revision/hash, recipient and expiry.
   Store only hashed tokens/OTP and protect any worker-delivery secrets at rest.
2. Bind both token and contract-number/phone lookup to that same historical session;
   do not redirect a verified session to the current successor. Invalidate pending
   sessions atomically on revision, recipient, cancellation and correction changes.
3. Lock/CAS the Case and session together. Invalid OTP attempts must remain committed
   even when verification returns a failed Result; business exceptions roll back.
   CUSTOMER_APPROVED is the only OTP transition. Never regress SIGNED/PRINTED.
4. Queue notification evidence and audit in the transaction. The worker must check
   that recipient/session evidence is still sendable before resolving any secret;
   retries are idempotent and log neither OTP/token nor provider raw payloads.
5. Private artifact storage must be durable, outside static mounts, and record a
   byte digest as well as the output hash. Every download/export reauthorizes and
   verifies the stored artifact. A failed or losing publication leaves unpublished
   files for the storage owner's reconciliation, never deletes a winning artifact.
6. Compose the optional hooks only when explicit Partner kind, schema constraints,
   policy, package installation and Docker packaging are ready together. This lane
   deliberately does not alter the shared manifests, migrations or composition root.

Fixture concurrency proves this adapter's calls and failure handling; it does not
prove database locks, exactly-once financial realization, live SMS delivery or
end-to-end activation. Those remain explicit #334/#335 acceptance obligations.

## Checks

Run `node tests/partner-sales/output/run-local.mjs` only with the existing healthy
`sabalanerp-local` project and after obtaining the shared QA runtime window.
The runner copies sources into `/tmp/customer-output-325`, never changes runtime
services or the database. UI and template tests also run using the existing
frontend tsx executable. Verification results are recorded in the issue delivery.
