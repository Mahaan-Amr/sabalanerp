# Current production application image export component

The three actual immutable application images serving production commit
`a2c75f1027a069e91837ff433e1c91cdc7746798` now have private exported archives.
The original deployment lock remained held through both-host storage preflight,
export, byte verification, local gzip round trip and durable native closure.
No runtime, SQL, source checkout, tag or public routing change was made.

[Result](production-image-export-b39dbefcc66448449f62d93159a31151.json) records
native exit 0 and unchanged identities/start times for all six healthy source
services. Exact compressed sizes are backend **535,457,062**, frontend
**269,816,525** and Inquiry **379,614,943** bytes. Private source capacity remained
26,033,737,728 bytes free after export. This is not a public pause/RTO measurement.

The frozen OCI inspector verified whole archive/blob hashes and exact
index/platform/config/rootfs identities; all five focused inspector regressions
passed before the operation. Gzip streams were independently read back against
the entire verified raw archive. Expanded layer diff-ID verification and measured
expanded staging costs remain requirements for independent materialization.

Both reviewers accepted the frozen sources before execution. Readable one-use
controllers and [exact source bytes](production-image-export-sources-20261018/exact-source-bytes.json)
are retained for provenance. Source hashes are also in the
[operation intent](production-image-export-b39dbefcc66448449f62d93159a31151-intent.json).

These archives are still on the production host. Independent encrypted custody,
remote readback, decryption, import and application restoration remain pending.
No coherent healthy recovery point or public online authority was published.
