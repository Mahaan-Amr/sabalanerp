import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  PrismaContractEditSessionStore, acquireContractEditSession, checkpointContractRecovery,
  heartbeatContractEditSession, assertContractEditOwnership, type ContractEditSessionRecord,
} from '../contractEditSessionService';

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
