import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartnerCustomerCreateCommand, validatePartnerCustomerDraft } from './partnerCustomerCreation';

test('builds the exact integrity-protected command accepted by partner CRM', async () => {
  const command = await buildPartnerCustomerCreateCommand({
    firstName: 'علی', lastName: 'نمونه', companyName: '', customerType: 'Individual',
    city: 'تهران', address: 'تهران، نشانی نمونه', nationalCode: '', phone: '09120000000',
  }, { commandId: 'customer-command-1', correlationId: 'customer-correlation-1',
    idempotencyKey: 'customer-idempotency-1' });

  assert.equal(command.schemaVersion, 1);
  assert.equal(command.reason, 'ثبت مشتری توسط فروشنده همکار');
  assert.equal(command.companyName, undefined);
  assert.equal(command.nationalCode, undefined);
  assert.match(command.payloadHash, /^sha256-v1:[a-f0-9]{64}$/);
});

test('requires the fields needed to continue into partner-sale delivery', () => {
  assert.equal(validatePartnerCustomerDraft({ firstName: '', lastName: 'نمونه', companyName: '',
    customerType: 'Individual', city: '', address: '', nationalCode: '', phone: '123' }), false);
  assert.equal(validatePartnerCustomerDraft({ firstName: 'علی', lastName: 'نمونه', companyName: '',
    customerType: 'Individual', city: '', address: 'نشانی نمونه', nationalCode: '', phone: '09120000000' }), true);
});
