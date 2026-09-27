import { spawnSync } from 'node:child_process';

const probe = `const { scanHiringFile } = require('./dist/services/hrHiringFileStorage');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const status = await scanHiringFile('/etc/hosts');
  console.log('antivirus-status=' + status);
  if (status !== 'CLEAN') process.exitCode = 1;
  if (process.exitCode) return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clamav-check-'));
  try {
    const sample = path.join(directory, 'test.txt');
    const marker = ['X5O!P%@AP[4', String.fromCharCode(92), 'PZX54(P^)7CC)7}',
      '$EICAR-', 'STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');
    fs.writeFileSync(sample, marker);
    let rejected = false;
    try { await scanHiringFile(sample); } catch { rejected = true; }
    console.log('antivirus-test-file-rejected=' + rejected);
    if (!rejected) process.exitCode = 1;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('antivirus-probe-failed=' + error.message);
  process.exitCode = 2;
});`;

const result = spawnSync('docker', [
  'compose', '-f', 'docker-compose.local.yml', 'exec', '-T', 'backend', 'node', '-e', probe,
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: false,
  timeout: 70_000,
});

if (result.error) throw result.error;
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
