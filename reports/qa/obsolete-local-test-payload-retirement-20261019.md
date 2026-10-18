# Exact obsolete local-test payload retirement — 2026-10-19

The completed local-cluster diagnostic chain `6808d4086c7fe0d25c3198aa647e7180` had exactly 47 obsolete payload files retired: 38 authenticated test cipher chunks, eight reconstructed WAL files and the reconstructed backup manifest. This intentionally retires that old diagnostic chain's replayability. Its original successful replay remains historical evidence; it is not a currently retained recovery point. Source cluster `7667464637415309346` is distinct from production cluster `7609810350852628513`.

The shared `postgres-image.tar` (115,880,960 bytes, SHA `4ac986e0e795da2700e014af9fd094f447204dc863856df94689732e15708ac7`) remains retained for the separate coherent-component diagnostic. All original seals, source proofs, scripts, keys, native/failure logs and full inspections remain retained. No production base/plaintext/cipher, application cipher/image, healthy checkpoint or foreign artifact was removed.

Successful scoped operation: `retire-obsolete-local-chain-b08afde597a54c2e8f8db0bf7ec00370`. Native exit 0 and actual closure passed. Native observed available bytes rose from 2,432,602,112 to 3,190,829,056, a net 758,226,944-byte increase; this is an observation on a shared filesystem, not exclusive attribution of every changed block. **Overall SSH exit is 1 and foreign comparison is false:** an unrelated container `314fa9308e7ffb9eca08d3a2db9f6ce259d9508c9231468e43bd2aceb932a289` appeared; all 17 original foreign identities remained unchanged. The scoped retirement does not certify the overall host or public admission.

The first attempt, `retire-obsolete-local-chain-46730b1701144cd895832e0fd70649bf`, refused with native exit 1 before any retirement intent or deletion. The initial script incorrectly expected UID0 for the reconstructed WAL files, whose actual native PostgreSQL owner was UID70. Its actual closure and unchanged foreign comparison passed; failure evidence and original source bytes remain preserved. The repaired source accepts UID70 only for those exact eight sealed WAL paths; chunks and manifest require UID0. The shared deletion helper's allowlist was not broadened. Eight native Linux tests passed, including actual UID70 ownership, wrong-owner/hardlink refusal, binary checkpoint/archive classification, nested holds, unreadable traversal and exact local seal selection. Both independent reviews passed before the repaired attempt.

Fresh retirement checks held both original backup locks and C2 native ownership in a private mount namespace. They verified the closed old-chain receipt, exact seal/source identity, current Docker references and absence of its retired containers, every target hash/inode/owner/link count, and no open descriptors/maps or nested mounts. A durable exact-target intent preceded deletion. Protected checkpoint metadata references were read with bounded no-follow identity checks and repeated before/after retirement. Both known healthy checkpoints and the original 3.66 GB image archive were fully rehashed; the additional October 18 checkpoint payload was independently streamed against its sidecar checksum and retained too. That extra payload's presence/hash does not establish its restore health. No replacement checkpoint was certified or older healthy point pruned.

- [Scoped actual retirement report](retire-obsolete-local-chain-b08afde597a54c2e8f8db0bf7ec00370.json).
- [Source-bound successful intent](retire-obsolete-local-chain-b08afde597a54c2e8f8db0bf7ec00370-intent.json).
- [Original pre-deletion refusal](retire-obsolete-local-chain-46730b1701144cd895832e0fd70649bf.json).
- [Original refused intent](retire-obsolete-local-chain-46730b1701144cd895832e0fd70649bf-intent.json).
- [Original executed source bytes](obsolete-local-test-payload-retirement-sources-20261019/exact-source-bytes.json).
- [Repaired executed source bytes](obsolete-local-test-payload-retirement-owner-r2-sources-20261019/exact-source-bytes.json).
- [Native eight-test source-bound receipt](obsolete-local-chain-selection-89efee00756e2ef2377614c016561ffb.json).

Independent full production-chain restoration and public online deployment remain pending.
