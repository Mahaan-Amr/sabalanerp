---
status: accepted
---

# Submit tax invoices asynchronously through configurable secure channels

Each Legal Entity selects an effective-dated direct or trusted-company Tax Submission Channel. Canonical Tax Invoice payloads enter a transactional outbox and produce idempotent, append-only attempts with protocol version, request identity, timestamps, safe responses, and error evidence; retry cannot create a duplicate invoice and the UI never blocks until the authority responds. Private keys, certificates, fiscal-memory secrets, and provider credentials live in an encrypted non-exportable secret store outside operational tables, logs, exports, and audit snapshots, while the UI shows only safe version and health metadata.
