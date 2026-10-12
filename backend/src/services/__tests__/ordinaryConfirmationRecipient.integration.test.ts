import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '../../lib/prisma';
import { ContractConfirmationService } from '../contractConfirmationService';
import smsService from '../smsService';

test('changed CRM recipient can open the resent contract using the number that received the SMS', async () => {
  const target = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) && target.pathname === '/sabalanerp', 'Use the existing local Compose database');
  const originalSend = smsService.sendContractConfirmationMessage;
  const sent: Array<{ phoneNumber: string; code: string }> = [];
  smsService.sendContractConfirmationMessage = async params => { sent.push(params); return { success: true }; };
  const service = new ContractConfirmationService();
  let contractId: string | undefined;
  let customerId: string | undefined;
  try {
    const source = await prisma.salesContract.findFirstOrThrow({ where: { partnerKind: null, partnerCaseId: null } });
    const customer = await prisma.crmCustomer.create({ data: { firstName: 'QA', lastName: randomUUID(),
      phoneNumbers: { create: { number: '09120000001', type: 'mobile', isPrimary: true } } }, include: { phoneNumbers: true } });
    customerId = customer.id;
    const contract = await prisma.salesContract.create({ data: {
      contractNumber: `QA-RECIPIENT-${randomUUID()}`, title: 'Recipient QA', titlePersian: 'آزمون گیرنده', content: 'QA',
      customerId, departmentId: source.departmentId, createdBy: source.createdBy, responsibleSellerId: source.responsibleSellerId,
      commercialFlowVersion: 1, commercialRevision: 1, commercialExpiresAt: new Date(Date.now() + 86400000),
    } });
    contractId = contract.id;
    const first = await service.sendForConfirmation({ contractId, requestedBy: source.createdBy });
    assert.equal(first.success, true, first.error);
    await prisma.contractPublicConfirmation.updateMany({ where: { contractId }, data: { lastSentAt: new Date(Date.now() - 120000) } });
    await prisma.phoneNumber.update({ where: { id: customer.phoneNumbers[0].id }, data: { number: '09120000002' } });
    const resent = await service.sendForConfirmation({ contractId, requestedBy: source.createdBy, resend: true });
    assert.equal(resent.success, true, resent.error);
    assert.equal(sent[sent.length - 1]?.phoneNumber, '09120000002');
    const lookup = await service.getPublicContractByManualLookup({ contractNumber: contract.contractNumber, phoneNumber: '09120000002' });
    assert.equal(lookup.success, true, 'The number receiving the SMS must find its active confirmation');
    const sessions = await prisma.contractPublicConfirmation.findMany({ where: { contractId }, orderBy: { createdAt: 'asc' } });
    assert.equal(sessions.length, 2, 'Keep the old recipient as historical evidence');
    assert.equal(sessions[0].status, 'CANCELLED');
    assert.equal(sessions[1].phoneNumber, '09120000002');
    assert.equal((await service.getPublicContractByManualLookup({ contractNumber: contract.contractNumber, phoneNumber: '09120000001' })).success, false);
    const oldToken = first.data!.publicLink!.split('/').pop()!;
    assert.equal((await service.verifyPublicOtp({ token: oldToken, code: sent[0].code })).success, false);

    // Soft-deleted primary mobiles must never win selection or be selectable.
    await prisma.phoneNumber.create({ data: { customerId, number: '09120000003', type: 'mobile', isPrimary: true, isActive: false } });
    await prisma.crmCustomer.update({ where: { id: customerId }, data: { projectManagerNumber: '09120000003' } });
    const recipients = await service.getConfirmationStatus(contractId);
    assert.deepEqual(recipients.data?.availablePhoneNumbers, ['09120000002']);
    assert.equal((await service.sendForConfirmation({ contractId, requestedBy: source.createdBy, resend: true,
      recipientPhoneNumber: '09120000003' })).success, false);

    // A rejected send must retain the last usable code, token and recipient.
    await prisma.contractPublicConfirmation.updateMany({ where: { contractId, status: 'PENDING' }, data: { lastSentAt: new Date(Date.now() - 120000) } });
    const beforeFailure = await prisma.contractPublicConfirmation.findFirstOrThrow({ where: { contractId, status: 'PENDING' } });
    smsService.sendContractConfirmationMessage = async () => ({ success: false, error: 'QA provider failure' });
    assert.equal((await service.sendForConfirmation({ contractId, requestedBy: source.createdBy, resend: true })).success, false);
    assert.deepEqual(await prisma.contractPublicConfirmation.findUniqueOrThrow({ where: { id: beforeFailure.id } }), beforeFailure);
    smsService.sendContractConfirmationMessage = async params => { sent.push(params); return { success: true }; };
    // Parallel sends serialize: only one replaces the active OTP, the other hits cooldown.
    const countBefore = sent.length;
    const parallel = await Promise.all([1, 2].map(() => service.sendForConfirmation({ contractId: contractId!, requestedBy: source.createdBy, resend: true })));
    assert.equal(parallel.filter(result => result.success).length, 1);
    assert.equal(sent.length, countBefore + 1);
    assert.equal(await prisma.contractPublicConfirmation.count({ where: { contractId, status: 'PENDING' } }), 1);

    // Choose an active secondary mobile explicitly, then keep public resends on it.
    await prisma.phoneNumber.create({ data: { customerId, number: '09120000004', type: 'mobile', isPrimary: false } });
    await prisma.contractPublicConfirmation.updateMany({ where: { contractId, status: 'PENDING' }, data: { lastSentAt: new Date(Date.now() - 120000) } });
    const secondary = await service.sendForConfirmation({ contractId, requestedBy: source.createdBy, resend: true,
      recipientPhoneNumber: '09120000004' });
    assert.equal(secondary.success, true, secondary.error);
    const secondaryToken = secondary.data!.publicLink!.split('/').pop()!;
    await prisma.contractPublicConfirmation.updateMany({ where: { contractId, status: 'PENDING' }, data: { lastSentAt: new Date(Date.now() - 120000) } });
    assert.equal((await service.resendFromPublicToken({ token: secondaryToken })).success, true);
    assert.equal(sent[sent.length - 1].phoneNumber, '09120000004');
    assert.equal((await service.getPublicContractByToken(secondaryToken)).success, true, 'Same-recipient public resend retains its link');
    await prisma.phoneNumber.updateMany({ where: { customerId, number: '09120000004' }, data: { isActive: false } });
    const beforePublic = sent.length;
    assert.equal((await service.resendFromPublicToken({ token: secondaryToken })).success, false);
    assert.equal(sent.length, beforePublic, 'A public request cannot silently send to a different CRM recipient');

    // The actual customer form accepts the latest delivered code and binds
    // acceptance to its recipient session, even after a later CRM correction.
    const verified = await service.verifyPublicOtpByManualLookup({ contractNumber: contract.contractNumber,
      phoneNumber: '09120000004', code: sent[sent.length - 1].code });
    assert.equal(verified.success, true, verified.error);
    const accepted = await prisma.salesContract.findUniqueOrThrow({ where: { id: contractId } });
    assert.equal(accepted.customerAcceptanceRevision, 1);
    const evidence = await prisma.contractPublicConfirmation.findFirstOrThrow({ where: { contractId, status: 'VERIFIED' } });
    assert.equal(evidence.phoneNumber, '09120000004');
    assert.equal((accepted.signatures as any).customerAcceptance.sessionId, evidence.id);
    assert.equal((await service.sendForConfirmation({ contractId, requestedBy: source.createdBy, resend: true })).success, false);
    assert.deepEqual(await prisma.salesContract.findUniqueOrThrow({ where: { id: contractId } }), accepted);
  } finally {
    smsService.sendContractConfirmationMessage = originalSend;
    if (contractId) {
      await prisma.contractConfirmationAuditLog.deleteMany({ where: { contractId } });
      await prisma.contractPublicConfirmation.deleteMany({ where: { contractId } });
      await prisma.accountingAuditLog.deleteMany({ where: { contractId } });
      await prisma.accountingCustomerRelationship.deleteMany({ where: { sourceType: 'SALES_CONTRACT', sourceId: contractId } });
      await prisma.salesContract.delete({ where: { id: contractId } });
    }
    if (customerId) {
      await prisma.accountingCustomerProfile.deleteMany({ where: { partySourceKind: 'CUSTOMER', partySourceId: customerId } });
      const parties = await prisma.accountingParty.findMany({ where: { sourceKind: 'CUSTOMER', sourceId: customerId }, select: { id: true } });
      await prisma.accountingPartyRoleAssignment.deleteMany({ where: { partyId: { in: parties.map(party => party.id) } } });
      await prisma.accountingParty.deleteMany({ where: { id: { in: parties.map(party => party.id) } } });
      await prisma.crmCustomer.delete({ where: { id: customerId } });
    }
    await disconnectDatabase();
  }
});
