# Scoped native capture integration — 2026-10-17

Private capture ownership integration; no durable fleet pause, production controller, public serving admission or new healthy recovery point is enabled.

The freeze parser now recognizes a genuinely read-only capture-purpose scope bound to the private guardian directory, exact scope/helper/mount identity, full-ID namespace, cluster/database, issued write gate and actual shared-global/exclusive-worker descriptors. It rejects scope substitution. PostgreSQL freeze/closure observer, SQLite and dump children inherit FD9/10 and online FD11/12. Legacy capture retains FD9/10. A native deadline marks failure only after actual close; it never kills a SQL client or authorizes release.

RED: online-native-capture-red-20261017.log reproduced the former parser refusing the real private capture guardian (CAPTURE_NAMESPACE_PROBE_REJECTED), root online-native-d79cf6f7cc2d907b6869bd1c04e5d08c. Original bytes/database are retained.

GREEN: online-native-e2ab6dc1ae5ce69520fc28586f73b40a.json. The real capture-purpose test first closed its own application Prisma pool; capture owns a dedicated native SQL namespace, and an idle application pool must not be mistaken for a closed capture namespace. The child acquired actual table SHARE and migration advisory locks, validated the real cluster/database, proved all four inherited same-inode FLOCK descriptions in the actual psql process, and completed rollback, native reap and fresh SQL closure. The remaining overlap, wrong-gate substitution, null-fence, disconnected exact-decimal commit and guardian-death worker refusal cases passed. The isolated database was dropped without FORCE after absence of sessions/prepared work.

Legacy complete coherent capture/restoration regression also passed: coherent-capture-b19187f1ed2eacae38fd5f9a66210202.json, 427 migrations and 541 relations, with SQLite/files/logical restore and fault ownership checks. Canonical service IDs/images/start times remained unchanged. This legacy full-schema proof and the new scoped one-table native freeze are distinct evidence; neither is a full new online application recovery chain.

One intervening run, online-native-551bc7d471c4852a125bac6737d0d9bd, completed ownership cases but failed final DROP of its isolated database. Read-only PostgreSQL logs confirmed statement timeout; it ran concurrently with the full-schema restoration. No timeout was increased and no SQL was cancelled or forced. The failed root/database remain retained. The final test ran sequentially after full-schema restoration and passed with the original budgets.

Both independent Standards and Spec source reviews passed versus cc900544. Python syntax passed; no runtime Prisma client was added. No production migration, route switch, backup retention or remote mutation occurred in this slice.
