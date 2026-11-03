import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '../../lib/prisma';
import { ContractConfirmationService } from '../contractConfirmationService';
import { deliverContractCancellationNotice, enqueueContractCancellationNotice, retryContractCancellationNotice,
  suppressContractCancellationNotices } from '../contractCancellationNotice';

test('cancellation intents commit atomically, retain current recipients, serialize delivery and honor activation periods', async () => {
  const target = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) && target.pathname === '/sabalanerp',
    'Use the existing sabalanerp-local services');
  assert.equal(target.port, target.hostname === 'postgres' ? '5432' : '55432', 'Use the existing Compose PostgreSQL published port');
  const contractIds: string[] = [];
  let customerId: string | undefined;
  const service = new ContractConfirmationService();
  const sent: string[] = [];
  const gateway = { sendContractCancellationMessage: async (input: { phoneNumber: string }) => {
    sent.push(input.phoneNumber); return { success: true, messageId: 404 };
  } };
  try {
    const source = await prisma.salesContract.findFirstOrThrow({ where: { partnerCaseId: null, partnerKind: null } });
    const customer = await prisma.crmCustomer.create({ data: { firstName: 'QA Cancellation', lastName: randomUUID(),
      phoneNumbers: { create: { number: '09120000002', type: 'mobile', isPrimary: true } } }, include: { phoneNumbers: true } });
    customerId = customer.id;
    const create = async (accepted: boolean) => {
      const contract = await prisma.salesContract.create({ data: { contractNumber: `QA-CANCEL-SMS-${randomUUID()}`,
        title: 'Cancellation SMS QA', titlePersian: 'آزمون پیامک لغو', content: 'QA', customerId: customer.id,
        createdBy: source.createdBy, responsibleSellerId: source.responsibleSellerId, departmentId: source.departmentId,
        status: 'DRAFT', commercialFlowVersion: 1, commercialRevision: 2 } });
      contractIds.push(contract.id);
      await prisma.contractPublicConfirmation.create({ data: { contractId: contract.id, tokenHash: randomUUID(),
        phoneNumber: '09120000001', otpCodeHash: 'qa', otpExpiresAt: new Date(), linkExpiresAt: new Date(),
        status: accepted ? 'VERIFIED' : 'PENDING', verifiedAt: accepted ? new Date(Date.now() - 10000) : null,
        commercialRevision: 1, lastSentAt: new Date(Date.now() - 20000) } });
      return contract;
    };
    const accepted = await create(true);
    const rejected = await create(false);
    await service.cancelContract({ contractId: rejected.id, requestedBy: source.createdBy, canCancelApproved: true });
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: rejected.id } }), 0, 'SMS submission alone does not qualify');
    await assert.rejects(prisma.$transaction(async tx => {
      await service.cancelContract({ contractId: accepted.id, requestedBy: source.createdBy, canCancelApproved: true, transaction: tx });
      throw new Error('QA rollback');
    }), /QA rollback/);
    assert.equal((await prisma.salesContract.findUniqueOrThrow({ where: { id: accepted.id } })).status, 'DRAFT');
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: accepted.id } }), 0);
    await service.cancelContract({ contractId: accepted.id, requestedBy: source.createdBy, canCancelApproved: true });
    await service.cancelContract({ contractId: accepted.id, requestedBy: source.createdBy, canCancelApproved: true });
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: accepted.id } }), 1, 'Repeated cancellation does not enqueue another notice');
    const notice = await prisma.contractCancellationNotice.findFirstOrThrow({ where: { contractId: accepted.id } });
    await Promise.all([deliverContractCancellationNotice(prisma, notice.id, gateway), deliverContractCancellationNotice(prisma, notice.id, gateway)]);
    assert.deepEqual(sent, ['09120000002'], 'Deliver once to the current mobile, not historical OTP recipient');
    assert.equal((await prisma.contractPublicConfirmation.findFirstOrThrow({ where: { contractId: accepted.id } })).phoneNumber, '09120000001');
    assert.equal((await prisma.contractCancellationNotice.findUniqueOrThrow({ where: { id: notice.id } })).status, 'SENT');

    const retrying = await create(true);
    await service.cancelContract({ contractId: retrying.id, requestedBy: source.createdBy, canCancelApproved: true });
    const retry = await prisma.contractCancellationNotice.findFirstOrThrow({ where: { contractId: retrying.id } });
    await deliverContractCancellationNotice(prisma, retry.id, { sendContractCancellationMessage: async () => ({ success: false, error: 'QA rejected', failureKind: 'PROVIDER_REJECTION' as const }) });
    assert.equal((await prisma.salesContract.findUniqueOrThrow({ where: { id: retrying.id } })).status, 'CANCELLED');
    await prisma.phoneNumber.update({ where: { id: customer.phoneNumbers[0].id }, data: { number: '09120000003' } });
    await prisma.$transaction(tx => retryContractCancellationNotice(tx, { contractId: retrying.id, actorId: source.createdBy }));
    await deliverContractCancellationNotice(prisma, retry.id, gateway);
    const attempts = await prisma.contractCancellationNoticeAttempt.findMany({ where: { noticeId: retry.id }, orderBy: { sequence: 'asc' } });
    assert.deepEqual(attempts.map(attempt => attempt.phoneNumber), ['09120000002', '09120000003']);
    assert.deepEqual(attempts.map(attempt => attempt.status), ['FAILED', 'SENT']);

    const reactivated = await create(true);
    await service.cancelContract({ contractId: reactivated.id, requestedBy: source.createdBy, canCancelApproved: true });
    const oldNotice = await prisma.contractCancellationNotice.findFirstOrThrow({ where: { contractId: reactivated.id } });
    await prisma.$transaction(async tx => {
      await tx.salesContract.update({ where: { id: reactivated.id }, data: { status: 'DRAFT' } });
      await tx.contractConfirmationAuditLog.create({ data: { contractId: reactivated.id, eventType: 'CONTRACT_REACTIVATED' } });
      await suppressContractCancellationNotices(tx, reactivated.id);
    });
    await deliverContractCancellationNotice(prisma, oldNotice.id, gateway);
    assert.equal((await prisma.contractCancellationNotice.findUniqueOrThrow({ where: { id: oldNotice.id } })).status, 'SUPPRESSED');
    await service.cancelContract({ contractId: reactivated.id, requestedBy: source.createdBy, canCancelApproved: true });
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: reactivated.id } }), 1, 'Previous activation acceptance cannot qualify a new cancellation');
    await prisma.contractPublicConfirmation.updateMany({ where: { contractId: reactivated.id }, data: { verifiedAt: new Date(Date.now() + 1000) } });
    const newNotice = await prisma.$transaction(tx => enqueueContractCancellationNotice(tx, { contractId: reactivated.id, eventKey: randomUUID(), at: new Date() }));
    assert.ok(newNotice, 'Fresh digital acceptance qualifies for a new period');
  } finally {
    const notices = await prisma.contractCancellationNotice.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } });
    await prisma.contractCancellationNoticeAttempt.deleteMany({ where: { noticeId: { in: notices.map(notice => notice.id) } } });
    await prisma.contractCancellationNotice.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.salesReportingEvent.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractConfirmationAuditLog.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractPublicConfirmation.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.salesContract.deleteMany({ where: { id: { in: contractIds } } });
    if (customerId) await prisma.crmCustomer.delete({ where: { id: customerId } });
    await disconnectDatabase();
  }
});
