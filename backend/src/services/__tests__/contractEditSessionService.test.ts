import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import {
  acquireContractEditSession,
  heartbeatContractEditSession,
  discoverRecoverableContractCreationDraft,
  discardContractCreationDraft,
  checkpointContractRecovery,
  assertContractEditOwnership,
  releaseContractEditSession,
  type ContractEditSessionRecord,
  type ContractEditSessionStore
} from '../contractEditSessionService';

class MemoryStore implements ContractEditSessionStore {
  record: ContractEditSessionRecord | null = null;
  discardAudits: Array<{ draftId: string; ownerUserId: string; discardedAt: Date }> = [];

  async load(draftId: string) {
    return this.record?.draftId === draftId ? structuredClone(this.record) : null;
  }

  async create(record: ContractEditSessionRecord) {
    this.record = structuredClone(record);
    return structuredClone(record);
  }

  async compareAndReplace(expected: ContractEditSessionRecord, record: ContractEditSessionRecord) {
    if (!isDeepStrictEqual(this.record, expected)) return null;
    this.record = structuredClone(record);
    return structuredClone(record);
  }

  async remove(draftId: string, leaseToken: string) {
    if (this.record?.draftId !== draftId || this.record.leaseToken !== leaseToken) return false;
    this.record = null;
    return true;
  }

  async listCreationDrafts(ownerUserId: string) {
    return this.record?.contractId === null && this.record.ownerUserId === ownerUserId
      ? [structuredClone(this.record)]
      : [];
  }

  async purgeIfUnchanged(expected: ContractEditSessionRecord) {
    if (!isDeepStrictEqual(this.record, expected)) return false;
    this.record = null;
    return true;
  }

  async discardCreationDraft(draftId: string, ownerUserId: string, discardedAt: Date) {
    if (this.record?.draftId !== draftId || this.record.ownerUserId !== ownerUserId || this.record.contractId !== null) {
      return false;
    }
    this.record = null;
    this.discardAudits.push({ draftId, ownerUserId, discardedAt });
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
  now: new Date('2026-07-25T08:00:30.000Z'),
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
  now: new Date('2026-07-25T08:00:35.000Z'),
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
  baseRevision: 4,
  now: new Date('2026-07-25T08:00:36.000Z')
});
assert.equal(oldOwner.ok, false, 'takeover must immediately revoke the previous writer');

const currentOwner = await assertContractEditOwnership(store, {
  draftId: 'draft-1',
  userId: 'seller-1',
  browserSessionId: 'browser-b',
  leaseToken: takeover.session.leaseToken,
  baseRevision: 4,
  now: new Date('2026-07-25T08:00:36.000Z')
});
assert.equal(currentOwner.ok, true);

const released = await releaseContractEditSession(store, {
  draftId: 'draft-1',
  userId: 'seller-1',
  browserSessionId: 'browser-b',
  leaseToken: takeover.session.leaseToken,
  baseRevision: 4,
  now: new Date('2026-07-25T08:00:37.000Z')
});
assert.equal(released.ok, true);
assert.equal(store.record, null);
const releasedAgain = await releaseContractEditSession(store, {
  draftId: 'draft-1',
  userId: 'seller-1',
  browserSessionId: 'browser-b',
  leaseToken: takeover.session.leaseToken,
  baseRevision: 4,
  now: new Date('2026-07-25T08:00:38.000Z')
});
assert.equal(releasedAgain.ok, true, 'releasing an already-cleaned committed session must be idempotent');

