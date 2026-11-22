import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

// Execute the actual backend Dockerfile's boundary COPY clause against the
// retained dependency image. No service is created or application started;
// this verifies packaging, not a complete production image/release build.
const root = path.resolve(import.meta.dirname, '..');
function verify() {
  const output = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
const backendRow = verify().find(row => row.Service === 'backend');
verify(); const backend = JSON.parse(execFileSync('docker', ['inspect', backendRow.Name], { encoding: 'utf8' }))[0];
verify(); const image = JSON.parse(execFileSync('docker', ['image', 'inspect', backend.Image], { encoding: 'utf8' }))[0];
const reference = image.RepoDigests.find(value => value.endsWith('@' + backend.Image)); assert.ok(reference);
const clause = fs.readFileSync(path.join(root, 'backend/Dockerfile'), 'utf8').split(/\r?\n/)
  .filter(line => line.startsWith('COPY ') && line.includes('deploy/scripts/online-backend-boundary.py'));
assert.equal(clause.length, 1); assert.ok(clause[0].includes('deploy/scripts/online-inquiry-boundary.py'));
const sourceFiles = clause[0].split(/\s+/).slice(1, -1);
assert.equal(clause[0].split(/\s+/).at(-1), './scripts/');
const operation = randomBytes(16).toString('hex'), directory = path.resolve('D:/sabalanerp-online-qa/backend-boundary-image-' + operation);
const capacity = fs.statfsSync(path.dirname(directory), { bigint: true }); assert.ok(capacity.bavail * capacity.bsize > 1024n ** 3n);
fs.mkdirSync(directory); fs.mkdirSync(path.join(directory, 'deploy')); fs.mkdirSync(path.join(directory, 'deploy/scripts'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), hashes = {};
for (const name of sourceFiles) {
  assert.match(name, /^deploy\/scripts\/[a-z-]+[.]py$/);
  const bytes = fs.readFileSync(path.join(root, name));
  fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' }); hashes[path.basename(name)] = sha(bytes);
}
const probe = `import ast,hashlib,json\nfrom pathlib import Path\np=Path('/app/scripts')\nexpected=json.loads(Path('/app/expected.json').read_text())\nfor name,sha in expected.items():\n raw=(p/name).read_bytes()\n assert hashlib.sha256(raw).hexdigest()==sha\n ast.parse(raw)\nassert (p/'online-inquiry-boundary.py').is_file()\n`;
fs.writeFileSync(path.join(directory, 'expected.json'), JSON.stringify(hashes), { flag: 'wx' });
fs.writeFileSync(path.join(directory, 'probe.py'), probe, { flag: 'wx' });
fs.writeFileSync(path.join(directory, 'Dockerfile'), `FROM ${reference}\nWORKDIR /app\n${clause[0]}\nCOPY expected.json probe.py /app/\nRUN python3 -I -B /app/probe.py\n`, { flag: 'wx' });
const tag = 'sabalanerp-online-backend-packaging:' + operation;
verify();
const child = spawn('docker', ['build', '--pull=false', '--tag', tag, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes.toString(); if (output.length < 1048576) process.stdout.write(bytes); });
const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
fs.writeFileSync(path.join(directory, 'build.log'), output, { flag: 'wx' });
assert.deepEqual(result, { code: 0, signal: null });
verify(); const built = JSON.parse(execFileSync('docker', ['image', 'inspect', tag], { encoding: 'utf8' }))[0];
const report = { operation, directory, image: built.Id, base: backend.Image, actualDockerfileCopyClause: clause[0],
  sourceHashes: hashes, copiedBytesAndPythonSyntaxVerified: true, fullProductionBuild: false, productionAdmission: false };
fs.writeFileSync(path.join(root, 'reports/qa/backend-boundary-image-' + operation + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
