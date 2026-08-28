import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  PrismaContractEditSessionStore, acquireContractEditSession, checkpointContractRecovery,
  heartbeatContractEditSession, assertContractEditOwnership, type ContractEditSessionRecord,
  discoverRecoverableContractCreationDraft,
  releaseContractEditSession,
} from '../contractEditSessionService';

test('generic lease and recovery reads never disclose server-owned Partner technical evidence', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const store = new PrismaContractEditSessionStore(database);
  const draftId = `recovery-protected-${randomUUID()}`;
  try {
    const now = new Date();
    const input = { draftId, contractId: null, userId: draftId, browserSessionId: 'browser-a',
      schemaVersion: 2, baseRevision: 0, takeover: false, now };
    const lease = await acquireContractEditSession(store, input);
    if (!lease.ok) throw new Error(lease.code);
    // This persisted fixture is written by the server producer, not submitted
    // through a generic browser checkpoint. Public lease reads must redact it.
    const protectedRecovery = { kind: 'partner-technical-recovery', version: 1, updatedAt: now.getTime(),
      privateEvidence: { rate: '12345', hash: 'private-test-only' }, technicalDraft: { inputRevision: 1 } };
    await store.compareAndReplace(lease.session, { ...lease.session, recovery: protectedRecovery });
    const owner = { ...input, leaseToken: lease.session.leaseToken };
    const resumed = await acquireContractEditSession(store, input);
    if (!resumed.ok) throw new Error(resumed.code);
    assert.equal(resumed.recovery, null);
    assert.equal(resumed.session.recovery, null);
    for (const read of [assertContractEditOwnership, heartbeatContractEditSession]) {
      const response = await read(store, owner);
      if (!response.ok) throw new Error(response.code);
      assert.equal(response.session.recovery, null);
      const rejected = await read(store, { ...owner, browserSessionId: 'other-tab' });
      if (rejected.ok) throw new Error('Stale editor accepted');
      assert.equal(rejected.recovery, null);
    }
    assert.equal(await discoverRecoverableContractCreationDraft(store, input), null,
      'ordinary draft discovery cannot restore a Partner draft into the priced wizard');
    assert.deepEqual((await store.load(draftId))?.recovery, protectedRecovery,
      'redaction and discovery must not delete private persisted evidence');
  } finally {
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});

function localDatabaseUrl(): string {
  const value = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!value) throw new Error('Explicit existing local recovery test database required');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) || url.pathname !== '/sabalanerp') {
    throw new Error('Non-local recovery test database refused');
  }
  url.searchParams.set('connection_limit', '4');
  url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

test('generic checkpoints cannot forge or replace a protected Partner recovery record', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const store = new PrismaContractEditSessionStore(database);
  const draftId = `recovery-protected-write-${randomUUID()}`;
  try {
    const now = new Date();
    const input = { draftId, contractId: null, userId: draftId, browserSessionId: 'browser-a',
      schemaVersion: 2, baseRevision: 0, takeover: false, now };
    const lease = await acquireContractEditSession(store, input);
    if (!lease.ok) throw new Error(lease.code);
    const owner = { ...input, leaseToken: lease.session.leaseToken };
    const envelope = { kind: 'partner-technical-recovery', version: 999, updatedAt: now.getTime(), privateEvidence: 'server-only' };
    const forged = await checkpointContractRecovery(store, { ...owner, recovery: envelope });
    assert.equal(forged.ok, false, 'unknown protected versions are not ordinary browser journals');
    assert.equal((await store.load(draftId))?.recovery, null);
    await store.compareAndReplace(lease.session, { ...lease.session, recovery: envelope });
    const replaced = await checkpointContractRecovery(store, { ...owner, recovery: { payload: 'ordinary replacement' } });
    if (replaced.ok) throw new Error('Generic checkpoint overwrote server evidence');
    assert.equal(replaced.recovery, null);
    assert.deepEqual((await store.load(draftId))?.recovery, envelope);
  } finally {
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});

