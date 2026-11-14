import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQaRemoteMountIdentity, assertQaContainerRemoteMountIdentity } from '../../deploy/scripts/qa-remote-mount-guard.mjs';

const target = '/srv/sabalanerp-qa/remote';
const source = 'sabalan-qa-backup@qa-backup.sabalan.test:/checkpoints';
const sshfs = `47 36 0:81 / ${target} rw,nosuid,nodev - fuse.sshfs ${source} rw,user_id=0,group_id=0\n`;
const ext4 = `47 36 8:48 / ${target} rw,relatime - ext4 /dev/sdd rw\n`;

test('QA admits only the exact independent SSHFS mount from both controller and daemon views', () => {
  assert.doesNotThrow(() => assertQaRemoteMountIdentity({ target, source,
    controllerMountinfo: sshfs, daemonMountinfo: sshfs }));
  assert.throws(() => assertQaRemoteMountIdentity({ target, source,
    controllerMountinfo: sshfs, daemonMountinfo: ext4 }), /QA_REMOTE_MOUNT_IDENTITY_UNPROVEN/);
  assert.throws(() => assertQaRemoteMountIdentity({ target, source,
    controllerMountinfo: sshfs, daemonMountinfo: '36 1 8:48 / / rw - ext4 /dev/sdd rw\n' }),
  /QA_REMOTE_MOUNT_IDENTITY_UNPROVEN/);
  assert.throws(() => assertQaRemoteMountIdentity({ target, source,
    controllerMountinfo: ext4, daemonMountinfo: sshfs }), /QA_REMOTE_MOUNT_IDENTITY_UNPROVEN/);
});

test('a parent mount, wrong account, or wrong host cannot satisfy the QA backup boundary', () => {
  for (const changed of [
    sshfs.replace(target, '/srv/sabalanerp-qa'),
    sshfs.replace('sabalan-qa-backup@', 'sabalan-backup@'),
    sshfs.replace('qa-backup.sabalan.test', 'production-backup.sabalan.test'),
    `${sshfs}${ext4}`,
  ]) assert.throws(() => assertQaRemoteMountIdentity({ target, source,
    controllerMountinfo: changed, daemonMountinfo: sshfs }), /QA_REMOTE_MOUNT_IDENTITY_UNPROVEN/);
});

test('the actual deployment container must see the same SSHFS source at its bind target', () => {
  const mounted = sshfs.replace(target, '/app/deployment-remote');
  assert.doesNotThrow(() => assertQaContainerRemoteMountIdentity(mounted, source));
  assert.throws(() => assertQaContainerRemoteMountIdentity(ext4.replace(target, '/app/deployment-remote'), source),
    /QA_REMOTE_MOUNT_IDENTITY_UNPROVEN/);
  assert.throws(() => assertQaContainerRemoteMountIdentity(mounted.replace(source, '/dev/sdd'), source),
    /QA_REMOTE_MOUNT_IDENTITY_UNPROVEN/);
});
