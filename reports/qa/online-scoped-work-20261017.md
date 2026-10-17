# Scoped native HTTP and worker integration

The private runtime factory now binds native HTTP/jobs grants to actual task
admission and the platform's existing shared request lifecycle. Upload routes
constructed before binding keep that same lifecycle. Binding after any probe or
binding twice is refused. Serving scopes cannot dispatch jobs; jobs scopes cannot
dispatch business HTTP. Every job also verifies the immutable global worker claim
and actual inherited native ownership.

Actual Linux/PostgreSQL acceptance passed in the existing `sabalanerp-local`
project: two native HTTP processes read concurrently, a single worker committed
one exact decimal row, and multipart uploads using the default lifecycle retained
their exact bytes. Killing an HTTP client process during SQL preserved the exact
committed amount `123456789.12345678` and quantity `0.00000001`; its unfinished work
journal remained ACTIVE. Dead worker/guardian replacement, substituted capture
gate, consumed grant reuse and legacy fleet bypass were refused.

Evidence: `online-native-5807392d8a69c68669a0c964d4e1578b.json` records source hashes,
actual namespace separation and unchanged canonical service identities. These
were two native processes in one retained diagnostic slot using the same image,
not two immutable ERP releases. The isolated database was dropped without FORCE
only after actual tagged SQL closure. Deliberately uncertain journals remain.

The 23-case real Linux kernel/HTTP regression passed in
`online-shared-http-binding-final-20261017.tap`. Current-source request/database
and separate-container regressions passed in
`runtime-request-database-20261017-33c37dab.json` and
`runtime-cross-container-20261017-6956748c.json`. Backend TypeScript no-emit and
database-client ownership checks passed. Independent Standards and Spec reviews
passed the final singleton-owning factory source.

This factory starts no application listener, job scheduler, migration, capture,
recovery finalization or cleanup. Registry identity and the capture scheduling
callback are still private diagnostic inputs. Durable fleet admission/pause,
semantic release compatibility and coherent independently restored application
coverage remain required before production integration. No production application,
schema or traffic changed in this slice; Issue #405 remains open.
