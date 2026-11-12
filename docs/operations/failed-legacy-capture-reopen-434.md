# Incident #434: failed legacy signal before checkpoint

This is a one-incident recovery of the unchanged previous release. It does not
qualify the failed capture, create a checkpoint, or admit a new release. The
original checksum-chained `RECOVERY_REQUIRED` journal and failed signal files
stay immutable. Production remains in maintenance if any check fails.

`deploy/scripts/reopen-failed-legacy-capture.mjs PLAN SHA256` requires a fresh
root-owned owner process with the existing deployment host flock passed as FD9.
It acquires the actual PostgreSQL advisory lock and a new durable lease on the
failed operation row. The plan is root-owned `0600`, checksum pinned, and names
a new private incident directory. Do not run it concurrently with any original
deployment owner or other incident controller.

Stage this script in a private root-owned operations bundle outside the live
Git checkout. Its sibling paths must include `capture-only-release.mjs`,
`reconcile-premutation-capture.mjs`, and
`online-release-host-dependencies/node_modules/@prisma/client` with the same
reviewed hashes and module layout. Confirm the staged script's SHA-256 equals
`ownerSourceSha256`, resolve all imports and the Prisma package from that exact
location, and leave the production tracked checkout clean. The immutable
control image must remain the exact pinned image. The gate run uses a separate
`incident-434-...` deployment ID for its report and transient Docker label;
it does not replace the original failed operation's journal or report row.

The plan format is `sabalan-failed-legacy-capture-reopen/v1`. It pins:

- `repositoryRoot`, `environmentFile`, `coordinationRoot`, `operationDirectory`;
- original `deploymentId`, `releaseId`, `targetCommit`, PostgreSQL connection
  URL and database name/system identifier/OID;
- immutable `controlImage`, `controlSourceCommit`, `controlSourceHash`, and
  `ownerSourceSha256`;
- original `journal` and `originalSnapshot` paths and SHA-256 values;
- `legacySignal.plan`, `.intent`, `.result`, `.held` paths and SHA-256 values;
- `restartedBackend` currently observed restart count, current `startedAt` and
  prior `previousFinishedAt` from Docker inspect; no preflight restart count is
  inferred;
- `currentNode` host PID, start ticks, and backend init PID from the current
  e407 container. The same process birth, parent, argv, executable and cgroup
  must be reobserved immediately before reopening;
- exact `recreatedNginxContainerId`, the reviewed `nginxEnvPermutation`, and
  the exact historical untracked source path inventory.

Before execution, independently review the plan against the original private
receipts and current production observations. The owner proves the terminal
pre-checkpoint journal, signal attempt and failed observer, old Node PID gone,
zero old backend SQL sessions, same old backend container and image with a
verified changed process birth, only Nginx replaced, and complete previous service configuration
and private bind bytes. Nginx Env ordering may be projected only by the pinned
permutation; every other configuration field must match the original snapshot.
The source commit, migration checksums, PostgreSQL identity, both public 503
responses, and all fourteen `PREVIOUS_UNCHANGED` gates must pass. The owner
rechecks six container births and private evidence before removing the exact
maintenance marker under the live lease and recording `ABORTED` with the
original failure nested in its report.

The success report must say `captureQualified:false`,
`checkpointCreated:false`, `databaseRestored:false`, and
`originalCaptureGuardPassed:false`. A later fresh capture and deployment still
need their own verified local and independent remote checkpoint.
