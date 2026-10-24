/** Actual negative preparation provenance and pure mutations; never starts runtime. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import * as baseline from '../../scripts/lib/application-native-post-up-memory-baseline.mjs';

const context = baseline.currentPostUpFailureContext;
const sha = raw => createHash('sha256').update(raw).digest('hex');
const clone = structuredClone;
const failed = baseline.readPostUpFailure(undefined, context);
const closed = JSON.parse(baseline.postUpReadReference(context.closure));

test('only literal current failure selects the new capsule context', () => {
  assert.equal(context.failed.sha256, '5af672637115a0d29083fc5c7ca2d6435450e77f89c302183cb7eb83617fa55b');
  assert.equal(baseline.postUpContextForBaseline({ format: baseline.capsulePostUpBaselineFormat, failed: context.failed }), context);
  assert.equal(baseline.isCapsulePostUpContext(context), true);
  assert.equal(baseline.isCapsulePostUpContext(clone(context)), false);
  assert.equal(baseline.isCapsulePostUpContext(baseline.postUpFailureContext), false);
  assert.throws(() => baseline.readPostUpFailure(undefined, clone(context)), /SOURCE_OWNED_POST_UP_FAILURE_CONTEXT_REQUIRED/);
});

test('original failed preparation and UP retain distinct actual closures', () => {
  assert.equal(failed.operation, '0fa0284f2e393d124c9fc9e0d14c8e9c');
  assert.equal(failed.pass, false);
  assert.equal(failed.phase, 'FAILED_CLOSED');
  assert.equal(failed.productionAdmission, false);
  assert.equal(failed.actual, undefined);
  assert.equal(failed.originalChildren, undefined);
  assert.equal(failed.up.originalPid, 9316);
  assert.equal(failed.up.code, 0);
  assert.equal(closed.originalPid, 34172);
  assert.equal(closed.code, 1);
  assert.equal(closed.stdoutEof, true);
  assert.equal(closed.stderrEof, true);
  assert.equal(closed.originalUpAdopted, false);
  assert.equal(closed.qualificationClaimed, false);
});

test('literal context pins current image, material and immutable original source', () => {
  assert.equal(context.image.sha256, 'e313c5b673ef2277e3b2ab4d568d2d5ff9844946b03b8b4c4a7d132036b4579c');
  assert.equal(context.material.sha256, 'a4d8fd8859407d8825a15bb4332c49b95edebed0a73bf37ca0d69fc82775eb85');
  assert.equal(context.originalSource.sha256, 'c786f721afb3f3da3ef676fdd45816d4f08918973fa42f3464749f45b1ace4ed');
  for (const key of ['failed', 'closure', 'stderr', 'originalSourceSnapshot', 'image', 'material']) {
    assert.equal(sha(baseline.postUpReadReference(context[key])), context[key].sha256);
    assert.equal(Object.isFrozen(context[key]), true);
  }
  assert.throws(() => { context.failed.sha256 = '0'.repeat(64); }, TypeError);
});

for (const [name, change] of Object.entries({
  unknownHash: value => { value.failed.sha256 = '0'.repeat(64); },
  wrongFile: value => { value.failed.file += '.other'; },
  historicalHashWithCurrentPath: value => { value.failed.sha256 = baseline.capsulePostUpFailureContext.failed.sha256; },
  currentHashWithHistoricalPath: value => { value.failed.file = baseline.capsulePostUpFailureContext.failed.file; },
  untypedFormat: value => { value.format = 'unknown'; }
})) test('context selector refuses ' + name, () => {
  const value = { format: baseline.capsulePostUpBaselineFormat, failed: clone(context.failed) };
  change(value);
  assert.throws(() => baseline.postUpContextForBaseline(value));
});

test('historical 971 and 4d9 remain separately readable negative contexts', () => {
  const old = baseline.readPostUpFailure();
  const capsule = baseline.readPostUpFailure(undefined, baseline.capsulePostUpFailureContext);
  assert.equal(old.operation, '97148774bad27bef1d5b464a69a8bdcb');
  assert.equal(capsule.operation, '4d9e5e57a12e985025bc06d59f08e050');
  assert.equal(old.pass, false);
  assert.equal(capsule.pass, false);
  assert.equal(baseline.postUpContextForBaseline({ format: baseline.capsulePostUpBaselineFormat, failed: baseline.capsulePostUpFailureContext.failed }), baseline.capsulePostUpFailureContext);
  assert.equal(baseline.postUpContextForBaseline({ format: baseline.postUpBaselineFormat }), baseline.postUpFailureContext);
});

// Evaluate the exact exported reader with an in-memory byte source to test semantic
// refusal independently of outer SHA checks. Original files are never modified.
function mutatedReader(change) {
  const records = new Map();
  for (const key of ['failed', 'closure', 'stderr', 'originalSourceSnapshot']) records.set(context[key].file, baseline.postUpReadReference(context[key]));
  const value = { failed: clone(failed), closed: clone(closed) };
  change(value);
  records.set(context.failed.file, Buffer.from(JSON.stringify(value.failed)));
  records.set(context.closure.file, Buffer.from(JSON.stringify(value.closed)));
  const read = vm.runInNewContext('(' + baseline.readCurrentPostUpFailure.toString() + ')', {
    assert, Buffer, currentPostUpFailureContext: context, postUpSlots: baseline.postUpSlots, sha,
    postUpReadReference: ref => { assert.ok(records.has(ref.file)); return records.get(ref.file); }
  });
  return read();
}

test('pure reader with genuine captured bytes remains negative', () => assert.equal(mutatedReader(() => {}).pass, false));

for (const [name, change] of Object.entries({
  failurePass: value => { value.failed.pass = true; },
  successPhase: value => { value.failed.phase = 'COMPLETE'; },
  admission: value => { value.failed.productionAdmission = true; },
  wrongFailure: value => { value.failed.failure.message = 'other'; },
  wrongOperation: value => { value.failed.operation = '4d9e5e57a12e985025bc06d59f08e050'; },
  originalSource: value => { value.failed.inputs[context.originalSource.file] = '0'.repeat(64); },
  failedUp: value => { value.failed.up.code = 1; },
  changedUpPid: value => { value.failed.up.originalPid++; },
  manufacturedActual: value => { value.failed.actual = {}; },
  manufacturedChildren: value => { value.failed.originalChildren = { allOriginalChildrenClosed: true }; },
  image: value => { value.failed.immutableImage = 'sha256:' + '0'.repeat(64); },
  imageReceipt: value => { value.failed.imageReceiptSha256 = '0'.repeat(64); },
  materialReceipt: value => { value.failed.materialReceiptSha256 = '0'.repeat(64); },
  protectedIdentity: value => { value.failed.protectedAfter.backend.id = 'changed'; },
  originalPid: value => { value.closed.originalPid++; },
  originalExit: value => { value.closed.code = 0; },
  stdoutEof: value => { value.closed.stdoutEof = false; },
  stderrEof: value => { value.closed.stderrEof = false; },
  interrupted: value => { value.closed.interrupted = true; },
  communicationFault: value => { value.closed.communicationFaults.push('KeyboardInterrupt'); },
  sourcePin: value => { value.closed.inputPins[context.originalSource.file] = '0'.repeat(64); },
  imagePin: value => { value.closed.inputPins[context.image.file] = '0'.repeat(64); },
  materialPin: value => { value.closed.inputPins[context.material.file] = '0'.repeat(64); },
  stdoutHash: value => { value.closed.stdoutSha256 = '0'.repeat(64); },
  stderrHash: value => { value.closed.stderrSha256 = '0'.repeat(64); },
  commandSource: value => { value.closed.argv[1] += '.other'; },
  inspectInsteadOfReplace: value => { value.closed.argv[2] = '--inspect'; },
  noFreshCohort: value => { value.closed.argv.pop(); },
  adoptedUp: value => { value.closed.originalUpAdopted = true; },
  qualificationClaim: value => { value.closed.qualificationClaimed = true; },
  wrongPlatform: value => { value.failed.candidateQaMemoryProfile.beforeUp.platform = 'linux'; },
  lowBeforeUp: value => { value.failed.candidateQaMemoryProfile.beforeUp.availableBytes = 2 * 1024 ** 3 - 1; },
  syntheticCredit: value => { value.failed.candidateQaMemoryProfile.cacheCreditUsed = true; },
  namespace: value => { value.failed.authorityCohort.nonce = '0'.repeat(32); },
  authorityPid: value => { value.failed.authorityCohort.verified['backend-candidate'].originalPid = 0; },
  authorityExit: value => { value.failed.authorityCohort.verified['backend-retained'].code = 1; },
  authorityResult: value => { value.failed.authorityCohort.verified['backend-candidate'].result.namespace.uid++; },
  preparedNamespace: value => { value.failed.authorityCohort.prepared['backend-retained'].result.namespace.uid++; }
})) test('literal negative reader refuses ' + name, () => assert.throws(() => mutatedReader(change)));

test('current context uses the real typed nonempty acceptance bootstrap', () => {
  const script = baseline.postUpAcceptanceBootstrap(context);
  assert.match(script, /TextIOWrapper\(io.BytesIO/);
  assert.doesNotMatch(script, /io.StringIO/);
  assert.equal(script, baseline.postUpAcceptanceBootstrap(baseline.capsulePostUpFailureContext));
  assert.notEqual(script, baseline.postUpAcceptanceBootstrap());
});

test('synthetic caller objects cannot grant private baseline or native ownership', () => {
  assert.throws(() => baseline.postUpMemoryDescriptor({ context, failed, pass: true }));
  assert.equal(fs.readFileSync(context.failed.file).includes(Buffer.from('"pass": false')), true);
});
