import assert from 'node:assert/strict';
import test from 'node:test';
import { independentBackupMount, renderIndependentBackupMount, assertActiveBackupTransport } from '../../deploy/scripts/install-independent-backup-mount.mjs';

const configuration = { host: '94.182.177.74', keyFile: '/root/.ssh/sabalan_backup_transfer_ed25519', knownHostsFile: '/root/.ssh/sabalan-backup-known-hosts' };
test('persistent transport has a pinned independent source and the transfer identity only', () => {
  const unit = renderIndependentBackupMount(configuration);
  assert.match(unit, /What=sabalan-backup@94\.182\.177\.74:\/checkpoints\n/);
  assert.ok(unit.includes(`Where=${independentBackupMount}\n`));
  assert.match(unit, /StrictHostKeyChecking=yes,BatchMode=yes,IdentitiesOnly=yes/);
  assert.match(unit, /WantedBy=remote-fs.target/);
  assert.equal(unit.includes('127.0.0.1'), false);
  assert.equal(unit.includes('recovery-private'), false);
});

test('an existing same-source connection must prove its actual root-owned pinned process options', () => {
  const process = { uid: 0, executable: '/usr/bin/sshfs', argv: ['sshfs', 'sabalan-backup@94.182.177.74:/checkpoints', independentBackupMount,
    '-o', `IdentityFile=${configuration.keyFile},UserKnownHostsFile=${configuration.knownHostsFile},StrictHostKeyChecking=yes,BatchMode=yes,IdentitiesOnly=yes,reconnect,allow_other,default_permissions`] };
  assert.doesNotThrow(() => assertActiveBackupTransport([process], configuration));
  for (const changed of [
    { ...process, uid: 1000 }, { ...process, executable: '/tmp/sshfs' },
    { ...process, argv: process.argv.map(value => value.replace('StrictHostKeyChecking=yes', 'StrictHostKeyChecking=no')) },
    { ...process, argv: process.argv.map(value => value.replace(',IdentitiesOnly=yes', '')) },
    { ...process, argv: [...process.argv, '-o', 'ssh_command=untrusted'] },
  ]) assert.throws(() => assertActiveBackupTransport([changed], configuration), /ACTIVE_SETTINGS_UNPROVEN/);
  assert.throws(() => assertActiveBackupTransport([process, process], configuration), /ACTIVE_SETTINGS_UNPROVEN/);
});
test('host and key paths cannot inject unit options or select arbitrary secret files', () => {
  for (const host of ['94.182.177.74\nWhat=evil', 'host%h', 'host,IdentityFile=evil', '-option', 'bad..host']) {
    assert.throws(() => renderIndependentBackupMount({ ...configuration, host }), /HOST_INVALID/);
  }
  for (const keyFile of ['/tmp/key', '/root/.ssh/key,exec=x', '/root/.ssh/../key', '/root/.ssh/key\nOptions=evil']) {
    assert.throws(() => renderIndependentBackupMount({ ...configuration, keyFile }), /KEY_PATH_INVALID/);
  }
});
