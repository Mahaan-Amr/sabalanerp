# Inquiry action/SQLite completion ownership — private acceptance

Issue #405 / ADR-0131. Review bases: ERP `b19a16ce667e3dbaa8d378e8ef7b26130251a456`,
Inquiry `a1196ba3363743d01d4c7d1d07040bf12569cae3`.
Frozen 18-file identity: `online-inquiry-review-candidate-20261018.json`, SHA-256
`2deec8aca5f478731eec5345fdfa27883110b1b039b657e6c9c78f23862506b6`.

## Implemented boundary

All **13** Inquiry Server Action bodies enter the async work owner. A one-off
TypeScript AST comparison confirmed all original business bodies are unchanged
inside the wrapper. The sole application Prisma client owns all model/raw
queries and complete interactive/batch transactions, including commit/rollback.
Nested work shares its admitted action's lease, so capture cannot deadlock an
already-admitted action between queries. Completed async contexts cannot lend
their expired permission to later descendants.

Next instrumentation initializes a fixed image-owned pure runtime bundle.
Partial configuration, a missing bundle or failed initialization permanently
rejects online work in that process. Ordinary legacy behavior remains available
only when no online input was ever observed. An incarnation cannot switch
between those modes.

The separate native Inquiry owner verifies the actual read-only platform grant,
SQLite file identity, exclusive private FD9, shared platform FD11, real guardian
ancestry and one-use namespace. It supplies no PostgreSQL URI/credentials and
makes no PostgreSQL SQL-closure claim. Its distinct `sabalan-inquiry-native/v1`
record reports `sqliteNativeClosed` only after all owned descendants are reaped.
Host container/image/mount admission and a complete SQLite-user census remain
separate requirements. The backend census currently refuses this distinct
record instead of silently ignoring it.

The Docker recipe bundles the pure owner modules and Python/flock dependencies.
**Ordinary startup explicitly refuses online configuration** while full
host/recovery/browser admission is unfinished. The private native entry is a
diagnostic prerequisite, not a flag-based public promotion path.

## Actual local evidence

- `inquiry-native-a59ea489b617ca3888890bf0ea552f09.json`: fresh compiled source,
  real RO scope mount and native locks in existing `sabalanerp-local` diagnostic
  slots. Normal early-return action waits for its real SQLite child. After Node
  SIGKILL, its SQLite child completes the exact transaction and the guardian
  waits for that child; the unresolved work journal stays ACTIVE. Consumed grants
  are rejected. Exact text amount `123456789.12345678` and quantity `0.00000001`
  survive both paths.
- The same report uses the actual installed SQLite Prisma 6.19.3 client from the
  unchanged Inquiry image, copied into the private diagnostic target. The actual
  application runtime adapter/client passes interactive transaction completion,
  lazy batch transaction, rollback and standalone raw read. This is not a mock
  query adapter and not a test against the backend's PostgreSQL client.
- `online-inquiry-linux-guards-20261018.tap`: **8/8**, zero skips, covering fresh
  session/credential authority, malformed/link recovery state and permanently
  closed partial runtime configuration. Partial initialization first reproduced
  a second-call bypass, then was corrected before this run.
- `sabalan-inquiry-build-6845a85e262d24f606a8ee9eca510173.json` / `.log`: actual
  Linux Next **16.2.6** default Turbopack production build, TypeScript and all
  fourteen application routes passed using copied Inquiry image dependencies.
  Private source, dependency copy and build-only SQLite lived under the existing
  backend's `/tmp`. No additional stack/container was created. The 512 MiB
  Inquiry container could not finish the build; the successful existing backend
  run bounded JS heap to 768 MiB and Rayon to two threads. This is a source build,
  not an immutable final-image acceptance.
- Backend `tsc --noEmit` and `npm run architecture:check` passed.
- Independent Standards and Spec reviews passed all 18 frozen source hashes.

Canonical backend and Inquiry container/image/start times remain unchanged;
the reports retain those exact identities. No production/backup-host mutation,
public traffic switch or production migration occurred in this slice.

## Review faults retained without invented recovery

Both reviews found a legacy-fence race before SH11 acquisition; Standards also
found that broken stderr could escape an uncertainty hold. Deterministic tests
first failed both safeguards in
`/app/online-runtime-acceptance/inquiry-native-6ec9cd2bd81882a700c7a4d35f8c6a3f`.
The unexpected query completed naturally; fences were retained. The corrected
owner repeats all legacy/bootstrap/restart checks under validated SH11/EX9 and
makes uncertainty logging best-effort before an unconditional hold loop.

The passing native report includes an actual intervening EX→SH lock transition
with an explicitly synthetic ACTIVE refusal marker, plus real stderr EPIPE and
injected native-directory fsync failure. The logging-fault fixture verifies held
locks/no child, deliberately kills only its own exact uncertain guardian and
retains original ACTIVE bytes. It never declares that fault a successful native
closure or reuses its namespace.

The initial successful two-case diagnostic
`inquiry-native-cb9a8cb7afcd84fbcc5d7bd3418e4f19.json` predates those fault tests.
`inquiry-native-17d8e5b5f883c1fae77caa4e2ba2125e.json` includes both corrected
fault guards. A later harness assertion mistakenly expected exit 137 for the new
successful Prisma case at `inquiry-native-fda848cd98c3f3d6878ae732f7387c4e`;
its native actors had already closed, and the original diagnostic remains.

## Still required before full program acceptance

Actual native Next/browser action overlap, session/draft/24-hour retired-build
behavior, compatible SQLite migration, strict Inquiry inclusion in coherent
capture, immutable host slot admission/switching and the complete independent
continuous recovery-chain application restore remain required. No healthy
production recovery point or production online authority is published here.