test('a protected draft cannot be rebound or reset through generic acquire but normal takeover still revokes its prior writer', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const store = new PrismaContractEditSessionStore(database);
  const draftId = `recovery-protected-binding-${randomUUID()}`;
  try {
    const now = new Date();
    const input = { draftId, contractId: null, userId: draftId, browserSessionId: 'browser-a',
      schemaVersion: 2, baseRevision: 0, takeover: false, now };
    const lease = await acquireContractEditSession(store, input);
    if (!lease.ok) throw new Error(lease.code);
    const envelope = { kind: 'partner-technical-recovery', version: 1, updatedAt: now.getTime(), privateEvidence: 'retained' };
    await store.compareAndReplace(lease.session, { ...lease.session, recovery: envelope });
    for (const change of [{ baseRevision: 1 }, { schemaVersion: 3 }, { contractId: 'unrelated-contract' }]) {
      const denied = await acquireContractEditSession(store, { ...input, ...change, browserSessionId: 'browser-b', takeover: true });
      if (denied.ok) throw new Error('Protected draft was rebound or reset');
      assert.equal(denied.code, 'revision-conflict');
      assert.equal(denied.recovery, null);
      const retained = await store.load(draftId);
      assert.equal(retained?.leaseToken, lease.session.leaseToken);
      assert.deepEqual(retained?.recovery, envelope);
    }
    const takeover = await acquireContractEditSession(store, { ...input, browserSessionId: 'browser-b', takeover: true });
    if (!takeover.ok) throw new Error(takeover.code);
    assert.equal(takeover.recovery, null);
    assert.equal(takeover.session.recovery, null);
    assert.notEqual(takeover.session.leaseToken, lease.session.leaseToken);
    const stale = await checkpointContractRecovery(store, { ...input, leaseToken: lease.session.leaseToken, recovery: {} });
    if (stale.ok) throw new Error('Revoked writer accepted');
    assert.equal(stale.recovery, null);
    assert.deepEqual((await store.load(draftId))?.recovery, envelope);
    const released = await releaseContractEditSession(store, { ...input, browserSessionId: 'browser-b',
      leaseToken: takeover.session.leaseToken });
    if (!released.ok || !('session' in released)) throw new Error('Current lease release failed');
    assert.equal(released.session.recovery, null);
  } finally {
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});

test('a concurrent protected transition cannot be rebound when an expired generic lease acquisition loses its compare-and-replace', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const draftId = `recovery-protected-race-${randomUUID()}`;
  const now = new Date();
  const envelope = { kind: 'partner-technical-recovery', version: 1, updatedAt: now.getTime(), privateEvidence: 'concurrent' };
  // External persistence seam: force the other server transaction to win the
  // first CAS. All writes/readback still use the real existing PostgreSQL store.
  class TransitioningStore extends PrismaContractEditSessionStore {
    private transitionPending = true;
    override async compareAndReplace(expected: ContractEditSessionRecord, replacement: ContractEditSessionRecord) {
      if (this.transitionPending) {
        this.transitionPending = false;
        await super.compareAndReplace(expected, { ...expected, schemaVersion: 3, recovery: envelope, updatedAt: now });
      }
      return super.compareAndReplace(expected, replacement);
    }
  }
  const store = new TransitioningStore(database);
  try {
    await store.create({ draftId, contractId: null, ownerUserId: draftId, browserSessionId: 'browser-a', leaseToken: 'old-lease',
      schemaVersion: 2, baseRevision: 0, recovery: null, createdAt: new Date(now.getTime() - 90_000),
      updatedAt: new Date(now.getTime() - 90_000), takenOverAt: null });
    const result = await acquireContractEditSession(store, { draftId, contractId: null, userId: draftId,
      browserSessionId: 'browser-b', schemaVersion: 2, baseRevision: 0, takeover: true, now });
    if (result.ok) throw new Error('Lost CAS rebound a protected record');
    assert.equal(result.code, 'revision-conflict');
    assert.equal(result.recovery, null);
    const retained = await store.load(draftId);
    assert.equal(retained?.schemaVersion, 3);
    assert.equal(retained?.leaseToken, 'old-lease');
    assert.deepEqual(retained?.recovery, envelope);
  } finally {
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});

test('ordinary discovery cannot purge a protected checkpoint installed after its draft listing', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const draftId = `recovery-protected-discovery-${randomUUID()}`;
  const now = new Date();
  const envelope = { kind: 'partner-technical-recovery', version: 1, updatedAt: now.getTime(), privateEvidence: 'newly-saved' };
  class SavingDuringDiscoveryStore extends PrismaContractEditSessionStore {
    override async listCreationDrafts(ownerUserId: string) {
      const snapshot = await super.listCreationDrafts(ownerUserId);
      for (const record of snapshot) await super.compareAndReplace(record, { ...record, recovery: envelope });
      return snapshot;
    }
  }
  const store = new SavingDuringDiscoveryStore(database);
  try {
    await store.create({ draftId, contractId: null, ownerUserId: draftId, browserSessionId: 'browser-a', leaseToken: randomUUID(),
      schemaVersion: 2, baseRevision: 0, recovery: null, createdAt: now, updatedAt: now, takenOverAt: null });
    assert.equal(await discoverRecoverableContractCreationDraft(store, { userId: draftId, browserSessionId: 'browser-a', now }), null);
    assert.deepEqual((await store.load(draftId))?.recovery, envelope, 'the newly saved protected draft survives stale cleanup');
  } finally {
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});

