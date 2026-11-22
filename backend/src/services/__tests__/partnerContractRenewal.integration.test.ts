import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPartnerCaseRouter } from '../../routes/partner-cases';
import type { AuthRequest } from '../../middleware/auth';
import { partnerContractCanRenew, renewPartnerContract } from '../partnerSales/cases/commercialLifecycle';

const databaseUrl = process.env.ORDINARY_CONTRACT_QA_DATABASE_URL
  || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10';
const location = new URL(databaseUrl);
assert.ok(location.hostname === '127.0.0.1' && location.port === '55432' && location.pathname === '/sabalanerp',
  'Renewal QA requires the existing sabalanerp-local database');
class RollbackFixture extends Error {}

async function requestRenewal(tx: Prisma.TransactionClient, actor: AuthRequest['user'],
  command: { caseId: string; revision: number; reason: string }) {
  const app = express();
  app.use(express.json());
  app.use(createPartnerCaseRouter({
    database: { $transaction: (work: (client: Prisma.TransactionClient) => unknown) => work(tx) } as PrismaClient,
    authenticate: (request, _response, next) => { (request as AuthRequest).user = actor; next(); },
  }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/${command.caseId}/commercial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RENEW', revision: command.revision, reason: command.reason }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

for (const role of ['ADMIN', 'MANAGER'] as const) test(`Partner renewal as ${role} preserves financial terms, resets approvals, and audits its reason`, async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assert.rejects(database.$transaction(async tx => {
      const root = await tx.partnerSaleCase.findFirstOrThrow({ where: {
        customerContractId: { not: null }, state: { notIn: ['CANCELLED', 'VOIDED'] },
      }, include: { customerContract: true, profile: { include: { user: true } } } });
      const source = root.customerContract!;
      const fixtureUsername = `renewal-${crypto.randomUUID()}`;
      const actor = role === 'ADMIN'
        ? await tx.user.findFirstOrThrow({ where: { role, isActive: true, partnerProfile: null } })
        : await tx.user.create({ data: { role, username: fixtureUsername, email: `${fixtureUsername}@example.invalid`,
          password: 'test-only', firstName: 'Renewal', lastName: 'Fixture' } });
      const revision = Math.max(source.commercialRevision, 1);
      const before = await tx.salesContract.update({ where: { id: source.id }, data: {
        commercialFlowVersion: 2, status: 'EXPIRED', isInactive: false, firstFinancialRecordAt: null,
        commercialRevision: revision,
        commercialExpiryDays: 7, commercialExpiresAt: new Date(0), dispatchExpiryExempt: false,
        salesApprovalRevision: revision, customerAcceptanceRevision: revision,
        isSigned: true, signatures: { approve: { old: true }, sign: { old: true }, unrelated: 'retained' },
      } });
      const confirmation = await tx.contractPublicConfirmation.create({ data: {
        contractId: source.id, commercialRevision: before.commercialRevision, tokenHash: `renewal-${crypto.randomUUID()}`,
        phoneNumber: '09120000000', otpCodeHash: 'synthetic-test-hash',
        otpExpiresAt: new Date(Date.now() + 60000), linkExpiresAt: new Date(Date.now() + 60000),
      } });
      assert.equal(partnerContractCanRenew(before, root.state), true);
      const command = { caseId: root.id, actorId: actor.id, revision: before.commercialRevision, reason: ' تمدید آزمایشی مهلت قرارداد همکار ' };
      await assert.rejects(renewPartnerContract(tx, { ...command, reason: ' ' }), /دلیل تمدید/);
      await assert.rejects(renewPartnerContract(tx, { ...command, revision: command.revision + 1 }), /تغییر کرده/);
      const deniedOwner = await requestRenewal(tx, root.profile.user, command);
      assert.equal(deniedOwner.status, 403);
      if (role === 'MANAGER') {
        const permission = await tx.workspacePermission.create({ data: {
          userId: actor.id, workspace: 'sales', permissionLevel: 'edit',
        } });
        const deniedManager = await requestRenewal(tx, actor, command);
        assert.ok([403, 404].includes(deniedManager.status), JSON.stringify(deniedManager.body));
        await tx.workspacePermission.update({ where: { id: permission.id }, data: { permissionLevel: 'admin' } });
        const otherDepartment = await tx.department.create({ data: { name: fixtureUsername, namePersian: fixtureUsername } });
        const scopedActor = await tx.user.update({ where: { id: actor.id }, data: { departmentId: otherDepartment.id } });
        const deniedScope = await requestRenewal(tx, scopedActor, command);
        assert.equal(deniedScope.status, 409);
        await tx.user.update({ where: { id: actor.id }, data: { departmentId: null } });
      }
      assert.equal((await requestRenewal(tx, actor, { ...command, reason: ' ' })).status, 400);
      assert.equal((await requestRenewal(tx, actor, { ...command, revision: revision + 1 })).status, 409);
      assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: source.id } })).commercialRevision, revision);
      const reply = await requestRenewal(tx, actor, command);
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.deepEqual(reply.body, { success: true });
      const renewed = await tx.salesContract.findUniqueOrThrow({ where: { id: source.id } });
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
        actorId: actor.id, action: 'COMMERCIAL_EXPIRY_RENEWED', note: command.reason.trim() } }));
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
