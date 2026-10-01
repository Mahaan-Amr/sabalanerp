import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRevisionConfirmationPhone } from '../dispatchAllocation';

const contract = { id: 'contract-1', commercialFlowVersion: 1, commercialRevision: 3,
  customerAcceptanceRevision: 3, customerAcceptanceMethod: 'DIGITAL',
  customer: { phoneNumbers: [{ number: '09123456789' }], primaryContact: null } };
const tx = (current: any, confirmations: any[]): any => ({
  salesContract: { findMany: async () => [current] },
  contractPublicConfirmation: { findMany: async () => confirmations },
});
test('edited contracts cannot send exit SMS to an old revision verified phone', async () => {
  const old = { contractId: contract.id, commercialRevision: 2, phoneNumber: '09999999999' };
  const recipient = await resolveRevisionConfirmationPhone(tx(contract, [old]), [contract.id]);
  assert.equal(recipient.confirmationPhone, null);
  assert.equal(recipient.evidence.length, 0);
});
test('paper acceptance uses current CRM contact with explicit unverified provenance', async () => {
  const old = { contractId: contract.id, commercialRevision: 2, phoneNumber: '09999999999' };
  const recipient = await resolveRevisionConfirmationPhone(tx({ ...contract, customerAcceptanceMethod: 'PAPER' }, [old]), [contract.id]);
  assert.equal(recipient.confirmationPhone, '09123456789');
  assert.equal(recipient.source, 'CURRENT_CUSTOMER_CONTACT');
  assert.equal(recipient.evidence[0].phoneVerified, false);
});
test('current digital confirmation retains verified notification identity', async () => {
  const recipient = await resolveRevisionConfirmationPhone(tx(contract,
    [{ contractId: contract.id, commercialRevision: 3, phoneNumber: '+989123456789' }]), [contract.id]);
  assert.equal(recipient.confirmationPhone, '09123456789');
  assert.equal(recipient.evidence[0].phoneVerified, true);
});
