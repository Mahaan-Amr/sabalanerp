# Inquiry SQLite pool URI identity

Follow-on to `f96613a5`, Issue #405. The first private native guard accepted
only a bare SQLite file URI, which would reject the repository's explicit
`connection_limit` / `pool_timeout` configuration. The actual regression at
`inquiry-native-be14f5beadcb86ded2c774cbc1e06781` failed before starting any
native application actor. Its original diagnostic files remain retained.

The native owner now requires the canonical absolute file URI with both bounded
positive parameters (`connection_limit` at most 16; `pool_timeout` at most 120).
It retains the existing exact owned SQLite file/header/inode checks, refuses
unknown URI options, aliases, duplicates and omitted parameters, and binds
SHA-256 of the entire canonical URL into a distinct
`sabalan-inquiry-native/v2` claim. Node checks that hash before starting work.
Historical v1 records are retained; no consumed namespace is reused.

`inquiry-native-a2e38134465c10cdbcaf7d2288107056.json` is the final fresh-source
Linux evidence: valid pool 2/timeout 5, nine invalid URI shapes refused, actual
normal/lost-Node SQLite commits, interactive and lazy-batch Prisma transactions,
rollback, standalone read, consumed-grant refusal and both native fault guards
passed. The earlier `inquiry-native-3528570e3e982ca09668562d5bfb074d.json`
predates the nine-negative-input assertions.

Independent read-only Standards and Spec reviews both passed the five-file
delta. Ordinary startup and production admission remain closed. This is neither
actual Next action overlap nor a coherent recovery-point acceptance.
