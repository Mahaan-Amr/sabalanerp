/** Fail closed when QA Docker would bind the underlying local directory in place of SSHFS. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = () => { throw new Error('QA_REMOTE_MOUNT_IDENTITY_UNPROVEN'); };
const unescapeMountField = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));

function exactMount(mountinfo, target) {
  const entries = mountinfo.split('\n').filter(Boolean).map(line => {
    const [before, after, ...extra] = line.split(' - ');
    if (!after || extra.length) fail();
    const left = before.split(' '), right = after.split(' ');
    if (left.length < 6 || right.length < 3) fail();
    return { mountpoint: unescapeMountField(left[4]), type: right[0], source: unescapeMountField(right[1]) };
  }).filter(entry => entry.mountpoint === target);
  if (entries.length !== 1) fail();
  return entries[0];
}

export function assertQaRemoteMountIdentity({ target, source, controllerMountinfo, daemonMountinfo }) {
  if (target !== '/srv/sabalanerp-qa/remote' || !/^sabalan-qa-backup@[a-zA-Z0-9][a-zA-Z0-9.-]*:\/checkpoints$/.test(source)) fail();
  for (const mountinfo of [controllerMountinfo, daemonMountinfo]) {
    if (typeof mountinfo !== 'string') fail();
    const observed = exactMount(mountinfo, target);
    if (observed.type !== 'fuse.sshfs' || observed.source !== source) fail();
  }
}

export function assertQaContainerRemoteMountIdentity(mountinfo, source) {
  if (typeof mountinfo !== 'string') fail();
  const observed = exactMount(mountinfo, '/app/deployment-remote');
  if (observed.type !== 'fuse.sshfs' || observed.source !== source) fail();
}

export function assertQaRemoteMountAtRuntime(target, backupHost) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || typeof backupHost !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(backupHost) || backupHost.includes('..')) fail();
  const pid = fs.readFileSync('/run/docker.pid', 'utf8').trim();
  if (!/^[1-9][0-9]*$/.test(pid)) fail();
  assert.equal(fs.realpathSync(target), target);
  assertQaRemoteMountIdentity({ target, source: `sabalan-qa-backup@${backupHost}:/checkpoints`,
    controllerMountinfo: fs.readFileSync('/proc/self/mountinfo', 'utf8'),
    daemonMountinfo: fs.readFileSync(`/proc/${pid}/mountinfo`, 'utf8') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const container = process.argv[2] === '--container';
    const offset = container ? 1 : 0;
    if (process.argv.length !== 4 + offset) fail();
    const target = process.argv[2 + offset], host = process.argv[3 + offset];
    assertQaRemoteMountAtRuntime(target, host);
    if (container) assertQaContainerRemoteMountIdentity(fs.readFileSync(0, 'utf8'),
      `sabalan-qa-backup@${host}:/checkpoints`);
  } catch {
    process.stderr.write('QA_REMOTE_MOUNT_IDENTITY_UNPROVEN\n');
    process.exitCode = 1;
  }
}