const expiredLeaseStore = new MemoryStore();
const expiredFirst = await acquireContractEditSession(expiredLeaseStore, {
  draftId: 'draft-expired',
  contractId: null,
  userId: 'seller-1',
  browserSessionId: 'browser-old',
  schemaVersion: 2,
  baseRevision: 0,
  takeover: false,
  now,
  createToken: () => 'lease-old'
});
assert.equal(expiredFirst.ok, true);
const reclaimed = await acquireContractEditSession(expiredLeaseStore, {
  draftId: 'draft-expired',
  contractId: null,
  userId: 'seller-1',
  browserSessionId: 'browser-new',
  schemaVersion: 2,
  baseRevision: 0,
  takeover: false,
  now: new Date('2026-07-25T08:01:16.000Z'),
  createToken: () => 'lease-new'
});
assert.equal(reclaimed.ok, true, 'an inactive creation-draft lease must be reclaimed without a false conflict');
if (!reclaimed.ok) throw new Error('Expected expired lease reclamation');
assert.equal(reclaimed.session.browserSessionId, 'browser-new');
assert.equal(reclaimed.session.leaseToken, 'lease-new');

const privateDraftStore = new MemoryStore();
const privateDraft = await acquireContractEditSession(privateDraftStore, {
  draftId: 'draft-private',
  contractId: null,
  userId: 'seller-1',
  browserSessionId: 'browser-owner',
  schemaVersion: 2,
  baseRevision: 0,
  takeover: false,
  now,
  createToken: () => 'lease-private'
});
assert.equal(privateDraft.ok, true);
const foreignTakeover = await acquireContractEditSession(privateDraftStore, {
  draftId: 'draft-private',
  contractId: null,
  userId: 'seller-2',
  browserSessionId: 'browser-foreign',
  schemaVersion: 2,
  baseRevision: 0,
  takeover: true,
  now: new Date('2026-07-25T08:00:20.000Z'),
  createToken: () => 'lease-foreign'
});
assert.equal(foreignTakeover.ok, false, 'a creation draft must remain private to its creator');
if (foreignTakeover.ok) throw new Error('Expected foreign takeover rejection');
assert.equal(foreignTakeover.code, 'draft-owner-mismatch');
assert.equal(foreignTakeover.recovery, null, 'foreign users must not receive private draft recovery');

const heartbeatStore = new MemoryStore();
const heartbeatLease = await acquireContractEditSession(heartbeatStore, {
  draftId: 'draft-heartbeat',
  contractId: null,
  userId: 'seller-1',
  browserSessionId: 'browser-live',
  schemaVersion: 2,
  baseRevision: 0,
  takeover: false,
  now,
  createToken: () => 'lease-live'
});
assert.equal(heartbeatLease.ok, true);
if (!heartbeatLease.ok) throw new Error('Expected heartbeat lease');
const heartbeat = await heartbeatContractEditSession(heartbeatStore, {
  draftId: 'draft-heartbeat',
  userId: 'seller-1',
  browserSessionId: 'browser-live',
  leaseToken: heartbeatLease.session.leaseToken,
  baseRevision: 0,
  now: new Date('2026-07-25T08:01:00.000Z')
});
assert.equal(heartbeat.ok, true);
const stillOwned = await acquireContractEditSession(heartbeatStore, {
  draftId: 'draft-heartbeat',
  contractId: null,
  userId: 'seller-1',
  browserSessionId: 'browser-other',
  schemaVersion: 2,
  baseRevision: 0,
  takeover: false,
  now: new Date('2026-07-25T08:02:00.000Z'),
  createToken: () => 'lease-other'
});
assert.equal(stillOwned.ok, false, 'a recent heartbeat must keep the current writer active');

