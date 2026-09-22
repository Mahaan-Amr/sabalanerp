import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartnerCustomerCreateCommand, buildPartnerCustomerUpdateCommand,
  validatePartnerCustomerDraft } from './partnerCustomerCreation';

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

test('includes owner-scoped blacklist and lock decisions in the protected update intent', async () => {
  const command = await buildPartnerCustomerUpdateCommand({
    firstName: 'علی', lastName: 'نمونه', companyName: '', customerType: 'Individual', city: '',
    address: 'نشانی نمونه', nationalCode: '', phone: '09120000000',
  }, { customerId: 'customer-owned-2', expectedRevision: 2, commandId: 'customer-restrict-command-1',
    correlationId: 'customer-restrict-correlation-1', idempotencyKey: 'customer-restrict-idempotency-1',
    isBlacklisted: true, isLocked: false });

  assert.equal(command.isBlacklisted, true);
  assert.equal(command.isLocked, false);
  assert.match(command.payloadHash, /^sha256-v1:[a-f0-9]{64}$/);
});

test('requires the fields needed to continue into partner-sale delivery', () => {
  assert.equal(validatePartnerCustomerDraft({ firstName: '', lastName: 'نمونه', companyName: '',
    customerType: 'Individual', city: '', address: '', nationalCode: '', phone: '123' }), false);
  assert.equal(validatePartnerCustomerDraft({ firstName: 'علی', lastName: 'نمونه', companyName: '',
    customerType: 'Individual', city: '', address: 'نشانی نمونه', nationalCode: '', phone: '09120000000' }), true);
});

test('accepts Persian and Arabic digits and persists identifiers with Latin digits', async () => {
  const draft = { firstName: 'فریبا', lastName: 'پورشهید', companyName: '', customerType: 'Individual' as const,
    city: 'تهران', address: 'معالی‌آباد', nationalCode: '۰۰۱۲۳۴۵۶۷۸', phone: '۰۹۳۹۸۳۷۳۵۷۰' };
  assert.equal(validatePartnerCustomerDraft(draft), true);
  const command = await buildPartnerCustomerCreateCommand(draft, { commandId: 'command-fa-digits',
    correlationId: 'correlation-fa-digits', idempotencyKey: 'idempotency-fa-digits' });
  assert.equal(command.phone, '09398373570');
  assert.equal(command.nationalCode, '0012345678');
});

test('builds an integrity-protected owner-scoped customer update command', async () => {
  const command = await buildPartnerCustomerUpdateCommand({
    firstName: 'فریبا', lastName: 'پورشهید', companyName: '', customerType: 'Individual',
    city: 'شیراز', address: 'معالی‌آباد', nationalCode: '', phone: '۰۹۳۹۸۳۷۳۵۷۰',
  }, { customerId: 'customer-owned-1', expectedRevision: 4, commandId: 'customer-update-command-1',
    correlationId: 'customer-update-correlation-1', idempotencyKey: 'customer-update-idempotency-1' });

  assert.equal(command.customerId, 'customer-owned-1');
  assert.equal(command.expectedRevision, 4);
  assert.equal(command.reason, 'ویرایش مشتری توسط فروشنده همکار');
  assert.equal(command.phone, '09398373570');
  assert.match(command.payloadHash, /^sha256-v1:[a-f0-9]{64}$/);
});
