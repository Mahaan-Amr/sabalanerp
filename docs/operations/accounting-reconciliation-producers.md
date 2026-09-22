# Accounting reconciliation producers

Period close accepts operational reconciliation only from registered source-owner producers. Each producer has its own HMAC secret and is restricted to an exact source system, reconciliation-code set, and either specific Accounting book IDs or legal-entity codes. Do not share credentials between subledger, treasury, inventory, and tax producers.

Configure `ACCOUNTING_RECONCILIATION_PRODUCERS` on the backend as a JSON array:

```json
[
  {
    "id": "treasury-production",
    "secret": "a-secret-with-at-least-32-bytes",
    "sourceSystem": "TREASURY",
    "reconciliationCodes": ["TREASURY"],
    "legalEntityCodes": ["1"]
  }
]
```

Production secrets belong in the deployment secret store, not in source control. `docker-compose.local.yml` supplies distinct development-only credentials for the four local producers.

The producer posts its immutable snapshot result to `/api/accounting/period-end/operational-reconciliations` with these headers:

- `X-Accounting-Reconciliation-Producer`: configured producer ID
- `X-Accounting-Reconciliation-Signature`: lowercase hex HMAC-SHA256 of the canonical evidence hash, using that producer's secret

The request body must contain the book, fiscal year and optional period IDs; the configured `sourceSystem` and reconciliation code; a SHA-256 source snapshot hash; source and ledger debit/credit totals; unresolved differences; control payload; and the reconciliation timestamp. The backend rejects signatures, scopes, mismatched fiscal domains, and materially future-dated evidence before writing immutable evidence.

To submit a producer-generated JSON payload with the repository adapter:

```powershell
$env:ACCOUNTING_RECONCILIATION_PRODUCER_ID = "treasury-production"
$env:ACCOUNTING_RECONCILIATION_PRODUCER_SECRET = "a-secret-with-at-least-32-bytes"
$env:ACCOUNTING_RECONCILIATION_URL = "https://erp.example.com/api/accounting/period-end/operational-reconciliations"
npm run accounting:reconciliation:submit -- .\reconciliation.json
```

Rotate one producer secret by changing only that producer's deployment secret and configuration. A producer cannot submit evidence for another source owner, reconciliation type, or legal entity.