test('same-lease same-millisecond concurrent checkpoints cannot both replace one persisted recovery revision', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const store = new PrismaContractEditSessionStore(database);
  const draftId = `recovery-cas-${randomUUID()}`;
  try {
    const now = new Date();
    const initial: ContractEditSessionRecord = {
      draftId, contractId: null, ownerUserId: draftId, browserSessionId: 'browser-a', leaseToken: randomUUID(),
      schemaVersion: 2, baseRevision: 0, recovery: { sequence: 1, payload: { input: 'initial' } },
      createdAt: now, updatedAt: now, takenOverAt: null,
    };
    await store.create(initial);
    const expected = await store.load(draftId);
    assert.ok(expected);
    const results = await Promise.all(['first', 'second'].map(input => store.compareAndReplace(expected, {
      ...expected, recovery: { sequence: 2, payload: { input } },
    })));
    assert.equal(results.filter(Boolean).length, 1, 'exactly one checkpoint owns the next revision');
    const accepted = results.find(Boolean);
    assert.ok(accepted);
    const current = await store.load(draftId);
    assert.deepEqual(current?.recovery, accepted.recovery);
    assert.equal(await store.compareAndReplace(expected, { ...expected, updatedAt: new Date(now.getTime() + 1) }), null,
      'a heartbeat copied before the checkpoint must not restore old content');
    assert.deepEqual((await store.load(draftId))?.recovery, accepted.recovery);
  } finally {
    // Only this exact namespaced draft, never a broad recovery-table cleanup.
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});

test('a live owner can checkpoint while heartbeats run without losing the saved draft or falsely losing ownership', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const store = new PrismaContractEditSessionStore(database);
  const draftId = `recovery-heartbeat-${randomUUID()}`;
  try {
    const lease = await acquireContractEditSession(store, {
      draftId, contractId: null, userId: draftId, browserSessionId: 'browser-a',
      schemaVersion: 2, baseRevision: 0, takeover: false,
    });
    if (!lease.ok) throw new Error(lease.code);
    const owner = { draftId, userId: draftId, browserSessionId: 'browser-a', leaseToken: lease.session.leaseToken, baseRevision: 0 };
    const writes = await Promise.all([
      checkpointContractRecovery(store, { ...owner, schemaVersion: 2, recovery: { input: 'saved-progress' } }),
      ...Array.from({ length: 8 }, () => heartbeatContractEditSession(store, owner)),
    ]);
    assert.ok(writes.every(result => result.ok), 'renewing the same live lease is not a competing editor');
    const resumed = await acquireContractEditSession(store, { ...owner, contractId: null, schemaVersion: 2, takeover: false });
    if (!resumed.ok) throw new Error(resumed.code);
    assert.deepEqual(resumed.recovery, { input: 'saved-progress' });
  } finally {
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});

test('foreign callers never receive private recovery and takeover revokes the stale writer without losing progress', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const store = new PrismaContractEditSessionStore(database);
  const draftId = `recovery-private-${randomUUID()}`;
  try {
    const input = { draftId, contractId: null, userId: draftId, browserSessionId: 'browser-a', schemaVersion: 2, baseRevision: 0, takeover: false };
    const lease = await acquireContractEditSession(store, input);
    if (!lease.ok) throw new Error(lease.code);
    const owner = { ...input, leaseToken: lease.session.leaseToken };
    const saved = await checkpointContractRecovery(store, { ...owner, recovery: { privateInput: 'latest-progress' } });
    if (!saved.ok) throw new Error(saved.code);
    for (const attempt of [assertContractEditOwnership, heartbeatContractEditSession]) {
      const denied = await attempt(store, { ...owner, userId: 'foreign-user' });
      if (denied.ok) throw new Error('Foreign writer was accepted');
      assert.equal(denied.recovery, null, 'denials must not disclose another creator’s recovery');
    }
    const takeover = await acquireContractEditSession(store, { ...input, browserSessionId: 'browser-b', takeover: true });
    if (!takeover.ok) throw new Error(takeover.code);
    assert.deepEqual(takeover.recovery, { privateInput: 'latest-progress' });
    assert.equal(await store.compareAndReplace(saved.session, { ...saved.session, recovery: { input: 'stale' } }), null);
    const stale = await checkpointContractRecovery(store, { ...owner, recovery: { input: 'stale' } });
    assert.equal(stale.ok, false);
    assert.deepEqual((await store.load(draftId))?.recovery, { privateInput: 'latest-progress' });
  } finally {
    try { await database.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await database.$disconnect(); }
  }
});
