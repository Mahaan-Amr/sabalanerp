# Model candidate SMS delivery as an attempt ledger

Candidate hiring SMS delivery is represented by a logical notification with an append-only sequence of provider attempts, rather than one mutable status on the hiring record. This preserves every SMS.ir `messageId`, actor and result for audit, lets any delivered attempt settle the logical notification, and prevents duplicate retries while an accepted attempt remains inside its 24-hour reporting window; legacy status columns remain only as compatibility projections during migration.
