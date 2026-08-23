import type { ContractWizardData, CrmCustomer } from '../types/contract.types';

type ContractPartySelection = Pick<ContractWizardData, 'customerId' | 'customer' | 'projectId' | 'project'>;

const hydrateCustomer = (customer: CrmCustomer): CrmCustomer => Object.fromEntries(
  Object.entries({
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    companyName: customer.companyName,
    customerType: customer.customerType,
    status: customer.status,
    projectAddresses: customer.projectAddresses || [],
    phoneNumbers: customer.phoneNumbers || [],
    nationalCode: customer.nationalCode,
    homeAddress: customer.homeAddress,
    homeNumber: customer.homeNumber,
    workAddress: customer.workAddress,
    workNumber: customer.workNumber,
    projectManagerName: customer.projectManagerName,
    projectManagerNumber: customer.projectManagerNumber,
    brandName: customer.brandName,
    brandNameDescription: customer.brandNameDescription,
    ownerUserId: customer.ownerUserId,
    ownerUser: customer.ownerUser,
    isBlacklisted: customer.isBlacklisted,
    isLocked: customer.isLocked
  }).filter(([, value]) => value !== undefined)
) as unknown as CrmCustomer;

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
  const projectAddresses = Array.isArray(wizardData.customer.projectAddresses)
    ? wizardData.customer.projectAddresses
    : [];
  let projectBelongsToCustomer = wizardData.project.customerId === wizardData.customerId;
  for (const project of projectAddresses) {
    if (project.id === wizardData.projectId) {
      projectBelongsToCustomer = true;
      break;
    }
  }
  const ownershipEvidenceAvailable = Boolean(wizardData.project.customerId) || projectAddresses.length > 0;
  if (!ownershipEvidenceAvailable) {
    // Persisted contract snapshots deliberately omit live CRM navigation collections.
    // The write boundary validates project ownership against authoritative CRM rows.
    return null;
  }
  return projectBelongsToCustomer
    ? null
    : 'هویت مشتری و پروژه قرارداد یکپارچه نیست؛ مشتری و پروژه را دوباره انتخاب کنید.';
};
