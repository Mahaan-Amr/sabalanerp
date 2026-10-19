# HR upload reference safety

The real hiring document route committed a document reference, then deleted its
file when a later audit INSERT failed. The formal-assessment batch route also
deleted the already committed first file when the second file failed signature
validation. Both failures were reproduced against the actual router, session,
generated Prisma client, PostgreSQL schema and Linux filesystem before repair.

`DurableUpload` now keeps request-specific original upload ownership after Multer
hands off to asynchronous business handlers. `retain(request, file)` marks an
upload before its reference is submitted to SQL. This decision cannot be reversed
by an acknowledgement error, audit failure or later batch failure. Unknown SQL
outcomes retain bytes: this deliberately does not certify that an unreferenced
upload can be retired. Such cases still need the complete file/reference census
and original-actor closure required by the online recovery design.

`discardUnreferenced` awaits cleanup under request completion ownership, refuses
foreign requests and paths, and verifies the original opened file identity. Its
explicit versioned composition additionally requires the original upload version;
it never falls back to removing the current path. Retention also fences queued
cleanup before it starts. An answered native-owned request cannot revive itself
to acquire cleanup authority. State is request-keyed in a WeakMap, with no strong
request registry or buffer retention.

All nine hiring multipart handlers and both hiring-finance duty handlers use
these decisions. The old unbound best-effort HR unlink export has no consumers
and was removed. Both assessment batch validators now enter the cleanup boundary
before rejecting an invalid kind or size. Business permissions, validation,
SQL mutations, authoritative sessions and idempotency policy are unchanged.

## Evidence

- [Missing owned business-cleanup API, RED](versioned-upload-a15e477ee3853a62d6128969ff45d70a.failed.json).
- [Initial asynchronous business rejection, PASS](versioned-upload-db47858cc777da9c49efa2e9bebffad2.json).
- [Six native multipart/publication cases, PASS](versioned-upload-5b1cc37a1ee49aca3dd59103be048017.json):
  retained SQL references, foreign ownership refusal, queued retention, changed
  generations, answered-request refusal, admission closure, multipart rejection
  and immutable history. Canonical services and the existing candidate retain
  their actual container/image/start identities.
- [Committed document audit failure, RED](hr-erasure-file-recovery-61aafbb8bfe51c9510569f15ff705f9b.json),
  then [document repair, PASS](hr-erasure-file-recovery-e3e4f2d0417b3beeebb0193b2c7f27ad.json).
- [A fixture lacking completed-result timestamps, rejected by real schema](hr-erasure-file-recovery-2e45741d1660ef27c155c12fbdcc2565.json).
  The fixture was repaired to satisfy existing checks; no constraints changed.
- [Committed first batch file lost, RED](hr-erasure-file-recovery-76216f12ce6f41d35f6930797c4a9020.json),
  then [batch repair, PASS](hr-erasure-file-recovery-3d08e0a6ea0c427783ff12fc28b36314.json).
- [Invalid-kind upload left behind, RED](hr-erasure-file-recovery-49f7a5d15bb1b15c8af97fd9f5b9e28f.json).
- [Final actual-router/database/native acceptance, PASS](hr-erasure-file-recovery-3c52871cf5fabe02934f7b2d07acdbe3.json):
  all earlier journal/retry cases plus committed-document audit failure, partial
  batch, invalid kind, finance original-return rejection and finance receipt
  rejection. The fixture uses the same HTTP lifecycle as the actual upload and
  idempotency consumers, observes real HTTP closure, closes the original database
  client and admitted native work, proves zero remaining SQL sessions and normally
  retires the isolated database by its original OID. Existing schema triggers are
  preserved; the extra audit fault trigger exists only in that isolated database.

All failed native-database attempts also recorded original client/work closure
and normally retired their own isolated database. False receipts remain false.
Only existing `sabalanerp-local` services were used; no extra stack or database
container was created. The real routers listened on an ephemeral loopback port
inside the already existing private candidate. Eager HR storage initialization
was confined to its private acceptance directory. No provider was invoked; native
antivirus descendant completion is not qualified by this test.

`npm run architecture:check`, full backend TypeScript checking and all three
existing durable-upload regression cases passed. No frontend interaction or
database schema changes are part of this component.

## Remaining program gates

Ordinary production startup is not switched to versioned HR storage. This does
not establish complete root/writer coverage, bind every SQL metadata reference
to a durable file generation, reconcile uncertain uploads, integrate initial
Job Application/Personnel erasure, prove retained-copy physical erasure, pass the
independent full application restore, or qualify public switching/24-hour forms.
Production online admission remains closed. Component success is not completion
of Issue #405 or authority to bypass any production deployment gate.
