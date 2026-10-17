# Retire one unreferenced private DR image

Frozen cleanup source: `b3dbe565`; fixture SHA-256
`253e12e818fa852c4490d1399f4b668f38bf2f0ae6cb59134ee59ebe3e087cd0`.
Both independent Standards/Spec reviews passed before execution. The staged
root-owned script was mode0400 on the independent backup host.
[Native status, proof and completion receipt](private-restore-image-retirement-20261017.json).

The exact image `sha256:15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d`
was imported for the completed private DR trials. Its working PostgreSQL
container/data had already been retired with native completion proof. Fresh
inspection found no running, stopped or created container referencing this
untagged image. The operator held both the private drill lock and backup storage
lock and checked references again immediately before no-force image removal.

Both complete healthy unheld checkpoints were fully hashed. The retained
encrypted physical component and the pinned full image archive were hashed too.
Streaming read-back found the exact image configuration, verified its config
digest and diff-ID list, and found every referenced layer entry. This relies on
the pinned full archive digest and its previously established provenance; it is
not a new independent layer-payload verification. No extraction/import was done.

Docker reported273,830,989 logical image bytes. Actual free space changed from
3,809,021,952 to4,099,321,856 bytes during removal; concurrent foreign activity
means this difference is not an exact exclusive reclaim measurement. All fresh
Fintech service identities/start times were unchanged during this operation.
The created R2 forensic container and its image remain protected. No recovery
archive, key, container or volume was removed.

A subsequent real production-to-backup preflight passed on both hosts: primary
35,058,028,544 free bytes; independent backup4,122,820,608 free bytes against the
3,758,096,384-byte full-drill budget. These are point-in-time observations.
Earlier preflight correctly failed while foreign updates temporarily consumed
space. Every real build/transfer/update still requires a fresh measured check.
