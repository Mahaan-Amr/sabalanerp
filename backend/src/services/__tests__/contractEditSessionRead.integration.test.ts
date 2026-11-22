import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { readContractEditSession } from '../contractEditSessionRead';

test('complete session transport matches Prisma values without passing a large journal through its JSON value codec', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/sabalanerp');
  const queries: string[] = [];
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [{ emit: 'event', level: 'query' }] });
  db.$on('query', event => queries.push(event.query));
  const draftId = `session-read-${randomUUID()}`, rollback = new Error('rollback fixture');
  try { await db.$transaction(async tx => {
    const journal = Array.from({ length: 30 }, (_, revision) => ({ revision, text: "حکمی ' $1 \\ \n", payload: 'x'.repeat(20_000) }));
    await tx.salesContractEditSession.create({ data: { draftId, ownerUserId: draftId, purpose: 'PARTNER_TECHNICAL',
      browserSessionId: 'browser', leaseToken: randomUUID(), schemaVersion: 1, baseRevision: 0,
      recovery: { validatedSnapshots: journal, draft: { inputRevision: 30 }, unknownMetadata: 'محفوظ' } } });
    const original = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId } });
    queries.length = 0;
    assert.deepEqual(await readContractEditSession(tx, draftId), original);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /convert_to\(recovery::text,\s*'UTF8'\)/,
      'transport the entire JSON document as UTF-8 bytes instead of an expanded Prisma JSON value');
    assert.deepEqual((await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId } })).recovery, original.recovery);
    for (const recovery of [Prisma.JsonNull, Prisma.DbNull, { primitive: true, value: 1.25 }, 'text', []]) {
      await tx.salesContractEditSession.update({ where: { draftId }, data: { recovery } });
      assert.deepEqual(await readContractEditSession(tx, draftId), await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId } }));
    }
    assert.equal(await readContractEditSession(tx, 'missing'), null);
    throw rollback;
  }, { timeout: 20_000 }); } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
