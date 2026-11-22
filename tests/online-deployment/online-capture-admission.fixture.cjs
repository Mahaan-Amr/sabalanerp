'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { OnlineCaptureAdmission } = require('./services/onlineCaptureAdmission');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encode = value => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const root = process.argv[2];
assert.equal(path.dirname(root), '/app/online-runtime-acceptance');
assert.match(path.basename(root), /^online-native-[a-f0-9]{32}$/);
const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json')));
const source = index.grants.find(g => g.name === 'capture');
assert.equal(source.scope.format, 'sabalan-online-runtime-scope/v2');
const python = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('admission',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
try:
 state=m.CaptureAdmission(json.load(sys.stdin)).state()[0];print('OPEN' if state['phase']=='OPEN' else 'CLOSING')
except Exception:print('REFUSED')`;
let number = 0;
function fixture() {
  const scope = JSON.parse(JSON.stringify(source.scope));
  const directory = path.join(root, 'reader-case-' + ++number);
  fs.mkdirSync(directory, { mode: 0o700 });
  scope.coordinationDirectory = directory;
  for (const key of ['gate', 'interlock', 'worker']) scope[key].file = directory + '/' + path.basename(scope[key].file);
  const admission = path.join(directory, 'online/admission');
  fs.mkdirSync(admission, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(admission, 'staging'), { mode: 0o700 });
  const definition = encode({ format: 'sabalan-online-admission-scope/v1',
    gate: scope.gate, interlock: scope.interlock, worker: scope.worker, database: scope.database });
  scope.admission = { directory: admission, scopeSha256: hash(definition) };
  fs.writeFileSync(path.join(admission, 'scope.json'), definition, { flag: 'wx', mode: 0o400 });
  const initial = encode({ format: 'sabalan-online-capture-admission/v1', generation: 0,
    phase: 'OPEN', previousSha256: null, capture: null, closureSha256: null });
  fs.writeFileSync(path.join(admission, '00000000.json'), initial, { flag: 'wx', mode: 0o400 });
  const input = { scope, sha256: source.sha256 };
  const reader = new OnlineCaptureAdmission(input);
  const snapshot = () => {
    const value = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', python, path.join(root, 'online-capture-admission.py')],
      { input: JSON.stringify(input), encoding: 'utf8', timeout: 10000 });
    assert.equal(value.status, 0, value.stderr);
    return value.stdout.trim();
  };
  const close = () => {
    const capture = { runtimeId: scope.runtimeId, scopeSha256: source.sha256,
      guardian: { pid: process.pid, bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        pidNamespace: fs.readlinkSync('/proc/self/ns/pid'), startTicks: fs.readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ')[19] } };
    const closing = encode({ format: 'sabalan-online-capture-admission/v1', generation: 1,
      phase: 'CLOSING', previousSha256: hash(initial), capture, closureSha256: null });
    fs.writeFileSync(path.join(admission, '00000001.json'), closing, { flag: 'wx', mode: 0o400 });
    return { closing, capture };
  };
  return { directory, admission, input, reader, snapshot, close };
}

// These intentionally synthetic records exercise reader validation only.
// Actual native reopening is separately proven by the scoped overlap fixture.
const cases = [];
for (const [name, corrupt] of [
  ['missing-initial', value => fs.unlinkSync(path.join(value.admission, '00000000.json'))],
  ['null-initial', value => fs.writeFileSync(path.join(value.admission, '00000000.json'), 'null\n')],
  ['wrong-scope-pin', value => { value.input.scope.admission.scopeSha256 = 'f'.repeat(64); }],
  ['history-gap', value => { value.close(); fs.renameSync(path.join(value.admission, '00000001.json'), path.join(value.admission, '00000002.json')); }],
  ['unknown-entry', value => fs.writeFileSync(path.join(value.admission, 'unknown.json'), '{}\n')],
  ['partial-publication', value => fs.writeFileSync(path.join(value.admission, '00000001.json'), '{', { mode: 0o400 })],
  ['hard-link-alias', value => fs.linkSync(path.join(value.admission, '00000000.json'), path.join(value.directory, 'alias'))],
  ['symlink-publication', value => { const file = path.join(value.admission, '00000000.json'); fs.renameSync(file, path.join(value.directory, 'initial')); fs.symlinkSync(path.join(value.directory, 'initial'), file); }],
  ['forged-open-without-native', value => { const { closing, capture } = value.close(); fs.writeFileSync(path.join(value.admission, '00000002.json'), encode({ format: 'sabalan-online-capture-admission/v1', generation: 2, phase: 'OPEN', previousSha256: hash(closing), capture, closureSha256: 'a'.repeat(64) }), { mode: 0o400 }); }],
]) {
  const value = fixture(); corrupt(value);
  assert.throws(() => value.reader.isOpen(), /ADMISSION_UNPROVEN/);
  assert.equal(value.snapshot(), 'REFUSED');
  cases.push(name);
}
{
  const value = fixture();
  assert.equal(value.reader.isOpen(), true); assert.equal(value.snapshot(), 'OPEN');
  value.close(); assert.equal(value.reader.isOpen(), false); assert.equal(value.snapshot(), 'CLOSING');
  fs.unlinkSync(path.join(value.admission, '00000001.json'));
  assert.throws(() => value.reader.isOpen(), /ADMISSION_UNPROVEN/);
  assert.throws(() => value.reader.isOpen(), /ADMISSION_UNPROVEN/);
  cases.push('observed-closing-removal-permanently-refused');
}
{
  const value = fixture(); assert.equal(value.reader.isOpen(), true);
  fs.renameSync(value.admission, value.admission + '-original');
  fs.cpSync(value.admission + '-original', value.admission, { recursive: true });
  assert.throws(() => value.reader.isOpen(), /ADMISSION_UNPROVEN/);
  cases.push('identical-root-replacement-refused');
}
{
  const value = fixture(); assert.equal(value.reader.isOpen(), true);
  const file = path.join(value.admission, '00000000.json');
  fs.renameSync(file, path.join(value.directory, 'original-initial'));
  fs.copyFileSync(path.join(value.directory, 'original-initial'), file);
  assert.throws(() => value.reader.isOpen(), /ADMISSION_UNPROVEN/);
  cases.push('identical-observed-head-replacement-refused');
}
{
  const value = fixture(); assert.equal(value.reader.isOpen(), true);
  value.close(); assert.equal(value.reader.isOpen(), false);
  fs.writeFileSync(path.join(value.admission, '00000000.json'), 'null\n');
  assert.equal(value.reader.isOpen(), false, 'older corruption cannot change the already verified CLOSING head');
  assert.throws(() => new OnlineCaptureAdmission(value.input).isOpen(), /ADMISSION_UNPROVEN/);
  assert.equal(value.snapshot(), 'REFUSED');
  cases.push('trusted-closing-survives-older-corruption-fresh-reader-refuses');
}
const capacityNative = path.join(root, 'capacity-case/online/native', index.grants[0].scope.runtimeId, 'deployment-runtime-native.json');
const capacityInput = JSON.parse(fs.readFileSync(capacityNative)).onlineScope;
const capacityReader = new OnlineCaptureAdmission(capacityInput);
const coldStart = performance.now(); assert.equal(capacityReader.isOpen(), true);
const coldMilliseconds = performance.now() - coldStart;
const originalOpen = fs.openSync; let openedFiles = 0;
const warmStart = performance.now();
try {
  fs.openSync = (...args) => { openedFiles++; return originalOpen(...args); };
  assert.equal(capacityReader.isOpen(), true);
} finally { fs.openSync = originalOpen; }
assert.ok(openedFiles <= 6, 'cached HTTP admission must not reread thousands of historical files');
const warmMilliseconds = performance.now() - warmStart;
console.log(JSON.stringify({ pass: true, crossLanguageReaderCases: cases,
  boundedCachedAdmission: { historyEvents: 8191, openedFiles, coldMilliseconds, warmMilliseconds } }));
