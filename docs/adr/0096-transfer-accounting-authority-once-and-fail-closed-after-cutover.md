---
status: accepted
---

# Transfer Accounting authority once and fail closed after cutover

Cutover requires proven coordinated backup and restore, a protected write boundary, final delta migration, exact reconciliation, accepted evidence, and an immutable authority-transfer timestamp after which Sepidar is read-only and SabalanERP receives every new accounting write. Before SabalanERP's first new authoritative posting, the rehearsed rollback may restore Sepidar. After authoritative posting begins, an incident pauses safely and fixes forward; returning authority requires an exceptional complete reverse migration and reconciliation, never casual dual entry or partial rollback.
