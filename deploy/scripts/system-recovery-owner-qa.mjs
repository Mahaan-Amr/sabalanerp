import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repository = '/opt/sabalanerp';
const custody = '/srv/sabalanerp-qa/system-recovery-owner';
const receiptPath = `${custody}/foreground.json`;
const helper = `${repository}/deploy/scripts/system-recovery-owner-qa.mjs`;
const consumer = `${repository}/deploy/scripts/system-recovery-owner-host.mjs`;
const selector = `${repository}/deploy/scripts/qa-rehearsal-target.mjs`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = () => Error('QA_RECOVERY_FOREGROUND_CONSUMER_UNPROVEN');

function privateRead(filename, mode = 0o400, maximum = 1024 * 1024) {
  if (!filename?.startsWith('/srv/sabalanerp-qa/') || fs.realpathSync(filename) !== filename) throw invalid();
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o777) !== mode || stat.size > maximum) throw invalid();
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function environmentValues(bytes) {
  const values = {};
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const equal = line.indexOf('=');
    if (equal < 1) throw invalid();
    const name = line.slice(0, equal);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || Object.hasOwn(values, name)) throw invalid();
    let value = line.slice(equal + 1);
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

function sourceHash() {
  return hash(Buffer.concat(['system-recovery-owner-qa.mjs', 'system-recovery-owner-host.mjs', 'system-recovery-backup-host.mjs',
    'system-recovery-backup-host.sh', 'deploy.sh', 'qa-rehearsal-target.mjs'].map(name => fs.readFileSync(`${repository}/deploy/scripts/${name}`))));
}

/** Reuse the complete existing approved target selector, including actual
 * Engine/socket/netns/machine, rendered mounts and independent backup checks. */
