import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CustomerContractOutputSchema, PARTNER_CONTRACT_VERSION, PartnerCaseViewSchema, partnerError } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures, createNegativePartnerFixtures, FixturePartnerQueryAdapter } from '@sabalanerp/partner-sales-contracts/testing';

test('compiled UI consumer reads isolated retail fixtures without broadening customer output', async () => {
  const fixture = createPartnerFixtures();
  assert.equal(PARTNER_CONTRACT_VERSION, '1.0.0');
  const adapter = new FixturePartnerQueryAdapter(['PARTNER_CASE', 'CUSTOMER_OUTPUT']);
  const query = { schemaVersion: 1 as const, purpose: 'PARTNER_CASE' as const, expected: fixture.case.head };
  const result = await adapter.query(query);
  assert.equal(result.ok, true);
  if (result.ok) {
    const view = PartnerCaseViewSchema.parse(result.value);
    assert.equal(view.resaleDifference, '400');
    view.products[0].retailUnitPrice = '0';
  }
  const next = await adapter.query(query);
  if (!next.ok) assert.fail('Fixture remains available');
  assert.equal(next.value.products[0].retailUnitPrice, '1000');
  assert.deepEqual(await adapter.query({ ...query, expected: { ...query.expected, caseId: 'other-owner' } }), { ok: false, error: partnerError('NOT_FOUND') });
  assert.deepEqual(await adapter.query({ ...query, expected: { ...query.expected, revision: 2 } }), { ok: false, error: partnerError('ROW_STALE') });
  for (const field of ['wholesaleUnitPrice', 'margin', 'caseNumber', 'recordId', 'inquiryId', 'contractData', 'graph', 'accounting']) {
    assert.equal(CustomerContractOutputSchema.safeParse({ ...fixture.customer, [field]: 'forbidden' }).success, false, field);
    assert.equal(CustomerContractOutputSchema.safeParse({ ...fixture.customer, customer: { ...fixture.customer.customer, [field]: 'forbidden' } }).success, false, field);
  }
});

test('shared negative fixtures and inquiry adapters support fixture-driven UI without internal economics', async () => {
  const negative = createNegativePartnerFixtures();
  const adapter = new FixturePartnerQueryAdapter(['PARTNER_CASE', 'PARTNER_INQUIRY', 'RESPONDER_INQUIRY']);
  assert.deepEqual(await adapter.query(negative.staleCaseQuery), { ok: false, error: partnerError('ROW_STALE') });
  assert.equal(CustomerContractOutputSchema.safeParse(negative.forbiddenCustomerOutput).success, false);
  const query = { schemaVersion: 1 as const, purpose: 'PARTNER_INQUIRY' as const, inquiryId: 'fixture-313-inquiry' };
  const partner = await adapter.query(query);
  assert.equal(partner.ok, true);
  if (partner.ok) assert.equal(partner.value.rows[0].approvedPrice?.amount, '800');
  assert.equal((await adapter.query({ ...query, purpose: 'RESPONDER_INQUIRY' })).ok, true);
  assert.equal((await adapter.query({ ...query, inquiryId: 'another-owner' })).ok, false);
});
