import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { getCrossWorkspaceDutyDetail, getCrossWorkspaceDutySummary, listCrossWorkspaceDuties } from '../crossWorkspaceDutyInbox';
import { claimCrossWorkspaceDuty, reassignCrossWorkspaceDuty, respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import {
  completeSalesContractCorrectionEdit,
  reconcileSalesContractCorrectionDuties,
  requestSalesContractCorrection,
} from '../salesContractCorrectionDuty';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

const rollback = new Error('ROLLBACK_SALES_CONTRACT_CORRECTION_DUTY_TEST');

test('Responsible Seller creates one correction request assigned to an eligible Accounting processor', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `seller-correction-${Date.now()}`;
      const [seller, alternateManager, processor] = await Promise.all([
        tx.user.create({ data: {
          email: `${suffix}-seller@example.invalid`, username: `${suffix}-seller`, password: 'not-a-login-secret',
          firstName: 'Responsible', lastName: 'Seller',
        } }),
        tx.user.create({ data: {
          email: `${suffix}-alternate-manager@example.invalid`, username: `${suffix}-alternate-manager`, password: 'not-a-login-secret',
          firstName: 'Alternate', lastName: 'Manager',
        } }),
        tx.user.create({ data: {
          email: `${suffix}-processor@example.invalid`, username: `${suffix}-processor`, password: 'not-a-login-secret',
          firstName: 'Accounting', lastName: 'Processor',
        } }),
      ]);
      const [department, customer] = await Promise.all([
        tx.department.create({ data: { name: `${suffix}-department`, namePersian: `${suffix}-department-fa` } }),
        tx.crmCustomer.create({ data: { firstName: 'Test', lastName: 'Customer', createdBy: seller.id } }),
      ]);
      const contract = await tx.salesContract.create({ data: {
        contractNumber: `SC-${suffix}`, title: 'Contract correction', titlePersian: 'اصلاح قرارداد',
        content: 'Contract content', customerId: customer.id, departmentId: department.id,
        createdBy: seller.id, responsibleSellerId: seller.id,
      } });
      await Promise.all([
        tx.workspacePermission.create({ data: {
          userId: processor.id, workspace: 'accounting', permissionLevel: 'admin', grantedBy: seller.id,
        } }),
        tx.featurePermission.create({ data: {
          userId: processor.id, workspace: 'accounting', feature: 'accounting_corrections_manage',
          permissionLevel: 'admin', grantedBy: seller.id,
        } }),
        tx.workspacePermission.create({ data: {
          userId: alternateManager.id, workspace: 'accounting', permissionLevel: 'admin', grantedBy: seller.id,
        } }),
        tx.featurePermission.create({ data: {
          userId: alternateManager.id, workspace: 'accounting', feature: 'accounting_corrections_manage',
          permissionLevel: 'admin', grantedBy: seller.id,
        } }),
      ]);

      const created = await requestSalesContractCorrection(tx, {
        contractId: contract.id,
        actorUserId: seller.id,
        category: 'AMOUNT_PRICING',
        priority: 'HIGH',
        reason: 'مبلغ قرارداد نیازمند اصلاح است.',
        idempotencyKey: `${suffix}:request`,
        now: new Date('2026-08-16T08:00:00.000Z'),
      });

      assert.deepEqual({
        sourceStatus: created.correction.status,
        dutyAction: created.duty.sourceActionCode,
        assignee: created.duty.currentAssigneeUserId,
        destination: created.duty.destinationWorkspaceCode,
      }, {
        sourceStatus: 'OPEN',
        dutyAction: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
        assignee: null,
        destination: 'ACCOUNTING',
      });

      const available = await listCrossWorkspaceDuties(tx, {
        actorUserId: processor.id,
        workspaceCode: 'ACCOUNTING',
        view: 'available',
        now: new Date('2026-08-16T08:02:00.000Z'),
      });
      assert.deepEqual(available.map(({ id, access }) => ({ id, access })), [
        { id: created.duty.id, access: 'AVAILABLE' },
      ]);
      assert.deepEqual(await getCrossWorkspaceDutySummary(tx, {
        actorUserId: processor.id,
        workspaceCode: 'ACCOUNTING',
        now: new Date('2026-08-16T08:02:00.000Z'),
      }), {
        open: 0,
        available: 1,
        dueSoon: 0,
        overdue: 0,
        triage: 1,
        canManageTriage: true,
      });

      const claimed = await claimCrossWorkspaceDuty(tx, {
        dutyId: created.duty.id,
        actorUserId: processor.id,
        policyVersion: 1,
        now: new Date('2026-08-16T08:03:00.000Z'),
      });
      assert.equal(claimed.currentAssigneeUserId, processor.id);

      const detail = await getCrossWorkspaceDutyDetail(tx, {
        dutyId: created.duty.id,
        actorUserId: processor.id,
        workspaceCode: 'ACCOUNTING',
        now: new Date('2026-08-16T08:05:00.000Z'),
      });
      assert.deepEqual(detail.fields, {
        title: `اصلاح قرارداد ${contract.contractNumber}`,
        description: 'مبلغ قرارداد نیازمند اصلاح است.',
        dueAt: '2026-08-17T08:00:00.000Z',
      });
      const reconciliation = await reconcileSalesContractCorrectionDuties(tx, { sourceIds: [created.correction.id] });
      assert.deepEqual(reconciliation, {
        ok: true,
        counts: { actionableSources: 1, openDuties: 1, grandfatheredLegacySources: 0 },
        findings: [],
      });

      const replay = await requestSalesContractCorrection(tx, {
        contractId: contract.id,
        actorUserId: seller.id,
        category: 'AMOUNT_PRICING',
        priority: 'HIGH',
        reason: 'مبلغ قرارداد نیازمند اصلاح است.',
        idempotencyKey: `${suffix}:request`,
        now: new Date('2026-08-16T08:01:00.000Z'),
      });
      assert.deepEqual({ correctionId: replay.correction.id, dutyId: replay.duty.id, replayed: replay.replayed }, {
        correctionId: created.correction.id,
        dutyId: created.duty.id,
        replayed: true,
      });

      await assert.rejects(requestSalesContractCorrection(tx, {
        contractId: contract.id,
        actorUserId: seller.id,
        category: 'AMOUNT_PRICING',
        priority: 'HIGH',
        reason: 'درخواست فعال تکراری',
        idempotencyKey: `${suffix}:duplicate`,
        now: new Date('2026-08-16T08:10:00.000Z'),
      }), /DUTY_ACTIVE_CHAIN_CONFLICT/);

      const forwarded = await respondToCrossWorkspaceDuty(tx, {
        dutyId: created.duty.id,
        actorUserId: processor.id,
        actionCode: 'FORWARD_TO_MANAGER',
        expectedSourceVersion: 1,
        expectedEnvelopeVersion: 1,
        reason: 'نیازمند تصمیم مدیر حسابداری است.',
        policyVersion: 1,
        now: new Date('2026-08-16T09:00:00.000Z'),
      });
      assert.deepEqual({
        sourceStatus: forwarded.correction.status,
        predecessorStatus: forwarded.predecessor.status,
        dutyAction: forwarded.successor.sourceActionCode,
        assignee: forwarded.successor.currentAssigneeUserId,
      }, {
        sourceStatus: 'ACKNOWLEDGED',
        predecessorStatus: 'COMPLETED',
        dutyAction: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
        assignee: null,
      });

      await claimCrossWorkspaceDuty(tx, {
        dutyId: forwarded.successor.id,
        actorUserId: processor.id,
        policyVersion: 1,
        now: new Date('2026-08-16T09:05:00.000Z'),
      });
      const reassigned = await reassignCrossWorkspaceDuty(tx, {
        dutyId: forwarded.successor.id,
        actorUserId: processor.id,
        targetUserId: alternateManager.id,
        expectedAssigneeUserId: processor.id,
        reason: 'مدیر جایگزین پرونده را بررسی می‌کند.',
        policyVersion: 1,
        now: new Date('2026-08-16T09:10:00.000Z'),
      });
      assert.deepEqual({
        assignee: reassigned.currentAssigneeUserId,
        dueAt: reassigned.dueAt.toISOString(),
      }, {
        assignee: alternateManager.id,
        dueAt: forwarded.successor.dueAt.toISOString(),
      });

      const approved = await respondToCrossWorkspaceDuty(tx, {
        dutyId: forwarded.successor.id,
        actorUserId: alternateManager.id,
        actionCode: 'APPROVE',
        expectedSourceVersion: 2,
        expectedEnvelopeVersion: 1,
        reason: null,
        policyVersion: 1,
        now: new Date('2026-08-16T10:00:00.000Z'),
      });
      assert.deepEqual({
        sourceStatus: approved.correction.status,
        predecessorStatus: approved.predecessor.status,
        dutyAction: approved.successor.sourceActionCode,
        assignee: approved.successor.currentAssigneeUserId,
        dueAt: approved.successor.dueAt.toISOString(),
      }, {
        sourceStatus: 'APPROVED_FOR_SALES_EDIT',
        predecessorStatus: 'COMPLETED',
        dutyAction: 'SALES_EDIT_CONTRACT_CORRECTION',
        assignee: seller.id,
        dueAt: '2026-08-19T10:00:00.000Z',
      });

      const edited = await completeSalesContractCorrectionEdit(tx, {
        contractId: contract.id,
        actorUserId: seller.id,
        note: 'مبلغ قرارداد اصلاح شد.',
        policyVersion: 1,
        now: new Date('2026-08-17T08:00:00.000Z'),
      });
      assert.deepEqual({
        sourceStatus: edited.correction.status,
        predecessorStatus: edited.predecessor.status,
        dutyAction: edited.successor.sourceActionCode,
        assignee: edited.successor.currentAssigneeUserId,
      }, {
        sourceStatus: 'SALES_EDITED',
        predecessorStatus: 'COMPLETED',
        dutyAction: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION',
        assignee: processor.id,
      });

      await assert.rejects(completeSalesContractCorrectionEdit(tx, {
        contractId: contract.id,
        actorUserId: seller.id,
        note: 'ذخیره دوم نباید مجاز باشد.',
        policyVersion: 1,
        now: new Date('2026-08-17T08:05:00.000Z'),
      }), /DUTY_SALES_EDIT_ALREADY_CONSUMED/);

      await assert.rejects(respondToCrossWorkspaceDuty(tx, {
        dutyId: edited.successor.id,
        actorUserId: seller.id,
        actionCode: 'VERIFY',
        expectedSourceVersion: 4,
        expectedEnvelopeVersion: 1,
        reason: null,
        policyVersion: 1,
        now: new Date('2026-08-17T09:00:00.000Z'),
      }), /ASSIGNEE_CHANGED|SEPARATION_OF_DUTIES_CONFLICT/);

      const returned = await respondToCrossWorkspaceDuty(tx, {
        dutyId: edited.successor.id,
        actorUserId: processor.id,
        actionCode: 'RETURN_TO_SELLER',
        expectedSourceVersion: 4,
        expectedEnvelopeVersion: 1,
        reason: 'اصلاح تکمیلی به تصمیم مدیر نیاز دارد.',
        policyVersion: 1,
        now: new Date('2026-08-17T09:05:00.000Z'),
      });
      assert.deepEqual({
        sourceStatus: returned.correction.status,
        dutyAction: returned.successor.sourceActionCode,
        sourceVersion: returned.successor.sourceVersion,
      }, {
        sourceStatus: 'ACKNOWLEDGED',
        dutyAction: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION',
        sourceVersion: 5,
      });

      await claimCrossWorkspaceDuty(tx, {
        dutyId: returned.successor.id,
        actorUserId: processor.id,
        policyVersion: 1,
        now: new Date('2026-08-17T09:07:00.000Z'),
      });

      const reapproved = await respondToCrossWorkspaceDuty(tx, {
        dutyId: returned.successor.id,
        actorUserId: processor.id,
        actionCode: 'APPROVE',
        expectedSourceVersion: 5,
        expectedEnvelopeVersion: 1,
        reason: null,
        policyVersion: 1,
        now: new Date('2026-08-17T09:10:00.000Z'),
      });
      assert.equal(reapproved.successor.sourceVersion, 6);
      const reedited = await completeSalesContractCorrectionEdit(tx, {
        contractId: contract.id,
        actorUserId: seller.id,
        note: 'اصلاح تکمیلی ذخیره شد.',
        policyVersion: 1,
        now: new Date('2026-08-17T09:20:00.000Z'),
      });
      assert.equal(reedited.successor.sourceVersion, 7);
      const verified = await respondToCrossWorkspaceDuty(tx, {
        dutyId: reedited.successor.id,
        actorUserId: processor.id,
        actionCode: 'VERIFY',
        expectedSourceVersion: 7,
        expectedEnvelopeVersion: 1,
        reason: 'اصلاح قرارداد بررسی و تأیید شد.',
        policyVersion: 1,
        now: new Date('2026-08-17T09:25:00.000Z'),
      });
      assert.deepEqual({
        sourceStatus: verified.correction.status,
        predecessorStatus: verified.predecessor.status,
        successor: verified.successor,
      }, {
        sourceStatus: 'RESOLVED',
        predecessorStatus: 'COMPLETED',
        successor: null,
      });

      throw rollback;
    }, { timeout: 180_000 }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('competing Seller requests create exactly one active correction chain', async () => {
  const prisma = new PrismaClient();
  const suffix = `seller-correction-concurrency-${Date.now()}`;
  const seeded = await prisma.$transaction(async (tx) => {
    const [seller, processor] = await Promise.all([
      tx.user.create({ data: {
        email: `${suffix}-seller@example.invalid`, username: `${suffix}-seller`, password: 'not-a-login-secret',
        firstName: 'Concurrent', lastName: 'Seller',
      } }),
      tx.user.create({ data: {
        email: `${suffix}-processor@example.invalid`, username: `${suffix}-processor`, password: 'not-a-login-secret',
        firstName: 'Concurrent', lastName: 'Processor',
      } }),
    ]);
    const [department, customer] = await Promise.all([
      tx.department.create({ data: { name: `${suffix}-department`, namePersian: `${suffix}-department-fa` } }),
      tx.crmCustomer.create({ data: { firstName: 'Concurrent', lastName: 'Customer', createdBy: seller.id } }),
    ]);
    const contract = await tx.salesContract.create({ data: {
      contractNumber: `SC-${suffix}`, title: 'Concurrent correction', titlePersian: 'اصلاح هم‌زمان',
      content: 'Contract content', customerId: customer.id, departmentId: department.id,
      createdBy: seller.id, responsibleSellerId: seller.id,
    } });
    await Promise.all([
      tx.workspacePermission.create({ data: {
        userId: processor.id, workspace: 'accounting', permissionLevel: 'admin', grantedBy: seller.id,
      } }),
      tx.featurePermission.create({ data: {
        userId: processor.id, workspace: 'accounting', feature: 'accounting_corrections_manage',
        permissionLevel: 'admin', grantedBy: seller.id,
      } }),
    ]);
    return { seller, processor, department, customer, contract };
  });
  const first = new PrismaClient();
  const second = new PrismaClient();
  try {
    const request = (database: PrismaClient, idempotencyKey: string) => requestSalesContractCorrection(database, {
      contractId: seeded.contract.id,
      actorUserId: seeded.seller.id,
      category: 'OTHER',
      priority: 'MEDIUM',
      reason: 'تنها یک زنجیره فعال باید ایجاد شود.',
      idempotencyKey,
      now: new Date('2026-08-16T08:00:00.000Z'),
    });
    const outcomes = await Promise.allSettled([
      request(first, `${suffix}:first`),
      request(second, `${suffix}:second`),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    assert.equal(
      rejected?.status === 'rejected' && rejected.reason instanceof Error ? rejected.reason.message : null,
      'DUTY_ACTIVE_CHAIN_CONFLICT',
    );
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    await prisma.$transaction(async (tx) => {
      const corrections = await tx.accountingCorrectionRequest.findMany({
        where: { contractId: seeded.contract.id }, select: { id: true },
      });
      const correctionIds = corrections.map(({ id }) => id);
      const duties = await tx.crossWorkspaceDuty.findMany({
        where: { sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: { in: correctionIds } }, select: { id: true },
      });
      const dutyIds = duties.map(({ id }) => id);
      await tx.crossWorkspaceDutyNotificationIdentity.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await tx.crossWorkspaceDutyAuditVersion.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await tx.crossWorkspaceDutyAssignmentHistory.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await tx.crossWorkspaceDuty.deleteMany({ where: { id: { in: dutyIds } } });
      await tx.accountingAuditLog.deleteMany({ where: { contractId: seeded.contract.id } });
      await tx.accountingCorrectionRequest.deleteMany({ where: { id: { in: correctionIds } } });
      await tx.salesContract.delete({ where: { id: seeded.contract.id } });
      await tx.crmCustomer.delete({ where: { id: seeded.customer.id } });
      await tx.department.delete({ where: { id: seeded.department.id } });
      await tx.featurePermission.deleteMany({ where: { userId: { in: [seeded.seller.id, seeded.processor.id] } } });
      await tx.workspacePermission.deleteMany({ where: { userId: { in: [seeded.seller.id, seeded.processor.id] } } });
      await tx.user.deleteMany({ where: { id: { in: [seeded.seller.id, seeded.processor.id] } } });
    }, { timeout: 120_000 });
    await prisma.$disconnect();
  }
});

test('competing Sales saves consume an approved correction opportunity exactly once', async () => {
  const prisma = new PrismaClient();
  const suffix = `seller-correction-save-concurrency-${Date.now()}`;
  const seeded = await prisma.$transaction(async (tx) => {
    const [seller, accountingAdmin] = await Promise.all([
      tx.user.create({ data: {
        email: `${suffix}-seller@example.invalid`, username: `${suffix}-seller`, password: 'not-a-login-secret',
        firstName: 'Save', lastName: 'Seller',
      } }),
      tx.user.create({ data: {
        email: `${suffix}-accounting@example.invalid`, username: `${suffix}-accounting`, password: 'not-a-login-secret',
        firstName: 'General', lastName: 'Manager', role: 'MANAGER',
      } }),
    ]);
    const [department, customer] = await Promise.all([
      tx.department.create({ data: { name: `${suffix}-department`, namePersian: `${suffix}-department-fa` } }),
      tx.crmCustomer.create({ data: { firstName: 'Save', lastName: 'Customer', createdBy: seller.id } }),
    ]);
    const contract = await tx.salesContract.create({ data: {
      contractNumber: `SC-${suffix}`, title: 'Save concurrency', titlePersian: 'ذخیره هم‌زمان',
      content: 'Contract content', customerId: customer.id, departmentId: department.id,
      createdBy: seller.id, responsibleSellerId: seller.id,
    } });
    return { seller, accountingAdmin, department, customer, contract };
  }, { timeout: 120_000 });
  const first = new PrismaClient();
  const second = new PrismaClient();
  try {
    const created = await requestSalesContractCorrection(prisma, {
      contractId: seeded.contract.id,
      actorUserId: seeded.seller.id,
      category: 'OTHER',
      priority: 'MEDIUM',
      reason: 'فرصت اصلاح فقط یک بار مصرف شود.',
      idempotencyKey: `${suffix}:request`,
    });
    assert.equal((await getCrossWorkspaceDutySummary(prisma, {
      actorUserId: seeded.accountingAdmin.id,
      workspaceCode: 'ACCOUNTING',
    })).canManageTriage, true);
    await claimCrossWorkspaceDuty(prisma, {
      dutyId: created.duty.id, actorUserId: seeded.accountingAdmin.id, policyVersion: 1,
    });
    const forwarded = await respondToCrossWorkspaceDuty(prisma, {
      dutyId: created.duty.id, actorUserId: seeded.accountingAdmin.id,
      actionCode: 'FORWARD_TO_MANAGER',
      expectedSourceVersion: 1, expectedEnvelopeVersion: 1,
      reason: 'تصمیم مدیر لازم است.', policyVersion: 1,
    });
    await claimCrossWorkspaceDuty(prisma, {
      dutyId: forwarded.successor.id, actorUserId: seeded.accountingAdmin.id, policyVersion: 1,
    });
    await respondToCrossWorkspaceDuty(prisma, {
      dutyId: forwarded.successor.id, actorUserId: seeded.accountingAdmin.id,
      actionCode: 'APPROVE', expectedSourceVersion: 2, expectedEnvelopeVersion: 1,
      reason: null, policyVersion: 1,
    });
    const save = (database: PrismaClient, note: string) => completeSalesContractCorrectionEdit(database, {
      contractId: seeded.contract.id,
      actorUserId: seeded.seller.id,
      note,
      policyVersion: 1,
    });
    const outcomes = await Promise.allSettled([
      save(first, 'ذخیره هم‌زمان اول'),
      save(second, 'ذخیره هم‌زمان دوم'),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
    const correction = await prisma.accountingCorrectionRequest.findFirstOrThrow({
      where: { contractId: seeded.contract.id },
    });
    assert.equal(correction.status, 'SALES_EDITED');
    assert.equal(await prisma.crossWorkspaceDuty.count({ where: {
      sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: correction.id,
      sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION', status: 'OPEN',
    } }), 1);
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    await prisma.$transaction(async (tx) => {
      const corrections = await tx.accountingCorrectionRequest.findMany({
        where: { contractId: seeded.contract.id }, select: { id: true },
      });
      const correctionIds = corrections.map(({ id }) => id);
      const duties = await tx.crossWorkspaceDuty.findMany({
        where: { sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: { in: correctionIds } }, select: { id: true },
      });
      const dutyIds = duties.map(({ id }) => id);
      await tx.crossWorkspaceDutyNotificationIdentity.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await tx.crossWorkspaceDutyAuditVersion.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await tx.crossWorkspaceDutyAssignmentHistory.deleteMany({ where: { dutyId: { in: dutyIds } } });
      await tx.crossWorkspaceDuty.deleteMany({ where: { id: { in: dutyIds } } });
      await tx.accountingAuditLog.deleteMany({ where: { contractId: seeded.contract.id } });
      await tx.accountingCorrectionRequest.deleteMany({ where: { id: { in: correctionIds } } });
      await tx.salesContract.delete({ where: { id: seeded.contract.id } });
      await tx.crmCustomer.delete({ where: { id: seeded.customer.id } });
      await tx.department.delete({ where: { id: seeded.department.id } });
      await tx.user.deleteMany({ where: { id: { in: [seeded.seller.id, seeded.accountingAdmin.id] } } });
    }, { timeout: 120_000 });
    await prisma.$disconnect();
  }
});
