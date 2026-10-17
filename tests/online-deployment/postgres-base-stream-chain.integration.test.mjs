import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import { postgresLsn, postgresWalSegments } from '../../scripts/postgres-recovery-coverage.mjs';

const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const source = process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL;
const binaryPath = process.env.ONLINE_STATIC_NATIVE_OWNER;
const { Client } = createRequire(import.meta.url)('pg');
const repository = path.resolve(import.meta.dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verify() {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(JSON.parse); }
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
}
function docker(args, options = {}) { verify(); return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 ** 2, ...options }); }
function identities() {
  return JSON.parse(docker(['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(name => 'sabalanerp-local-' + name + '-1')]))
    .map(row => ({ id: row.Id, image: row.Image, startedAt: row.State.StartedAt }));
}
const lsnText = value => (value >> 32n).toString(16).toUpperCase() + '/' + (value & 0xffffffffn).toString(16).toUpperCase();

test('native compressed physical base and concurrently streamed WAL cover a later exact committed transaction',
  { skip: !canonical || !source || !binaryPath, timeout: 1200000 }, async () => {
    const binary = fs.readFileSync(binaryPath);
    assert.equal(sha(binary), 'cd4f193fef97afd5b067ee8e105d010e7da4d7236b2851b28c6245563997faa3');
    const before = identities(), operation = randomBytes(16).toString('hex');
    const namespace = 'sabalan-base-chain-' + operation;
    const databaseName = 'sabalanerp_concurrency_' + operation.slice(0, 16);
    const root = '/tmp/sabalan-pgchain-' + operation, pgId = before[3].id;
    const url = new URL(source);
    assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(url.host)); assert.equal(url.pathname, '/sabalanerp');
    url.pathname = '/postgres'; const admin = new Client({ connectionString: url.toString() });
    url.pathname = '/' + databaseName; const writer = new Client({ connectionString: url.toString() });
    fs.writeFileSync(path.join(repository, 'reports/qa/base-stream-chain-' + operation + '-intent.json'),
      JSON.stringify({ root, databaseName, namespace, canonical: before, binarySha256: sha(binary), fixtureSha256: sha(fs.readFileSync(import.meta.filename)) }) + '\n', { flag: 'wx' });
    const native = (name, command, applicationName) => {
      assert.match(name, /^[a-z]+$/);
      verify();
      // The shell retains FD9 until the subreaper has issued its exact receipt
      // and the status/logs are persisted. A Docker-client exit is insufficient.
      const child = spawn('docker', ['exec', '-e', 'PGAPPNAME=' + applicationName, pgId, 'sh', '-c',
        'set -u; root="$1"; name="$2"; token="$3"; shift 3; umask 077; exec 9>>"$root/$name.lock"; flock -n 9 || exit 75; test ! -e "$root/$name.active" || exit 75; printf ACTIVE >"$root/$name.active"; sync; "$root/owner" 900 "$token" "$@" >"$root/$name.stdout" 2>"$root/$name.stderr"; result=$?; printf "%s" "$result" >"$root/$name.status"; sync; exit "$result"',
        'native-chain-command', root, name, operation + '-' + name, ...command], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', errors = '';
      child.stdout.on('data', bytes => { assert.ok(output.length + bytes.length < 65536); output += bytes; });
      child.stderr.on('data', bytes => { assert.ok(errors.length + bytes.length < 65536); errors += bytes; });
      const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal, output, errors })); });
      return { name, closed };
    };
    const nativeProof = command => {
      const proof = docker(['exec', pgId, 'sh', '-c',
        'set -eu; root="$1"; name="$2"; token="$3"; exec 9<>"$root/$name.lock"; flock -n 9; test "$(cat "$root/$name.status")" = 0; tail -n 1 "$root/$name.stderr"; cat "$root/$name.stdout"',
        'native-chain-proof', root, command.name, operation + '-' + command.name]);
      assert.ok(proof.startsWith('SABALAN_NATIVE_REAPED ' + operation + '-' + command.name + ' 0\n'), proof);
      return proof;
    };
    let receiver, receiverResult, base, endLsn, successful = false;
    const commands = [];
    try {
      await admin.connect();
      const [profile] = (await admin.query(`SELECT (pg_control_system()).system_identifier::text AS "systemIdentifier",
        (pg_control_checkpoint()).timeline_id AS timeline, pg_size_bytes(current_setting('wal_segment_size'))::integer AS "segmentBytes",
        (SELECT sum(pg_database_size(oid))::text FROM pg_database) AS "clusterBytes",
        (SELECT count(*)::integer FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')) AS "externalTablespaces"`)).rows;
      assert.equal(profile.systemIdentifier, '7667464637415309346'); assert.equal(profile.externalTablespaces, 0);
      const available = BigInt(docker(['exec', pgId, 'sh', '-c', 'df -Pk /tmp | tail -1 | awk \'{print $4}\'']).trim()) * 1024n;
      assert.ok(available > BigInt(profile.clusterBytes) * 4n + 2n * 1024n ** 3n);
      await admin.query(`CREATE DATABASE "${databaseName}"`); await writer.connect();
      await writer.query('CREATE TABLE recovery_chain_probe(id text PRIMARY KEY, amount numeric(24,8) NOT NULL, quantity numeric(24,8) NOT NULL)');
      await writer.query("INSERT INTO recovery_chain_probe VALUES('retained','19.50000000','1.00000000')");
      docker(['exec', pgId, 'mkdir', '-m', '700', root]);
      docker(['cp', binaryPath, pgId + ':' + root + '/owner']);
      docker(['exec', pgId, 'chmod', '500', root + '/owner']);
      assert.equal(docker(['exec', pgId, 'sha256sum', root + '/owner']).split(/\s/)[0], sha(binary));
      docker(['exec', pgId, 'mkdir', '-m', '700', root + '/wal']);
      const slots = (await admin.query('SELECT slot_name FROM pg_replication_slots ORDER BY slot_name')).rows;
      await admin.query('SELECT pg_switch_wal()');
      const startLsn = (await admin.query('SELECT pg_current_wal_insert_lsn()::text AS lsn')).rows[0].lsn;
      const end = (postgresLsn(startLsn) / BigInt(profile.segmentBytes) + 8n) * BigInt(profile.segmentBytes);
      const range = { startLsn, endLsn: lsnText(end), timeline: profile.timeline, segmentBytes: profile.segmentBytes };
      endLsn = range.endLsn;
      const names = postgresWalSegments(range); assert.equal(names.length, 8);
      receiver = native('stream', ['pg_receivewal', '-h', '/var/run/postgresql', '-U', 'postgres', '--no-password', '--no-loop', '--synchronous',
        '--directory=' + root + '/wal', '--endpos=' + range.endLsn], namespace + '-stream'); commands.push(receiver);
      receiver.closed.then(value => { receiverResult = value; });
      const deadline = performance.now() + 30000;
      while (!(await admin.query('SELECT pid FROM pg_stat_replication WHERE application_name=$1 AND state=$2', [namespace + '-stream', 'streaming'])).rowCount) {
        assert.equal(receiverResult, undefined); assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 50));
      }
      base = native('base', ['pg_basebackup', '-h', '/var/run/postgresql', '-U', 'postgres', '--no-password', '--pgdata=' + root + '/base',
        '--format=tar', '--compress=client-gzip:1', '--wal-method=fetch', '--manifest-checksums=SHA256', '--max-rate=16M', '--checkpoint=fast', '--no-clean'], namespace + '-base'); commands.push(base);
      const baseResult = await base.closed;
      assert.equal(baseResult.code, 0, baseResult.errors); assert.equal(baseResult.signal, null); nativeProof(base);
      assert.equal(receiverResult, undefined, 'bounded receiver must still cover writes after the base');
      const manifestBytes = docker(['exec', pgId, 'cat', root + '/base/backup_manifest']);
      const manifest = JSON.parse(manifestBytes);
      assert.equal(manifest['PostgreSQL-Backup-Manifest-Version'], 1);
      assert.equal(manifest['WAL-Ranges'].length, 1);
      const baseRange = manifest['WAL-Ranges'][0]; assert.equal(baseRange.Timeline, range.timeline);
      assert.ok(postgresLsn(baseRange['Start-LSN']) >= postgresLsn(range.startLsn));
      assert.ok(postgresLsn(baseRange['End-LSN']) < end);
      await writer.query("UPDATE recovery_chain_probe SET amount='123456789.12345678', quantity='0.00000001' WHERE id='retained'");
      const committedLsn = (await writer.query('SELECT pg_current_wal_flush_lsn()::text AS lsn')).rows[0].lsn;
      assert.ok(postgresLsn(committedLsn) > postgresLsn(baseRange['End-LSN']) && postgresLsn(committedLsn) < end);
      while (postgresLsn((await admin.query('SELECT pg_current_wal_insert_lsn()::text AS lsn')).rows[0].lsn) < end) await admin.query('SELECT pg_switch_wal()');
      const completed = await receiver.closed; assert.equal(completed.code, 0, completed.errors); assert.equal(completed.signal, null); nativeProof(receiver);
      const segments = names.map(name => ({ name, bytes: Number(docker(['exec', pgId, 'stat', '-c', '%s', root + '/wal/' + name]).trim()),
        sha256: docker(['exec', pgId, 'sha256sum', root + '/wal/' + name]).split(/\s/)[0] }));
      assert.ok(segments.every(row => row.bytes === range.segmentBytes));
      const checked = native('records', ['pg_waldump', '-q', '-p', root + '/wal', '-s', range.startLsn, '-e', range.endLsn], namespace + '-records'); commands.push(checked);
      assert.equal((await checked.closed).code, 0); nativeProof(checked);
      const listing = docker(['exec', pgId, 'tar', '-tzf', root + '/base/base.tar.gz']).trim().split('\n');
      assert.ok(listing.length > 0 && listing.length <= 250000);
      for (const item of listing) {
        const clean = item.replace(/^\.\//, '').replace(/\/$/, '');
        assert.ok(clean && !clean.startsWith('/') && !clean.includes('\\') && !clean.split('/').some(row => !row || row === '.' || row === '..'));
      }
      const types = docker(['exec', pgId, 'tar', '-tvzf', root + '/base/base.tar.gz']).trim().split('\n');
      assert.ok(types.every(row => ['-', 'd'].includes(row[0])), 'links and special archive members forbidden');
      docker(['exec', pgId, 'mkdir', '-m', '700', root + '/verified']);
      const extract = native('extract', ['tar', '-xzf', root + '/base/base.tar.gz', '-C', root + '/verified'], namespace + '-extract'); commands.push(extract);
      assert.equal((await extract.closed).code, 0); nativeProof(extract);
      docker(['exec', pgId, 'sh', '-c',
        'set -eu; if test -e "$1/verified/backup_manifest"; then cmp "$1/base/backup_manifest" "$1/verified/backup_manifest"; else cp "$1/base/backup_manifest" "$1/verified/backup_manifest"; fi; sync', 'bind-manifest', root]);
      const verified = native('verify', ['pg_verifybackup', root + '/verified'], namespace + '-verify'); commands.push(verified);
      assert.equal((await verified.closed).code, 0); assert.match(nativeProof(verified), /backup successfully verified/);
      assert.deepEqual((await writer.query('SELECT * FROM recovery_chain_probe')).rows, [{ id: 'retained', amount: '123456789.12345678', quantity: '0.00000001' }]);
      assert.deepEqual((await admin.query('SELECT slot_name FROM pg_replication_slots ORDER BY slot_name')).rows, slots);
      assert.equal((await admin.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name LIKE $1', [namespace + '%'])).rows[0].count, 0);
      assert.deepEqual(identities(), before);
      const archiveSha256 = docker(['exec', pgId, 'sha256sum', root + '/base/base.tar.gz']).split(/\s/)[0];
      const archiveBytes = Number(docker(['exec', pgId, 'stat', '-c', '%s', root + '/base/base.tar.gz']).trim());
      const result = { nativeBaseStreamChainPassed: true, operation, namespace, databaseName, root, source: profile, range, segments,
        committedLsn, expected: { id: 'retained', amount: '123456789.12345678', quantity: '0.00000001' }, baseRange,
        archiveSha256, archiveBytes, manifestSha256: sha(Buffer.from(manifestBytes)), binarySha256: sha(binary),
        fixtureSha256: sha(fs.readFileSync(import.meta.filename)), canonicalBeforeAndAfter: before,
        limits: ['local physical component only', 'unencrypted private source retained', 'independent replay and coherent application recovery not yet established'] };
      fs.writeFileSync(path.join(repository, 'reports/qa/base-stream-chain-' + operation + '.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
      successful = true;
    } finally {
      // Never kill an unknown native command or drop its source database.
      // Native guards enforce their own bounded read-only child lifetimes.
      const failures = [];
      if (receiver && !receiverResult) {
        try {
          // Permit the bounded read-only receiver to reach its natural end even
          // when a preceding assertion failed. Never terminate SQL or a client.
          for (let attempt = 0; attempt < 8; attempt++) {
            const current = (await admin.query('SELECT pg_current_wal_insert_lsn()::text AS lsn')).rows[0].lsn;
            if (postgresLsn(current) >= postgresLsn(endLsn)) break;
            await admin.query('SELECT pg_switch_wal()');
          }
        } catch (error) { failures.push(error); }
      }
      for (const command of commands) {
        try { await command.closed; nativeProof(command); } catch (error) { failures.push(error); }
      }
      try { await writer.end(); } catch (error) { failures.push(error); }
      try {
        if (successful && !failures.length) {
          assert.equal((await admin.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name LIKE $1', [namespace + '%'])).rows[0].count, 0);
          await admin.query(`DROP DATABASE "${databaseName}"`);
        }
      } finally { await admin.end(); }
      if (failures.length) throw new AggregateError(failures, 'NATIVE_BASE_CHAIN_COMPLETION_UNPROVEN');
    }
  });
