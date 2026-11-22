import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { readPartnerCreationRecoveries, readPartnerCaseRecovery } from '../partnerSales/cases/creationRecoveryMetadata';
import { decodeTechnicalRecovery } from '../partnerSales/cases/technicalRecoveryRecords';

test('creation metadata excludes immutable journal payload while preserving validation, ownership, ordering and stored history', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  assert(['postgres:', 'postgresql:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/sabalanerp');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const owner = `creation-metadata-${randomUUID()}`, caseId = `${owner}-case`, rollback = new Error('fixture rollback');
  try {
    await db.$transaction(async tx => {
      const recovery = { kind: 'partner-technical-recovery', version: 1, recoveryRevision: 1,
        updatedAt: Date.now(), draft: { schemaVersion: 1, inputRevision: 1, rows: [] },
        partnerCaseId: caseId, draftTitle: 'عنوان محفوظ', wizardDraft: { step: 'payment' }, unknownMetadata: 'retained',
        validatedSnapshots: [{ private: 'x'.repeat(500_000) }] };
      for (const [index, item] of [recovery, { ...recovery, draft: { invalid: true } }].entries())
        await tx.salesContractEditSession.create({ data: { draftId: `${owner}-${index}`, ownerUserId: owner,
          purpose: 'PARTNER_TECHNICAL', browserSessionId: 'browser', leaseToken: randomUUID(), schemaVersion: 1, baseRevision: index,
          updatedAt: new Date(Date.now() + index * 1000), recovery: item } });
      const result = await readPartnerCreationRecoveries(tx, owner, caseId);
      assert.deepEqual(result.rawDrafts.map(row => row.baseRevision), [1, 0]);
      assert.equal(result.requestedRecovery?.baseRevision, 1);
      for (const row of [...result.rawDrafts, result.requestedRecovery!]) {
        assert(!('validatedSnapshots' in (row.recovery as object)), 'metadata must not transport the full historical journal');
        const original = (await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: row.draftId }, select: { recovery: true } })).recovery as any;
        const { validatedSnapshots, ...metadata } = original;
        assert.deepEqual(row.recovery, metadata);
        assert.equal(Boolean(decodeTechnicalRecovery(row.recovery)), Boolean(decodeTechnicalRecovery(original)));
        assert.equal(validatedSnapshots[0].private.length, 500_000, 'stored evidence stays intact');
      }
      const full = await tx.salesContractEditSession.findFirstOrThrow({ where: { ownerUserId: owner,
        purpose: 'PARTNER_TECHNICAL', recovery: { path: ['partnerCaseId'], equals: caseId } },
        select: { draftId: true, baseRevision: true, recovery: true } });
      assert.deepEqual(await readPartnerCaseRecovery(tx, { ownerUserId: owner, caseId }), full);
      const entry = await readPartnerCaseRecovery(tx, { ownerUserId: owner, caseId, navigationOnly: true });
      const { validatedSnapshots: journal, ...metadata } = full.recovery as any;
      assert.deepEqual(entry, { ...full, recovery: metadata });
      assert.equal(Boolean(decodeTechnicalRecovery(entry?.recovery)), Boolean(decodeTechnicalRecovery(full.recovery)));
      assert.equal(journal[0].private.length, 500_000);
      assert.equal(await readPartnerCaseRecovery(tx, { ownerUserId: 'foreign', caseId }), null);
      assert.equal(await readPartnerCaseRecovery(tx, { ownerUserId: owner, caseId: 'other-case' }), null);
      const foreign = await readPartnerCreationRecoveries(tx, 'other-owner', caseId);
      assert.deepEqual(foreign, { rawDrafts: [], requestedRecovery: null });
      assert.equal((await readPartnerCreationRecoveries(tx, owner, 'other-case')).requestedRecovery, null);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
