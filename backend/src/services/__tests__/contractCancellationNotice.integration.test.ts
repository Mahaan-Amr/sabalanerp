import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '../../lib/prisma';
import { ContractConfirmationService } from '../contractConfirmationService';
import { reactivateOrdinaryContract } from '../ordinaryContractReactivation';
import { expireOrdinaryContracts } from '../ordinaryContractLifecycle';
import smsService from '../smsService';
import { deliverContractCancellationNotice, deliverPendingContractCancellationNotices,
  retryContractCancellationNotice } from '../contractCancellationNotice';

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
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
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
    const paper = await create(false);
    await prisma.contractPublicConfirmation.deleteMany({ where: { contractId: paper.id } });
    await prisma.salesContract.update({ where: { id: paper.id }, data: {
      customerAcceptanceMethod: 'PAPER', customerAcceptanceRevision: 2 } });
    await service.cancelContract({ contractId: paper.id, requestedBy: source.createdBy, canCancelApproved: true });
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: paper.id } }), 0, 'Paper-only acceptance does not qualify');
    const expired = await create(true);
    await prisma.salesContract.update({ where: { id: expired.id }, data: { commercialExpiresAt: new Date(Date.now() - 1000) } });
    const expiryDatabase = new Proxy(prisma, { get(target, property) {
      if (property === 'salesContract') return new Proxy(target.salesContract, { get(delegate, operation) {
        if (operation === 'findMany') return (query: any) => delegate.findMany({ ...query,
          where: { ...query.where, id: expired.id } });
        return Reflect.get(delegate, operation);
      } });
      return Reflect.get(target, property);
    } });
    await expireOrdinaryContracts(expiryDatabase);
    assert.equal((await prisma.salesContract.findUniqueOrThrow({ where: { id: expired.id } })).status, 'EXPIRED');
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: expired.id } }), 0, 'Expiry never enqueues cancellation SMS');
    const inactive = await create(true);
    await prisma.salesContract.update({ where: { id: inactive.id }, data: { isInactive: true,
      inactiveAt: new Date(), inactiveReason: 'QA administrative deactivation' } });
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: inactive.id } }), 0,
      'Administrative deactivation retains digital acceptance without creating a cancellation notice');
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
    await reactivateOrdinaryContract(prisma, { contractId: reactivated.id, actorId: admin.id,
      expectedRevision: 2, reason: 'آزمون فعال‌سازی دوباره با حفظ پذیرش قبلی' });
    await deliverContractCancellationNotice(prisma, oldNotice.id, gateway);
    assert.equal((await prisma.contractCancellationNotice.findUniqueOrThrow({ where: { id: oldNotice.id } })).status, 'SUPPRESSED');
    await service.cancelContract({ contractId: reactivated.id, requestedBy: source.createdBy, canCancelApproved: true });
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: reactivated.id } }), 1, 'Previous activation acceptance cannot qualify a new cancellation');
    await reactivateOrdinaryContract(prisma, { contractId: reactivated.id, actorId: admin.id,
      expectedRevision: 3, reason: 'آزمون پذیرش تازه پس از فعال‌سازی' });
    await prisma.contractPublicConfirmation.create({ data: { contractId: reactivated.id,
      tokenHash: randomUUID(), phoneNumber: '09120000003', otpCodeHash: 'qa', otpExpiresAt: new Date(),
      linkExpiresAt: new Date(), status: 'VERIFIED', commercialRevision: 4,
      verifiedAt: new Date(Date.now() + 1000), lastSentAt: new Date() } });
    await service.cancelContract({ contractId: reactivated.id, requestedBy: source.createdBy, canCancelApproved: true });
    assert.equal(await prisma.contractCancellationNotice.count({ where: { contractId: reactivated.id } }), 2,
      'Actual cancellation after fresh digital acceptance creates a new notice and retains the suppressed notice');

    const missing = await create(true);
    await prisma.phoneNumber.updateMany({ where: { customerId: customer.id }, data: { isActive: false } });
    await service.cancelContract({ contractId: missing.id, requestedBy: source.createdBy, canCancelApproved: true });
    const missingNotice = await prisma.contractCancellationNotice.findFirstOrThrow({ where: { contractId: missing.id } });
    await deliverContractCancellationNotice(prisma, missingNotice.id, gateway);
    assert.equal((await prisma.contractCancellationNotice.findUniqueOrThrow({ where: { id: missingNotice.id } })).status, 'NEEDS_PHONE');
    assert.equal(await prisma.contractCancellationNoticeAttempt.count({ where: { noticeId: missingNotice.id } }), 0);
    await prisma.phoneNumber.createMany({ data: ['09120000004', '09120000005'].map(number =>
      ({ customerId: customer.id, number, type: 'mobile', isActive: true, isPrimary: false })) });
    await prisma.contractCancellationNotice.update({ where: { id: missingNotice.id }, data: { availableAt: new Date(0) } });
    await deliverContractCancellationNotice(prisma, missingNotice.id, gateway);
    assert.equal((await prisma.contractCancellationNotice.findUniqueOrThrow({ where: { id: missingNotice.id } })).status, 'NEEDS_SELECTION');
    await prisma.$transaction(tx => retryContractCancellationNotice(tx, { contractId: missing.id,
      actorId: source.createdBy, phoneNumber: '09120000005' }));
    await deliverContractCancellationNotice(prisma, missingNotice.id, gateway);
    assert.equal((await prisma.contractCancellationNoticeAttempt.findFirstOrThrow({ where: { noticeId: missingNotice.id } })).phoneNumber, '09120000005');

    const uncertain = await create(true);
    await service.cancelContract({ contractId: uncertain.id, requestedBy: source.createdBy, canCancelApproved: true });
    const uncertainNotice = await prisma.contractCancellationNotice.findFirstOrThrow({ where: { contractId: uncertain.id } });
    await prisma.$transaction(tx => retryContractCancellationNotice(tx, { contractId: uncertain.id,
      actorId: source.createdBy, phoneNumber: '09120000004' }));
    await deliverContractCancellationNotice(prisma, uncertainNotice.id, { sendContractCancellationMessage: async () =>
      ({ success: false, error: 'QA unknown network outcome', failureKind: 'NETWORK' as const, errorCode: 'ECONNRESET' }) });
    assert.equal((await prisma.contractCancellationNotice.findUniqueOrThrow({ where: { id: uncertainNotice.id } })).status, 'UNKNOWN');
    const submissions = sent.length;
    await Promise.all([deliverContractCancellationNotice(prisma, uncertainNotice.id, gateway),
      deliverContractCancellationNotice(prisma, uncertainNotice.id, gateway)]);
    assert.equal(sent.length, submissions, 'An uncertain submission is never automatically retried');
    await prisma.contractCancellationNotice.update({ where: { id: uncertainNotice.id }, data: {
      status: 'SENDING', lastAttemptAt: new Date(Date.now() - 6 * 60_000) } });
    await prisma.contractCancellationNoticeAttempt.updateMany({ where: { noticeId: uncertainNotice.id },
      data: { status: 'SENDING', completedAt: null } });
    const scanDatabase = new Proxy(prisma, { get(target, property) {
      if (property === 'contractCancellationNotice') return new Proxy(target.contractCancellationNotice, { get(delegate, operation) {
        if (operation === 'findMany') return (query: any) => delegate.findMany({ ...query,
          where: { ...query.where, id: uncertainNotice.id } });
        return Reflect.get(delegate, operation);
      } });
      return Reflect.get(target, property);
    } });
    const previousSend = smsService.sendContractCancellationMessage;
    smsService.sendContractCancellationMessage = gateway.sendContractCancellationMessage;
    try { await deliverPendingContractCancellationNotices(scanDatabase); }
    finally { smsService.sendContractCancellationMessage = previousSend; }
    assert.equal(sent.length, submissions, 'Crash recovery must not resubmit an interrupted provider request');
    assert.equal((await prisma.contractCancellationNotice.findUniqueOrThrow({ where: { id: uncertainNotice.id } })).status, 'UNKNOWN');
    assert.equal((await prisma.contractCancellationNoticeAttempt.findFirstOrThrow({ where: { noticeId: uncertainNotice.id } })).status, 'UNKNOWN');
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
