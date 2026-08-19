import assert from 'node:assert/strict';
import {
  createContractRecoveryEnvelope,
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

console.log('contractRecoveryJournal tests passed');