const durableDraftStore = new MemoryStore();
const durableLease = await acquireContractEditSession(durableDraftStore, {
  draftId: 'draft-durable', contractId: null, userId: 'seller-1', browserSessionId: 'browser-a',
  schemaVersion: 2, baseRevision: 0, takeover: false, now, createToken: () => 'lease-durable'
});
assert.equal(durableLease.ok, true);
if (!durableLease.ok) throw new Error('Expected durable draft lease');
await checkpointContractRecovery(durableDraftStore, {
  draftId: 'draft-durable', userId: 'seller-1', browserSessionId: 'browser-a',
  leaseToken: durableLease.session.leaseToken, baseRevision: 0, schemaVersion: 2,
  recovery: { sequence: 1, updatedAt: now.getTime(), payload: { currentStep: 2, customerId: 'customer-1' } },
  now
});
const discovered = await discoverRecoverableContractCreationDraft(durableDraftStore, {
  userId: 'seller-1', browserSessionId: 'browser-b', now: new Date('2026-07-31T08:00:00.000Z')
});
assert.equal(discovered?.draftId, 'draft-durable');
assert.equal(discovered?.activeElsewhere, false, 'expired live ownership must not hide recoverable content');
const foreignDiscovery = await discoverRecoverableContractCreationDraft(durableDraftStore, {
  userId: 'seller-2', browserSessionId: 'browser-b', now: new Date('2026-07-31T08:00:00.000Z')
});
assert.equal(foreignDiscovery, null, 'other users must not discover a private creation draft');
const expiredDiscovery = await discoverRecoverableContractCreationDraft(durableDraftStore, {
  userId: 'seller-1', browserSessionId: 'browser-b', now: new Date('2026-08-02T08:00:00.001Z')
});
assert.equal(expiredDiscovery, null, 'recovery must expire seven days after its last meaningful change');
assert.equal(durableDraftStore.record, null, 'expired recovery and ownership state must be purged');

const discardStore = new MemoryStore();
const discardLease = await acquireContractEditSession(discardStore, {
  draftId: 'draft-discard', contractId: null, userId: 'seller-1', browserSessionId: 'browser-a',
  schemaVersion: 2, baseRevision: 0, takeover: false, now, createToken: () => 'lease-discard'
});
assert.equal(discardLease.ok, true);
const discarded = await discardContractCreationDraft(discardStore, {
  draftId: 'draft-discard', userId: 'seller-1', now: new Date('2026-07-25T08:00:10.000Z')
});
assert.equal(discarded, true);
assert.equal(discardStore.record, null, 'discard must erase recoverable contents and ownership');
assert.deepEqual(discardStore.discardAudits, [{
  draftId: 'draft-discard', ownerUserId: 'seller-1', discardedAt: new Date('2026-07-25T08:00:10.000Z')
}]);

const staleRevisionStore = new MemoryStore();
const staleLease = await acquireContractEditSession(staleRevisionStore, {
  draftId: 'contract-committed',
  contractId: 'contract-committed',
  userId: 'seller-1',
  browserSessionId: 'browser-before-commit',
  schemaVersion: 2,
  baseRevision: 0,
  takeover: false,
  now,
  createToken: () => 'lease-before-commit'
});
assert.equal(staleLease.ok, true);
if (!staleLease.ok) throw new Error('Expected stale pre-commit lease');

await checkpointContractRecovery(staleRevisionStore, {
  draftId: 'contract-committed',
  userId: 'seller-1',
  browserSessionId: 'browser-before-commit',
  leaseToken: staleLease.session.leaseToken,
  baseRevision: 0,
  schemaVersion: 2,
  recovery: { currentStep: 4, products: ['stale-before-commit'] },
  now: new Date('2026-07-25T08:04:00.000Z')
});

const editAfterCommit = await acquireContractEditSession(staleRevisionStore, {
  draftId: 'contract-committed',
  contractId: 'contract-committed',
  userId: 'seller-1',
  browserSessionId: 'browser-after-commit',
  schemaVersion: 2,
  baseRevision: 1,
  takeover: false,
  now: new Date('2026-07-25T08:05:00.000Z'),
  createToken: () => 'lease-after-commit'
});
assert.equal(
  editAfterCommit.ok,
  true,
  'a lease from an older committed revision must expire instead of blocking the next edit'
);
if (!editAfterCommit.ok) throw new Error('Expected a fresh post-commit lease');
assert.equal(editAfterCommit.recovery, null, 'stale recovery must not cross canonical revisions');
assert.equal(editAfterCommit.session.baseRevision, 1);
assert.equal(editAfterCommit.session.leaseToken, 'lease-after-commit');

console.log('contractEditSessionService tests passed');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
