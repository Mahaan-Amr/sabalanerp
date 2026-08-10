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

Create a recovery-capable backup and restore it in the controlled `sabalanerp-local` restore drill. Record the backup
SHA-256 and compare the restored counts, identifiers, scale-three quantities, scale-twelve amounts, and evidence hash
with the source. A successful backup command without a successful restore is not evidence.

Run `verify:shipment-statement-migration` twice. Each immutable run must contain all preservation scopes with no
difference. Run legacy pricing preflight in dry-run, apply, and repeat modes. The repeated apply must create zero new
records. Every release-cohort row must have an explicit reviewed disposition; unresolved, quarantined, and unreviewed
counts must all be zero. `REPAIR_REQUIRED` records may remain outside the release cohort only with their explicit
blocked disposition—they are never guessed, zero-filled, or silently converted to `READY`.

Run every command listed by `CUTOVER_ACCEPTANCE_COMMANDS` in
`backend/src/services/shipmentStatementCutover/index.ts`. Capture the exact command, exit code, and SHA-256 of its
complete output in the evidence JSON. Include the audit/recovery report and the three-run concurrency trace hashes,
incident contacts, and the post-cutover monitoring checklist.

## 3. Create the immutable go/no-go manifest

Set these values through the release secret manager; do not put the signing key in a file or command history:

- `SHIPMENT_STATEMENT_CUTOVER_SIGNING_KEY` (at least 32 characters)
- `SHIPMENT_STATEMENT_CUTOVER_KEY_ID`
- `SHIPMENT_STATEMENT_CUTOVER_ACTOR_ID`
- `SHIPMENT_STATEMENT_RELEASE_ID`

Then run:

```powershell
npm --prefix backend run shipment-statement:cutover:manifest -- --evidence <evidence.json> --out <new-manifest.json>
```

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

The command verifies the manifest hash and HMAC, rejects any changed evidence, and performs one conditional database
update. PostgreSQL transaction time becomes the exact compatibility boundary. The database trigger prevents a second
activation or later rewriting. The signed receipt records the exact boundary and actor.

Only after the receipt is archived and independently compared with the database row may deployment set
`CUSTOMER_SHIPMENT_STATEMENTS_ENABLED=true`. Drafts finalized from that boundary onward revalidate under the new
rules; revisions finalized before it remain waybill-only and can never receive a Customer Shipment Statement.

## 5. Pause and rollback

Before activation, rollback means leaving or setting the environment flag to false. Never delete migration evidence,
sealed pricing, artifacts, manifests, or the disabled cutover row.

After activation, an incident pauses new statement work by setting the environment flag false. Existing evidence and
the immutable database boundary remain. Reconcile the incident, restore only verified original artifact bytes through
the recovery flow, and fix forward. Re-enable only after the complete gate matrix and monitoring checks pass again.

Monitor at minimum: issuance failures, incomplete primary bundles, orphan/corrupt artifacts, audit gaps, stale pricing
bindings, failed print handoffs, adjustment sequence conflicts, Guard exits without a valid bundle, and concurrency
retry exhaustion.
