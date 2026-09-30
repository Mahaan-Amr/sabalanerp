import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const pointerPath = root => path.join(root, '.deploy-state', 'biometric-configuration.json');

export function validateWorkstations(value, allowEmpty = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (!allowEmpty && !Object.keys(value).length)) throw new Error('Invalid workstation configuration.');
  const validateKey = key => {
    if (typeof key !== 'string' || Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key) throw new Error('Invalid workstation key.');
  };
  for (const [id, config] of Object.entries(value)) {
    if (!safeId.test(id) || !config || Object.keys(config).sort().join(',') !== 'activeTransportKeyId,commandSecretBase64,transportKeysBase64') throw new Error('Invalid workstation fields.');
    validateKey(config.commandSecretBase64);
    if (!safeId.test(config.activeTransportKeyId) || !config.transportKeysBase64 || Array.isArray(config.transportKeysBase64) || !Object.hasOwn(config.transportKeysBase64, config.activeTransportKeyId)) throw new Error('Invalid transport configuration.');
    for (const [keyId, key] of Object.entries(config.transportKeysBase64)) {
      if (!safeId.test(keyId)) throw new Error('Invalid transport key identifier.');
      validateKey(key);
    }
  }
  return value;
}

export function replaceWorkstations(environment, workstations) {
  const matches = environment.split(/\r?\n/).filter(line => /^BIOMETRIC_WORKSTATIONS_JSON=/.test(line));
  if (matches.length > 1) throw new Error('Duplicate workstation environment setting.');
  const replacement = `BIOMETRIC_WORKSTATIONS_JSON='${JSON.stringify(validateWorkstations(workstations, true))}'`;
  return matches.length ? environment.replace(/^BIOMETRIC_WORKSTATIONS_JSON=.*$/m, replacement) : `${environment.replace(/\s*$/, '')}\n${replacement}\n`;
}

function atomicWrite(file, value) {
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  if (process.platform !== 'win32') {
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
}

function readState(root) {
  const pointer = JSON.parse(fs.readFileSync(pointerPath(root), 'utf8'));
  const bytes = fs.readFileSync(pointer.snapshotPath);
  if (!/^[a-f0-9]{64}$/.test(pointer.snapshotHash) || hash(bytes) !== pointer.snapshotHash) throw new Error('Configuration recovery snapshot integrity failed.');
  const state = JSON.parse(bytes);
  if (state.root !== path.resolve(root) || !safeId.test(state.deploymentId) || state.environmentPath !== pointer.environmentPath) throw new Error('Configuration recovery snapshot binding failed.');
  validateWorkstations(state.previous, true);
  validateWorkstations(state.candidate);
  return { pointer, state };
}

export function prepareConfiguration(root, environmentPath, provisioningPath, deploymentId, backend) {
  root = path.resolve(root);
  environmentPath = fs.realpathSync(environmentPath);
  if (!safeId.test(deploymentId)) throw new Error('Invalid configuration deployment identifier.');
  if (fs.existsSync(pointerPath(root))) throw new Error('Unfinished configuration release requires recovery.');
  const entries = Object.fromEntries(backend.Config.Env.map(value => { const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)]; }));
  const previous = validateWorkstations(JSON.parse(entries.BIOMETRIC_WORKSTATIONS_JSON || '{}'), true);
  const incoming = validateWorkstations(JSON.parse(fs.readFileSync(provisioningPath, 'utf8')));
  const candidate = { ...previous };
  for (const [id, config] of Object.entries(incoming)) {
    if (Object.hasOwn(previous, id)) throw new Error('Workstation already registered; rotation requires a separate workflow.');
    candidate[id] = config;
  }
  const coordination = backend.Mounts.find(mount => mount.Destination === entries.RECOVERY_COORDINATION_DIR && mount.RW);
  if (!coordination || !path.isAbsolute(coordination.Source)) throw new Error('Writable protected recovery coordination mount is required.');
  const directory = path.join(fs.realpathSync(coordination.Source), 'biometric-configuration');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const snapshotPath = path.join(directory, `${deploymentId}.json`);
  const originalEnvironment = fs.readFileSync(environmentPath, 'utf8');
  const candidateEnvironment = replaceWorkstations(originalEnvironment, candidate);
  const state = { root, deploymentId, environmentPath, originalEnvironment, candidateEnvironment, previous, candidate };
  const bytes = JSON.stringify(state);
  const descriptor = fs.openSync(snapshotPath, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  if (process.platform !== 'win32') {
    const directoryDescriptor = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  }
  fs.mkdirSync(path.dirname(pointerPath(root)), { recursive: true, mode: 0o700 });
  atomicWrite(pointerPath(root), JSON.stringify({ snapshotPath, snapshotHash: hash(bytes), environmentPath }));
}

export function configurationExports(root, previous = false) {
  const { state } = readState(root);
  return `export BIOMETRIC_WORKSTATIONS_JSON=${shellQuote(JSON.stringify(previous ? state.previous : state.candidate))}`;
}

export function persistConfiguration(root, previous = false) {
  const { state } = readState(root);
  const current = fs.readFileSync(state.environmentPath, 'utf8');
  if (current !== state.originalEnvironment && current !== state.candidateEnvironment) throw new Error('Production environment changed concurrently; refusing configuration promotion or recovery.');
  atomicWrite(state.environmentPath, previous ? state.originalEnvironment : state.candidateEnvironment);
}

export function cleanupConfiguration(root) {
  const { pointer } = readState(root);
  // The verified encrypted checkpoint retains the old configuration for disaster recovery.
  fs.unlinkSync(pointerPath(root));
  fs.unlinkSync(pointer.snapshotPath);
}

export function markTrafficMayOpen(root) {
  const { pointer } = readState(root);
  atomicWrite(pointerPath(root), JSON.stringify({ ...pointer, trafficMayBeOpen: true }));
}

export function configurationRecoveryState(root, deploymentId) {
  const { pointer, state } = readState(root);
  if (state.deploymentId !== deploymentId) throw new Error('Configuration recovery belongs to a different deployment session.');
  return pointer.trafficMayBeOpen === true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, root, ...args] = process.argv.slice(2);
  try {
    if (command === 'prepare') prepareConfiguration(root, ...args, JSON.parse(fs.readFileSync(0, 'utf8'))[0]);
    else if (command === 'exports') process.stdout.write(configurationExports(root, args[0] === 'previous'));
    else if (command === 'persist') persistConfiguration(root, args[0] === 'previous');
    else if (command === 'cleanup') cleanupConfiguration(root);
    else if (command === 'mark-open') markTrafficMayOpen(root);
    else if (command === 'recovery-state') process.stdout.write(configurationRecoveryState(root, args[0]) ? 'open' : 'closed');
    else throw new Error('Unknown configuration command.');
  } catch {
    // Never emit key-bearing JSON, original environment bytes or JSON parser excerpts.
    console.error('Biometric configuration operation failed; protected state retained for recovery.');
    process.exitCode = 1;
  }
}
