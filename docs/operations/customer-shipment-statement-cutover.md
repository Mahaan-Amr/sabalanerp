# Customer Shipment Statement cutover

This runbook is deliberately fail-closed. It does not waive a failed gate, synthesize legacy pricing, delete evidence,
or activate the external feature flag. The database cutover is one-way; after accepted live writes, pause the new
path and fix forward instead of deleting or rewriting document history.

## 1. Keep both gates disabled

Deploy the additive migrations and code with `CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=false`. Confirm that the singleton
`customer-shipment-statements` database cutover is also disabled. A manifest cannot receive `GO` while either gate is
already enabled.

Use only the existing Compose project:

```powershell
npm run docker:local:ps
```

## 2. Produce evidence

On production, steps 2 through 4 must run while the existing zero-data-loss deployment owns the live lease, Nginx is
serving maintenance, writers are drained, and the verified local/off-server checkpoint is complete. The cutover
command refuses production execution unless the durable deployment operation is at `MIGRATIONS_APPLIED`, its lease is
live, and its release ID and target commit match. Keep that boundary through activation and the final deployment
gates; never collect the authoritative cohort while public contract writes are open. A newly created contract is not
ignored: it either appears in the locked recapture with an exact reviewed disposition or the run returns `NO_GO`.

Production operators must set `SHIPMENT_STATEMENT_CUTOVER_REQUIRED=true` only for the one-way activation release and
set the target release gate `CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=true`. Place the prepared caller evidence at
`<DEPLOYMENT_REPORT_DIR_HOST>/shipment-statement-cutover/pending/evidence.json` and its referenced recovery,
integrity, concurrency, and acceptance inputs under the adjacent `artifacts/` directory. Optional legacy pricing
reviews belong in `pending/legacy-pricing-reviews.json`. The deployment runner keeps the command-local environment gate false,
runs legacy dry-run/apply/repeat, manifest, and activation synchronously after `MIGRATIONS_APPLIED`, renews the deployment lease while they run,
and does not start the release until they finish. A missing/stale artifact, changed live cohort, `NO_GO`, expired lease,
or timeout triggers the existing journaled rollback; there is no phase race or manual bypass.
Every pre-captured acceptance receipt must name the exact target commit. Production recomputes the receipt/output
hashes, checks that commit binding, re-reads the migration evidence, and recaptures the complete live legacy cohort
while writers remain drained. It does not attempt to run the local Docker or browser matrix inside the minimal
production backend image.

After writers drain, the runner first creates fresh legacy dry-run/apply/repeat artifacts from the exact current
database state. It then creates `<deployment-id>/artifacts/live-cohort.json` and keeps the
lease alive while it waits (within the existing 15-minute post-mutation limit) for independent approval. The reviewer
must inspect that file and sign its exact bytes from a separate trusted terminal:

```sh
node deploy/scripts/approve-shipment-statement-cohort.mjs \
  <report-dir>/shipment-statement-cutover/<deployment-id>/artifacts/live-cohort.json \
  <report-dir>/shipment-statement-cutover/<deployment-id>/artifacts/live-cohort-approval.json \
  <secret-dir>/shipment-statement-cohort-approval-key \
  <approval-key-id> <reviewer-id>
```

The runner writes a deployment-specific evidence copy that binds all three fresh legacy artifacts and these two
cohort paths. The approval helper fsyncs a mode-0600 temporary file and publishes it atomically; it never prints the
secret. A deployment ID with existing cutover output is rejected, so no stale artifact can be reused. A contract
created up to the drain boundary is therefore included in the fresh legacy run and snapshot rather than depending on
an earlier count.

Create a recovery-capable backup and restore it in the controlled `sabalanerp-local` restore drill. Record the backup
SHA-256 and compare the restored counts, identifiers, scale-three quantities, scale-twelve amounts, and evidence hash
with the source. A successful backup command without a successful restore is not evidence.

Run `verify:shipment-statement-migration` twice. Each immutable run must contain all preservation scopes with no
difference. The production runner performs legacy pricing preflight in dry-run, apply, and repeat modes after drain.
The repeated apply must create zero new
records. Every release-cohort row must have an explicit reviewed disposition; unresolved, quarantined, and unreviewed
counts must all be zero. `REPAIR_REQUIRED` records may remain outside the release cohort only with their explicit
blocked disposition—they are never guessed, zero-filled, or silently converted to `READY`.

Bind release-cohort decisions to the exact legacy manifest and source evidence in a JSON artifact. Every current
legacy identity must appear exactly once. `INCLUDE` admits the row to the release cohort; only a
`REPAIR_REQUIRED` row may use `EXCLUDE_BLOCKED`. The latter records that the pre-cutover revision remains
waybill-only until its owning source is corrected and a successor approval is created. Changed hashes, unknown or
duplicate identities, incomplete reviewer evidence, and exclusions of any other state fail closed.

```json
{
  "schemaVersion": 1,
  "sourceManifestHash": "64-character legacy manifest hash",
  "entries": [
    {
      "contractId": "internal-contract-id",
      "sourceFinancialRecordId": "internal-approved-leaf-id",
      "sourceEvidenceHash": "64-character source evidence hash",
      "decision": "INCLUDE",
      "reviewedBy": "release-owner-id",
      "reviewedAt": "2026-09-05T10:00:00.000Z",
      "reason": "Independent release-cohort review reference"
    }
  ]
}
```

