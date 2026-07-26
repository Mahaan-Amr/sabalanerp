import assert from 'node:assert/strict';
import {
  acquireContractEditSession,
  checkpointContractRecovery,
  assertContractEditOwnership,
  releaseContractEditSession,
  type ContractEditSessionRecord,
  type ContractEditSessionStore
} from '../contractEditSessionService';

class MemoryStore implements ContractEditSessionStore {
  record: ContractEditSessionRecord | null = null;

  async load(draftId: string) {
    return this.record?.draftId === draftId ? structuredClone(this.record) : null;
  }

  async create(record: ContractEditSessionRecord) {
    this.record = structuredClone(record);
    return structuredClone(record);
  }

  async replace(expectedToken: string, record: ContractEditSessionRecord) {
    if (this.record?.leaseToken !== expectedToken) return null;
    this.record = structuredClone(record);
    return structuredClone(record);
  }

  async remove(draftId: string, leaseToken: string) {
    if (this.record?.draftId !== draftId || this.record.leaseToken !== leaseToken) return false;
    this.record = null;
    return true;
  }
}

const run = async () => {
const store = new MemoryStore();
const now = new Date('2026-07-25T08:00:00.000Z');

const first = await acquireContractEditSession(store, {
  draftId: 'draft-1',
  contractId: 'contract-1',
  userId: 'seller-1',
  browserSessionId: 'browser-a',
  schemaVersion: 2,
  baseRevision: 4,
  takeover: false,
  now,
  createToken: () => 'lease-a'
});
assert.equal(first.ok, true);
if (!first.ok) throw new Error('Expected first lease');

await checkpointContractRecovery(store, {
  draftId: 'draft-1',
  userId: 'seller-1',
  browserSessionId: 'browser-a',
  leaseToken: first.session.leaseToken,
  baseRevision: 4,
  schemaVersion: 2,
  recovery: { currentStep: 5, productModal: { view: 'remainder-source' } },
  now: new Date('2026-07-25T08:01:00.000Z')
});

const blocked = await acquireContractEditSession(store, {
  draftId: 'draft-1',
  contractId: 'contract-1',
  userId: 'seller-1',
  browserSessionId: 'browser-b',
  schemaVersion: 2,
  baseRevision: 4,
  takeover: false,
  now: new Date('2026-07-25T08:02:00.000Z'),
  createToken: () => 'lease-b'
});
assert.equal(blocked.ok, false);
if (blocked.ok) throw new Error('Expected second editor to be blocked');
assert.deepEqual(blocked.recovery, { currentStep: 5, productModal: { view: 'remainder-source' } });

const takeover = await acquireContractEditSession(store, {
  draftId: 'draft-1',
  contractId: 'contract-1',
  userId: 'seller-1',
  browserSessionId: 'browser-b',
  schemaVersion: 2,
  baseRevision: 4,
  takeover: true,
  now: new Date('2026-07-25T08:03:00.000Z'),
  createToken: () => 'lease-b'
});
assert.equal(takeover.ok, true);
if (!takeover.ok) throw new Error('Expected takeover');
assert.deepEqual(takeover.recovery, { currentStep: 5, productModal: { view: 'remainder-source' } });

const oldOwner = await assertContractEditOwnership(store, {
  draftId: 'draft-1',
  userId: 'seller-1',
  browserSessionId: 'browser-a',
  leaseToken: first.session.leaseToken,
  baseRevision: 4
});
assert.equal(oldOwner.ok, false, 'takeover must immediately revoke the previous writer');

const currentOwner = await assertContractEditOwnership(store, {
  draftId: 'draft-1',
  userId: 'seller-1',
  browserSessionId: 'browser-b',
  leaseToken: takeover.session.leaseToken,
  baseRevision: 4
});
assert.equal(currentOwner.ok, true);

const released = await releaseContractEditSession(store, {
  draftId: 'draft-1',
  userId: 'seller-1',
  browserSessionId: 'browser-b',
  leaseToken: takeover.session.leaseToken,
  baseRevision: 4
});
assert.equal(released.ok, true);
assert.equal(store.record, null);

console.log('contractEditSessionService tests passed');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
