# Current production physical component and independent RSA recovery

This is a physical PostgreSQL component, not a healthy coherent application
point, continuous production recovery, ten-minute RTO proof or online admission.

The original host deployment lock was held throughout source capture. Fresh
reference-aware cleanup/capacity preflight completed on both hosts before heavy
work. No eligible images/containers were removed. Production stayed at
`a2c75f1027a069e91837ff433e1c91cdc7746798`; all six source service/container
identities were unchanged and healthy before/after capture. This work performed
no application update, migration, role/configuration change or maintenance request.

Actual production PostgreSQL 15.16, system identifier `7609810350852628513`,
timeline 1, produced a 378,808,320-byte physical tar in 40.111 seconds. Native
`pg_verifybackup` returned `backup successfully verified`. The source guardian
and server-closure receipts were checked before releasing ownership.

- Plaintext SHA256: `c4b485ccc756ea48e08a72ea9c8dbdfd00aa9d1a892c63b0788985f699957c09`.
- Native backup manifest SHA256: `97030a3f62a1f5601d36e2062ac8774827ddb76c14880e278dc548b3229ef0e5`.
- Included WAL range: timeline 1, `4/C7000028` through `4/C700DFD8`.
- Source image index: `sha256:5fe8ca7fc662071188c30271cb870d1ce9a6ec4578c934b064697ae77a9241e1`.

The component was encrypted with the existing AES-GCM multi-recipient format:
the primary's existing local rollback secret and the independent backup RSA
public key. Native supervised local decryption/fsync/hash verification passed.
An initial wrapper refused the configured relative secret-directory path before
creating encryption work. Resolving it against the actual `/opt/sabalanerp`
working directory, while preserving canonical-path/permissions checks, allowed
the subsequent attempt. No key or existing directory permissions were changed.

- Ciphertext: 378,809,460 bytes.
- Ciphertext SHA256: `e1e1c633bda9699868d50073adcf3c34d84488e8f070a3455215ce5c7742e8d1`.
- Local encryption operation: `encrypt-c3c0618c2fc74bb4aa5235ac497d5498`.
- Backup object: `private-base-transfer-57134361821f4d688fcd4712f3bc398a/base.sabrec`.
- Sidecar SHA256: `6f0edd0d34138df343b6de30b2b6667f1bcceef396992609d7778da68b904215`.

Only ciphertext crossed the existing restricted SFTP transport. The exact
configured mount identity was checked; complete destination byte/hash readback
and metadata readback passed before transfer completion. No healthy checkpoint
sidecar or retention promotion was published.

On the independent host, the actual ciphertext, metadata, containing directory
and checkpoints parent were fsynced. The independent private RSA key was read
only on that host. Authenticated decryption, plaintext length and the original
SHA256 all matched. Both original backup ownership locks were inherited by the
native supervisor; all sixteen foreign container identities were unchanged
within that operation. No PostgreSQL service was started during this step.

An initial independent wrapper refused the existing 0755 public-code QA directory
before creating work. The corrected check preserves its root-owned/non-writable
status beneath the verified 0700 private ancestor, and creates all business-data
work in a fresh 0700 directory. No existing permissions were altered. The native
supervisor additionally enforces private ownership of that data directory.

Accepted receipts:

- `production-base-prod-base-47065f6d83fd4a63b6f3171256016c47.json`.
- `production-base-encrypt-c3c0618c2fc74bb4aa5235ac497d5498.json`.
- `production-base-transfer-57134361821f4d688fcd4712f3bc398a.json`.
- `production-base-restore-dbfc6b6eca9741469ae3076756b165a8.json`.

Frozen public private-operation source is retained in the adjacent
`production-base-private-orchestrators-20261018` directory. It contains public
code and key-file references, no keys, credentials or plaintext business data.

Next required: reconstruct the exact production PostgreSQL image from the
protected retained image archive and boot/validate the independent physical
copy. That working image was deliberately removed after earlier DR acceptance;
its absence is not permission to substitute a different image. Continuous WAL,
coherent protected files/SQLite/coordination/privacy, current application image
retrieval and full application restore remain separate gates. Both older healthy
checkpoints and their dependencies remain protected; this component replaces none.
