import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPartnerCasePrismaClientCompatibility } from '../partnerSales/cases/prismaClientCompatibility';

test('current generated Prisma Client supports the Partner Case Draft lifecycle', () => {
  assert.doesNotThrow(() => assertPartnerCasePrismaClientCompatibility());
});

test('startup fails closed when the generated Prisma Client predates Partner pricing state', () => {
  assert.throws(() => assertPartnerCasePrismaClientCompatibility([
    { name: 'PartnerSaleCase', fields: [{ name: 'customerConfirmationState' }] },
    { name: 'PartnerCaseRevision', fields: [] },
  ]), /PartnerSaleCase\.pricingState, PartnerCaseRevision\.pricingState/);
});
