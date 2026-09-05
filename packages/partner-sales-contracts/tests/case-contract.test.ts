import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerSaleCaseSchema, checkExpectedRevision } from '../src';

const hash = 'sha256-v1:' + 'a'.repeat(64);
const ref = { caseId: 'case-313', revision: 1, integrityHash: hash };
export const caseFixture = {
  schemaVersion: 1, caseId: 'case-313', caseNumber: 'CASE-313', partnerSellerId: 'partner-313',
  creatorId: 'partner-313', responsibleSellerId: 'partner-313', salesCreditOwnerId: 'partner-313',
  customerId: 'customer-313', state: 'DRAFT', head: ref,
  graph: { owner: ref, schemaVersion: 1, graphHash: hash, productRowIds: ['row-313'] },
  internalRecord: { kind: 'SABALAN_TO_PARTNER', recordId: 'internal-313', recordNumber: 'INTERNAL-313', owner: ref, commercialAccountId: 'account-313' },
  customerContract: { kind: 'PARTNER_CUSTOMER', contractId: 'contract-313', contractNumber: 'CUSTOMER-313', owner: ref },
};

test('Case owns an exact pair, graph and immutable Partner attribution', () => {
  assert.equal(PartnerSaleCaseSchema.parse(caseFixture).internalRecord.kind, 'SABALAN_TO_PARTNER');
  for (const mutation of [
    { internalRecord: undefined }, { creatorId: 'admin' },
    { internalRecord: { ...caseFixture.internalRecord, kind: 'SALES_CONTRACT' } },
    { customerContract: { ...caseFixture.customerContract, owner: { ...ref, revision: 2 } } },
    { graph: { ...caseFixture.graph, productRowIds: ['row-313', 'row-313'] } },
  ]) assert.equal(PartnerSaleCaseSchema.safeParse({ ...caseFixture, ...mutation }).success, false);
  assert.equal(checkExpectedRevision(ref, { ...ref, revision: 2 })?.code, 'ROW_STALE');
  assert.equal(checkExpectedRevision(ref, { ...ref, integrityHash: 'sha256-v1:' + 'b'.repeat(64) })?.code, 'INTEGRITY_CONFLICT');
});
