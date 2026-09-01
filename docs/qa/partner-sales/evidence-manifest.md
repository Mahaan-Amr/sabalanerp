# Evidence manifest contract

Interface: `partner-qa-harness/v1`. Each run writes `test-results/partner-sales/<runId>/manifest.json` even when a check fails after initialization.

| Field | Meaning |
| --- | --- |
| `runId`, `mode`, `startedAt`, `finishedAt` | Unique UUIDv4 evidence namespace, command and UTC times |
| `head`, `reviewBase`, `workspaceStatus` | Checkout candidate and complete dirty/untracked path inventory, including unrelated work |
| `sourceFiles`, `sourceHash` | SHA-256 of each harness/test/config source and the sorted file/hash list, including untracked source; identifies the tested patch without publishing it |
| `interfaceVersion`, `foundationInterface`, `foundationBuildFiles` | Infrastructure and pinned Partner interface; foundation modes also hash the actual compiled exports consumed. Historical null means the interface was not yet consumed |
| `inventoryHash`, `inventory.json` | Reproducible route/action ledger identity and every role/owner/outcome |
| `runtime` | Verified local service container/image references, database identity and safe SMS status; absent for offline checks |
| `schema` | Count and digest of finished, non-rolled-back migration identities/checksums in the actual local database |
| `checks` | Executed command, exit code and `pass`/`fail`; absent checks are not passing |
| `status`, `error`, `limitations` | Overall command outcome and declared boundaries; a green Module command does not mean release acceptance |

For browser runs, `browser-results.json` records each project/test result; `browser/` retains screenshots and traces. API checks never record authentication cookies or response payloads. Browser baseline is anonymous and only captures the login surface. Evidence retention in CI is 14 days; longer retention and final sign-off belong to #335/#336.

The source hash identifies the harness, **not** the backend/frontend code inside a pre-existing container. Container identity is recorded separately. Before final Partner acceptance the runtime owner must deploy the approved integrated candidate and record immutable application/image/schema identity; an unrelated local image cannot prove that candidate. Initial #314 results make no such claim.

For visual review, add the exact screenshot/trace names, reviewer, observed layout and any defect to `baseline.md`. For a defect add a separate finding with reproduction, actor/path, runtime/candidate evidence, expected/actual outcome and responsible owner. Preserve failed runs. Do not overwrite a failed result or relabel a not-executed route as passed.
