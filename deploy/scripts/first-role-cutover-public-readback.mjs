import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdtempSync, openSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFirstRoleHostLock, readFirstRolePrivateFile } from './first-role-cutover-host-environment.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hostname = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const reject = () => { throw new Error('FIRST_ROLE_ROLLBACK_PUBLIC_READBACK_FAILED'); };

export function checkFirstRolePublicOrigins(hosts, observe = origin => execFileSync('curl', [
  '--disable', '--noproxy', '*', '--proto', '=https', '--connect-timeout', '5', '--max-time', '12', '--silent', '--show-error',
  '--output', '/dev/null', '--write-out', '%{http_code} %{ssl_verify_result}', '--', `${origin}/`,
], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] })) {
  if (hosts.length !== 2 || hosts[0] === hosts[1] || hosts.some(host => !hostname.test(host))) reject();
  return hosts.map(host => {
    const origin = `https://${host}`;
    if (observe(origin) !== '200 0') reject();
    return { origin, httpStatus: 200, tlsVerified: true };
  });
}

function capture(root, reportDir, hosts) {
  assertFirstRoleHostLock(root);
  const load = file => readFirstRolePrivateFile(path.join(reportDir, file)).bytes;
  const { purpose, phase, deploymentId, releaseId, targetCommit } = JSON.parse(load('active-deployment-session.json'));
  if (purpose !== 'first-database-role-cutover' || phase !== 'ROLLBACK_STARTED' || !/^[A-Za-z0-9_-]{1,160}$/.test(deploymentId)) reject();
  const intentFile = 'first-role-cutover-open-intent.json';
  const intent = load(intentFile);
  const opening = JSON.parse(intent);
  if (opening.outcome !== 'ROLLED_BACK' || opening.deploymentId !== deploymentId || opening.releaseId !== releaseId
    || opening.targetCommit !== targetCommit) reject();
  const origins = checkFirstRolePublicOrigins(hosts);
  assertFirstRoleHostLock(root);
  if (!load(intentFile).equals(intent)) reject();
  const proof = { format: 'sabalan-first-role-rollback-public/v1', deploymentId, releaseId, targetCommit, intentSha256: hash(intent),
    observedAt: new Date().toISOString(), origins };
  const output = path.join(reportDir, `first-role-rollback-public-${deploymentId}.json`);
  try {
    lstatSync(output);
    // Custody of an existing proof is validated before a controller retry.
    const previous = JSON.parse(readFirstRolePrivateFile(output).bytes);
    if (previous.intentSha256 !== proof.intentSha256 || previous.deploymentId !== deploymentId || previous.releaseId !== releaseId
      || previous.targetCommit !== targetCommit || JSON.stringify(previous.origins) !== JSON.stringify(origins)) reject();
    const age = Date.now() - Date.parse(previous.observedAt);
    if (!Number.isFinite(age) || age < 0) reject();
    if (age <= 45_000) return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const tmp = mkdtempSync(path.join(reportDir, '.first-role-public-'));
  const staged = path.join(tmp, 'readback.json');
  try {
    const fd = openSync(staged, 'wx', 0o400);
    try { writeFileSync(fd, `${JSON.stringify(proof)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(staged, output);
    const dir = openSync(reportDir, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally {
    try { unlinkSync(staged); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    rmdirSync(tmp);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6) reject();
    const [root, reportDir, ...hosts] = process.argv.slice(2);
    capture(root, reportDir, hosts);
  } catch {
    console.error('The exact restored release could not be read back on both public HTTPS origins.');
    process.exitCode = 1;
  }
}
