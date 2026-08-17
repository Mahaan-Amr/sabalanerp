const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const CONTRACT_CUSTOMER_SNAPSHOT_FIELDS = [
  'id',
  'ownerUserId',
  'companyName',
  'customerType',
  'industry',
  'status',
  'primaryContactId',
  'address',
  'city',
  'country',
  'communicationPreferences',
  'customFields',
  'isActive',
  'brandName',
  'brandNameDescription',
  'firstName',
  'homeAddress',
  'homeNumber',
  'isBlacklisted',
  'isLocked',
  'lastName',
  'nationalCode',
  'projectManagerName',
  'projectManagerNumber',
  'referrerFirstName',
  'referrerLastName',
  'referrerPhoneNumber',
  'workAddress',
  'workNumber',
  'primaryContact',
  'phoneNumbers',
  'projectAddresses',
] as const;

const customerSnapshot = (customer: Record<string, unknown>) =>
  Object.fromEntries(CONTRACT_CUSTOMER_SNAPSHOT_FIELDS.flatMap((field) =>
    Object.prototype.hasOwnProperty.call(customer, field) ? [[field, customer[field]]] : []
  ));

/**
 * Keeps the contract-owned customer facts while excluding live CRM navigation
 * collections that can recursively contain earlier contract snapshots.
 */
export const sanitizeContractDataCustomerSnapshot = <T>(contractData: T): T => {
  if (!isRecord(contractData) || !isRecord(contractData.customer)) return contractData;

  return {
    ...contractData,
    customer: customerSnapshot(contractData.customer),
  } as T;
};

/**
 * Freezes the accounting source contract without embedding unrelated CRM
 * history. Contract items, deliveries, payments and commercial evidence stay
 * intact for financial approval and audit reconciliation.
 */
export const buildAccountingContractSourceSnapshot = <T extends Record<string, unknown>>(contract: T): T => ({
  ...contract,
  contractData: sanitizeContractDataCustomerSnapshot(contract.contractData),
});