The product/release owner approves the exact cohort SHA-256 together with the approver identity and key ID as a
detached HMAC-SHA256 artifact containing `algorithm`, `keyId`, `approvedBy`, and `signature`. Set `legacy.cohortArtifactPath` and
`legacy.cohortApprovalArtifactPath` in the caller evidence JSON. The cohort approval key must be held separately from
the cutover signing key; the command rejects reuse of the same key. The verified artifact hashes, complete source and
release-cohort status counts, release-cohort count, and excluded-blocked count are copied into the signed cutover
manifest. Omitting reviewed cohort evidence preserves the existing fail-closed `NO_GO` behavior when unresolved or
unreviewed legacy rows exist.

The HMAC input is the UTF-8 encoding of this compact JSON object in the shown key order, with the real values and no
extra whitespace: `{"algorithm":"HMAC-SHA256","keyId":"<key-id>","approvedBy":"<owner-id>","cohortSha256":"<cohort-file-sha256>"}`.

Run every command listed by `CUTOVER_ACCEPTANCE_COMMANDS` in
`backend/src/services/shipmentStatementCutover/index.ts`. Capture the exact command, exit code, and SHA-256 of its
complete output in the evidence JSON. Include the audit/recovery report and the three-run concurrency trace hashes,
incident contacts, and the post-cutover monitoring checklist.

## 3. Create the immutable go/no-go manifest

Set the non-secret identities through the release configuration:

- `SHIPMENT_STATEMENT_CUTOVER_KEY_ID`
- `SHIPMENT_STATEMENT_COHORT_APPROVAL_KEY_ID`
- `SHIPMENT_STATEMENT_CUTOVER_ACTOR_ID`
- `SHIPMENT_STATEMENT_RELEASE_ID`

For a non-production rehearsal only, the signing values may be supplied as
`SHIPMENT_STATEMENT_CUTOVER_SIGNING_KEY` and `SHIPMENT_STATEMENT_COHORT_APPROVAL_KEY`; each must contain at least
32 characters and they must differ. Never put either value in command history or a committed file.

In production the two key values must not be environment variables. The secret manager must mount them as mode-0600
`shipment-statement-cutover-signing-key` and `shipment-statement-cohort-approval-key` files beneath
`DEPLOYMENT_SECRET_DIR`; only the ephemeral deployment service receives that read-only mount.

Then run:

```powershell
npm --prefix backend run shipment-statement:cutover:manifest -- --evidence <evidence.json> --artifacts <gate-artifact-dir> --out <new-manifest.json>
```

That direct command is for rehearsal and non-production preparation only. In production, `deploy.sh` owns this command
and writes the immutable manifest beneath `shipment-statement-cutover/<deployment-id>/manifest.json`.

The command reloads the disabled database gate and the two latest immutable migration runs rather than trusting those
fields from the supplied JSON. The output file is created with exclusive write semantics and cannot overwrite an
earlier manifest. A `GO` authorization expires after 15 minutes so activation cannot reuse stale preflight evidence.
`NO_GO` exits with code 2. Archive that manifest and stop; fix the owning source ticket and repeat
with a new release ID and a new output path.

## 4. Activate only after independent approval

Do not run this step for a `NO_GO` manifest. Keep the environment flag false while the transaction executes:

```powershell
npm --prefix backend run shipment-statement:cutover:activate -- --manifest <go-manifest.json> --receipt <new-receipt.json>
```

That direct command is likewise non-production. Production activation is performed only by the deployment runner;
the transaction re-locks and revalidates the exact deployment ID, secret lease token, release ID, commit, phase, and
database clock immediately before changing the cutover row. Its receipt is retained beside the production manifest.

The command verifies the manifest hash and HMAC, rejects any changed evidence, and performs one conditional database
update. PostgreSQL transaction time becomes the exact compatibility boundary. The database trigger prevents a second
activation or later rewriting. The signed receipt records the exact boundary and actor.

Only after the receipt is archived and independently compared with the database row may deployment set
`CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=true`. Signed database activation atomically changes the operations control from
its initial safe pause to running and appends the first hash-chained audit event. The target release must carry the
enabled environment gate and prove the effective runtime state before `TRAFFIC_OPENED`; initial activation never
depends on reaching the web panel through maintenance. Drafts finalized from the database boundary onward revalidate
under the new rules; revisions finalized before it remain waybill-only and can never receive a Customer Shipment
Statement.

The release-mode `deployment-gates` command enforces that proof: before traffic can open, an activated cutover requires
the environment gate enabled and the operations control running with no incident. A pre-cutover release rejects an
environment gate that was enabled early.

## 5. Pause and rollback

Before activation, rollback means leaving or setting the environment flag to false. Never delete migration evidence,
sealed pricing, artifacts, manifests, the paused operations-control row, or the disabled cutover row.

After activation, use **توقف موقت** for a planned short pause. Use **توقف اضطراری** when correctness or integrity is
in doubt. Both controls are durable, require administrator
re-authentication and a reason, increment a compare-and-swap revision, and append a hash-chained immutable audit event.
The environment flag remains an independent deployment gate, not the routine pause control.

While either database pause or environment gate is inactive, a post-cutover finalization fails closed. It must never
fall back to the legacy waybill-only path. Existing evidence and the immutable database boundary remain. Reconcile an
incident, restore only verified original artifact bytes through the recovery flow, and fix forward. Resume an emergency
pause only after the incident cause is corrected and the administrator records the recovery reason; use a full
controlled release whenever code, schema, or release evidence changed.

Monitor at minimum: issuance failures, incomplete primary bundles, orphan/corrupt artifacts, audit gaps, stale pricing
bindings, failed print handoffs, adjustment sequence conflicts, Guard exits without a valid bundle, and concurrency
retry exhaustion.
