import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import envelope from '../../backend/scripts/system-recovery-envelope.cjs';
import { selectQARecoveryTarget, verifyQAforegroundConsumer } from './system-recovery-owner-qa.mjs';

const root = '/opt/sabalanerp';
const operationId = /^c[a-z0-9]{24}$/;
const rejected = () => Error('SYSTEM_RECOVERY_OWNER_HOST_REJECTED');

export function recoveryMutationWithinBudget(started, now = process.hrtime.bigint()) {
  return typeof started === 'bigint' && started >= 0n && now >= started && now - started < 900_000_000_000n;
}

export function assertOwnedRecoveryContainer(container, expected) {
  if (!/^[a-f0-9]{64}$/.test(container?.Id || '') || container.Name !== '/' + expected.name || container.Image !== expected.image
    || container.Config?.Labels?.['com.docker.compose.project'] !== 'sabalanerp'
    || container.Config.Labels['com.docker.compose.service'] !== 'deployment'
    || container.Config.Labels['io.sabalan.deployment.id'] !== expected.deploymentId
    || JSON.stringify(container.Config.Cmd) !== JSON.stringify(['sh', 'scripts/with-backend-control-ownership.sh',
      'node', 'dist/scripts/system-recovery-owner.js', '--sealed', expected.operationId, 'RESTORE'])) throw rejected();
  return container.Id;
}