export function selectQARecoveryTarget(envFile, keyFile) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || fs.realpathSync(repository) !== repository) throw invalid();
  const planFile = process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE;
  const planSha256 = process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256;
  if (!/^[a-f0-9]{64}$/.test(planSha256 || '')) throw invalid();
  const bytes = privateRead(planFile);
  if (hash(bytes) !== planSha256) throw invalid();
  const plan = JSON.parse(bytes);
  const selected = execFileSync(process.execPath, [selector, planFile, planSha256, repository, envFile], {
    cwd: repository, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (selected !== 'docker-compose.rehearsal.yml') throw invalid();
  const envBytes = privateRead(envFile);
  if (hash(envBytes) !== plan.environmentSha256) throw invalid();
  const environment = environmentValues(envBytes);
  if (plan.qaRoot !== '/srv/sabalanerp-qa' || keyFile !== `${environment.DEPLOYMENT_SECRET_DIR}/system-recovery-owner-private.pem`) throw invalid();
  const publicKey = createPublicKey(privateRead(keyFile)).export({ type: 'spki', format: 'pem' });
  const publicPath = `${environment.DEPLOYMENT_SECRET_DIR}/system-recovery-owner-public.pem`;
  if (privateRead(publicPath, 0o444).toString('utf8') !== publicKey) throw invalid();
  return { composeFile: selected, qaOnly: true, productionAdmission: false, planFile, planSha256,
    environmentSha256: plan.environmentSha256, envFile, keyFile, publicKeySha256: hash(publicKey),
    sourceSha256: sourceHash(), nodeExecutable: fs.realpathSync(process.execPath), networkNamespaceIdentity: plan.networkNamespaceIdentity,
    machineId: plan.machineId, engineId: plan.engineId, backupHost: plan.backupHost, productionBackupHost: plan.productionBackupHost };
}

function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw invalid();
  const root = `/proc/${pid}`;
  const stat = fs.readFileSync(`${root}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { pid, birth: fields[19], state: fields[0], parentPid: Number(fields[1]), uid: fs.statSync(root).uid,
    argv: fs.readFileSync(`${root}/cmdline`, 'utf8').split('\0').filter(Boolean),
    executable: fs.readlinkSync(`${root}/exe`), networkNamespaceIdentity: fs.readlinkSync(`${root}/ns/net`) };
}

/** Deterministic receipt seam; live observations always come from /proc and
 * the hash-bound selector in verifyQAforegroundConsumer below. */
export function validateQAforegroundConsumerReceipt(receipt, observed) {
  assert.equal(receipt.format, 'sabalan-qa-recovery-foreground/v1');
  assert.equal(receipt.qaOnly, true);
  assert.equal(receipt.productionAdmission, false);
  assert.equal(receipt.state, 'RUNNING');
  for (const name of ['planFile', 'planSha256', 'environmentSha256', 'envFile', 'keyFile', 'publicKeySha256', 'sourceSha256',
    'nodeExecutable', 'networkNamespaceIdentity', 'machineId', 'engineId', 'backupHost', 'productionBackupHost']) assert.equal(receipt[name], observed.target[name]);
  assert.notEqual(receipt.backupHost, receipt.productionBackupHost);
  const age = observed.now - Date.parse(receipt.heartbeatAt);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= 5000);
  for (const name of ['supervisor', 'consumer']) {
    const expected = receipt[name], actual = observed[name];
    assert.equal(actual.uid, 0);
    assert.ok(['R', 'S', 'D'].includes(actual.state));
    for (const field of ['pid', 'birth', 'executable', 'networkNamespaceIdentity']) assert.equal(expected[field], actual[field]);
    assert.match(actual.birth, /^[1-9][0-9]*$/);
    assert.deepEqual(actual.argv, expected.argv);
    assert.equal(actual.executable, observed.target.nodeExecutable);
    assert.equal(actual.networkNamespaceIdentity, observed.target.networkNamespaceIdentity);
  }
  assert.equal(observed.consumer.parentPid, observed.supervisor.pid);
  assert.deepEqual(observed.supervisor.argv.slice(1), [helper, 'supervise', observed.target.envFile, observed.target.keyFile]);
  assert.deepEqual(observed.consumer.argv, [observed.supervisor.executable, consumer, 'consume', observed.target.envFile, observed.target.keyFile, '--watch']);
}

export function verifyQAforegroundConsumer(envFile, keyFile) {
  const target = selectQARecoveryTarget(envFile, keyFile);
  assertCustodyDirectory();
  const receipt = JSON.parse(privateRead(receiptPath, 0o400, 32768));
  validateQAforegroundConsumerReceipt(receipt, { target, now: Date.now(),
    supervisor: processIdentity(receipt.supervisor?.pid), consumer: processIdentity(receipt.consumer?.pid) });
  return { composeFile: target.composeFile, qaOnly: true, productionAdmission: false };
}

function assertCustodyDirectory() {
  const directory = fs.lstatSync(custody);
  if (fs.realpathSync(custody) !== custody || directory.uid !== 0 || !directory.isDirectory() || (directory.mode & 0o777) !== 0o700) throw invalid();
}

function publish(receipt, initial = false) {
  const temporary = `${custody}/.foreground-${randomBytes(12).toString('hex')}`;
  const descriptor = fs.openSync(initial ? receiptPath : temporary, 'wx', 0o400);
  try { fs.writeFileSync(descriptor, JSON.stringify(receipt) + '\n'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  if (!initial) fs.renameSync(temporary, receiptPath);
  const directory = fs.openSync(custody, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

async function supervise(envFile, keyFile) {
  const target = selectQARecoveryTarget(envFile, keyFile);
  fs.mkdirSync(custody, { recursive: true, mode: 0o700 });
  assertCustodyDirectory();
  const supervisor = processIdentity(process.pid);
  assert.deepEqual(supervisor.argv.slice(1), [helper, 'supervise', envFile, keyFile]);
  let child;
  let stopped = false;
  let settled = false;
  let outcome;
  const receipt = { format: 'sabalan-qa-recovery-foreground/v1', ...target, state: 'STARTING', supervisor,
    heartbeatAt: new Date().toISOString() };
  publish(receipt, true); // Refuse an existing descriptor; never adopt an unknown prior supervisor.
  try {
    child = spawn('/bin/sh', ['-c', 'kill -STOP $$; exec "$@"', 'sabalan-recovery-qa-start',
      supervisor.executable, consumer, 'consume', envFile, keyFile, '--watch'],
    { cwd: repository, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
    outcome = new Promise((resolveOutcome, rejectOutcome) => {
      child.once('error', error => { settled = true; rejectOutcome(error); });
      child.once('exit', (code, signal) => { settled = true; resolveOutcome({ code, signal }); });
    });
    outcome.catch(() => {}); // Startup observation may throw before awaiting a spawn failure.
    for (let attempt = 0; attempt < 200; attempt++) {
      if (settled) throw invalid();
      if (processIdentity(child.pid).state === 'T') break;
      if (attempt === 199) throw invalid();
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    const identity = processIdentity(child.pid);
    receipt.consumer = { ...identity, state: 'S', executable: supervisor.executable,
      argv: [supervisor.executable, consumer, 'consume', envFile, keyFile, '--watch'] };
    receipt.state = 'RUNNING';
    receipt.heartbeatAt = new Date().toISOString();
    publish(receipt);
    child.kill('SIGCONT');
    const terminate = () => { stopped = true; child.kill('SIGTERM'); child.kill('SIGCONT'); };
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    signals.forEach(signal => process.once(signal, terminate));
    const heartbeat = setInterval(() => {
      try {
        if (sourceHash() !== target.sourceSha256) throw invalid();
        receipt.heartbeatAt = new Date().toISOString();
        publish(receipt);
      } catch { terminate(); }
    }, 1000);
    let result;
    try { result = await outcome; }
    finally { clearInterval(heartbeat); signals.forEach(signal => process.removeListener(signal, terminate)); }
    if (!stopped || result.code !== null) throw invalid();
    receipt.state = 'STOPPED';
    receipt.heartbeatAt = new Date().toISOString();
    publish(receipt);
  } catch (error) {
    receipt.state = 'FAILED';
    receipt.heartbeatAt = new Date().toISOString();
    publish(receipt);
    if (child && !settled) { child.kill('SIGKILL'); child.kill('SIGCONT'); }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [command, envFile, keyFile, ...extra] = process.argv.slice(2);
  try {
    if (extra.length || !envFile || !keyFile) throw invalid();
    if (command === 'supervise') await supervise(envFile, keyFile);
    else if (command === 'verify') verifyQAforegroundConsumer(envFile, keyFile);
    else if (command === 'select') process.stdout.write(selectQARecoveryTarget(envFile, keyFile).composeFile + '\n');
    else throw invalid();
  } catch { console.error('QA_RECOVERY_FOREGROUND_CONSUMER_UNPROVEN'); process.exitCode = 1; }
}
