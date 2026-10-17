# Native streamed WAL and independent encrypted custody

Issue #405 remains open. This evidence concerns bounded WAL components, not
continuous coherent application recovery or production online admission.

At frozen receiver source `273f859e`, both native cases passed in 49.11 seconds:
ordinary completion and lost Docker-exec acknowledgement before the sender
started. The second case first proved that zero observed senders without native
completion could not authorize cleanup. The receiver then streamed actual
committed numeric values (`123456789.12345678` and `0.00000001`), completed
naturally, and persisted completion independently of stdout. Both fixtures
restored the exact original HBA bytes/ownership/mode, observed configuration
reload, proved a fresh replication connection was denied, removed their exact
temporary roles and dropped their isolated databases without force. Existing
replication slots and all four canonical service identities/start times stayed
unchanged. No production authentication or application changed.

The dedicated temporary roles had replication LOGIN with connection limit two,
no superuser/database/role creation, inheritance or RLS bypass. Their HBA rules
were limited to the exact candidate IPv4 address and used SCRAM. Password bytes
remained private; HBA recovery originals were synced in the existing PostgreSQL
volume before replacement. The receiver uses no replication slot and retains
unfinished ownership rather than inferring completion from the Docker client.

Native PostgreSQL 15.18 subsequently validated the complete captured record
ranges for both actual streamed segments, then rejected deliberately modified
CRC bytes in disposable private copies. Source segments were unchanged. That
test passed in 23.96 seconds at `00998bc6`; its report is
`streamed-wal-native-5c9d02879c2142bc.json`. An earlier assertion expected only
the normal record-loop checksum message; PostgreSQL rejected the damaged first
record during initial discovery instead. The genuine rejection and overly
narrow assertion are retained in the RED TAP. Its failed private copy remains
quarantined; successful copies were removed.

`seal-postgres-wal.cjs` at `3af732ef` sealed the lost-acknowledgement capture in
5.56 seconds. Under the actual receiver lock it revalidated private closed state,
configuration/source binding and segment bytes, encrypted both the original
capture receipt and WAL, independently decrypted each with a retained private
**test** local key, checked exact plaintext hashes, synced ciphertexts and
published SEALED last. The other recipient is the real independent backup
server's RSA public key. Its private key never left that server. The test local
key is not production's automatic-rollback authority, and no production
checkpoint is claimed.

Before transfer, actual reference-aware preflight passed on both hosts:
production had 35,057,188,864 available bytes and the backup had 3,834,953,728.
No eligible container/image was removed. Only two ciphertexts and their seal
receipt were copied to a new private diagnostic directory on the backup host:
`/root/sabalan-recovery-private/native-qa/wal-stream-f7e6da7d707c0e4fe990747263afa2b4`.

Independent verification at `5394c8f9` used Python cryptography on that host,
separate from the encrypting implementation. It pinned the seal SHA-256
`6e7844b6c35e7432618b85ce2ec09ca062a75c998fd0e8ecdf5c54a0a29d6701`
and independent RSA public identity
`455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af`.
RSA-OAEP/AES-GCM authenticated decryption matched every original byte/hash;
actual altered ciphertext was rejected for both objects. The decrypted capture
and segment set matched each other. Ciphertexts and directory ancestry were
synced before durable VERIFIED publication. Plaintext was held in memory only.
All thirteen foreign Fintech container identities/start times remained unchanged.
The remote encrypted objects and original verification receipt remain private.

The canonical local source system is `7667464637415309346`, timeline one.
These are local test-cluster changes, not production-cluster WAL. The native
source databases were removed after capture. No physical base replay, continuing
stream, coherent file/SQLite/coordination/privacy boundary, current-data rollback,
24-hour browser support or release switch is certified by this component proof.
Those remain mandatory before production online mutations.

Source Standards/Spec reviews passed before each native action. The independent
verification reviews identified missing input/parent fsync; `5394c8f9` resolved
both findings before execution. Architecture and unchanged design-system commit
gates passed. Raw native outcomes and bounded identity reports are retained next
to this document.
