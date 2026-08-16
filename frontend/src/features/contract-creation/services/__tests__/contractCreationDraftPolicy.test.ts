import assert from 'node:assert/strict';
import {
  contractCreationRecoverySurface,
  hasMeaningfulContractCreationProgress,
  shouldRotateUnavailableCreationDraft,
} from '../contractCreationDraftPolicy';

const blankWizard = {
  contractKind: 'standard',
  contractDate: '1405/05/25',
  contractNumber: '',
  creatorSequenceNumber: null,
  customerId: '',
  customer: null,
  projectId: '',
  project: null,
  selectedProductTypeForAddition: null,
  products: [],
  serviceRows: [],
  deliveries: [],
  payment: { payments: [], currency: 'تومان', totalContractAmount: 0 },
  discount: null,
  signature: null,
} as any;

assert.equal(
  hasMeaningfulContractCreationProgress({ wizardData: blankWizard, contractDateChanged: false }),
  false,
  'opening a blank wizard with its default date must not create a draft',
);
assert.equal(
  hasMeaningfulContractCreationProgress({ wizardData: blankWizard, contractDateChanged: true }),
  true,
  'an explicitly changed contract date is meaningful business progress',
);

for (const wizardData of [
  { ...blankWizard, customerId: 'customer-1' },
  { ...blankWizard, projectId: 'project-1' },
  { ...blankWizard, products: [{ id: 'product-1' }] },
  { ...blankWizard, serviceRows: [{ id: 'service-1' }] },
  { ...blankWizard, deliveries: [{ id: 'delivery-1' }] },
  { ...blankWizard, payment: { ...blankWizard.payment, payments: [{ id: 'payment-1' }] } },
]) {
  assert.equal(
    hasMeaningfulContractCreationProgress({ wizardData, contractDateChanged: false }),
    true,
  );
}

assert.equal(
  contractCreationRecoverySurface({ blockReason: null, hasRecoverableDraft: false }),
  'NONE',
);
assert.equal(
  contractCreationRecoverySurface({ blockReason: null, hasRecoverableDraft: true }),
  'DRAFT',
);
assert.equal(
  contractCreationRecoverySurface({ blockReason: 'owned-elsewhere', hasRecoverableDraft: true }),
  'OWNERSHIP',
  'a live owner conflict must protect the draft behind one takeover surface',
);

assert.equal(shouldRotateUnavailableCreationDraft({
  status: 404,
  code: 'draft-owner-mismatch',
  contractId: null,
  takeover: false,
}), true, 'a private draft id owned by another user must not block an independent creation attempt');
assert.equal(shouldRotateUnavailableCreationDraft({
  status: 404,
  code: 'draft-owner-mismatch',
  contractId: 'contract-1',
  takeover: false,
}), false, 'an existing contract edit must never silently rotate to a new creation draft');

console.log('Contract creation draft policy tests passed.');
