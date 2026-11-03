# Restored application source port — completion ticket 02 / #410

This is source readiness for integration #417. It is not a native FULL token,
healthy recovery point, source authority certificate or production admission.
The coordinator must invoke this entry from the SAME awaited strict COMPLETE
callback, inside `withRestoredQaPrivateControlQualification`'s live scope.

## Entry and input

`qualifyRestoredQaApplications({proof, scope, sourceOwned, prepare, exercise, onHeld})`
in `application-composer.mjs` checks the engine-owned proof before using scopes.
`scope` is the actual `{material, normal, owner}` object from private control.
The production checkpoint database comes from that NORMAL capability's accepted
source descriptor; the target is the engine's actual restored database.

`sourceOwned` carries the accepted release/image/source identity, `operation`,
`checkpointChecksum`, measured `runtime`, `config`, `sourcePins`, pinned Python
ELF `{file, sha256}`, and the existing original `issuer`. Config must retain
`privateQualificationRuntime`, `roleTopology.main.host`, `postgres` host/port/
controlDatabase, existingContainerId and the identical sourcePins. No credentials
or private key belong in any source packet or output. The actual controller
configuration is written only after the new index and its digest exist.

The issuer supplies `enrollment` with publicKey (SPKI base64), publicKeyPem,
session and actorId, plus `assertActive()`, `signDecision({decision, artifacts})`
and `signControl(control)`. Each signing method returns a base64 Ed25519 signature
for the canonical existing private-qualification protocol. The broker verifies
it locally. Bind this port to the coordinator's existing original issuer and
read-only trust mount. Do not provision a replacement key or serialize custody.
The broker exports `assertOriginalIndependentQualificationEndpoint(witness)`;
only its own still-live original HTTP child can produce the witness.

`prepare({root, publicGrants, enrollment})` is file-only provisioning through the
existing coordinator resource lease: copy pinned helper sources, publish exact
public grants via the existing RO authority channel, and return only after
verification. It must not launch actors or mutate shared carrier/master code.
`build-runtime-sources.py`'s `build()` returns five deterministic source strings;
its CLI prints hashes only. It executes no generated source and writes nothing.
The canonical remaining inputs are `deploy/scripts/online-runtime-owner.py`,
`tests/online-deployment/private-qualification-bootstrap.fixture.sql`, and the
existing compiled `online-private-qualification-native.worker.ts` diagnostic
worker named `online-private-qualification-worker.cjs`. Use the accepted existing
compiler/pins; do not rebuild unrelated application artifacts.

`exercise({witness, database, manifest, assertActive})` consumes the #411 existing
Inquiry carrier contract and the coordinator's frontend/domain checks. It must
retain and naturally close its own originals before resolving, including on
probe failure. Return exactly `{database, authenticated: true, businessVerified:
true, filesVerified: true, originals, productionAdmission: false}`. `originals`
contains exactly one frontend row and one Inquiry row. The frontend row retains
`{role: 'frontend', originalPid, code: 0, signal: null, stdoutEof: true,
stderrEof: true, killed: false, observationFault: null, sha256}`.

The Inquiry row is `{role: 'inquiry', evidence}` and MUST NOT be converted to a
natural-zero/EOF row. `evidence` contains seven references named `activeNative`,
`finalNative`, `requestedStop`, `retirement`, `work`, `workClaim`, `workScope`.
Each reference is exactly `{rawBase64, bytes, sha256}` for the real original file
bytes, at most1MiB each. Keep the ACTIVE bytes from the SAME probe's successful
`observe_ready()`. After successful `stop()` and BEFORE `retire()`, snapshot the
exact `requested-stop.json` bytes and verify their hash/metadata against that
owner's `request_receipt`; retain their `requestedStop` reference outside the
operation child. Collect the final native/work/claim/scope references at this
closed boundary as well. `retire()` deletes `requested-stop.json` and its log;
its retained owner fields contain only their metadata/hashes, so they cannot
reconstruct the raw bytes afterward. Only AFTER `retire()` succeeds, read the
completed parent tombstone for `retirement` (never RETIRING). Preserve requested
SIGTERM wrapper128/native143,
`naturalExitZero:false`, actual native/SQLite/work closure and the exact original
SQLite snapshot. No native-log EOF is invented: source03 writes a file log and
closes it, rather than exposing stdout/stderr pipes for the inner Next child.
The artifact retains all supplied raw references and a separate Inquiry summary.

