import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

test('closed barrier installation rolls back lock refusal and late DDL failure before a complete installation', async () => {
  assert.equal(process.env.CUSTOMER_SEMANTIC_BARRIER_LOCAL_ACCEPTANCE, '1');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.host, '127.0.0.1:55432'); assert.match(url.pathname, /^\/qa_customer_barrier_[a-f0-9]{32}$/);
  const sql = fs.readFileSync(process.env.CUSTOMER_SEMANTIC_BARRIER_SQL_FILE!, 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), process.env.CUSTOMER_SEMANTIC_BARRIER_SQL_SHA256);
  const db = new PrismaClient(), blocker = new PrismaClient();
  const snapshot = () => db.$queryRawUnsafe(`SELECT t.oid::text AS oid, c.relname, t.tgname, t.tgenabled,
    t.tgfoid::text AS function_oid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace ORDER BY c.relname,t.tgname`);
  const assertAbsent = async () => {
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT to_regclass('public.online_financial_compatibility_barriers')::text AS name`), [{ name: null }]);
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('sabalan_require_customer_source_shares','sabalan_protect_customer_barrier',
        'sabalan_guard_customer_credit_source','sabalan_reject_customer_semantic_mutation','sabalan_guard_customer_semantic_fields')`), []);
  };
  let release!: () => void, acquired!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const locked = new Promise<void>(resolve => { acquired = resolve; });
  let holding: Promise<unknown> | undefined;
  try {
    await assertAbsent();
    const before = await snapshot();
    holding = blocker.$transaction(async tx => {
      await tx.$executeRawUnsafe('LOCK public.accounting_treasury_transactions IN ROW EXCLUSIVE MODE');
      acquired(); await released;
    }, { timeout: 30_000 });
    try {
      await Promise.race([locked, holding]);
      const started = Date.now();
      await assert.rejects(db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='250ms'");
        await tx.$executeRawUnsafe(sql);
      }, { timeout: 15_000 }), /lock timeout/);
      assert.ok(Date.now() - started < 5_000);
    } finally { release(); await holding; holding = undefined; }
    await assertAbsent(); assert.deepEqual(await snapshot(), before);

    // A collision at the last DDL statement proves that earlier table,
    // functions and triggers cannot survive a failed standalone DO statement.
    await db.$executeRawUnsafe(`CREATE TRIGGER customer_semantic_truncate_compatibility
      BEFORE TRUNCATE ON public.accounting_settlement_allocations FOR EACH STATEMENT
      EXECUTE FUNCTION public.accounting_reject_immutable_change()`);
    const conflict = await snapshot();
    await assert.rejects(db.$executeRawUnsafe(sql), /already exists/);
    await assertAbsent(); assert.deepEqual(await snapshot(), conflict);
    await db.$executeRawUnsafe('DROP TRIGGER customer_semantic_truncate_compatibility ON public.accounting_settlement_allocations');
    assert.deepEqual(await snapshot(), before);
    await db.$executeRawUnsafe(sql);
    assert.deepEqual(await db.$queryRawUnsafe('SELECT capability,state FROM public.online_financial_compatibility_barriers'),
      [{ capability: 'customer-source-shares/v1', state: 'CLOSED' }]);
    console.log(JSON.stringify({ barrierInstalledAfterFaults: true }));
  } finally {
    release(); if (holding) await holding.catch(() => undefined);
    try { await blocker.$disconnect(); } finally { await db.$disconnect(); }
    console.log(JSON.stringify({ closedBarrierInstallerClientsClosed: true }));
  }
});
