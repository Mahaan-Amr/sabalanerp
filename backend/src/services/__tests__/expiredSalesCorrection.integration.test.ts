import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expireCommercialCorrectionPeriods } from '../ordinaryContractLifecycle';
import { requestAccountingSalesContractCorrection } from '../salesContractCorrectionDuty';
import { respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import { listCrossWorkspaceDuties } from '../crossWorkspaceDutyInbox';
import { addTehranWorkingDays } from '../tehranBusinessCalendar';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10';
const url = new URL(databaseUrl);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432', 'Use the existing sabalanerp-local database only');
class Rollback extends Error {}

for (const flow of [0, 1]) test(`expired correction returns to Accounting, renews only by manager, and closes without changing the Contract (flow ${flow})`, async () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assert.rejects(db.$transaction(async tx => {
      const key = `expiry-${randomUUID()}`;
      const [manager, seller, accountant, outsider] = await Promise.all(['manager', 'seller', 'accountant', 'outsider'].map(name => tx.user.create({ data: {
        email: `${key}-${name}@example.invalid`, username: `${key}-${name}`, password: 'not-a-login-secret',
        firstName: name, lastName: 'آزمون', role: name === 'manager' ? 'ADMIN' : 'USER',
      } })));
      const department = await tx.department.create({ data: { name: key, namePersian: 'آزمون انقضا' } });
      const customer = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: key, createdBy: seller.id } });
      await tx.featurePermission.create({ data: { userId: accountant.id, workspace: 'accounting', feature: 'accounting_corrections_verify', permissionLevel: 'edit', grantedBy: manager.id } });
      const contract = await tx.salesContract.create({ data: {
        contractNumber: `100608-${key}`, title: key, titlePersian: 'آزمون انقضا', content: 'نسخه محفوظ',
        customerId: customer.id, departmentId: department.id, createdBy: seller.id, responsibleSellerId: seller.id,
        commercialFlowVersion: flow, commercialRevision: 1, salesApprovalRevision: 1, customerAcceptanceRevision: 1,
        status: 'SIGNED', totalAmount: 100,
      } });
      const now = new Date();
      const request = await requestAccountingSalesContractCorrection(tx, { contractId: contract.id, actorUserId: manager.id,
        category: 'OTHER', priority: 'MEDIUM', reason: 'اصلاح آزمایشی', idempotencyKey: key, now });
      const answer = async (duty: { id: string; sourceVersion: number; envelopeVersion: number }, actionCode: string, actorUserId = manager.id, at = now) => respondToCrossWorkspaceDuty(tx, {
        dutyId: duty.id, actorUserId, actionCode, expectedSourceVersion: duty.sourceVersion,
        expectedEnvelopeVersion: duty.envelopeVersion, reason: 'دلیل آزمایشی تصمیم', policyVersion: 2, now: at,
      });
      const approved = await answer(request.duty, 'APPROVE');
      const expiredAt = new Date(now.getTime() - 1_000);
      await tx.crossWorkspaceDuty.update({ where: { id: approved.successor.id }, data: { dueAt: expiredAt } });
      const sellerBefore = await listCrossWorkspaceDuties(tx, { actorUserId: seller.id, workspaceCode: 'sales', view: 'assigned', now });
      assert.ok(!sellerBefore.some(row => row.id === approved.successor.id), 'expired Sales duty must be hidden even before the worker runs');
      // Run the real worker, restricting only its candidate scan to this rollback fixture.
      const worker = new Proxy(tx, { get(target, property) {
        if (property === '$transaction') return (work: (transaction: Prisma.TransactionClient) => unknown) => work(tx);
        if (property === 'crossWorkspaceDuty') return new Proxy(tx.crossWorkspaceDuty, { get(delegate, method) {
          if (method === 'findMany') return (args: any) => delegate.findMany({ ...args, where: { AND: [args.where, { sourceId: request.correction.id }] } });
          return Reflect.get(delegate, method);
        } });
        return Reflect.get(target, property);
      } }) as unknown as PrismaClient;
      await expireCommercialCorrectionPeriods(worker, now);
      await expireCommercialCorrectionPeriods(worker, now);
      const reviews = await tx.crossWorkspaceDuty.findMany({ where: { sourceId: request.correction.id, status: 'OPEN' } });
      assert.equal(reviews.length, 1, 'repeat expiry must create exactly one active successor');
      assert.equal(reviews[0].sourceActionCode, 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION');
      assert.equal(reviews[0].currentAssigneeUserId, null);
      const accounting = await listCrossWorkspaceDuties(tx, { actorUserId: accountant.id, workspaceCode: 'accounting', view: 'assigned', now });
      assert.ok(accounting.some(row => row.id === reviews[0].id), 'review belongs in eligible Accounting My Duties');
      const unauthorized = await listCrossWorkspaceDuties(tx, { actorUserId: outsider.id, workspaceCode: 'accounting', view: 'assigned', now });
      assert.ok(!unauthorized.some(row => row.id === reviews[0].id));
      const history = await listCrossWorkspaceDuties(tx, { actorUserId: seller.id, workspaceCode: 'sales', view: 'history', now });
      assert.ok(history.some(row => row.id === approved.successor.id), 'seller retains immutable expiry history');
      const search = (actorUserId: string, search: string) => listCrossWorkspaceDuties(tx, { actorUserId, workspaceCode: 'sales', view: 'history', search, now });
      assert.ok((await search(seller.id, '۱۰۰۶۰۸')).some(row => row.id === approved.successor.id), 'Persian digits match Contract number');
      assert.ok((await search(seller.id, 'مشتري')).some(row => row.id === approved.successor.id), 'Arabic/Persian spelling matches the authorized Customer name');
      assert.ok(!(await search(outsider.id, key)).some(row => row.id === approved.successor.id), 'search cannot expose another Seller history');
      assert.equal((await search(seller.id, '%')).length, 0, 'wildcards are literal text');
      await assert.rejects(answer(reviews[0], 'APPROVE', accountant.id), /ACTION_NOT_ALLOWED/);
      const renewal = await answer(reviews[0], 'RETURN_TO_SELLER', accountant.id);
      assert.equal(renewal.successor.sourceActionCode, 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION');
      await assert.rejects(answer(renewal.successor, 'APPROVE', accountant.id), /INELIGIBLE/);
      const rejected = await answer(renewal.successor, 'DECLINE');
      assert.equal(rejected.correction.status, 'SALES_EDITED', 'manager rejection returns to Accounting review');
      assert.equal(rejected.successor.sourceActionCode, 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION');
      const requestedAgain = await answer(rejected.successor, 'RETURN_TO_SELLER', accountant.id);
      const renewedAt = new Date(now.getTime() + 60_000);
      const renewed = await answer(requestedAgain.successor, 'APPROVE', manager.id, renewedAt);
      assert.equal(renewed.successor.currentAssigneeUserId, seller.id);
      assert.equal(renewed.successor.dueAt.toISOString(), addTehranWorkingDays(renewedAt, 3).toISOString());
      assert.notEqual(renewed.successor.id, approved.successor.id);
      await tx.crossWorkspaceDuty.update({ where: { id: renewed.successor.id }, data: { dueAt: renewedAt } });
      const closingAt = new Date(renewedAt.getTime() + 1_000);
      await expireCommercialCorrectionPeriods(worker, closingAt);
      const closing = await tx.crossWorkspaceDuty.findFirstOrThrow({ where: { sourceId: request.correction.id, status: 'OPEN' } });
      await assert.rejects(respondToCrossWorkspaceDuty(tx, { dutyId: closing.id, actorUserId: accountant.id, actionCode: 'VERIFY',
        expectedSourceVersion: closing.sourceVersion, expectedEnvelopeVersion: closing.envelopeVersion,
        reason: null, policyVersion: 2, now: closingAt }), /REASON_REQUIRED/);
      const financial = await tx.accountingFinancialRecord.create({ data: { contractId: contract.id, kind: 'INVOICE_CANDIDATE',
        sourceKind: 'SALES_CONTRACT', amount: 1, createdBy: manager.id } });
      await assert.rejects(answer(closing, 'VERIFY', accountant.id, closingAt), /DUTY_CORRECTION_FINANCIAL_WORKFLOW_INCOMPLETE/);
      assert.equal((await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: closing.id } })).status, 'OPEN');
      await tx.accountingFinancialRecord.delete({ where: { id: financial.id } });
      const closed = await answer(closing, 'VERIFY', accountant.id, closingAt);
      assert.equal(closed.correction.status, 'RESOLVED');
      assert.deepEqual(await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } }), contract, 'expiry and disposition must not mutate the Contract');
      assert.equal(await tx.crossWorkspaceDuty.count({ where: { sourceId: request.correction.id, status: 'OPEN' } }), 0);
      throw new Rollback();
    }, { timeout: 30_000 }), Rollback);
  } finally { await db.$disconnect(); }
});