`sourceOwned.inquiryCarrier` is a coordinator-owned live port with
`assertCurrent()` and `observationBinding()`. `assertCurrent` must use the SAME
source03 `InquiryCarrierIncarnation` handle against a fresh inspection; failed
recreation permanently invalidates it. `observationBinding()` is called only
AFTER exercise, and returns `{scope, originalDatabase, inputSqlite}` from the
actual probe's saved `loaded`, `original_before` and `input_receipt`. Do not
compute this expectation by copying output JSON. The composer adds the expected
SQLite hash from its engine-owned COMPLETE manifest, not from a supplied receipt.
No future copy path, inode or hash is required before the probe exists.

The coordinator's `exercise` must hold `with probe.reader():` around every real
browser/HTTP/SQLite reader until it actually closes; then observe the SAME
probe's requested stop and retirement. Ambiguous readiness/stop retains that
owner and its exact handles; resolving the callback is forbidden while an
unknown reader or child remains live. These data receipts grant no authority;
#417 must still bind them to its genuine outer originals. No cookie/token or
user record values may enter the result. The source03 carrier implementation is
consumed unchanged, never replaced by this ticket.

## Completion and output

The broker uses the canonical baseline/native guardian/work journal/SQL tools.
The lifecycle always awaits original closure; a failed probe still owes HTTP
drain, SQL fence and shutdown. HELD originals retain custody without signals,
timeout cleanup, receipt adoption or a health claim.

After actor closure, the SAME normal cap rechecks business hashes, working
files, exact retained migration history and visible/quiet SQL; its temporary
client disconnects before returning. The layout also rechecks copied roots,
root incarnations, original raw-value files and the installed catalog/file map.

Output is one `sabalan-live-restored-application-reference/v1` pointing to an
exclusive fsynced `sabalan-live-restored-application-artifacts/v1` JSON file,
with exact bytes/SHA256. It retains original COMPLETE/working/history values,
raw baseline, baseline/native/work closure, observer/initialization/fence/close
SQL facts and final readback. The artifact is bounded at 8 MiB; the eventual
canonical consumer's existing total-proof limit is unchanged. #417 joins this
source result with its own genuine owner/worker closures; do not pass this
partial artifact directly as canonical FULL evidence. Cleanup remains pending
and independentPointHealthy/productionAdmission remain false.

## Integration boundary

The backend source addition is a changed artifact input. The old backend image
receipt is preserved and must not be relabeled to include this source. #417/#413
must bind the integrated source/compilation/image graph before native #419.
The small NORMAL/readback additions to restoredQaMigrationBaseline.ts must be
merged serially with #414's migration owner. No shared runtime was used here.

## Consumed source03 revision

Source03 commits `3d84d602`, `5f844c0d`, `9887efa6` were verified against all five
file SHA256/byte counts and source tree `c5267bf9633ac1971e8b51cd315948ea7e9b25f7`,
then cherry-picked as `42ca52fb`, `9679b1d8`, `4952b8f2`. Receipt
`reports/qa/inquiry-carrier-411-validation.json` has SHA256
`4067f374327f66faf111deb699b516ee1d8a5ffa8dad372012ae70d4950c9d78` in the source
commit. This is source consumption only; actual Compose/RO mount/image/browser/
Next-native acceptance remains pending with the persistent coordinator. #411
must remain open until that native acceptance is earned.
