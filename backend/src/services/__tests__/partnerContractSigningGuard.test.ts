import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { assertContractQuantityEvidenceReadyForFinalization } from '../contractQuantityEvidenceGuard';

test('a committed partner customer contract uses its sealed Case evidence at the signing boundary', async () => {
  const fixture = createPartnerFixtures();
  const contractId = fixture.case.customerContract!.contractId;
  const database = {
    salesContract: { findUnique: async () => ({
      id: contractId,
      contractNumber: fixture.customer.contractNumber,
      partnerKind: 'PARTNER_CUSTOMER',
      partnerCaseId: fixture.case.caseId,
      partnerRevision: fixture.case.head.revision,
      partnerIntegrityHash: fixture.case.head.integrityHash,
      contractData: fixture.customer,
      items: [],
      deliveries: [],
      productGraphState: null,
    }) },
    partnerSaleCase: { findUnique: async () => ({
      id: fixture.case.caseId,
      state: 'COMMITTED',
      headRevision: fixture.case.head.revision,
      committedRevision: fixture.case.head.revision,
      integrityHash: fixture.case.head.integrityHash,
      customerContractId: contractId,
      head: { customerProjection: fixture.customer },
    }) },
  };

  await assert.doesNotReject(() => assertContractQuantityEvidenceReadyForFinalization(database as never, contractId));
});
