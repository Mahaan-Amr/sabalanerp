import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { customerFinanceData } from './customerFinanceFixture';
import { recordCustomerAccountOperation, readCustomerWorkspace } from '../accountingCustomerWorkspace';
import { createReceivableCheckPrisma } from '../accountingCustomerTreasuryPrisma';

test('barrier adoption observes a real incompatible writer committing while installation waits', async () => {
  assert.equal(process.env.CUSTOMER_SEMANTIC_BARRIER_LOCAL_ACCEPTANCE, '1');
  const kind = process.env.CUSTOMER_SEMANTIC_BARRIER_RACE_KIND;
  assert.ok(['counter-race', 'partial-status-race', 'partial-event-race'].includes(kind!));
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.host, '127.0.0.1:55432'); assert.match(url.pathname, /^\/qa_customer_barrier_[a-f0-9]{32}$/);
  const sql = fs.readFileSync(process.env.CUSTOMER_SEMANTIC_BARRIER_SQL_FILE!, 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), process.env.CUSTOMER_SEMANTIC_BARRIER_SQL_SHA256);
  const installerUrl = new URL(url.href);
  const namespace = 'customer-barrier-installer-' + url.pathname.slice(-32);
  assert.ok(namespace.length <= 63);
  installerUrl.searchParams.set('application_name', namespace);
  const db = new PrismaClient(), writer = new PrismaClient(),
    installer = new PrismaClient({ datasources: { db: { url: installerUrl.href } } });
  let release!: () => void, acquired!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const updated = new Promise<void>(resolve => { acquired = resolve; });
  let writing: Promise<unknown> | undefined;
  let installing: Promise<{ ok: boolean; error?: unknown }> | undefined;
  let installerPid: number | undefined;
  try {
    const f = await customerFinanceData(db), id = await f.customer();
    await recordCustomerAccountOperation(db, id, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: 'race-legacy-debit' });
    const profile = (await readCustomerWorkspace(db, { id, asOf: new Date(), userId: f.actor.id })).profile!;
    const check = await createReceivableCheckPrisma(db, { profileId: profile.id, legalEntityId: f.book.legalEntityId,
      serialNumber: 'private-race', bankName: 'آزمون', amountRials: 100n, dueAt: f.common.occurredAt,
      occurredAt: f.common.occurredAt, evidence: { kind: 'private-legacy-baseline' }, actor: f.actor });
    writing = writer.$transaction(async tx => {
      if (kind === 'partial-event-race') await tx.accountingCheckInstrumentEvent.create({ data: {
        checkInstrumentId: check.id, sequence: 2, eventType: 'PARTIAL_SETTLED', occurredAt: f.common.occurredAt,
        actorId: f.actor.id, evidence: {}, evidenceHash: 'private-race-event' } });
      else await tx.accountingCheckInstrument.update({ where: { id: check.id },
        data: kind === 'counter-race' ? { clearedRials: '1' } : { status: 'PARTIAL_SETTLED' } });
      acquired(); await released;
    }, { timeout: 30_000 });
    await Promise.race([updated, writing]);
    let settled = false;
    let entered!: () => void;
    const entry = new Promise<void>(resolve => { entered = resolve; });
    installing = installer.$transaction(async tx => {
      const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      installerPid = connection.pid; entered();
      await tx.$executeRawUnsafe(sql);
    }, { timeout: 15_000 }).then(() => ({ ok: true }), error => ({ ok: false, error }))
      .finally(() => { settled = true; });
    await Promise.race([entry, installing]);
    const deadline = Date.now() + 5_000;
    let observed = false;
    while (!settled && Date.now() < deadline) {
      const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND pid=${installerPid} AND wait_event_type='Lock') AS waiting`;
      if (rows[0].waiting) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(observed, true, 'The actual installer must be observed behind the actual SQL writer.');
    release(); await writing; writing = undefined;
    const result = await installing;
    assert.equal(result.ok, false, 'Installing CLOSED after the incompatible writer commits is forbidden.');
    assert.match(String(result.error), /CUSTOMER_SEMANTIC_BASELINE_INCOMPATIBLE/);
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT to_regclass('public.online_financial_compatibility_barriers')::text AS name`), [{ name: null }]);
    const committed = await db.accountingCheckInstrument.findUniqueOrThrow({ where: { id: check.id } });
    assert.equal(committed.clearedRials.toString(), kind === 'counter-race' ? '1' : '0');
    assert.equal(committed.status, kind === 'partial-status-race' ? 'PARTIAL_SETTLED' : 'RECEIVED');
    assert.equal(await db.accountingCheckInstrumentEvent.count({ where: { checkInstrumentId: check.id, eventType: 'PARTIAL_SETTLED' } }),
      kind === 'partial-event-race' ? 1 : 0);
    await assert.rejects(db.$transaction(tx => tx.$executeRawUnsafe(sql), { isolationLevel: 'RepeatableRead' }),
      /CUSTOMER_SEMANTIC_INSTALL_ISOLATION_UNSUPPORTED/);
    console.log(JSON.stringify({ incompatibleWriterPreservedAndAdoptionRefused: true, kind }));
  } finally {
    release(); if (writing) await writing.catch(() => undefined);
    if (installing) {
      const completion = await installing;
      console.log(JSON.stringify({ installerPid, raceInstallationCommitted: completion.ok, raceInstallationError: String(completion.error ?? '') }));
    }
    try { await installer.$disconnect(); } finally { try { await writer.$disconnect(); } finally { await db.$disconnect(); } }
    console.log(JSON.stringify({ closedBarrierRaceClientsClosed: true }));
  }
});
