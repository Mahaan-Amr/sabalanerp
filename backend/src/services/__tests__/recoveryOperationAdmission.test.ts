import assert from 'node:assert/strict';
import test from 'node:test';
import { RecoveryOperationAdmission } from '../recoveryOperationAdmission';

test('retirement reserves detached recovery work from admission until real completion, including before its callback starts', async () => {
  const operation = new RecoveryOperationAdmission();
  assert.equal(operation.acquire(), true);
  assert.equal(operation.acquire(), false);
  let drained = false;
  const drain = operation.drain(1000).then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drained, false);
  assert.equal(operation.acquire(), false);
  operation.release();
  await drain;
  assert.equal(drained, true);
  assert.equal(operation.acquire(), false, 'a retiring runtime never resumes control admission');
});

test('timeout leaves the owner blocked until its admitted task actually finishes', async () => {
  const operation = new RecoveryOperationAdmission();
  operation.acquire();
  await assert.rejects(operation.drain(5), /RECOVERY_OPERATION_DRAIN_TIMEOUT/);
  assert.equal(operation.acquire(), false);
  const completed = operation.drain(1000);
  operation.release(); await completed;
  assert.equal(operation.acquire(), false);
});