function stopOwnedContainer(name, image, deploymentId, id) {
  requireNativeRoot();
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || !/^sha256:[a-f0-9]{64}$/.test(image)
    || !/^deploy-[A-Za-z0-9_-]{1,120}$/.test(deploymentId) || !operationId.test(id)) throw rejected();
  const [container] = JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', timeout: 10000 }));
  const exact = assertOwnedRecoveryContainer(container, { name, image, deploymentId, operationId: id });
  // A timeout is unknown completion, never permission to roll back. The caller
  // must additionally reap Compose and prove native runtime closure.
  execFileSync('docker', ['stop', '--time', '30', exact], { timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function decodeOwnerInbox(id, bytes, privateKey) {
  if (!operationId.test(id) || bytes.length > 32768) throw rejected();
  const request = envelope.open(bytes, privateKey);
  if (request.format !== 'sabalan-system-recovery-owner/v1' || request.operationId !== id
    || !/^[a-f0-9]{64}$/.test(request.requestId || '') || !['BACKUP', 'RESTORE'].includes(request.action)
    || !['COMPLETE', 'SANITIZED_TEST'].includes(request.packageType)) throw rejected();
  const input = Buffer.from(JSON.stringify({ request, sealedSha256: createHash('sha256').update(bytes).digest('hex') }));
  if (input.length > 16384) { input.fill(0); throw rejected(); }
  return { action: request.action, input };
}

function requireNativeRoot() {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw rejected();
}

function privateFile(file) {
  if (!file || !file.startsWith('/') || realpathSync(file) !== file) throw rejected();
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o400 || stat.size > 16384) throw rejected();
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

function provision(directory) {
  requireNativeRoot();
  if (!directory.startsWith('/')) throw rejected();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (realpathSync(directory) !== directory || stat.uid !== 0 || (stat.mode & 0o022)) throw rejected();
  const privatePath = join(directory, 'system-recovery-owner-private.pem');
  const publicPath = join(directory, 'system-recovery-owner-public.pem');
  let privateKey;
  try { privateKey = privateFile(privatePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const fd = openSync(privatePath, 'wx', 0o400);
    try { writeFileSync(fd, pair.privateKey); fsyncSync(fd); } finally { closeSync(fd); }
    privateKey = pair.privateKey;
  }
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  try {
    const fd = openSync(publicPath, 'wx', 0o444);
    try { writeFileSync(fd, publicKey); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (error) {
    if (error.code !== 'EEXIST' || readFileSync(publicPath, 'utf8') !== publicKey || realpathSync(publicPath) !== publicPath) throw rejected();
  }
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function recoveryInbox(envFile, keyFile) {
  const qa = process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE || process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256;
  const composeFile = qa ? selectQARecoveryTarget(envFile, keyFile).composeFile : 'docker-compose.prod.yml';
  const compose = ['compose', '--project-name', 'sabalanerp', '--env-file', envFile, '-f', join(root, composeFile)];
  const container = execFileSync('docker', [...compose, 'ps', '-q', 'backend'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{12,64}$/.test(container)) throw rejected();
  const [inspection] = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }));
  if (inspection.Config.Labels['com.docker.compose.project'] !== 'sabalanerp'
    || inspection.Config.Labels['com.docker.compose.service'] !== 'backend') throw rejected();
  const mount = inspection.Mounts.filter(m => m.Type === 'volume' && m.Destination === '/app/storage/recovery');
  if (mount.length !== 1) throw rejected();
  const [volume] = JSON.parse(execFileSync('docker', ['volume', 'inspect', mount[0].Name], { encoding: 'utf8' }));
  if (volume.Labels?.['com.docker.compose.project'] !== 'sabalanerp'
    || volume.Labels?.['com.docker.compose.volume'] !== 'backend_recovery'
    || volume.Mountpoint !== mount[0].Source || realpathSync(volume.Mountpoint) !== volume.Mountpoint) throw rejected();
  return join(volume.Mountpoint, 'owner-inbox');
}

async function consume(envFile, keyFile, watch) {
  requireNativeRoot();
  if (!envFile?.startsWith('/') || realpathSync(envFile) !== envFile || realpathSync(root) !== root) throw rejected();
  const privateKey = privateFile(keyFile);
  do {
    // An uncertain prior child retains its hold. A later consumer never adopts it.
    try { lstatSync(join(root, '.deploy-state/system-recovery-backup-active.json')); throw rejected(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const inbox = recoveryInbox(envFile, keyFile);
    let names;
    try {
      if (realpathSync(inbox) !== inbox || !lstatSync(inbox).isDirectory()) throw rejected();
      names = readdirSync(inbox).filter(name => operationId.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).sort();
    } catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
    for (const name of names) {
      const fd = openSync(join(inbox, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32768 || (stat.mode & 0o077)) throw rejected();
        bytes = readFileSync(fd);
      } finally { closeSync(fd); }
      const id = name.slice(0, -5);
      const decoded = decodeOwnerInbox(id, bytes, privateKey);
      const child = spawn('/bin/sh', [join(root, 'deploy/scripts/deploy.sh'), '--system-recovery-owner', envFile, id, decoded.action],
        { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
      child.stdin.on('error', () => {});
      child.stdin.end(decoded.input, () => decoded.input.fill(0));
      const code = await new Promise((done, fail) => { child.once('error', fail); child.once('close', done); });
      if (code !== 0) throw rejected();
    }
    if (watch) await new Promise(done => setTimeout(done, 5000));
  } while (watch);
}

function serviceUnit(envFile, keyFile) {
  if ([envFile, keyFile].some(value => !/^\/[a-zA-Z0-9/_.-]+$/.test(value || ''))) throw rejected();
  return `[Unit]\nDescription=Sabalan authenticated System Recovery owner consumer\nAfter=docker.service\nRequires=docker.service\n\n[Service]\nType=simple\nUser=root\nWorkingDirectory=${root}\nExecStart=/usr/bin/node ${root}/deploy/scripts/system-recovery-owner-host.mjs consume ${envFile} ${keyFile} --watch\nRestart=on-failure\nRestartSec=30\nStandardInput=null\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function verify(envFile, keyFile) {
  requireNativeRoot();
  if (process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE || process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256) {
    return verifyQAforegroundConsumer(envFile, keyFile);
  }
  const publicKey = createPublicKey(privateFile(keyFile)).export({ type: 'spki', format: 'pem' });
  const publicPath = join(dirname(keyFile), 'system-recovery-owner-public.pem');
  if (realpathSync(publicPath) !== publicPath || readFileSync(publicPath, 'utf8') !== publicKey) throw rejected();
  const unitPath = '/etc/systemd/system/sabalanerp-system-recovery.service';
  const stat = lstatSync(unitPath);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) || readFileSync(unitPath, 'utf8') !== serviceUnit(envFile, keyFile)) throw rejected();
  execFileSync('systemctl', ['is-enabled', '--quiet', 'sabalanerp-system-recovery.service']);
  const state = execFileSync('systemctl', ['show', '--property=ActiveState', '--value', 'sabalanerp-system-recovery.service'], { encoding: 'utf8' }).trim();
  if (!['active', 'activating'].includes(state)) throw rejected();
}

function install(envFile, keyFile) {
  requireNativeRoot();
  privateFile(keyFile);
  const unit = serviceUnit(envFile, keyFile);
  writeFileSync('/etc/systemd/system/sabalanerp-system-recovery.service', unit, { mode: 0o644 });
  execFileSync('systemctl', ['daemon-reload']);
  execFileSync('systemctl', ['enable', '--now', 'sabalanerp-system-recovery.service']);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'provision' && args.length === 1) provision(args[0]);
    else if (command === 'within-budget' && args.length === 1) process.exitCode = recoveryMutationWithinBudget(BigInt(args[0])) ? 0 : 1;
    else if (command === 'stop-owner' && args.length === 4) stopOwnedContainer(...args);
    else if (command === 'install' && args.length === 2) install(...args);
    else if (command === 'verify' && args.length === 2) verify(...args);
    else if (command === 'consume' && (args.length === 2 || (args.length === 3 && args[2] === '--watch'))) await consume(args[0], args[1], args[2] === '--watch');
    else throw rejected();
  } catch { console.error('SYSTEM_RECOVERY_OWNER_HOST_FAILED'); process.exitCode = 1; }
}
