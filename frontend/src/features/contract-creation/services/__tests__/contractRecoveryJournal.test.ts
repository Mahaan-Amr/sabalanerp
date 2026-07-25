import assert from 'node:assert/strict';
import {
  createContractRecoveryEnvelope,
  getContractRecoveryStorageKey,
  parseContractRecoveryEnvelope,
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

console.log('contractRecoveryJournal tests passed');
