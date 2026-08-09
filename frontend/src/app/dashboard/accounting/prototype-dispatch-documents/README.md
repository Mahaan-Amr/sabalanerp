# Dispatch document bundle prototype

Throwaway visual evidence for the Wayfinder decision ticket
“Prototype the compact branded dispatch document bundle.” It answers one
question: which compact RTL paper system should define the separately printable
waybill, shipment statement, print-both stream, continuation page, and signed
statement adjustment?

After checking the target with `npm run docker:local:ps`, run the prototype with
one command from this worktree:

```powershell
docker compose -f docker-compose.local.yml up -d --build --wait frontend
```

Then sign in to the local ERP and open:

```text
http://localhost:3000/dashboard/accounting/prototype-dispatch-documents?variant=A&document=both
```

Use the bottom switcher or Left/Right arrow keys to compare:

- `A` — guide bands: scan-first hierarchy and a prominent total.
- `B` — identity rail: a stable shipment rail with receipt-like price rows.
- `C` — ruled ledger: restrained, familiar form structure with minimal ornament.

The `document` query parameter accepts `waybill`, `statement`, `both`,
`continuation`, or `adjustment`. “Both” renders the two existing artifacts in
sequence; it does not imply a persisted combined artifact.

## Decision boundary

This prototype decides layout, density, shared visual identity, print ordering,
and continuation behavior only. Number identity, template version, checksums,
artifact persistence, exact snapshot schema, and print audit remain placeholders
owned by neighboring Wayfinder tickets. All displayed records are fake and every
sheet is watermarked.

The decision is not complete until a human chooses a variant or a deliberate
combination of their parts and explains why.
