import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { partnerContractCanRenew, renewPartnerContract } from '../partnerSales/cases/commercialLifecycle';

const databaseUrl = process.env.ORDINARY_CONTRACT_QA_DATABASE_URL
  || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10';
const location = new URL(databaseUrl);
assert.ok(location.hostname === '127.0.0.1' && location.port === '55432' && location.pathname === '/sabalanerp',
  'Renewal QA requires the existing sabalanerp-local database');
class RollbackFixture extends Error {}

test('Partner renewal preserves the Case and financial terms, invalidates approvals and links, and audits its reason', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assert.rejects(database.$transaction(async tx => {
      const root = await tx.partnerSaleCase.findFirstOrThrow({ where: {
        customerContractId: { not: null }, state: { notIn: ['CANCELLED', 'VOIDED'] },
      }, include: { customerContract: true } });
      const source = root.customerContract!;
      const actor = await tx.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
      const before = await tx.salesContract.update({ where: { id: source.id }, data: {
        commercialFlowVersion: 2, status: 'EXPIRED', isInactive: false, firstFinancialRecordAt: null,
        commercialExpiryDays: 7, commercialExpiresAt: new Date(0), dispatchExpiryExempt: false,
        salesApprovalRevision: source.commercialRevision, customerAcceptanceRevision: source.commercialRevision,
        isSigned: true, signatures: { approve: { old: true }, sign: { old: true }, unrelated: 'retained' },
      } });
      const confirmation = await tx.contractPublicConfirmation.create({ data: {
        contractId: source.id, commercialRevision: source.commercialRevision, tokenHash: `renewal-${crypto.randomUUID()}`,
        phoneNumber: '09120000000', otpCodeHash: 'synthetic-test-hash',
        otpExpiresAt: new Date(Date.now() + 60000), linkExpiresAt: new Date(Date.now() + 60000),
      } });
      assert.equal(partnerContractCanRenew(before, root.state), true);
      const command = { caseId: root.id, actorId: actor.id, revision: before.commercialRevision, reason: ' تمدید آزمایشی مهلت قرارداد همکار ' };
      await assert.rejects(renewPartnerContract(tx, { ...command, reason: ' ' }), /دلیل تمدید/);
      await assert.rejects(renewPartnerContract(tx, { ...command, revision: command.revision + 1 }), /تغییر کرده/);
      const renewed = await renewPartnerContract(tx, command);
      assert.equal(renewed.status, 'DRAFT');
      assert.equal(renewed.commercialRevision, before.commercialRevision + 1);
      assert.equal(renewed.salesApprovalRevision, null);
      assert.equal(renewed.customerAcceptanceRevision, null);
      assert.equal(renewed.isSigned, false);
      assert.deepEqual(renewed.signatures, { approve: null, sign: null, customerAcceptance: null, digitalConfirmation: null, unrelated: 'retained' });
      assert.ok(Math.abs(renewed.commercialExpiresAt!.getTime() - Date.now() - 7 * 86400000) < 5000);
      assert.equal(renewed.commercialExpiryDays, 7);
      assert.equal(renewed.totalAmount?.toString(), before.totalAmount?.toString());
      assert.equal(renewed.currency, before.currency);
      assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: root.id } })).state, root.state);
      assert.equal((await tx.contractPublicConfirmation.findUniqueOrThrow({ where: { id: confirmation.id } })).status, 'CANCELLED');
      assert.ok(await tx.accountingAuditLog.findFirst({ where: { contractId: source.id,
        action: 'COMMERCIAL_EXPIRY_RENEWED', note: command.reason.trim() } }));
      await assert.rejects(renewPartnerContract(tx, { ...command, revision: renewed.commercialRevision }), /قابل تمدید نیست/);
      for (const patch of [{ isInactive: true }, { firstFinancialRecordAt: new Date() },
        { status: 'CANCELLED' as const }, { status: 'DRAFT' as const, commercialExpiresAt: new Date(Date.now() + 60000) },
        { status: 'SIGNED' as const, dispatchExpiryExempt: true }]) {
        assert.equal(partnerContractCanRenew({ ...before, ...patch }, root.state), false);
      }
      for (const state of ['CANCELLED', 'VOIDED']) assert.equal(partnerContractCanRenew(before, state), false);
      throw new RollbackFixture();
    }, { timeout: 30000 }), RollbackFixture);
  } finally { await database.$disconnect(); }
});
