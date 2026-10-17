import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';

const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const reportPath = process.env.ONLINE_PHYSICAL_CHAIN_REPORT;
const repository = path.resolve(import.meta.dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verify() {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(JSON.parse); }
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
}
function docker(args, options = {}) { verify(); return execFileSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 ** 2, ...options }); }
const closed = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
function identities() {
  return JSON.parse(docker(['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(name => 'sabalanerp-local-' + name + '-1')]))
    .map(row => ({ id: row.Id, image: row.Image, startedAt: row.State.StartedAt }));
}

test('native verified base and WAL are copied privately on-host and durably sealed in bounded chunks',
  { skip: !canonical || !reportPath, timeout: 240000 }, async () => {
    const proofBytes = fs.readFileSync(path.resolve(repository, reportPath)), proof = JSON.parse(proofBytes);
    const helper = fs.readFileSync(path.join(repository, 'tests/online-deployment/seal-physical-chain.fixture.cjs'));
    assert.equal(proof.nativeBaseStreamChainPassed && proof.temporaryDatabaseDroppedWithoutForce, true);
    assert.match(proof.operation, /^[a-f0-9]{32}$/);
    assert.equal(proof.root, '/tmp/sabalan-pgchain-' + proof.operation);
    const before = identities(); assert.deepEqual(before, proof.canonicalBeforeAndAfter);
    const [candidate] = JSON.parse(docker(['inspect', 'sabalanerp-local-backend-candidate-1']));
    assert.ok(candidate.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
    assert.equal(candidate.Mounts.find(row => row.Destination === '/app/online-runtime-acceptance')?.Name, 'sabalanerp-local_online_runtime_acceptance');
    const root = '/app/online-runtime-acceptance/base-stream-chain-' + proof.operation;
    const expected = [{ source: 'base/base.tar.gz', name: 'base.tar.gz', bytes: proof.archiveBytes, sha256: proof.archiveSha256 },
      { source: 'base/backup_manifest', name: 'backup_manifest', bytes: null, sha256: proof.manifestSha256 },
      ...proof.segments.map(row => ({ source: 'wal/' + row.name, name: 'wal/' + row.name, bytes: row.bytes, sha256: row.sha256 }))];
    assert.equal(proof.segments.length, 8);
    for (const row of expected) {
      assert.ok(['base/base.tar.gz', 'base/backup_manifest'].includes(row.source) || /^wal\/[0-9A-F]{24}$/.test(row.source));
      assert.match(row.sha256, /^[a-f0-9]{64}$/);
      const size = Number(docker(['exec', before[3].id, 'stat', '-c', '%s', proof.root + '/' + row.source]).trim());
      if (row.bytes === null) { assert.ok(size > 0 && size <= 32 * 1024 ** 2); row.bytes = size; }
      else assert.equal(size, row.bytes);
    }
    fs.writeFileSync(path.join(repository, 'reports/qa/physical-chain-seal-' + proof.operation + '-intent.json'),
      JSON.stringify({ root, sourceProofSha256: sha(proofBytes), helperSha256: sha(helper), fixtureSha256: sha(fs.readFileSync(import.meta.filename)), expected }) + '\n', { flag: 'wx' });
    docker(['exec', '-i', candidate.Id, 'node', '-e',
      "const fs=require('fs'),v=JSON.parse(fs.readFileSync(0));process.umask(0o077);fs.mkdirSync(v.root,{mode:0o700});fs.mkdirSync(v.root+'/wal',{mode:0o700});fs.writeFileSync(v.root+'/source-proof.json',Buffer.from(v.proof,'base64'),{flag:'wx',mode:0o400});fs.writeFileSync(v.root+'/seal-physical-chain.fixture.cjs',Buffer.from(v.helper,'base64'),{flag:'wx',mode:0o400});for(const name of ['test-local-rollback-key','independent-public.pem']){fs.copyFileSync(v.authority+'/'+name,v.root+'/'+name,fs.constants.COPYFILE_EXCL);fs.chmodSync(v.root+'/'+name,0o400)}"],
    { input: JSON.stringify({ root, proof: proofBytes.toString('base64'), helper: helper.toString('base64'), authority: '/app/online-runtime-acceptance/wal-stream-f7e6da7d707c0e4fe990747263afa2b4' }) });
    const receive = `import hashlib,json,os,pathlib,stat,sys,tarfile
root=pathlib.Path(sys.argv[1]);expected={row['source']:row for row in json.loads(sys.argv[2])};seen=set()
assert root.resolve(strict=True)==root and root.stat().st_uid==os.getuid() and not root.stat().st_mode&0o077
total=sum(row['bytes'] for row in expected.values());copied=0
def capacity():
 value=os.statvfs(root)
 assert value.f_bavail*value.f_frsize >= (total-copied)+total+64*1024**2+512*1024**2,'PRIVATE_COPY_CAPACITY_REQUIRED'
capacity()
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|') as archive:
 for member in archive:
  assert member.name in expected and member.name not in seen and member.isfile() and not member.issym() and not member.islnk()
  row=expected[member.name];assert member.size==row['bytes'];seen.add(member.name)
  target=root/row['name'];assert target.parent.resolve(strict=True)==target.parent
  fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);digest=hashlib.sha256();count=0
  try:
   with archive.extractfile(member) as source:
    while chunk:=source.read(262144):
     count+=len(chunk);copied+=len(chunk);assert count<=row['bytes'];capacity();digest.update(chunk);offset=0
     while offset<len(chunk):
      written=os.write(fd,chunk[offset:]);assert written>0;offset+=written
   assert count==row['bytes'] and digest.hexdigest()==row['sha256'];os.fsync(fd)
  finally:os.close(fd)
assert seen==set(expected)
for item in [root/'wal',root,root.parent]:
 fd=os.open(item,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
print(json.dumps({'privateSourceFilesVerified':len(seen)}))`;
    verify();
    const producer = spawn('docker', ['exec', before[3].id, 'tar', '-C', proof.root, '-cf', '-', ...expected.map(row => row.source)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const producerClosed = closed(producer);
    verify();
    const consumer = spawn('docker', ['exec', '-i', candidate.Id, 'python3', '-c', receive, root, JSON.stringify(expected)], { stdio: ['pipe', 'pipe', 'pipe'] });
    const consumerClosed = closed(consumer);
    let errors = '', output = '';
    for (const child of [producer, consumer]) child.stderr.on('data', bytes => { assert.ok(errors.length + bytes.length < 65536); errors += bytes; });
    consumer.stdout.on('data', bytes => { assert.ok(output.length + bytes.length < 65536); output += bytes; });
    const outcomes = await Promise.allSettled([pipeline(producer.stdout, consumer.stdin), producerClosed, consumerClosed]);
    for (const outcome of outcomes) assert.equal(outcome.status, 'fulfilled', String(outcome.reason));
    for (const outcome of outcomes.slice(1)) assert.deepEqual(outcome.value, { code: 0, signal: null }, errors);
    assert.equal(JSON.parse(output).privateSourceFilesVerified, expected.length);
    const sealed = JSON.parse(docker(['exec', candidate.Id, 'sh', '-c',
      'set -eu; umask 077; exec 9>>"$1/seal.lock"; flock -n 9; exec node "$1/seal-physical-chain.fixture.cjs" "$1" "$2"', 'seal-physical-component', root, sha(proofBytes)]));
    assert.equal(sealed.phase, 'SEALED'); assert.equal(sealed.operation, proof.operation);
    assert.equal(sealed.sourceProofSha256, sha(proofBytes));
    assert.equal(sealed.independentPublicKeySha256, '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af');
    assert.equal(sealed.localKeyIsTestAuthority, true);
    assert.equal(sealed.files.length, expected.length + 1);
    for (const item of sealed.files) {
      assert.equal(item.chunks.reduce((sum, row) => sum + row.rawBytes, 0), item.bytes);
      assert.ok(item.chunks.every(row => row.rawBytes > 0 && row.rawBytes <= 16 * 1024 ** 2 && row.localDecryptVerified === true));
    }
    const durable = JSON.parse(docker(['exec', candidate.Id, 'node', '-e', "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))", root + '/sealed/seal-state.json']));
    assert.deepEqual(durable, sealed); assert.deepEqual(identities(), before);
    fs.writeFileSync(path.join(repository, 'reports/qa/physical-chain-sealed-' + proof.operation + '.json'),
      JSON.stringify({ privatePhysicalChainSealed: true, root, sealed, fixtureSha256: sha(fs.readFileSync(import.meta.filename)), helperSha256: sha(helper),
        limits: ['local test-cluster component with test local key', 'independent reassembly, replay and coherent application recovery still required'] }, null, 2) + '\n', { flag: 'wx' });
  });
