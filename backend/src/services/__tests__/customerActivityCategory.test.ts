import assert from 'node:assert/strict';
import test from 'node:test';
import { customerActivityCategorySchema } from '../customerActivityCategory';
import { PartnerCustomerCreateSchema, PartnerCustomerUpdateSchema, PartnerContractCustomerCreateSchema } from '../partnerSales/crm/contracts';

test('activity choice distinguishes explicit NONE from missing or invalid data', () => {
  for (const value of ['BUILDER', 'ARCHITECT', 'NONE']) assert.equal(customerActivityCategorySchema.safeParse(value).success, true);
  for (const value of [undefined, null, '', 'NORMAL', 'SPECIAL', 'OTHER', [], 0]) assert.equal(customerActivityCategorySchema.safeParse(value).success, false);
});

test('all Partner customer identity commands require a valid activity choice', () => {
  const common = { schemaVersion: 1, commandId: 'command', correlationId: 'correlation', idempotencyKey: 'key',
    payloadHash: `sha256-v1:${'a'.repeat(64)}`, reason: 'ثبت مشخصات مشتری' };
  const identity = { firstName: 'نام', lastName: 'مشتری', customerType: 'Individual', phone: '09120000001' };
  for (const [schema, payload] of [
    [PartnerCustomerCreateSchema, { ...common, ...identity }],
    [PartnerCustomerUpdateSchema, { ...common, ...identity, customerId: 'customer', expectedRevision: 1 }],
  ] as const) {
    for (const value of [undefined, null, '', 'NORMAL']) assert.equal(schema.safeParse({ ...payload, activityCategory: value }).success, false);
    for (const value of ['BUILDER', 'ARCHITECT', 'NONE']) assert.equal(schema.safeParse({ ...payload, activityCategory: value }).success, true);
  }
  const payload = { ...common, customer: { firstName: 'نام', lastName: 'مشتری', customerType: 'Government', phoneNumber1: '09120000001' },
    project: { projectName: 'پروژه', address: 'نشانی' } };
  assert.equal(PartnerContractCustomerCreateSchema.safeParse(payload).success, false);
  assert.equal(PartnerContractCustomerCreateSchema.safeParse({ ...payload, customer: { ...payload.customer, activityCategory: 'NONE' } }).success, true);
});
