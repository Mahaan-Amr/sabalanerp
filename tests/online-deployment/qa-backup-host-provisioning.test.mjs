import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const scripts = path.resolve(import.meta.dirname, '../../deploy/scripts');
const read = name => fs.readFileSync(path.join(scripts, name), 'utf8');

test('QA backup host provisioning uses separate accounts, custody and SSH policy', () => {
  const script = read('provision-qa-backup-host.sh');
  assert.match(script, /\/opt\/sabalanerp-qa-recovery/);
  assert.match(script, /\/srv\/sabalanerp-qa-recovery\/checkpoints/);
  assert.match(script, /Match User sabalan-qa-backup\n/);
  assert.match(script, /Match User sabalan-qa-backup-ops\n/);
  assert.match(script, /ForceCommand internal-sftp -d \/checkpoints/);
  assert.match(script, /\/etc\/ssh\/sshd_config\.d\/91-sabalan-qa-backup\.conf/);
  assert.doesNotMatch(script, /(?<!qa-)sabalan-backup(?:-ops)?/);
  assert.doesNotMatch(script, /\/srv\/sabalanerp-recovery/);
});

test('QA operations commands hold the QA lock and cannot invoke the production owner', () => {
  const client = read('qa-backup-preflight-client.sh');
  const preflight = read('qa-backup-preflight-root.sh');
  const retention = read('qa-backup-retention-root.sh');
  for (const source of [preflight, retention]) {
    assert.match(source, /lock=\/run\/lock\/sabalan-qa-backup-storage\.lock/);
    assert.match(source, /exec 9>>"\$lock"/);
    assert.match(source, /stat -Lc '%d:%i:%u:%h' \/proc\/self\/fd\/9/);
    assert.match(source, /flock -n 9/);
    assert.doesNotMatch(source, /\/srv\/sabalanerp-recovery|\/opt\/sabalanerp-recovery|\/run\/lock\/sabalan-backup-storage\.lock/);
  }
  assert.match(client, /'retain'\) exec \/usr\/bin\/sudo -n \/usr\/local\/sbin\/sabalan-qa-backup-retention/);
  assert.match(client, /'preflight '\*\) required_bytes=/);
  assert.match(preflight, /--checkpoint-root \/srv\/sabalanerp-qa-recovery\/checkpoints/);
  assert.match(retention, /SABALAN_BACKUP_TARGET=qa/);
  assert.match(retention, /\/opt\/sabalanerp-qa-recovery\/deploy\/scripts\/backup-checkpoint-retention\.cjs/);
});
