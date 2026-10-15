import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { readRecoveryForDisplay } from '../partnerSales/cases/recoveryDisplayRead';

test('display readers transport only candidate evidence while preserving ordering, malformed metadata and the stored journal', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/sabalanerp');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const draftId = `display-read-${randomUUID()}`, rollback = new Error('rollback fixture');
  try { await db.$transaction(async tx => {
    const history = [1, 2, 3, 2, 4].map((revision, index) => ({ payload: {
      view: { recoveryRevision: revision }, index, largeCatalog: 'x'.repeat(100_000) }, integrityHash: `hash-${index}` }));
    const recovery = { kind: 'partner-technical-recovery', version: 1, recoveryRevision: 4, updatedAt: Date.now(),
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }, unknown: { preserved: true },
      wizardDraft: { intent: { recoveryRevision: 2 } }, validatedSnapshots: history };
    const original = await tx.salesContractEditSession.create({ data: { draftId, ownerUserId: draftId,
      purpose: 'PARTNER_TECHNICAL', browserSessionId: 'browser', leaseToken: randomUUID(), schemaVersion: 1, baseRevision: 0,
      recovery } });
    const latest = await readRecoveryForDisplay(tx, draftId, { kind: 'latest' });
    assert.deepEqual(latest, { ...original, recovery: { ...recovery, validatedSnapshots: [history.at(-1)] } });
    for (const selection of [{ kind: 'wizard' as const }, { kind: 'revision' as const, revision: 2 }]) {
      const selected = await readRecoveryForDisplay(tx, draftId, selection);
      const projected = (selected!.recovery as any).validatedSnapshots;
      // SQL may conservatively retain adjacent numeric hints; only JS decoding
      // decides exact revision and authenticity. It must omit unrelated catalogs.
      assert(projected.length < history.length);
      assert.deepEqual(projected.filter((r: any) => r.payload.view.recoveryRevision === 2), history.filter(r => r.payload.view.recoveryRevision === 2));
      assert.deepEqual({ ...selected, recovery: null }, { ...original, recovery: null });
      assert.deepEqual({ ...(selected!.recovery as object), validatedSnapshots: history }, recovery);
    }
    assert.deepEqual((await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId } })).recovery, recovery);
    // Preserve JavaScript hint selection even for rounded database JSON numbers,
    // and never cast arbitrary strings/objects or overflowing doubles in SQL.
    const unusual = '[{"payload":{"view":{"recoveryRevision":2.0000000000000001}}},' +
      '{"payload":{"view":{"recoveryRevision":"2"}}},null,{},' +
      '{"payload":{"view":{"recoveryRevision":1e300}}},' +
      '{"payload":{"view":{"recoveryRevision":9007199254740991.25}}}]';
    await tx.$executeRaw`UPDATE sales_contract_edit_sessions SET recovery = jsonb_set(recovery,
      '{validatedSnapshots}', ${unusual}::jsonb) WHERE "draftId" = ${draftId}`;
    const untrusted = (await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId } })).recovery as any;
    for (const revision of [2, Number.MAX_SAFE_INTEGER]) {
      const projected = (await readRecoveryForDisplay(tx, draftId, { kind: 'revision', revision }))!.recovery as any;
      const exact = (records: any[]) => records.filter(r => r?.payload?.view?.recoveryRevision === revision);
      assert.deepEqual(exact(projected.validatedSnapshots), exact(untrusted.validatedSnapshots));
    }
    for (const invalid of [null, 'invalid', { ...recovery, validatedSnapshots: null }, { ...recovery, validatedSnapshots: {} }, { ...recovery, validatedSnapshots: [] }]) {
      await tx.salesContractEditSession.update({ where: { draftId }, data: { recovery: invalid === null ? Prisma.JsonNull : invalid } });
      assert.deepEqual((await readRecoveryForDisplay(tx, draftId, { kind: 'latest' }))?.recovery, invalid);
    }
    assert.equal(await readRecoveryForDisplay(tx, 'missing', { kind: 'latest' }), null);
    throw rollback;
  }, { timeout: 20_000 }); } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
