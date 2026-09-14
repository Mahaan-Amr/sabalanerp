import assert from 'node:assert/strict';
import {
  createCoalescedContractCheckpointState,
  createContractRecoveryEnvelope,
  flushCoalescedContractCheckpoint,
  getContractRecoveryStorageKey,
  parseContractRecoveryEnvelope,
  persistContractRecoveryEnvelope,
  selectNewestContractRecovery
} from '../../utils/contractRecoveryJournal';

const scope = {
  userId: 'seller-1',
  draftId: 'contract-1',
  schemaVersion: 2,
  baseRevision: 4
};
const local = createContractRecoveryEnvelope({
  scope,
  sequence: 7,
  payload: { currentStep: 5, modalView: 'product' },
  now: 100
});
const server = createContractRecoveryEnvelope({
  scope,
  sequence: 6,
  payload: { currentStep: 4 },
  now: 90
});

assert.equal(
  getContractRecoveryStorageKey(scope),
  'contract-recovery:v2:seller-1:contract-1:4'
);
assert.deepEqual(parseContractRecoveryEnvelope(JSON.stringify(local), scope, 100), local);
assert.equal(
  parseContractRecoveryEnvelope(JSON.stringify(local), { ...scope, baseRevision: 5 }, 100),
  null,
  'recovery from another canonical revision must never be applied'
);
assert.deepEqual(selectNewestContractRecovery(local, server), local);
assert.deepEqual(selectNewestContractRecovery(null, server), server);

const persisted = new Map<string, string>();
assert.equal(
  persistContractRecoveryEnvelope({
    setItem: (key, value) => persisted.set(key, value)
  }, 'recovery-key', local),
  true
);
assert.equal(persisted.get('recovery-key'), JSON.stringify(local));
assert.equal(
  persistContractRecoveryEnvelope({
    setItem: () => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    }
  }, 'recovery-key', local),
  false,
  'browser quota errors must disable only the local fallback, not crash the wizard'
);

const testCoalescedCheckpointDrain = async () => {
  const checkpointState = createCoalescedContractCheckpointState<number>();
  const checkpointWrites: number[] = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  let releaseFirstWrite: (() => void) | undefined;
  const firstWriteBlocked = new Promise<void>(resolve => {
    releaseFirstWrite = resolve;
  });
  const writeCheckpoint = async (sequence: number) => {
    activeWrites += 1;
    maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
    checkpointWrites.push(sequence);
    if (sequence === 1) await firstWriteBlocked;
    activeWrites -= 1;
  };
  checkpointState.pending = 1;
  const firstFlush = flushCoalescedContractCheckpoint(checkpointState, writeCheckpoint);
  await Promise.resolve();
  checkpointState.pending = 2;
  checkpointState.pending = 3;
  const overlappingFlush = flushCoalescedContractCheckpoint(checkpointState, writeCheckpoint);
  assert.equal(overlappingFlush, firstFlush, 'overlapping flushes must share one in-flight drain');
  releaseFirstWrite?.();
  await firstFlush;
  assert.deepEqual(checkpointWrites, [1, 3], 'queued changes must coalesce to the newest pending checkpoint');
  assert.equal(maximumActiveWrites, 1, 'checkpoint requests must never overlap');
};

testCoalescedCheckpointDrain()
  .then(() => console.log('contractRecoveryJournal tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
