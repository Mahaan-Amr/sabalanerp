import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { postgresLsn, postgresWalSegments } from '../../scripts/postgres-recovery-coverage.mjs';

const { Client } = createRequire(import.meta.url)('pg');
const repository = path.resolve(import.meta.dirname, '../..');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const source = process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verify() {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(JSON.parse); }
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
}
function docker(args, options = {}) { verify(); return execFileSync('docker', args, { encoding: 'utf8', ...options }); }
function identities() {
  return JSON.parse(docker(['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(name => 'sabalanerp-local-' + name + '-1')]))
    .map(row => ({ id: row.Id, image: row.Image, startedAt: row.State.StartedAt }));
}

for (const loseClient of [false, true]) test('native slot-free WAL streaming captures committed work' + (loseClient ? ' after exec-client loss' : ' with normal acknowledgement'),
  { skip: !canonical || !source, timeout: 120000 }, async () => {
    const receiver = fs.readFileSync(path.join(repository, 'deploy/scripts/receive-postgres-wal.py'));
    const before = identities();
    const url = new URL(source);
    assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(url.host)); assert.equal(url.pathname, '/sabalanerp');
    const operation = randomBytes(16).toString('hex'), databaseName = 'sabalanerp_concurrency_' + operation.slice(0, 16);
    url.pathname = '/postgres'; const administrator = new Client({ connectionString: url.toString() });
    url.pathname = '/' + databaseName; const writer = new Client({ connectionString: url.toString() });
    const root = '/app/online-runtime-acceptance/wal-stream-' + operation;
    const namespace = 'sabalan-wal-' + operation;
    const replicationUser = 'sabalan_wal_' + operation, password = randomBytes(32).toString('hex');
    const salt = randomBytes(16), salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
    const clientKey = createHmac('sha256', salted).update('Client Key').digest();
    const storedKey = createHash('sha256').update(clientKey).digest('base64');
    const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
    const verifier = 'SCRAM-SHA-256$4096:' + salt.toString('base64') + '$' + storedKey + ':' + serverKey;
    const observations = [];
    let created = false, roleCreated = false, successful = false, hba, candidateId, roleOid;
    let receiverClosed;
    const reloadHba = async () => {
      const previous = (await administrator.query('SELECT pg_conf_load_time()::text AS value')).rows[0].value;
      assert.equal((await administrator.query('SELECT pg_reload_conf() AS ok')).rows[0].ok, true);
      const deadline = performance.now() + 5000;
      while (!(await administrator.query('SELECT pg_conf_load_time()>$1::timestamptz AS fresh', [previous])).rows[0].fresh) {
        assert.ok(performance.now() < deadline, 'configuration reload must be observed');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal((await administrator.query('SELECT error FROM pg_hba_file_rules WHERE error IS NOT NULL')).rowCount, 0);
    };
    const launcher = `import json,os,pathlib,re,sys,time
from urllib.parse import urlsplit,urlunsplit
root=pathlib.Path(sys.argv[1]); configuration=json.loads((root/'configuration.json').read_text())
name=configuration['databaseName']; assert re.fullmatch(r'sabalanerp_concurrency_[a-f0-9]{16}',name)
source=urlsplit(os.environ['DATABASE_URL']); assert source.hostname=='postgres' and source.port==5432 and source.path=='/sabalanerp'
os.environ['DATABASE_URL']=urlunsplit((source.scheme,source.netloc,'/'+name,source.query,''))
${loseClient ? `with (root/'launcher-ready').open('x') as stream:
 stream.write('ready');stream.flush();os.fsync(stream.fileno())
deadline=time.monotonic()+30
while not (root/'launcher-go').exists():
 assert time.monotonic()<deadline
 time.sleep(0.02)
` : ''}
os.execv(sys.executable,[sys.executable,str(root/'receive-postgres-wal.py'),str(root/'configuration.json')])
`;
    const completionProof = () => {
      verify();
      const result = spawnSync('docker', ['exec', candidateId, 'python3', '-c',
        `import fcntl,hashlib,json,os,pathlib,stat,sys
try:
 root=pathlib.Path(sys.argv[1]); assert root.resolve(strict=True)==root
 state=root/'capture-state.json';fd=os.open(state,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_uid==os.getuid() and not before.st_mode&0o077 and 0<before.st_size<=65536
  record=json.loads(os.read(fd,65537));after=os.fstat(fd);named=os.lstat(state)
  assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
  assert (named.st_dev,named.st_ino)==(before.st_dev,before.st_ino)
 finally:os.close(fd)
 cfg_bytes=(root/'configuration.json').read_bytes();cfg=json.loads(cfg_bytes)
 assert record['phase'] in ['COMPLETE','FAILED'] and record['nativeReaped'] is True and record['databaseQuiet'] is True
 assert record['namespace']==cfg['namespace'] and record['configurationSha256']==hashlib.sha256(cfg_bytes).hexdigest()
 assert all(record['source'][key]==cfg[key] for key in ['databaseName','databaseOid','systemIdentifier','timeline','segmentBytes'])
 lock=root/'receiver.lock';fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW);held=os.fstat(fd);named=os.lstat(lock)
 assert stat.S_ISREG(held.st_mode) and held.st_nlink==1 and held.st_uid==os.getuid() and not held.st_mode&0o022 and (held.st_dev,held.st_ino)==(named.st_dev,named.st_ino)
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 print(json.dumps(record))
except Exception:
 print('WAL_CAPTURE_NATIVE_COMPLETION_UNPROVEN',file=sys.stderr);sys.exit(75)`, root], { encoding: 'utf8' });
      assert.equal(result.error, undefined); assert.equal(result.signal, null);
      return result;
    };
    fs.writeFileSync(path.join(repository, 'reports/qa/wal-receiver-' + operation + '-intent.json'),
      JSON.stringify({ databaseName, root, receiverSha256: sha(receiver), fixtureSha256: sha(fs.readFileSync(import.meta.filename)), canonical: before }) + '\n', { flag: 'wx' });
    try {
      await administrator.connect(); await administrator.query(`CREATE DATABASE "${databaseName}"`); created = true;
      await administrator.query(`CREATE ROLE "${replicationUser}" LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '${verifier}'`);
      roleCreated = true;
      const [role] = (await administrator.query('SELECT oid::text AS oid,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls,rolreplication,rolcanlogin,rolconnlimit FROM pg_roles WHERE rolname=$1', [replicationUser])).rows;
      roleOid = role.oid;
      assert.equal(role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolinherit || role.rolbypassrls, false);
      assert.equal(role.rolreplication && role.rolcanlogin, true); assert.equal(role.rolconnlimit, 2);
      await writer.connect(); await writer.query('CREATE TABLE wal_probe(id text PRIMARY KEY, amount numeric(24,8), quantity numeric(24,8))');
      const slotsBefore = (await administrator.query('SELECT slot_name FROM pg_replication_slots ORDER BY slot_name')).rows;
      const [profile] = (await writer.query(`SELECT current_database() AS "databaseName",d.oid::text AS "databaseOid",
        c.system_identifier::text AS "systemIdentifier",(pg_control_checkpoint()).timeline_id AS timeline,
        pg_size_bytes(current_setting('wal_segment_size'))::integer AS "segmentBytes"
        FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database()`)).rows;
      await administrator.query('SELECT pg_switch_wal()');
      const startLsn = (await writer.query('SELECT pg_current_wal_insert_lsn()::text AS lsn')).rows[0].lsn;
      const end = (postgresLsn(startLsn) / BigInt(profile.segmentBytes) + 1n) * BigInt(profile.segmentBytes);
      const endLsn = (end >> 32n).toString(16).toUpperCase() + '/' + (end & 0xffffffffn).toString(16).toUpperCase();
      const range = { ...profile, startLsn, endLsn }, names = postgresWalSegments(range); assert.equal(names.length, 1);
      const [slot] = JSON.parse(docker(['inspect', 'sabalanerp-local-backend-candidate-1']));
      candidateId = slot.Id;
      assert.equal(slot.Image, before[0].image); assert.ok(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
      assert.equal(slot.Mounts.find(row => row.Destination === '/app/online-runtime-acceptance')?.Name, 'sabalanerp-local_online_runtime_acceptance');
      docker(['exec', '-i', slot.Id, 'node', '-e',
        "const fs=require('fs'),v=JSON.parse(fs.readFileSync(0));fs.mkdirSync(v.root,{mode:0o700});fs.writeFileSync(v.root+'/receive-postgres-wal.py',Buffer.from(v.receiver,'base64'),{flag:'wx',mode:0o400});fs.writeFileSync(v.root+'/configuration.json',JSON.stringify(v.configuration),{flag:'wx',mode:0o400});fs.writeFileSync(v.root+'/replication-password',v.password,{flag:'wx',mode:0o400});fs.writeFileSync(v.root+'/launch.py',v.launcher,{flag:'wx',mode:0o400});"],
      { input: JSON.stringify({ root, password, launcher, receiver: receiver.toString('base64'), configuration: { root, namespace, replicationUser, ...range } }) });
      const networks = Object.values(slot.NetworkSettings.Networks);
      assert.equal(networks.length, 1); const ip = networks[0].IPAddress;
      assert.match(ip, /^(?:\d{1,3}\.){3}\d{1,3}$/);
      const row = `host replication ${replicationUser} ${ip}/32 scram-sha-256 # wal-fixture-${operation}`;
      const hbaPath = (await administrator.query('SHOW hba_file')).rows[0].hba_file;
      assert.equal(hbaPath, docker(['exec', before[3].id, 'sh', '-c', 'printf "%s/pg_hba.conf" "$PGDATA"']));
      const hbaDirectory = path.posix.dirname(hbaPath) + '/.sabalan-wal-auth-' + operation;
      const [pgContainer] = JSON.parse(docker(['inspect', before[3].id]));
      const persistent = pgContainer.Mounts.find(row => row.Type === 'volume' && row.RW
        && (path.posix.dirname(hbaPath) === row.Destination || hbaPath.startsWith(row.Destination + '/')));
      assert.ok(persistent?.Name, 'HBA recovery bytes must survive PostgreSQL container recreation');
      const originalMetadata = docker(['exec', before[3].id, 'stat', '-c', '%u:%g:%a', hbaPath]).trim();
      assert.match(originalMetadata, /^\d+:\d+:[0-7]{3,4}$/);
      assert.equal(parseInt(originalMetadata.split(':')[2], 8) & 0o022, 0);
      const originalHash = docker(['exec', before[3].id, 'sh', '-c', 'set -eu; test ! -L "$PGDATA/pg_hba.conf"; sha256sum "$PGDATA/pg_hba.conf"']).split(/\s/)[0];
      assert.match(originalHash, /^[a-f0-9]{64}$/);
      const installedHash = docker(['exec', before[3].id, 'sh', '-c',
        'set -eu; target="$PGDATA/pg_hba.conf"; test "$(sha256sum "$target" | cut -d " " -f 1)" = "$3"; umask 077; mkdir -m 700 "$1"; chown "$(stat -c %u:%g "$PGDATA")" "$1"; cp -p "$target" "$1/original"; cp -p "$target" "$1/prepared"; printf "\\n%s\\n" "$2" >>"$1/prepared"; sha256sum "$1/original" "$1/prepared" >"$1/prepared-sha256"; chown "$(stat -c %u:%g "$PGDATA")" "$1/prepared-sha256"; sync; sha256sum "$1/prepared"',
        'owned-wal-hba-install', hbaDirectory, row, originalHash, operation]).split(/\s/)[0];
      assert.match(installedHash, /^[a-f0-9]{64}$/);
      hba = { directory: hbaDirectory, persistentVolume: persistent.Name, originalHash, installedHash, originalMetadata, path: hbaPath, exactRole: replicationUser, exactIp: ip };
      const committedHash = docker(['exec', before[3].id, 'sh', '-c',
        'set -eu; target="$PGDATA/pg_hba.conf"; test ! -L "$target"; test "$(sha256sum "$target" | cut -d " " -f 1)" = "$2"; test "$(sha256sum "$1/prepared" | cut -d " " -f 1)" = "$3"; cp -p "$1/prepared" "$PGDATA/.wal-hba-$4"; sync; mv "$PGDATA/.wal-hba-$4" "$target"; sync; sha256sum "$target"',
        'owned-wal-hba-commit', hbaDirectory, originalHash, installedHash, operation]).split(/\s/)[0];
      assert.equal(committedHash, installedHash); hba.committed = true;
      await reloadHba();
      assert.equal((await administrator.query("SELECT line_number FROM pg_hba_file_rules WHERE $1=ANY(user_name) AND 'replication'=ANY(database)", [replicationUser])).rowCount, 1);
      verify();
      const process = spawn('docker', ['exec', slot.Id, 'sh', '-c',
        'set -eu; umask 077; exec 9>>"$1/receiver.lock"; flock --nonblock 9; exec python3 "$1/launch.py" "$1"',
        'native-wal-stream', root], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = '', terminal;
      process.stdout.on('data', bytes => { assert.ok(Buffer.byteLength(output) + bytes.length < 1024 * 1024); output += bytes; });
      process.stderr.on('data', bytes => { assert.ok(Buffer.byteLength(error) + bytes.length < 1024 * 1024); error += bytes; });
      const closed = new Promise((resolve, reject) => { process.once('error', reject); process.once('close', (code, signal) => { terminal = { code, signal }; resolve(terminal); }); });
      receiverClosed = closed;
      if (loseClient) {
        const readyDeadline = performance.now() + 10000;
        while (docker(['exec', candidateId, 'node', '-e', "process.stdout.write(String(require('fs').existsSync(process.argv[1])))", root + '/launcher-ready']).trim() !== 'true') {
          assert.equal(terminal, undefined, error); assert.ok(performance.now() < readyDeadline);
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal((await administrator.query('SELECT count(*)::integer AS count FROM pg_stat_replication WHERE application_name=$1', [namespace])).rows[0].count, 0);
        process.kill('SIGTERM'); const lost = await closed; assert.ok(lost.code !== 0 || lost.signal);
        const refused = completionProof(); assert.equal(refused.status, 75); assert.ok(refused.stderr.includes('WAL_CAPTURE_NATIVE_COMPLETION_UNPROVEN'));
        docker(['exec', candidateId, 'node', '-e', "require('fs').writeFileSync(process.argv[1],'go',{flag:'wx',mode:0o600})", root + '/launcher-go']);
        observations.push({ dockerExecClientLostBeforeReceiverStart: true, emptySenderSnapshotDidNotAuthorizeCleanup: true });
      }
      const deadline = performance.now() + 30000;
      while (!(await administrator.query('SELECT pid FROM pg_stat_replication WHERE application_name=$1 AND state=$2 AND usename=$3 AND host(client_addr)=$4', [namespace, 'streaming', replicationUser, ip])).rowCount) {
        if (!loseClient) assert.equal(terminal, undefined, 'receiver exited before streaming: ' + error);
        assert.ok(performance.now() < deadline, 'actual replication must become visible');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await writer.query("INSERT INTO wal_probe VALUES('committed','123456789.12345678','0.00000001')");
      const committedLsn = (await writer.query('SELECT pg_current_wal_flush_lsn()::text AS lsn')).rows[0].lsn;
      await administrator.query('SELECT pg_switch_wal()');
      const outcome = await closed;
      if (!loseClient) { assert.equal(outcome.code, 0, error); assert.equal(outcome.signal, null); }
      let proven;
      const completeDeadline = performance.now() + 30000;
      while ((proven = completionProof()).status !== 0) {
        assert.ok(performance.now() < completeDeadline, 'native completion evidence/lock must become available');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const result = JSON.parse(proven.stdout); assert.equal(result.phase, 'COMPLETE'); assert.equal(result.nativeStatus, 0);
      if (!loseClient) assert.deepEqual(JSON.parse(output.trim()), result);
      assert.equal(result.namespace, namespace); assert.deepEqual(result.segments.map(row => row.name), names);
      assert.ok(postgresLsn(committedLsn) > postgresLsn(startLsn) && postgresLsn(committedLsn) < postgresLsn(endLsn));
      assert.deepEqual((await writer.query('SELECT * FROM wal_probe')).rows, [{ id: 'committed', amount: '123456789.12345678', quantity: '0.00000001' }]);
      assert.deepEqual((await administrator.query('SELECT slot_name FROM pg_replication_slots ORDER BY slot_name')).rows, slotsBefore);
      assert.equal((await administrator.query('SELECT count(*)::integer AS count FROM pg_stat_replication WHERE application_name=$1', [namespace])).rows[0].count, 0);
      observations.push({ committedLsn, captured: result, replicationSlotsUnchanged: true, nativeReceiverExitedNaturally: true, dockerExecClient: outcome,
        temporaryLeastPrivilegeReplicationRole: replicationUser, temporaryExactIpScramHba: hba });
      assert.deepEqual(identities(), before); successful = true;
    } finally {
      const cleanupErrors = []; let nativeClosed = !receiverClosed;
      try {
        if (receiverClosed) {
          // Finish the bounded read-only stream before changing credentials.
          // No SQL backend or application request is terminated.
          await administrator.query('SELECT pg_switch_wal()'); await receiverClosed;
          const proof = completionProof(); assert.equal(proof.status, 0, proof.stderr);
          assert.equal((await administrator.query('SELECT count(*)::integer AS count FROM pg_stat_replication WHERE application_name=$1', [namespace])).rows[0].count, 0);
          nativeClosed = true;
        }
        if (hba && nativeClosed) {
          assert.equal(hba.committed, true, 'uncertain HBA commit requires inspection');
          const restoredHash = docker(['exec', before[3].id, 'sh', '-c',
            'set -eu; target="$PGDATA/pg_hba.conf"; test ! -L "$target"; test "$(sha256sum "$target" | cut -d " " -f 1)" = "$3"; test "$(sha256sum "$1/original" | cut -d " " -f 1)" = "$2"; cp -p "$1/original" "$PGDATA/.wal-hba-restore-$4"; sync; mv "$PGDATA/.wal-hba-restore-$4" "$target"; sync; sha256sum "$target"',
            'owned-wal-hba-restore', hba.directory, hba.originalHash, hba.installedHash, operation]).split(/\s/)[0];
          assert.equal(restoredHash, hba.originalHash); hba.restoredHash = restoredHash;
          assert.equal(docker(['exec', before[3].id, 'stat', '-c', '%u:%g:%a', hba.path]).trim(), hba.originalMetadata);
          await reloadHba();
          assert.equal((await administrator.query("SELECT line_number FROM pg_hba_file_rules WHERE $1=ANY(user_name) AND 'replication'=ANY(database)", [replicationUser])).rowCount, 0);
          const denied = JSON.parse(docker(['exec', candidateId, 'python3', '-c',
            `import json,os,pathlib,subprocess,sys
from urllib.parse import urlsplit,unquote
root=pathlib.Path(sys.argv[1]); cfg=json.loads((root/'configuration.json').read_text()); uri=urlsplit(os.environ['DATABASE_URL'])
env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
env.update(PGHOST=uri.hostname,PGPORT=str(uri.port or 5432),PGUSER=cfg['replicationUser'],PGPASSWORD=(root/'replication-password').read_text(),PGAPPNAME=cfg['namespace']+'-denied',PGCONNECT_TIMEOUT='5')
directory=root/'denied-wal';directory.mkdir(mode=0o700)
value=subprocess.run(['/usr/lib/postgresql/15/bin/pg_receivewal','--directory='+str(directory),'--endpos='+cfg['endLsn'],'--no-password','--no-loop','--synchronous'],env=env,stdin=subprocess.DEVNULL,capture_output=True,timeout=10)
print(json.dumps({'code':value.returncode,'hbaDenied':b'no pg_hba.conf entry for replication' in value.stderr}))`, root]));
          assert.equal(denied.code, 1); assert.equal(denied.hbaDenied, true);
          assert.equal((await administrator.query('SELECT count(*)::integer AS count FROM pg_stat_replication WHERE application_name=$1', [namespace + '-denied'])).rows[0].count, 0);
          observations.push({ originalHbaRestored: true, freshReplicationConnectionDeniedAfterRestore: true });
        }
      } catch (error) { cleanupErrors.push(error); }
      if (roleCreated) {
        try {
          assert.equal((await administrator.query('SELECT oid::text AS oid FROM pg_roles WHERE rolname=$1', [replicationUser])).rows[0]?.oid, roleOid);
          // A conflicting/uncertain HBA cleanup keeps its evidence and disables
          // only this owned temporary LOGIN; it never overwrites another edit.
          if (cleanupErrors.length || !nativeClosed) await administrator.query(`ALTER ROLE "${replicationUser}" NOLOGIN`);
          else await administrator.query(`DROP ROLE "${replicationUser}"`);
        } catch (error) {
          cleanupErrors.push(error);
          try {
            if ((await administrator.query('SELECT oid::text AS oid FROM pg_roles WHERE rolname=$1', [replicationUser])).rows[0]?.oid === roleOid) {
              await administrator.query(`ALTER ROLE "${replicationUser}" NOLOGIN`);
            }
          } catch (disableError) { cleanupErrors.push(disableError); }
        }
      }
      try { await writer.end(); } catch (error) { cleanupErrors.push(error); }
      try {
        if (created && successful && !cleanupErrors.length) { verify(); await administrator.query(`DROP DATABASE "${databaseName}"`); }
      } catch (error) { cleanupErrors.push(error); }
      finally { await administrator.end(); }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'OWNED_WAL_FIXTURE_CLEANUP_UNPROVEN');
    }
    assert.deepEqual(identities(), before);
    const report = { nativeWalReceiverPassed: true, databaseName, temporaryDatabaseDroppedWithoutForce: true,
      observations, canonicalBeforeAndAfter: before, receiverSha256: sha(receiver), fixtureSha256: sha(fs.readFileSync(import.meta.filename)),
      limits: ['physical WAL includes cluster-private data; private artifacts retained', 'native bounded WAL component, not continuous coherent recovery publication', 'no independent restore or production admission'] };
    fs.writeFileSync(path.join(repository, 'reports/qa/wal-receiver-' + operation + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  });
