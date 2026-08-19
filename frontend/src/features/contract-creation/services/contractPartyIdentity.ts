import type { ContractWizardData, CrmCustomer } from '../types/contract.types';

type ContractPartySelection = Pick<ContractWizardData, 'customerId' | 'customer' | 'projectId' | 'project'>;

const hydrateCustomer = (customer: CrmCustomer): CrmCustomer => ({
  ...customer,
  projectAddresses: customer.projectAddresses || [],
  phoneNumbers: customer.phoneNumbers || []
});

export const createCustomerSelectionUpdates = (
  current: ContractPartySelection,
  customer: CrmCustomer
): ContractPartySelection => {
  const changedCustomer = current.customerId !== customer.id;
  return {
    customerId: customer.id,
    customer: hydrateCustomer(customer),
    projectId: changedCustomer ? '' : current.projectId,
    project: changedCustomer ? null : current.project
  };
};

export const applyLoadedCustomer = (
  requestedCustomerId: string,
  selectedCustomerId: string,
  customer: CrmCustomer
): Pick<ContractWizardData, 'customerId' | 'customer'> | null => {
  if (requestedCustomerId !== selectedCustomerId || customer.id !== requestedCustomerId) return null;
  return { customerId: requestedCustomerId, customer: hydrateCustomer(customer) };
};

export const validateContractPartyIdentity = (wizardData: ContractPartySelection): string | null => {
  if (!wizardData.customerId || !wizardData.customer || wizardData.customer.id !== wizardData.customerId) {
    return 'هویت مشتری و پروژه قرارداد یکپارچه نیست؛ مشتری و پروژه را دوباره انتخاب کنید.';
  }
  if (!wizardData.projectId || !wizardData.project || wizardData.project.id !== wizardData.projectId) {
    return 'هویت مشتری و پروژه قرارداد یکپارچه نیست؛ مشتری و پروژه را دوباره انتخاب کنید.';
  }
  const projectBelongsToCustomer =
    wizardData.project.customerId === wizardData.customerId ||
    wizardData.customer.projectAddresses.some(project => project.id === wizardData.projectId);
  return projectBelongsToCustomer
    ? null
    : 'هویت مشتری و پروژه قرارداد یکپارچه نیست؛ مشتری و پروژه را دوباره انتخاب کنید.';
};
