'use strict';
// Bind only this native fixture's temporary database BEFORE the canonical
// application client is constructed by the actual deployment script.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root, databaseName, owner } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.match(root, /^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/);
assert.match(databaseName, /^sabalanerp_concurrency_[a-f0-9]{16}$/);
assert.equal(fs.realpathSync(root), root);
const source = new URL(process.env.DATABASE_URL);
assert.equal(source.hostname, 'postgres'); assert.equal(source.port, '5432'); assert.equal(source.pathname, '/sabalanerp');
assert.equal(source.searchParams.get('application_name'), 'sabalanerp-online-candidate');
assert.equal(source.searchParams.get('connection_limit'), '2'); assert.equal(source.searchParams.get('pool_timeout'), '10');
source.pathname = '/' + databaseName;
source.searchParams.set('application_name', 'sabalan-bridge-cli-' + databaseName.slice(-16));
process.env.DATABASE_URL = source.toString();
process.env.DEPLOYMENT_ID = owner.deploymentId;
process.env.DEPLOYMENT_RELEASE_ID = owner.releaseId;
process.env.DEPLOYMENT_LEASE_TOKEN = owner.leaseToken;
const command = process.argv[3];
assert.ok(command === undefined || ['bootstrap-migrate-baseline', 'bootstrap-adopt'].includes(command));
if (command) {
  process.env.DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP = 'true';
  process.env.DEPLOYMENT_REPORT_DIR = path.join(root, 'reports');
}
const script = path.join(root, command ? 'dist/scripts/deployment-control.js' : 'dist/scripts/deployment-owned-migrations.js');
process.argv = [process.execPath, script, ...(command ? [command] : [])];
require(script);
