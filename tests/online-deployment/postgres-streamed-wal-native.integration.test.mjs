import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { postgresLsn, postgresWalSegments } from '../../scripts/postgres-recovery-coverage.mjs';

const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const reports = process.env.ONLINE_WAL_CAPTURE_REPORTS?.split(';').filter(Boolean);
const repository = path.resolve(import.meta.dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verify() {
  const text = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(text); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = text.trim().split(/\r?\n/).map(JSON.parse); }
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
}
function docker(args, options = {}) { verify(); return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, ...options }); }
function identities() {
  return JSON.parse(docker(['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(name => 'sabalanerp-local-' + name + '-1')]))
    .map(row => ({ id: row.Id, image: row.Image, startedAt: row.State.StartedAt }));
}
function closed(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

test('native PostgreSQL checks actual streamed WAL records and rejects modified CRC bytes',
  { skip: !canonical || !reports?.length, timeout: 120000 }, async () => {
    const before = identities(), proofs = [];
    for (const reportPath of reports) {
      const bytes = fs.readFileSync(path.resolve(repository, reportPath));
      const report = JSON.parse(bytes);
      assert.equal(report.nativeWalReceiverPassed, true);
      assert.deepEqual(report.canonicalBeforeAndAfter, before);
      const capture = report.observations.find(row => row.captured)?.captured;
      assert.equal(capture?.phase, 'COMPLETE');
      assert.equal(capture.nativeReaped && capture.databaseQuiet, true);
      assert.equal(capture.nativeStatus, 0);
      assert.match(capture.namespace, /^sabalan-wal-[a-f0-9]{32}$/);
      const operation = capture.namespace.slice('sabalan-wal-'.length);
      const root = '/app/online-runtime-acceptance/wal-stream-' + operation;
      const range = { startLsn: capture.startLsn, endLsn: capture.endLsn,
        timeline: capture.source.timeline, segmentBytes: capture.source.segmentBytes };
      const names = postgresWalSegments(range);
      assert.deepEqual(capture.segments.map(row => row.name), names);
      const [slot] = JSON.parse(docker(['inspect', 'sabalanerp-local-backend-candidate-1']));
      assert.equal(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'), true);
      assert.equal(slot.Mounts.find(row => row.Destination === '/app/online-runtime-acceptance')?.Name, 'sabalanerp-local_online_runtime_acceptance');
      // Re-open durable state and actual private files; the prior JSON PASS alone
      // cannot establish byte identity for this independent native check.
      const observed = JSON.parse(docker(['exec', slot.Id, 'python3', '-c',
        `import fcntl,hashlib,json,os,pathlib,stat,sys
root=pathlib.Path(sys.argv[1]);assert root.resolve(strict=True)==root
assert root.stat().st_uid==os.getuid() and not root.stat().st_mode&0o077
lock=os.open(root/'receiver.lock',os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
state=json.loads((root/'capture-state.json').read_text());cfg=(root/'configuration.json').read_bytes()
assert state['phase']=='COMPLETE' and state['nativeReaped'] and state['databaseQuiet'] and state['nativeStatus']==0
assert state['configurationSha256']==hashlib.sha256(cfg).hexdigest()
files=[]
for row in state['segments']:
 assert len(row['name'])==24 and all(c in '0123456789ABCDEF' for c in row['name'])
 item=root/'wal'/row['name'];fd=os.open(item,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  a=os.fstat(fd);assert stat.S_ISREG(a.st_mode) and a.st_nlink==1 and a.st_uid==os.getuid() and not a.st_mode&0o077 and a.st_size==row['bytes']
  h=hashlib.sha256()
  while chunk:=os.read(fd,262144):h.update(chunk)
  b=os.fstat(fd);n=item.lstat();assert (a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns) and (n.st_dev,n.st_ino)==(a.st_dev,a.st_ino)
  assert h.hexdigest()==row['sha256'];files.append(row)
 finally:os.close(fd)
print(json.dumps({'state':state,'files':files}))`, root]));
      assert.deepEqual(observed.state, capture);
      assert.deepEqual(observed.files, capture.segments);
      const pgId = before[3].id;
      const nativeVersion = docker(['exec', pgId, 'pg_waldump', '--version']).trim();
      assert.match(nativeVersion, /PostgreSQL\) 15\./);
      const target = docker(['exec', pgId, 'sh', '-c', 'umask 077; mktemp -d /tmp/sabalan-streamed-wal-XXXXXX']).trim();
      assert.match(target, /^\/tmp\/sabalan-streamed-wal-[a-zA-Z0-9]{6}$/);
      let passed = false;
      try {
        // Raw cluster-private bytes remain on the same local Docker host. They
        // stream through memory; no plaintext Windows file or second PG service.
        verify();
        const producer = spawn('docker', ['exec', slot.Id, 'tar', '-C', root + '/wal', '-cf', '-', ...names], { stdio: ['ignore', 'pipe', 'pipe'] });
        const producerClosed = closed(producer);
        verify();
        const consumer = spawn('docker', ['exec', '-i', pgId, 'tar', '-C', target, '-xf', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
        const consumerClosed = closed(consumer);
        const errors = [];
        for (const child of [producer, consumer]) child.stderr.on('data', value => {
          assert.ok(errors.reduce((sum, row) => sum + row.length, 0) + value.length < 65536);
          errors.push(value);
        });
        const outcomes = await Promise.allSettled([pipeline(producer.stdout, consumer.stdin), producerClosed, consumerClosed]);
        for (const outcome of outcomes) assert.equal(outcome.status, 'fulfilled', String(outcome.reason));
        assert.deepEqual(outcomes[1].value, { code: 0, signal: null }, Buffer.concat(errors).toString());
        assert.deepEqual(outcomes[2].value, { code: 0, signal: null }, Buffer.concat(errors).toString());
        for (const segment of capture.segments) {
          assert.equal(docker(['exec', pgId, 'sha256sum', target + '/' + segment.name]).split(/\s/)[0], segment.sha256);
          assert.equal(Number(docker(['exec', pgId, 'stat', '-c', '%s', target + '/' + segment.name]).trim()), range.segmentBytes);
        }
        docker(['exec', pgId, 'pg_waldump', '-q', '-p', target, '-s', range.startLsn, '-e', range.endLsn]);
        const first = docker(['exec', pgId, 'pg_waldump', '-n', '1', '-p', target, '-s', range.startLsn, '-e', range.endLsn]);
        const found = first.match(/lsn:\s*([0-9A-F]+\/[0-9A-F]+)/i);
        assert.ok(found, 'actual records required, not an empty valid range');
        const firstLsn = found[1].split('/').map(row => BigInt('0x' + row).toString(16).toUpperCase()).join('/');
        const firstValue = postgresLsn(firstLsn);
        const name = postgresWalSegments({ ...range, startLsn: firstLsn })[0];
        const offset = Number(firstValue % BigInt(range.segmentBytes)) + 20;
        assert.ok(offset % 8192 <= 8188, 'fixture CRC must not cross a WAL page header');
        const original = Buffer.from(docker(['exec', slot.Id, 'python3', '-c',
          "import pathlib,sys;f=(pathlib.Path(sys.argv[1])/'wal'/sys.argv[2]).open('rb');f.seek(int(sys.argv[3]));print(f.read(4).hex())", root, name, String(offset)]).trim(), 'hex');
        assert.equal(original.length, 4);
        const corrupt = Buffer.from(original); corrupt[0] ^= 1;
        docker(['exec', '-i', pgId, 'dd', 'of=' + target + '/' + name, 'bs=1', 'seek=' + offset, 'count=4', 'conv=notrunc'], { input: corrupt });
        verify();
        const rejected = spawnSync('docker', ['exec', pgId, 'pg_waldump', '-q', '-p', target, '-s', firstLsn, '-e', range.endLsn], { encoding: 'utf8', timeout: 30000 });
        assert.equal(rejected.error, undefined); assert.equal(rejected.signal, null);
        assert.equal(rejected.status, 1); assert.match(rejected.stderr, /incorrect resource manager data checksum/i);
        assert.deepEqual(identities(), before);
        proofs.push({ captureReport: reportPath, captureReportSha256: sha(bytes), namespace: capture.namespace,
          nativeVersion, segments: capture.segments, completeNativeRangeVerified: true, firstRecordLsn: firstLsn,
          modifiedRecordCrcRejected: true, privateRawCopy: target, privateCopyRemovedAfterSuccess: true });
        passed = true;
      } finally {
        if (passed) docker(['exec', pgId, 'sh', '-c',
          'set -eu; case "$1" in /tmp/sabalan-streamed-wal-??????) ;; *) exit 1;; esac; test -d "$1"; test ! -L "$1"; rm -rf -- "$1"', 'owned-native-wal-cleanup', target]);
      }
    }
    assert.deepEqual(identities(), before);
    const result = { streamedWalNativeValidationPassed: true, proofs, canonicalBeforeAndAfter: before,
      fixtureSha256: sha(fs.readFileSync(import.meta.filename)),
      limits: ['native streamed-WAL component only', 'no base replay, encryption, independent restore or production admission'] };
    fs.writeFileSync(path.join(repository, 'reports/qa/streamed-wal-native-' + randomBytes(8).toString('hex') + '.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  });
