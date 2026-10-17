'use strict';
// Native identity INPUT adapter only. Never imports Prisma or starts a listener.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadOnlineRuntimeScope } = require('./onlineRuntimeScope');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const root = process.argv[2], mode = process.argv[3];
assert.match(root, /^\/app\/online-runtime-acceptance\/online-authority-[a-f0-9]{32}$/);
const index = JSON.parse(fs.readFileSync(root + '/grant-index.json', 'utf8'));
function environment(grant) {
  return { ...process.env, BACKEND_ONLINE_SCOPE_FILE: grant.file, BACKEND_ONLINE_SCOPE_SHA256: grant.sha256,
    BACKEND_RUNTIME_ROLE: grant.role, RECOVERY_COORDINATION_DIR: grant.scope?.coordinationDirectory
      || index.grants[0].scope.coordinationDirectory };
}
function refused(run) {
  assert.throws(run, error => error instanceof Error && error.message === 'ONLINE_RUNTIME_SCOPE_UNPROVEN');
}
function child(grant, selectedMode, selectedIndex) {
  const result = spawnSync(process.execPath, [__filename, root, selectedMode, String(selectedIndex)], {
    env: environment(grant), encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
  });
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
async function main() {
  if (mode === 'readonly') {
    const observed = index.grants.map((grant, value) => child(grant, 'valid-child', value));
    const transitions = ['role', 'disabled', 'hash'].map(kind => child(index.grants[0], 'transition-' + kind, 0));
    const invalid = index.invalid.map((grant, value) => child(grant, 'invalid-child', value));
    console.log(JSON.stringify({ pass: true, mode, observed, transitions, invalid, sourceSha256: hash(fs.readFileSync(__dirname + '/onlineRuntimeScope.js')) }));
  } else if (mode === 'valid-child') {
    const grant = index.grants[Number(process.argv[4])];
    const input = loadOnlineRuntimeScope();
    // Compare hashes, avoiding a failure dump of private scope/nonce bytes.
    assert.equal(hash(Buffer.from(JSON.stringify(canonical(input.scope)))), hash(Buffer.from(JSON.stringify(canonical(grant.scope)))));
    assert.equal(input.sha256, grant.sha256);
    assert.equal(input.helperSha256, hash(fs.readFileSync(__dirname + '/online-runtime-scope.py')));
    assert.equal(input.mountNamespace, fs.readlinkSync('/proc/self/ns/mnt'));
    assert.equal(input.mountInfoSha256, hash(fs.readFileSync('/proc/self/mountinfo')));
    for (const value of [input, input.scope, input.scope.gate, input.scope.database]) assert.ok(Object.isFrozen(value));
    assert.throws(() => { input.scope.gate.inode = '1'; }, TypeError);
    assert.strictEqual(loadOnlineRuntimeScope(), input);
    console.log(JSON.stringify({ pass: true, purpose: grant.scope.purpose, mountId: input.mountId, frozen: true }));
  } else if (mode.startsWith('transition-')) {
    const input = loadOnlineRuntimeScope();
    assert.ok(input);
    const kind = mode.slice('transition-'.length);
    const changed = kind === 'role' ? { ...process.env, BACKEND_RUNTIME_ROLE: 'candidate' }
      : kind === 'disabled' ? {} : kind === 'hash' ? { ...process.env, BACKEND_ONLINE_SCOPE_SHA256: '0'.repeat(64) } : null;
    assert.ok(changed);
    refused(() => loadOnlineRuntimeScope(changed));
    // Returning to the original valid configuration must not clear the hold.
    refused(() => loadOnlineRuntimeScope());
    console.log(JSON.stringify({ pass: true, transition: kind, persistentPoison: true }));
  } else if (mode === 'invalid-child') {
    refused(() => loadOnlineRuntimeScope());
    console.log(JSON.stringify({ pass: true, rejected: index.invalid[Number(process.argv[4])].kind }));
  } else if (mode === 'writable-alias') {
    for (const [position, grant] of index.grants.entries()) child(grant, 'alias-child', position);
    console.log(JSON.stringify({ pass: true, mode, actualWritableAliasesRejected: index.grants.length }));
  } else if (mode === 'alias-child') {
    refused(() => loadOnlineRuntimeScope());
    console.log(JSON.stringify({ pass: true, refused: 'ACTUAL_WRITABLE_ALIAS' }));
  } else if (mode === 'cache-tamper') {
    const input = loadOnlineRuntimeScope(environment(index.cacheProbe));
    console.log(JSON.stringify({ event: 'ready', device: input.device, inode: input.inode }));
    const deadline = performance.now() + 15000;
    while (!fs.existsSync(root + '/cache-probe-replaced')) {
      assert.ok(performance.now() < deadline, 'Source replacement test did not complete');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    // The replacement retains IDENTICAL bytes/hash. An issued process must
    // still reject its changed source inode instead of silently rebinding.
    assert.equal(hash(fs.readFileSync(index.cacheProbe.file)), index.cacheProbe.sha256);
    refused(() => loadOnlineRuntimeScope(environment(index.cacheProbe)));
    console.log(JSON.stringify({ pass: true, mode, sameBytesReplacementRejected: true }));
  } else if (mode === 'unconfigured') {
    assert.equal(loadOnlineRuntimeScope({}), undefined);
    refused(() => loadOnlineRuntimeScope({ BACKEND_ONLINE_SCOPE_FILE: '/run/sabalan-online/' + 'a'.repeat(64) + '.json' }));
    console.log(JSON.stringify({ pass: true, mode }));
  } else throw Error('Unknown scope input fixture mode');
}
main().catch(() => { process.stderr.write('ONLINE_SCOPE_NODE_ACCEPTANCE_FAILED\n'); process.exitCode = 1; });
