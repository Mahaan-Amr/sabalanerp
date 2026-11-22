import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaContractEditSessionStore } from '../contractEditSessionService';

test('Partner JSON transport preserves full-snapshot CAS, same-millisecond races and private history', async () => {
  const value = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  assert(value, 'Explicit existing local database required');
  const url = new URL(value);
  assert(['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) && url.pathname === '/sabalanerp');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [{ emit: 'event', level: 'query' }] });
  const updates: string[] = [];
  let afterLeaseWrite: (() => void) | undefined;
  db.$on('query', event => { if (event.query.includes('UPDATE sales_contract_edit_sessions')) { updates.push(event.query); const callback = afterLeaseWrite; afterLeaseWrite = undefined; callback?.(); } });
  const store = new PrismaContractEditSessionStore(db), draftId = `partner-json-transport-${randomUUID()}`;
  const now = new Date();
  const recovery = { kind: 'partner-technical-recovery', version: 1, updatedAt: now.getTime(),
    validatedSnapshots: Array.from({ length: 1000 }, (_, i) => ({ revision: i, private: `حکمی '${i}' $1 \\ محفوظ`, facts: 'x'.repeat(500) })),
    draft: { inputRevision: 1 } };
  try {
    await store.create({ draftId, contractId: null, ownerUserId: draftId, purpose: 'PARTNER_TECHNICAL',
      browserSessionId: 'browser', leaseToken: randomUUID(), schemaVersion: 1, baseRevision: 0,
      recovery, createdAt: now, updatedAt: now, takenOverAt: null });
    const initial = (await store.load(draftId))!;
    const [a, b] = await Promise.all([1, 2].map(inputRevision => store.compareAndReplace(initial,
      { ...initial, recovery: { ...recovery, draft: { inputRevision: inputRevision + 1 } } })));
    assert.equal([a, b].filter(Boolean).length, 1);
    const current = (await store.load(draftId))!;
    assert.deepEqual((current.recovery as typeof recovery).validatedSnapshots, recovery.validatedSnapshots);
    assert.equal(current.updatedAt.getTime(), now.getTime());
    assert.equal(await store.compareAndReplace(initial, initial), null, 'same timestamp never accepts stale JSON');
    for (const changed of [{ leaseToken: 'other' }, { ownerUserId: 'other' }, { browserSessionId: 'other' },
      { contractId: 'other' }, { purpose: 'STANDARD' as const }, { baseRevision: 1 }, { schemaVersion: 2 },
      { createdAt: new Date(now.getTime() + 1) }, { updatedAt: new Date(now.getTime() + 1) }, { takenOverAt: now }]) {
      assert.equal(await store.compareAndReplace({ ...current, ...changed }, current), null);
    }
    const reordered = { ...current, recovery: Object.fromEntries(Object.entries(current.recovery as object).reverse()) };
    assert(await store.compareAndReplace(reordered, current), 'JSONB equality must ignore object-key order');
    assert.deepEqual((await store.load(draftId))?.recovery, current.recovery);
    const leaseSnapshot = (await store.load(draftId))!;
    updates.length = 0;
    const retainedDocument = structuredClone(leaseSnapshot.recovery);
    afterLeaseWrite = () => { (leaseSnapshot.recovery as Record<string, unknown>).unpersistedCallerMutation = true; };
    const renewed = await store.compareAndReplace(leaseSnapshot, { ...leaseSnapshot,
      leaseToken: randomUUID(), updatedAt: new Date(now.getTime() + 1000) });
    assert(renewed);
    assert.deepEqual(renewed.recovery, retainedDocument, 'acknowledge only the JSON verified by CAS, even if a caller mutates its input while awaiting SQL');
    assert.equal(updates.length, 1);
    assert(!/\brecovery\s*=/.test(updates[0].split('WHERE')[0]),
      'a lease-only update must not rewrite the immutable recovery journal');
    assert.match(updates[0].split('WHERE')[1], /\brecovery\s*=/,
      'lease optimization must retain complete JSON equality in the CAS predicate');
    const forged = { ...renewed, recovery: { ...(renewed.recovery as object), unacknowledged: true } };
    assert.equal(await store.compareAndReplace(forged, { ...forged, leaseToken: randomUUID() }), null,
      'a lease-only update must reject stale or forged JSON even with matching metadata');
  } finally {
    try { await db.salesContractEditSession.deleteMany({ where: { draftId } }); }
    finally { await db.$disconnect(); }
  }
});
