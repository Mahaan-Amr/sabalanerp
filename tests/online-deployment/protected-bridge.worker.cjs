'use strict';
// One native transaction invocation under the fixture's inherited kernel FD9.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const { applyProtectedBridgeMigration } = require('./protectedBridgeMigrations');
const configuration = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const command = JSON.parse(process.argv[3]);
const { root, databaseName, owner, migrations } = configuration;
assert.match(root, /^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/);
assert.match(databaseName, /^sabalanerp_concurrency_[a-f0-9]{16}$/);
assert.equal(fs.realpathSync(root), root);
assert.equal(process.env.RECOVERY_COORDINATION_DIR, path.join(root, 'coordination'));
const source = new URL(process.env.DATABASE_URL);
assert.equal(source.hostname, 'postgres'); assert.equal(source.port, '5432'); assert.equal(source.pathname, '/sabalanerp');
assert.equal(source.searchParams.get('application_name'), 'sabalanerp-online-candidate');
source.pathname = '/' + databaseName;
source.searchParams.set('application_name', 'sabalan-bridge-' + databaseName.slice(-16));
const database = new PrismaClient({ datasources: { db: { url: source.toString() } } });
(async () => {
  let outcome;
  try {
    assert.ok([0, 1].includes(command.index));
    const name = migrations[command.index], bytes = fs.readFileSync(path.join(root, name + '.sql'));
    if (command.tamper) bytes[0] ^= 1;
    const identity = command.wrongOwner ? { ...owner, leaseToken: 'not-the-owned-fixture-lease' } : owner;
    if (command.dropLock) fs.closeSync(9);
    const result = await applyProtectedBridgeMigration(database, identity, name, bytes);
    outcome = { ok: true, value: result };
  } catch (error) { outcome = { ok: false, code: error.code || error.message, sqlState: error.meta?.code }; }
  finally { await database.$disconnect(); }
  process.stdout.write(JSON.stringify(outcome) + '\n');
})().catch(() => { process.exitCode = 1; });
