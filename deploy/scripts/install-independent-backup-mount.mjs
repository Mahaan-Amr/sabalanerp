import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const independentBackupMount = '/mnt/sabalanerp-independent-recovery';
const marker = '# Managed by Sabalan independent recovery transport.\n';

export function renderIndependentBackupMount({ host, keyFile, knownHostsFile }) {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host)
    || host.includes('..') || host.endsWith('.')) throw new Error('BACKUP_MOUNT_HOST_INVALID');
  for (const file of [keyFile, knownHostsFile]) {
    if (typeof file !== 'string' || !/^\/root\/\.ssh\/[a-zA-Z0-9_.-]+$/.test(file)) throw new Error('BACKUP_MOUNT_KEY_PATH_INVALID');
  }
  return `${marker}[Unit]
Description=Sabalan independent encrypted checkpoint transport
Wants=network-online.target
After=network-online.target

[Mount]
What=sabalan-backup@${host}:/checkpoints
Where=${independentBackupMount}
Type=fuse.sshfs
Options=_netdev,IdentityFile=${keyFile},UserKnownHostsFile=${knownHostsFile},StrictHostKeyChecking=yes,BatchMode=yes,IdentitiesOnly=yes,reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,allow_other,default_permissions
TimeoutSec=45

[Install]
WantedBy=remote-fs.target
`;
}

export function assertActiveBackupTransport(processes, configuration) {
  const expected = new Map([
    ['IdentityFile', configuration.keyFile], ['UserKnownHostsFile', configuration.knownHostsFile],
    ['StrictHostKeyChecking', 'yes'], ['BatchMode', 'yes'], ['IdentitiesOnly', 'yes'],
    ['reconnect', undefined], ['ServerAliveInterval', '15'], ['ServerAliveCountMax', '3'],
    ['allow_other', undefined], ['default_permissions', undefined],
    ['_netdev', undefined], ['rw', undefined], ['relatime', undefined], ['user_id', '0'], ['group_id', '0'],
  ]);
  const matching = processes.filter(process => process.argv.includes(independentBackupMount)
    && process.argv.includes(`sabalan-backup@${configuration.host}:/checkpoints`));
  if (matching.length !== 1 || matching[0].uid !== 0 || matching[0].executable !== '/usr/bin/sshfs') {
    throw new Error('BACKUP_MOUNT_ACTIVE_SETTINGS_UNPROVEN');
  }
  const options = new Map();
  const args = matching[0].argv.slice(1);
  for (let index = 0; index < args.length; index++) {
    if ([independentBackupMount, `sabalan-backup@${configuration.host}:/checkpoints`, '-f', '-s'].includes(args[index])) continue;
    if (args[index] !== '-o' || !args[index + 1]) throw new Error('BACKUP_MOUNT_ACTIVE_SETTINGS_UNPROVEN');
    for (const option of args[++index].split(',')) {
      const [key, ...rest] = option.split('=');
      const value = rest.length ? rest.join('=') : undefined;
      if (!expected.has(key) || expected.get(key) !== value || options.has(key)) throw new Error('BACKUP_MOUNT_ACTIVE_SETTINGS_UNPROVEN');
      options.set(key, value);
    }
  }
  for (const key of ['IdentityFile', 'UserKnownHostsFile', 'StrictHostKeyChecking', 'BatchMode', 'IdentitiesOnly']) {
    if (!options.has(key)) throw new Error('BACKUP_MOUNT_ACTIVE_SETTINGS_UNPROVEN');
  }
}

function activeSshfsProcesses() {
  const processes = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const directory = `/proc/${entry}`;
      const executable = fs.readlinkSync(`${directory}/exe`);
      if (executable !== '/usr/bin/sshfs') continue;
      processes.push({ executable, uid: fs.statSync(directory).uid,
        argv: fs.readFileSync(`${directory}/cmdline`, 'utf8').split('\0').filter(Boolean) });
    } catch { /* Process exited or belongs to an unrelated inaccessible identity. */ }
  }
  return processes;
}

export function installIndependentBackupMount(configuration) {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('BACKUP_MOUNT_ROOT_REQUIRED');
  const content = renderIndependentBackupMount(configuration);
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const [file, privateKey] of [[configuration.keyFile, true], [configuration.knownHostsFile, false]]) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.uid !== 0 || fs.realpathSync(file) !== file || (stat.mode & (privateKey ? 0o077 : 0o022))) {
      throw new Error('BACKUP_MOUNT_KEY_CUSTODY_INVALID');
    }
  }
  run('ssh-keygen', ['-F', configuration.host, '-f', configuration.knownHostsFile]);
  run('sshfs', ['--version']);
  const name = run('systemd-escape', ['--path', '--suffix=mount', independentBackupMount]);
  const unit = `/etc/systemd/system/${name}`;
  if (fs.existsSync(unit) && (!fs.lstatSync(unit).isFile() || !fs.readFileSync(unit, 'utf8').startsWith(marker))) {
    throw new Error('BACKUP_MOUNT_FOREIGN_UNIT');
  }
  const verifyMount = (required) => {
    let value;
    try { value = JSON.parse(run('findmnt', ['--mountpoint', independentBackupMount, '--json', '--output', 'TARGET,SOURCE,FSTYPE'])).filesystems?.[0]; }
    catch (error) { if (error.status !== 1) throw error; }
    if (!value) { if (required) throw new Error('BACKUP_MOUNT_NOT_ACTIVE'); return false; }
    if (value.target !== independentBackupMount || value.source !== `sabalan-backup@${configuration.host}:/checkpoints`
      || value.fstype !== 'fuse.sshfs') throw new Error('BACKUP_MOUNT_IDENTITY_MISMATCH');
    assertActiveBackupTransport(activeSshfsProcesses(), configuration);
    return true;
  };
  verifyMount(false);
  if (!fs.existsSync(independentBackupMount)) fs.mkdirSync(independentBackupMount, { mode: 0o700 });
  if (fs.lstatSync(independentBackupMount).isSymbolicLink()) throw new Error('BACKUP_MOUNT_PATH_INVALID');
  const temporaryDirectory = fs.mkdtempSync('/run/sabalan-mount-');
  try {
    const staged = path.join(temporaryDirectory, name);
    fs.writeFileSync(staged, content, { mode: 0o644, flag: 'wx' });
    run('systemd-analyze', ['verify', staged]);
    const temporary = `${unit}.${randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o644);
    try { fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, unit);
    const directory = fs.openSync(path.dirname(unit), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    run('systemctl', ['daemon-reload']);
    run('systemctl', ['enable', name]);
    run('systemctl', ['start', name]);
    run('systemctl', ['is-active', '--quiet', name]);
    verifyMount(true);
    return { unit: name, source: `sabalan-backup@${configuration.host}:/checkpoints`, target: independentBackupMount,
      sha256: createHash('sha256').update(content).digest('hex'), active: true, enabled: run('systemctl', ['is-enabled', name]) === 'enabled' };
  } finally { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [host, keyFile, knownHostsFile, ...extra] = process.argv.slice(2);
  try {
    if (extra.length) throw new Error('BACKUP_MOUNT_ARGUMENT_INVALID');
    console.log(JSON.stringify({ ok: true, ...installIndependentBackupMount({ host, keyFile, knownHostsFile }) }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: /^BACKUP_MOUNT_[A-Z_]+$/.test(error.message) ? error.message : 'BACKUP_MOUNT_INSTALL_FAILED' }));
    process.exitCode = 1;
  }
}
