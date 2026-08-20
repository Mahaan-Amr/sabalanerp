import assert from 'node:assert/strict';
import {
  applyLoadedCustomer,
  createCustomerSelectionUpdates,
  validateContractPartyIdentity
} from '../contractPartyIdentity';
import {
  consumeContractReturnSelection,
  writeContractReturnSelection
} from '../../utils/contractReturnSelection';
import type { ContractWizardData, CrmCustomer, ProjectAddress } from '../../types/contract.types';

const customer = (id: string, projectAddresses: ProjectAddress[] = []): CrmCustomer => ({
  id,
  firstName: id,
  lastName: 'مشتری',
  customerType: 'Individual',
  status: 'Active',
  projectAddresses,
  phoneNumbers: [],
  isBlacklisted: false,
  isLocked: false
});

const oldProject = { id: 'project-old', customerId: 'customer-old', address: 'قدیم', city: null, isActive: true };
const nextCustomer = customer('customer-next', [
  { id: 'project-next', customerId: 'customer-next', address: 'جدید', city: null, isActive: true }
]);

const customerWithLiveCrmNavigation = {
  ...nextCustomer,
  salesContracts: [{ id: 'contract-old', contractData: { customer: nextCustomer } }],
  leads: [{ id: 'lead-1' }],
  communications: [{ id: 'communication-1' }],
  potentialProjects: [{ id: 'potential-1' }],
  contacts: [{ id: 'contact-1' }],
  _count: { salesContracts: 1 }
} as CrmCustomer;

assert.deepEqual(
  createCustomerSelectionUpdates({
    customerId: 'customer-old', customer: customer('customer-old', [oldProject]),
    projectId: oldProject.id, project: oldProject
  }, nextCustomer),
  { customerId: 'customer-next', customer: nextCustomer, projectId: '', project: null }
);

assert.equal(
  applyLoadedCustomer('customer-next', 'customer-other', customer('customer-next')),
  null,
  'a late response for a previous selection must not overwrite the current customer'
);

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); }
};
assert.equal(writeContractReturnSelection({ currentStep: 2, customerId: 'customer-next' }, storage), true);
assert.deepEqual(consumeContractReturnSelection(storage), {
  version: 1,
  currentStep: 2,
  customerId: 'customer-next'
});
assert.equal(consumeContractReturnSelection(storage), null, 'return selection is consumed only once');
assert.equal(writeContractReturnSelection(
  { currentStep: 2, customerId: 'customer-next' },
  { ...storage, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } }
), false, 'a full browser store must block return instead of crashing or restoring a stale customer');
assert.deepEqual(
  applyLoadedCustomer('customer-next', 'customer-next', nextCustomer),
  { customerId: 'customer-next', customer: nextCustomer }
);
const boundedCustomerSelection = applyLoadedCustomer(
  'customer-next',
  'customer-next',
  customerWithLiveCrmNavigation
);
assert.equal('salesContracts' in (boundedCustomerSelection?.customer || {}), false);
assert.equal('leads' in (boundedCustomerSelection?.customer || {}), false);
assert.equal('communications' in (boundedCustomerSelection?.customer || {}), false);
assert.equal('potentialProjects' in (boundedCustomerSelection?.customer || {}), false);
assert.equal('contacts' in (boundedCustomerSelection?.customer || {}), false);
assert.equal('_count' in (boundedCustomerSelection?.customer || {}), false);
assert.deepEqual(boundedCustomerSelection?.customer?.projectAddresses, nextCustomer.projectAddresses);

assert.equal(validateContractPartyIdentity({
  customerId: 'customer-next', customer: nextCustomer,
  projectId: 'project-next', project: nextCustomer.projectAddresses[0]
} as ContractWizardData), null);

assert.equal(
  validateContractPartyIdentity({
    customerId: 'customer-next', customer: customer('customer-old', [oldProject]),
    projectId: oldProject.id, project: oldProject
  } as ContractWizardData),
  'هویت مشتری و پروژه قرارداد یکپارچه نیست؛ مشتری و پروژه را دوباره انتخاب کنید.'
);

console.log('contract party identity tests passed');
