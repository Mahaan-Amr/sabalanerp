/** Source-bound current history proof. Synthetic results never qualify runtime. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inertAcceptanceSpec, inertAcceptanceSpecSha256, inertAcceptanceInventorySummary,
  inertAcceptanceInputFiles, validateInertAcceptanceResult } from '../../scripts/lib/application-native-inert-acceptance.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const spec = inertAcceptanceSpec(root);
const clone = structuredClone;
const sha = raw => createHash('sha256').update(raw).digest('hex');
const oldFailed = 'retained-browser-14df9eedda62073251b3faa592f7fd70';
const oldComplete = 'retained-browser-c776c84c730cac0f558db42c7ba29277';
const retained = 'retained-browser-38343d1b941091e344e5ed45791ace77';
const negative = 'application-native-1cc175018d9d712991bdf4ee45d2593e';
const largeRelative = 'full-catalog/backend/node_modules/@prisma/client/index.d.ts';
const largePath = '/app/online-runtime-acceptance/' + negative + '/' + largeRelative;
const secondLargeRelative = 'node_modules/@prisma/client/index.d.ts';
const secondLargePath = '/app/online-runtime-acceptance/' + negative + '/' + secondLargeRelative;
const largeSha = 'd0182cc0e86bcce247fd381e059fb4e04d963636b07dfa0b593ed9cf15ee4255';
const capsuleNames = ['application-prisma-ebcfd40fff0a28e39d983c6616893b50', 'inquiry-coherent-7878c93646acd9ac37cef95e27a4029d'];

function fixture() {
  const capsuleDirectoryIdentities = Object.fromEntries(spec.capsuleNames.map(name => {
    const s = spec.children[name];
    return ['/app/online-runtime-acceptance/' + name,
      [s.st_dev, s.st_ino, ...['st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_mode', 'st_uid', 'st_nlink'].map(key => Number(s[key]))]];
  }));
  const value = { format: 'sabalan-inert-owned-acceptance-history/v1', classification: 'INERT_OWNED_HISTORY_VIEW',
    physicalEmpty: false, namespace: clone(spec.namespace), historicalNamespace: clone(spec.historicalNamespace),
    rootNames: Object.keys(spec.children).sort(), children: clone(spec.children), histories: inertAcceptanceInventorySummary(spec),
    closures: Object.fromEntries(Object.entries(spec.closures).map(([key, row]) => [key, {
      nativeSha256: row.nativeSha256, workSha256: row.workSha256, phase: 'QUIESCENT', nativeReaped: true, sqliteNativeClosed: true
    }])), negativePreparations: clone(spec.negativePreparations),
    lockIdentities: Object.entries(spec.locks).map(([file, row]) => ({ file, identity: {
      ...spec.namespace, st_dev: row?.device ?? '2112', st_ino: row?.inode ?? 'synthetic-unpinned-lock',
      st_mode: '33152', st_nlink: '1', st_size: '0'
    } })), capsuleDirectoryIdentities, readOnly: true, databaseExecuted: false,
    nativeActorStarted: false, qualificationSucceeded: false, productionAdmission: false };
  const capsule = { readOnly: true, capsulesVerified: 2, directoryIdentities: clone(capsuleDirectoryIdentities),
    databaseExecuted: false, nativeActorStarted: false, productionAdmission: false };
  return { value, capsule };
}

test('current view contains exactly six authenticated root names and four histories', () => {
  assert.deepEqual(Object.keys(spec.children).sort(), [...capsuleNames, oldFailed, oldComplete, retained, negative].sort());
  assert.deepEqual(Object.keys(spec.histories).sort(), [oldFailed, oldComplete, retained, negative].sort());
  assert.deepEqual(spec.capsuleNames.slice().sort(), capsuleNames.slice().sort());
  for (const key of ['st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode']) assert.equal(spec.namespace[key], spec.historicalNamespace[key]);
  assert.equal(sha(Buffer.from(JSON.stringify(spec))), inertAcceptanceSpecSha256);
});

test('full negative preparation inventory replaces partial metadata without inventing native closure', () => {
  const inventory = spec.histories[negative];
  assert.equal(inventory.entries.length, 4491);
  assert.equal(inventory.files, 3568);
  assert.equal(inventory.bytes, 226777618);
  assert.equal(inventory.entries.filter(row => row.type === 'file').length, inventory.files);
  assert.equal(inventory.entries.filter(row => row.type === 'file').reduce((sum, row) => sum + row.bytes, 0), inventory.bytes);
  assert.equal(new Set(inventory.entries.map(row => row.path)).size, inventory.entries.length);
  assert.equal(Object.keys(spec.closures).length, 4);
  assert.ok(Object.keys(spec.closures).every(key => !key.includes('1cc175')));
});

test('large file allowances are exactly the two authenticated paths, byte counts and digests', () => {
  assert.deepEqual(spec.largeFiles, {
    [largePath]: { bytes: 52193462, sha256: largeSha },
    [secondLargePath]: { bytes: 52193462, sha256: largeSha }
  });
  const rows = spec.histories[negative].entries.filter(entry => entry.type === 'file' && entry.bytes > 16 * 1024 ** 2);
  assert.deepEqual(rows.map(row => row.path).sort(), [largeRelative, secondLargeRelative].sort());
  for (const row of rows) {
    assert.equal(row.bytes, 52193462);
    assert.equal(row.sha256, largeSha);
  }
});

test('unused negative master evidence never becomes a successful native closure', () => {
  assert.deepEqual(Object.keys(spec.negativePreparations), [negative]);
  const proof = spec.negativePreparations[negative];
  assert.equal(proof.classification, 'KNOWN_NEGATIVE_CANCELLED_UNUSED');
  assert.equal(proof.originalMasterCode, 125);
  assert.equal(proof.nativeClosureClaimed, false);
  assert.equal(proof.unusedGrantRecords, 17);
  assert.equal(proof.nativeActorRecords, 0);
});

test('valid synthetic six-history result remains physically nonempty and nonqualifying', () => {
  const { value, capsule } = fixture();
  validateInertAcceptanceResult(value, spec, capsule);
  assert.equal(value.physicalEmpty, false);
  assert.equal(value.empty, undefined);
  assert.equal(value.actorEntries, undefined);
  assert.equal(value.qualificationSucceeded, false);
});

for (const [name, change] of Object.entries({
  missingNewRetained: value => { delete value.histories[retained]; },
  missingNegativeInventory: value => { delete value.histories[negative]; },
  partialInventory: value => { value.histories[negative].entries = 2048; },
  differentNegativeDigest: value => { value.histories[negative].sha256 = '0'.repeat(64); },
  unknownRoot: value => { value.rootNames.push('unowned-history'); },
  rootOmitted: value => { value.rootNames = value.rootNames.filter(name => name !== negative); },
  falseEmpty: value => { value.physicalEmpty = true; },
  fakeActorArray: value => { value.actorEntries = []; },
  changedParent: value => { value.namespace.st_ino += '1'; },
  missingRetainedClosure: value => { delete value.closures[Object.keys(value.closures).at(-1)]; },
  activeRetained: value => { value.closures[Object.keys(value.closures).at(-1)].phase = 'ACTIVE'; },
  positiveNegativeCode: value => { value.negativePreparations[negative].originalMasterCode = 0; },
  positiveNegativeClassification: value => { value.negativePreparations[negative].classification = 'COMPLETE'; },
  inventedNativeClosure: value => { value.negativePreparations[negative].nativeClosureClaimed = true; },
  activeNegativeActor: value => { value.negativePreparations[negative].nativeActorRecords = 1; },
  missingUnusedGrant: value => { value.negativePreparations[negative].unusedGrantRecords = 16; },
  inventedArchiveRead: value => { value.negativePreparations[negative].archiveBytesReadByThisVerifier = true; },
  changedArchiveInventory: value => { value.negativePreparations[negative].fullArchiveInventorySha256 = '0'.repeat(64); },
  missingAbsentActorPath: value => { value.negativePreparations[negative].absentPaths.pop(); },
  qualification: value => { value.qualificationSucceeded = true; },
  production: value => { value.productionAdmission = true; }
})) test('current typed proof refuses ' + name, () => {
  const { value, capsule } = fixture(); change(value);
  assert.throws(() => validateInertAcceptanceResult(value, spec, capsule));
});

for (const [name, change] of Object.entries({
  largeUnknownFile: value => { value.largeFiles[largePath + '.other'] = clone(value.largeFiles[largePath]); },
  genericLargeBound: value => { value.largeFiles[largePath].bytes++; },
  wrongLargeHash: value => { value.largeFiles[largePath].sha256 = '0'.repeat(64); },
  missingLargeAllowance: value => { delete value.largeFiles[largePath]; },
  shortenedSourceInventory: value => { value.histories[negative].entries.pop(); }
})) test('caller cannot change source-owned policy through ' + name, () => {
  const { value, capsule } = fixture(), changed = clone(spec); change(changed);
  assert.throws(() => validateInertAcceptanceResult(value, changed, capsule));
});

test('current successful retained report is an authenticated input and old empty probe stays unchanged', () => {
  assert.ok(inertAcceptanceInputFiles(root).some(file => path.basename(file) === 'retained-browser-38343d1b941091e344e5ed45791ace77.json'));
  assert.equal(sha(fs.readFileSync(path.join(root, 'tests/online-deployment/application-native-negative-acceptance.fixture.py'))),
    '2ab67a15c8c87ea3ba6a3403754cc8ab57ccbded8e388f2f91d141c72bd1630a');
});
