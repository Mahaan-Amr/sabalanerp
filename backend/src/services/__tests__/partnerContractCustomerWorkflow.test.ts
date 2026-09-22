import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerContractCustomerCreateSchema, PartnerContractProjectCreateSchema,
  PartnerTransferCancelSchema } from '../partnerSales/crm/contracts';

const command = (customerType: 'Individual' | 'Company' | 'Government', nationalCode: string) => ({
  schemaVersion: 1,
  commandId: 'partner-contract-customer-command',
  correlationId: 'partner-contract-customer-correlation',
  idempotencyKey: 'partner-contract-customer-idempotency',
  payloadHash: `sha256-v1:${'a'.repeat(64)}`,
  reason: 'ثبت مشتری و پروژه برای قرارداد فروش همکار',
  customer: {
    firstName: 'علی',
    lastName: 'نمونه',
    customerType,
    phoneNumber1: '۰۹۱۲۰۰۰۰۰۰۰',
    nationalCode,
    companyName: customerType === 'Individual' ? undefined : 'شرکت نمونه',
  },
  project: {
    projectName: 'پروژه اول',
    address: 'تهران، نشانی پروژه',
    city: 'تهران',
    projectType: 'مسکونی',
  },
});

test('shared Partner Customer workflow validates personal and legal identity by Customer type', () => {
  assert.equal(PartnerContractCustomerCreateSchema.safeParse(command('Individual', '۰۰۱۲۳۴۵۶۷۸')).success, true);
  assert.equal(PartnerContractCustomerCreateSchema.safeParse(command('Company', '۱۰۱۰۱۰۱۰۱۰۱')).success, true);
  assert.equal(PartnerContractCustomerCreateSchema.safeParse(command('Government', '10101010101')).success, true);
  assert.equal(PartnerContractCustomerCreateSchema.safeParse(command('Company', '0012345678')).success, false);
});

test('shared Partner Customer workflow rejects Collaborative Customers and incomplete first Projects', () => {
  assert.equal(PartnerContractCustomerCreateSchema.safeParse({
    ...command('Individual', '0012345678'),
    customer: { ...command('Individual', '0012345678').customer, customerType: 'Collaborative' },
  }).success, false);
  assert.equal(PartnerContractCustomerCreateSchema.safeParse({
    ...command('Individual', '0012345678'),
    project: { ...command('Individual', '0012345678').project, address: '' },
  }).success, false);
});

test('adding a Project to an existing Partner Customer uses the same complete Project fields', () => {
  const value = command('Individual', '0012345678');
  assert.equal(PartnerContractProjectCreateSchema.safeParse({
    schemaVersion: 1,
    commandId: 'partner-contract-project-command',
    correlationId: 'partner-contract-project-correlation',
    idempotencyKey: 'partner-contract-project-idempotency',
    payloadHash: `sha256-v1:${'b'.repeat(64)}`,
    reason: 'ثبت پروژه مشتری برای قرارداد فروش همکار',
    customerId: 'customer-one',
    project: { ...value.project, projectManagerName: 'مدیر پروژه', marketerFirstName: 'بازاریاب' },
  }).success, true);
});

test('all optional mobile fields use the same Iranian mobile validation', () => {
  const value = command('Individual', '0012345678');
  assert.equal(PartnerContractCustomerCreateSchema.safeParse({ ...value,
    customer: { ...value.customer, whatsappNumber: '۰۹۱۲۱۲۳۴۵۶۷', referrerPhoneNumber: '09121234567' },
  }).success, true);
  assert.equal(PartnerContractCustomerCreateSchema.safeParse({ ...value,
    customer: { ...value.customer, whatsappNumber: '02112345678' },
  }).success, false);
});

test('requester cancellation is a strict revision-bound command', () => {
  assert.equal(PartnerTransferCancelSchema.safeParse({ schemaVersion: 1,
    commandId: 'partner-transfer-cancel-command', correlationId: 'partner-transfer-cancel-correlation',
    transferId: 'partner-transfer-one', expectedRevision: 1,
    reason: 'لغو درخواست انتقال توسط درخواست‌کننده',
    idempotencyKey: 'partner-transfer-cancel-idempotency', payloadHash: `sha256-v1:${'c'.repeat(64)}`,
  }).success, true);
});
