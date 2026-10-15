import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { postgresLsn, postgresWalSegments } from '../../scripts/postgres-recovery-coverage.mjs';

const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const repository = fileURLToPath(new URL('../..', import.meta.url));
function docker(args, options = {}) {
  const rows = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' })
    .trim().split(/\r?\n/).map(JSON.parse);
  for (const name of ['backend', 'postgres']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === name && row.State === 'running' && row.Health === 'healthy'), `Canonical ${name} must be healthy`);
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, ...options });
}
const pg = args => ['exec', 'sabalanerp-local-postgres-1', ...args];
function sql(text) {
  return docker(['exec', '-i', 'sabalanerp-local-postgres-1', 'sh', '-c',
    'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], { input: text });
}

test('PostgreSQL 15 validates real captured WAL and refuses a corrupted record without another database service',
  { skip: !canonical, timeout: 120000 }, () => {
    const local = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-wal-native-qa-'));
    const schema = 'sabalan_wal_qa_' + randomUUID().replaceAll('-', '');
    let pgRoot, backendRoot, schemaCreated = false;
    try {
      const nativeVersion = docker(pg(['pg_waldump', '--version'])).trim();
      assert.match(nativeVersion, /PostgreSQL\) 15\./);
      sql(`CREATE SCHEMA ${schema};`);
      schemaCreated = true;
      const output = sql(`SELECT json_build_object('startLsn', pg_current_wal_insert_lsn(),
        'timeline', (pg_control_checkpoint()).timeline_id, 'segmentBytes', pg_size_bytes(current_setting('wal_segment_size')),
        'serverVersion',current_setting('server_version_num'));
        CREATE TABLE ${schema}.ledger (id integer PRIMARY KEY, amount numeric(12,2) NOT NULL);
        INSERT INTO ${schema}.ledger VALUES (1,19.50),(2,8.25);
        SELECT json_build_object('amount',sum(amount)::text) FROM ${schema}.ledger;
        SELECT json_build_object('endLsn',pg_current_wal_insert_lsn());
        SELECT pg_switch_wal();`);
      const facts = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(JSON.parse);
      assert.equal(facts[1].amount, '27.75');
      assert.ok(Number(facts[0].serverVersion) >= 150000 && Number(facts[0].serverVersion) < 160000);
      const range = { startLsn: facts[0].startLsn, timeline: facts[0].timeline, segmentBytes: facts[0].segmentBytes, endLsn: facts[2].endLsn };
      const names = postgresWalSegments(range);
      assert.ok(names.length >= 1 && names.length <= 4, 'bounded local WAL fixture');
      pgRoot = docker(pg(['sh', '-c', 'umask 077; mktemp -d /tmp/sabalan-wal-proof-XXXXXX'])).trim();
      assert.match(pgRoot, /^\/tmp\/sabalan-wal-proof-[a-zA-Z0-9]{6}$/);
      docker(pg(['sh', '-c', 'set -eu; root="$1"; shift; for name do cp "$PGDATA/pg_wal/$name" "$root/$name"; chmod 600 "$root/$name"; done', 'wal-capture', pgRoot, ...names]));
      const native = docker(pg(['pg_waldump', '-p', pgRoot, '-s', range.startLsn, '-e', range.endLsn]));
      const first = native.match(/lsn:\s*([0-9A-F]+\/[0-9A-F]+)/i);
      assert.ok(first, 'native PostgreSQL parsed records in the captured range');
      docker(['cp', 'sabalanerp-local-postgres-1:' + pgRoot, path.join(local, 'wal')]);
      const expected = names.map(name => {
        const bytes = fs.readFileSync(path.join(local, 'wal', name));
        assert.equal(bytes.length, range.segmentBytes);
        return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      });
      backendRoot = docker(['exec', 'sabalanerp-local-backend-1', 'node', '-e',
        "console.log(require('fs').mkdtempSync('/tmp/sabalan-wal-bytes-qa-'))"]).trim();
      assert.match(backendRoot, /^\/tmp\/sabalan-wal-bytes-qa-[a-zA-Z0-9]{6}$/);
      fs.writeFileSync(path.join(local, 'input.json'), JSON.stringify({ range, expected }));
      fs.copyFileSync(path.join(repository, 'scripts/postgres-recovery-coverage.mjs'), path.join(local, 'postgres-recovery-coverage.mjs'));
      fs.copyFileSync(path.join(repository, 'tests/online-deployment/postgres-wal-files.fixture.mjs'), path.join(local, 'postgres-wal-files.fixture.mjs'));
      for (const name of ['wal', 'input.json', 'postgres-recovery-coverage.mjs', 'postgres-wal-files.fixture.mjs']) {
        docker(['cp', path.join(local, name), 'sabalanerp-local-backend-1:' + backendRoot + '/' + name]);
      }
      const verified = docker(['exec', '-e', 'WAL_COVERAGE_FIXTURE_ROOT=' + backendRoot, 'sabalanerp-local-backend-1',
        'node', '--test', backendRoot + '/postgres-wal-files.fixture.mjs']);
      assert.match(verified, /# pass 1/); assert.match(verified, /# fail 0/);
      process.stdout.write(verified);

      // pg_waldump pads each hexadecimal component; pg_lsn text does not.
      const nativeLsn = first[1].split('/').map(part => BigInt('0x' + part).toString(16).toUpperCase()).join('/');
      const recordLsn = postgresLsn(nativeLsn);
      const recordRange = { ...range, startLsn: nativeLsn, endLsn: range.endLsn };
      const name = postgresWalSegments(recordRange)[0];
      const offset = Number(recordLsn % BigInt(range.segmentBytes)) + 20; // Native XLogRecord CRC.
      const damaged = fs.readFileSync(path.join(local, 'wal', name));
      assert.ok(offset < damaged.length); damaged[offset] ^= 1;
      fs.writeFileSync(path.join(local, name), damaged);
      docker(['cp', path.join(local, name), 'sabalanerp-local-postgres-1:' + pgRoot + '/' + name]);
      // Verify the target before invoking a command whose failure is expected.
      docker(pg(['test', '-d', pgRoot]));
      const corrupt = spawnSync('docker', pg(['pg_waldump', '-q', '-p', pgRoot, '-s', recordRange.startLsn, '-e', range.endLsn]),
        { encoding: 'utf8', timeout: 30000 });
      assert.notEqual(corrupt.status, 0);
      assert.match(corrupt.stderr, /checksum|record|invalid/i);
      console.log(JSON.stringify({ nativePostgresWal: true, nativeVersion, corruptedRecordRejected: true, segments: expected.length, bytes: expected.length * range.segmentBytes }));
    } finally {
      const cleanupErrors = [];
      const clean = run => { try { run(); } catch (error) { cleanupErrors.push(error); } };
      if (schemaCreated) clean(() => sql(`DROP SCHEMA ${schema} CASCADE;`));
      if (pgRoot) clean(() => {
        assert.match(pgRoot, /^\/tmp\/sabalan-wal-proof-[a-zA-Z0-9]{6}$/);
        docker(pg(['sh', '-c', 'set -eu; target="$1"; case "$target" in /tmp/sabalan-wal-proof-??????) ;; *) exit 1;; esac; rm -rf -- "$target"', 'owned-cleanup', pgRoot]));
      });
      if (backendRoot) clean(() => {
        assert.match(backendRoot, /^\/tmp\/sabalan-wal-bytes-qa-[a-zA-Z0-9]{6}$/);
        docker(['exec', 'sabalanerp-local-backend-1', 'node', '-e',
          "const fs=require('fs'),path=require('path'),root=process.argv[1];if(path.dirname(root)!=='/tmp'||!/^sabalan-wal-bytes-qa-[a-zA-Z0-9]{6}$/.test(path.basename(root)))throw Error('unsafe cleanup');fs.rmSync(root,{recursive:true});", backendRoot]);
      });
      clean(() => {
        assert.equal(path.dirname(local), os.tmpdir());
        assert.ok(path.basename(local).startsWith('sabalan-wal-native-qa-'));
        assert.equal(fs.realpathSync(local), path.resolve(local));
        fs.rmSync(local, { recursive: true });
      });
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'OWNED_WAL_FIXTURE_CLEANUP_FAILED');
    }
  });
