import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const repository = path.resolve(import.meta.dirname, '../..');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const reportPath = process.env.ONLINE_WAL_SEAL_CAPTURE_REPORT;
const publicKeyPath = process.env.ONLINE_WAL_SEAL_PUBLIC_KEY;
const sha = value => createHash('sha256').update(value).digest('hex');
function docker(args, options = {}) {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(JSON.parse); }
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, ...options });
}

test('closed streamed WAL is durably encrypted for retained local and independent RSA authorities',
  { skip: !canonical || !reportPath || !publicKeyPath, timeout: 90000 }, () => {
    // Missing implementation must fail before any Docker or secret creation.
    const helper = fs.readFileSync(path.join(repository, 'deploy/scripts/seal-postgres-wal.cjs'));
    const coverage = fs.readFileSync(path.join(repository, 'scripts/postgres-recovery-coverage.mjs'));
    const bytes = fs.readFileSync(path.resolve(repository, reportPath)), report = JSON.parse(bytes);
    assert.equal(report.nativeWalReceiverPassed, true);
    const capture = report.observations.find(row => row.captured)?.captured;
    assert.match(capture?.namespace, /^sabalan-wal-[a-f0-9]{32}$/);
    const root = '/app/online-runtime-acceptance/wal-stream-' + capture.namespace.slice('sabalan-wal-'.length);
    const [slot] = JSON.parse(docker(['inspect', 'sabalanerp-local-backend-candidate-1']));
    assert.ok(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
    const ids = () => JSON.parse(docker(['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(name => 'sabalanerp-local-' + name + '-1')]))
      .map(row => ({ id: row.Id, image: row.Image, startedAt: row.State.StartedAt }));
    assert.deepEqual(ids(), report.canonicalBeforeAndAfter);
    docker(['exec', '-i', slot.Id, 'node', '-e',
      "const fs=require('fs'),c=require('crypto'),v=JSON.parse(fs.readFileSync(0));process.umask(0o077);fs.mkdirSync(v.root+'/bundle/deploy/scripts',{recursive:true,mode:0o700});fs.mkdirSync(v.root+'/bundle/scripts',{mode:0o700});fs.writeFileSync(v.root+'/bundle/deploy/scripts/seal-postgres-wal.cjs',Buffer.from(v.helper,'base64'),{flag:'wx',mode:0o400});fs.writeFileSync(v.root+'/bundle/scripts/postgres-recovery-coverage.mjs',Buffer.from(v.coverage,'base64'),{flag:'wx',mode:0o400});fs.writeFileSync(v.root+'/test-local-rollback-key',c.randomBytes(48).toString('base64'),{flag:'wx',mode:0o400});fs.writeFileSync(v.root+'/independent-public.pem',v.publicKey,{flag:'wx',mode:0o400});"],
    { input: JSON.stringify({ root, helper: helper.toString('base64'), coverage: coverage.toString('base64'), publicKey: fs.readFileSync(publicKeyPath, 'utf8') }) });
    const output = JSON.parse(docker(['exec', slot.Id, 'sh', '-c',
      'set -eu; exec 9<>"$1/receiver.lock"; flock --nonblock 9; exec node "$1/bundle/deploy/scripts/seal-postgres-wal.cjs" "$1" "$1/test-local-rollback-key" "$1/independent-public.pem"', 'seal-closed-wal', root]));
    assert.equal(output.phase, 'SEALED'); assert.equal(output.namespace, capture.namespace);
    assert.equal(output.independentPublicKeySha256, '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af');
    assert.deepEqual(output.objects.map(row => row.name), ['capture.sabrec', ...capture.segments.map(row => row.name + '.sabrec')]);
    assert.ok(output.objects.every(row => row.localDecryptVerified && row.encryptedBytes > 0 && /^[a-f0-9]{64}$/.test(row.encryptedSha256)));
    const durable = JSON.parse(docker(['exec', slot.Id, 'node', '-e', "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))", root + '/sealed/seal-state.json']));
    assert.deepEqual(durable, output);
    const binding = docker(['exec', slot.Id, 'sha256sum', root + '/capture-state.json']).split(/\s/)[0];
    assert.equal(output.captureSha256, binding);
    assert.deepEqual(ids(), report.canonicalBeforeAndAfter);
    fs.writeFileSync(path.join(repository, 'reports/qa/wal-sealed-' + capture.namespace.slice('sabalan-wal-'.length) + '.json'),
      JSON.stringify({ localWalSealPassed: true, captureReport: reportPath, captureReportSha256: sha(bytes), sealed: output,
        helperSha256: sha(helper), coverageSha256: sha(coverage), fixtureSha256: sha(fs.readFileSync(import.meta.filename)),
        limits: ['local rollback key is retained private test authority, not production key', 'independent RSA decryption and remote equality still required', 'not a continuous coherent recovery point or release admission'] }, null, 2) + '\n', { flag: 'wx' });
  });
