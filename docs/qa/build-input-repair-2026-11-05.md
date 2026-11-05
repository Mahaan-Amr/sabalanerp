# Build input recovery — 2026-11-05

The working tree had 144 unstaged deletions across `packages/contract-product-graph` and `packages/partner-sales-contracts`. Both directories existed but were completely empty. Dockerfiles for both backend and frontend require these package manifests, TypeScript configuration and source trees. The exact input-presence check failed before repair; the earlier Docker build failed at `COPY .../src`.

## Recovery and preservation

Restored **only missing tracked files** from `0a49b5b4` (HEAD at the start of this repair). Each file was created with exclusive-create semantics and verified byte-for-byte against its Git object. No existing file was overwritten, no branch/index reset was used, and no package/domain behavior was edited. The restored files already belong to HEAD, so their recovery cancels the working-tree deletions rather than introducing a new source revision.

Before restoring, preserved the binary working-tree diff and index diff under the ignored local evidence directory `reports/deploy/build-input-repair-dd7dc1c223a146738037b58482b031fc`. Hashed 1,297 existing modified/untracked files; all remained unchanged after restoration and package tests. The pre-existing `frontend/tsconfig.tsbuildinfo` modification and unrelated untracked work were preserved. Installed package dependencies from their restored lockfiles; generated dependencies/output remain ignored.

## Validation

- `npm run build:contract-product-graph`: passed.
- `npm run test:contract-product-graph`: passed the complete package command, including its manual assertion suites and TAP groups of 5, 11, 22 and 6 cases.
- `npm run test:partner-sales-contracts`: passed, 90 tests, zero failures/skips.
- Local frontend image build: passed.
- Production frontend `runner` image build: passed, including full Next compilation, TypeScript validation and page generation; existing lint warnings remain.
- `npm run check:frontend-docker-workspace`: initially failed because its parser required `build` immediately after `frontend` and expected the old runtime copy stage. Updated the checker to isolate the indented frontend/build mappings independently of sibling-key order, and to accept the actual `production-builder` only when it inherits the package-compiling `builder`. Context and Dockerfile checks inspect immediate mapping fields; unrelated copy stages remain rejected. The production Compose and frontend Dockerfile themselves were not changed.
- `node --test tests/frontend-docker-workspace/check.test.mjs`: six passed. The actual configuration and reordered-key success cases failed before the fix; invalid context, wrong Dockerfile, unrelated runtime copy and broken stage inheritance are rejected afterward.
- Complete backend Docker image: passed after the transport/install fixes, including explicit Prisma Client generation, both TypeScript compilations, runtime image assembly and export. The final build command exited 0.

The first full backend image build encountered a second, independent problem after the missing inputs were restored: repeated HTTP timeouts downloading the 81 MB Debian Chromium package, eventually failing APT with exit 100. From the existing backend container, an ordinary HTTP request to either official archive timed out before receiving any bytes, while the corresponding HTTPS request returned 200 and streamed more than 1 MiB. Changed only the application-package installation layer to use HTTPS for official Debian archive URLs, after the preceding layer has installed CA certificates. Private mirror URLs, APT signatures, certificate verification, dependency declarations, image startup and deployment gates are unchanged. This is not a dependency upgrade or a download-integrity bypass.

A subsequent build's npm debug log showed the Prisma engines postinstall had completed while the client postinstall was still waiting. Dependencies were being installed before `backend/prisma` was copied. Scoped `PRISMA_SKIP_POSTINSTALL_GENERATE=true` to that dependency-install command; retained the existing mandatory explicit `npx prisma generate` after the schema copy. The next build passed dependency installation and explicit generation (8.6 seconds). No Prisma version, generated runtime client contract, migration or runtime client ownership changed. The superseded build client and its identified build-only plugin processes were cancelled; no serving application process was stopped.

Builds target the existing `sabalanerp-local` configuration and do not start/recreate services. A build-only frontend override selects the normal `runner` target with an explicitly separate validation image tag; no extra application service, database or Compose stack is launched. No migration, restore, deployment, cache/volume removal or historical acceptance replay is part of this repair.

Private build logs and preservation manifests remain under ignored `reports/deploy`; no existing customer data or credentials are added to Git.

Final preservation recheck passed for all 1,297 pre-existing modified/untracked files and all 144 restored files. No restored source differs from its original Git object. The only intentional source changes are the Docker dependency-install/transport fixes and the accurate workspace checker with its regression tests. Running services were not promoted to these newly built images; no runtime migration was run.
