---
status: accepted
---

# Require tamper-evident audit and proven Accounting recovery

Accounting audit is append-only, hash-linked, externally checkpointed, and verified on a schedule, covering successful and denied commands, effective authorization, overrides, evidence access, exports, and state changes without logging secrets. Recovery targets no more than fifteen minutes of potentially unrecovered change and four hours to core-service restoration through point-in-time recovery, encrypted off-host and immutable copies, coordinated database and file manifests, automated integrity validation, and quarterly full restore proof. Backup completion without successful restore evidence is not acceptance.
