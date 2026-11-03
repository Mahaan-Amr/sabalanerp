'use strict';
// Test-only worker: run only within the reviewed private control fixture.
// Fixture checkpoint flags describe synthetic state, not real backup proof.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const configPath = process.argv[2];
assert.equal(typeof configPath, 'string');
const { root, databaseName, owner } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert.match(root, /^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(root), root);
assert.equal(configPath, path.join(root, 'configuration.json'));
assert.match(databaseName, /^sabalanerp_protected_[a-f0-9]{32}$/);
assert.ok(owner && typeof owner.deploymentId === 'string' && typeof owner.releaseId === 'string' && typeof owner.leaseToken === 'string');
const source = new URL(process.env.DATABASE_URL);
assert.equal(source.hostname, 'postgres');
assert.equal(source.port, '5432');
assert.equal(source.pathname, '/sabalanerp');
assert.equal(source.searchParams.get('application_name'), 'sabalanerp-online-candidate');
assert.equal(source.searchParams.get('connection_limit'), '2');
assert.equal(source.searchParams.get('pool_timeout'), '10');
source.pathname = '/' + databaseName;
source.searchParams.set('application_name', 'sabalan-candidate-cli-' + databaseName.slice(-16));
process.env.DATABASE_URL = source.toString();
process.env.DEPLOYMENT_ID = owner.deploymentId;
process.env.DEPLOYMENT_RELEASE_ID = owner.releaseId;
process.env.DEPLOYMENT_LEASE_TOKEN = owner.leaseToken;
const script = path.join(root, 'dist/scripts/deployment-owned-migrations.js');
// The CLI is import-safe: launch it as the main module, retaining only the
// fixture's already-held FD 9. The caller must independently reap the worker
// and prove both output readers and the descendant have closed.
const child = spawn(process.execPath, [script], {
  stdio: ['ignore', 'inherit', 'inherit', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 9],
});
let unknown = false;
const timer = setTimeout(() => { unknown = true; }, 30000);
child.on('error', () => { unknown = true; });
child.on('close', (code, signal) => {
  clearTimeout(timer);
  if (unknown || signal || !Number.isInteger(code)) {
    process.stderr.write('CANDIDATE_CLI_WORKER_OUTCOME_UNKNOWN\n');
    process.exitCode = 1;
  } else process.exitCode = code;
});
