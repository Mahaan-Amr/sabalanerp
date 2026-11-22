# Durable runtime busy epochs — 2026-10-17

Frozen implementation: `fe01315f..ba72402d` (`238c1730`, gate-binding repair `ba72402d`). This is a private primitive, not online production admission.

`RuntimeBoundaryJournal` claims one preprovisioned private namespace using exclusive durable creation and actual Linux boot/PID-namespace/PID/start-tick identity. Scope binds immutable image, registry hash, generation, PostgreSQL application namespace and the exact kernel-gate inode/device/owner. A restarted process cannot claim, reset or settle the prior incarnation.

One durable ACTIVE epoch precedes admission of a group of overlapping tasks. Every reference must complete before durable QUIESCENT publication and shared gate release. A fresh task cannot join a settling epoch. Three small files remain after normal operation; no per-request file accumulation occurs. Publication uncertainty poisons admission and retains the kernel gate; torn temporary evidence remains visible. QUIESCENT does not prove PostgreSQL or descendant completion after death.

## Evidence

- Backend TypeScript build, including cutover compilation: passed.
- `npm run architecture:check`: passed. No application database client added.
- `node scripts/run-kernel-write-admission-local.mjs`: **18 passed, zero failures/skips**, native Linux, 1.881 seconds. It includes the prior nine HTTP/kernel cases and nine journal/admission cases: constant-space repeated epochs, 100 overlapping references, delayed settling, dead ACTIVE incarnation, malformed/torn/symlinked records, actual file-sync failure, owner revocation, stop during pending admission, and two-gate composition rejection.
- Existing `sabalanerp-local` backend remained container `a1ea34a8d7d878b906fba7b4fdbe975df13a6b00d63a863eacce34b9827e86ff`, image `sha256:33cb69566bb1de4f8895e73486be364ccad1d60e978ba0a30f34c210ecf6f505`, start `2026-10-15T09:01:40.016187222Z`. Only private temporary fixture code ran there; no restart or production activation.
- Independent Standards review identified a gate/journal composition mismatch. Exact identity comparison and defensive copies repaired it; both independent Standards and Spec reviews then reported no actionable findings on `fe01315f..ba72402d`.

An initial expanded run used the previous compiled output while compilation was still running and failed the new identity-method regression; it was not counted as acceptance. The final completed build and rerun passed all 18 cases.

Final compiled SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| kernelWriteAdmission.js | 36a26bd2ac91b30ebaf58262969dce8bd1aee22cca2d39eeb69ee193e0048da4 |
| runtimeBoundaryJournal.js | 7839d785824d84072c75191027e9be5c143f711900c2be2539c10d4aa61fcd45 |
| runtimeTaskAdmission.js | 1b4f1d66189a16ffc7f417f90d63f86b4b0cf4d7cdee5f258a07db8784162f48 |
| runtime-fixture.cjs | 29a38bb432d97cbf29ca31ce901c0e81aaf96abbea8e4069f432f6ff3f845346 |

## Still required

Exact PostgreSQL session/prepared-work and native descendant completion, owned provisioning/controller, cross-container acceptance, full HTTP/control/worker/Inquiry integration, coherent continuous recovery and the remaining Issue #405 release/browser/domain gates. No new production entry point or bypass was introduced.
