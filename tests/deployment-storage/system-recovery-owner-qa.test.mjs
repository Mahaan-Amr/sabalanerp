import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { validateQAforegroundConsumerReceipt } from '../../deploy/scripts/system-recovery-owner-qa.mjs';

function fixture() {
  const target = { planFile: '/srv/sabalanerp-qa/target.json', planSha256: 'a'.repeat(64), environmentSha256: 'b'.repeat(64),
    envFile: '/srv/sabalanerp-qa/environment', keyFile: '/srv/sabalanerp-qa/secrets/system-recovery-owner-private.pem',
    publicKeySha256: 'c'.repeat(64), sourceSha256: 'd'.repeat(64), nodeExecutable: '/usr/bin/node',
    networkNamespaceIdentity: 'net:[12345]', machineId: 'private-qa-machine', engineId: 'private-qa-engine',
    backupHost: 'qa-backup.test', productionBackupHost: 'production-backup.test' };
  const supervisor = { pid: 101, birth: '100001', uid: 0, state: 'S', parentPid: 100, executable: '/usr/bin/node',
    networkNamespaceIdentity: 'net:[12345]', argv: ['/usr/bin/node', '/opt/sabalanerp/deploy/scripts/system-recovery-owner-qa.mjs',
      'supervise', target.envFile, target.keyFile] };
  const consumer = { pid: 102, birth: '100002', uid: 0, state: 'S', parentPid: 101, executable: '/usr/bin/node',
    networkNamespaceIdentity: 'net:[12345]', argv: ['/usr/bin/node', '/opt/sabalanerp/deploy/scripts/system-recovery-owner-host.mjs',
      'consume', target.envFile, target.keyFile, '--watch'] };
  const now = Date.parse('2026-11-17T12:00:00Z');
  const receipt = { format: 'sabalan-qa-recovery-foreground/v1', qaOnly: true, productionAdmission: false,
    ...structuredClone(target), state: 'RUNNING', heartbeatAt: new Date(now - 1000).toISOString(),
    supervisor: structuredClone(supervisor), consumer: structuredClone(consumer) };
  return { receipt, observed: { target, now, supervisor, consumer } };
}

test('a live exact QA supervisor and canonical consumer are accepted without production admission', () => {
  const { receipt, observed } = fixture();
  assert.doesNotThrow(() => validateQAforegroundConsumerReceipt(receipt, observed));
});

for (const field of ['planSha256', 'environmentSha256', 'publicKeySha256', 'sourceSha256', 'engineId', 'machineId', 'backupHost']) {
  test(`foreground admission refuses a changed ${field}`, () => {
    const { receipt, observed } = fixture();
    receipt[field] = 'unbound';
    assert.throws(() => validateQAforegroundConsumerReceipt(receipt, observed));
  });
}

test('a reused PID, changed argv, foreign namespace, stale heartbeat or production claim cannot authorize foreground use', () => {
  const changes = [
    value => { value.observed.supervisor.birth = '999999'; },
    value => { value.observed.consumer.argv.push('--force'); },
    value => { value.observed.consumer.networkNamespaceIdentity = 'net:[99999]'; },
    value => { value.receipt.heartbeatAt = new Date(value.observed.now - 5001).toISOString(); },
    value => { value.receipt.productionAdmission = true; },
    value => { value.observed.supervisor.uid = 1000; },
    value => { value.observed.consumer.parentPid = 1; },
    value => { value.observed.supervisor.state = 'Z'; },
  ];
  for (const change of changes) {
    const value = fixture(); change(value);
    assert.throws(() => validateQAforegroundConsumerReceipt(value.receipt, value.observed));
  }
});

test('foreground start and verify reuse the approved selector and original encrypted consumer loop', () => {
  const source = fs.readFileSync(new URL('../../deploy/scripts/system-recovery-owner-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /execFileSync\(process.execPath, \[selector, planFile, planSha256, repository, envFile\]/);
  assert.match(source, /'consume', envFile, keyFile, '--watch'/);
  assert.match(source, /kill -STOP \$\$; exec/);
  assert.match(source, /publish\(receipt, true\)/);
  assert.match(source, /O_NOFOLLOW/);
  assert.doesNotMatch(source, /OWNER_READY|OWNER_FORCE|systemctl/);
});
