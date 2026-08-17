type SnapshotRecord = Record<string, unknown>;

export type ContractPrimaryContactSnapshot = {
  id?: string;
  firstName?: string;
  lastName?: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
};

export type ContractPhoneNumberSnapshot = {
  id?: string;
  number?: string;
  type?: string;
  isPrimary?: boolean;
  isActive?: boolean;
};

export type ContractCustomerSnapshot = {
  id?: string;
  companyName?: string | null;
  customerType?: string;
  industry?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  brandName?: string | null;
  brandNameDescription?: string | null;
  firstName?: string;
  homeAddress?: string | null;
  homeNumber?: string | null;
  lastName?: string;
  nationalCode?: string | null;
  projectManagerName?: string | null;
  projectManagerNumber?: string | null;
  referrerFirstName?: string | null;
  referrerLastName?: string | null;
  referrerPhoneNumber?: string | null;
  workAddress?: string | null;
  workNumber?: string | null;
  primaryContact?: ContractPrimaryContactSnapshot;
  phoneNumbers?: ContractPhoneNumberSnapshot[];
};

const isRecord = (value: unknown): value is SnapshotRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const projectFields = (source: SnapshotRecord, fields: readonly string[]): SnapshotRecord =>
  Object.fromEntries(fields.flatMap((field) =>
    Object.prototype.hasOwnProperty.call(source, field) ? [[field, source[field]]] : []
  ));

const CUSTOMER_FACT_FIELDS = [
  'id', 'companyName', 'customerType', 'industry', 'address', 'city', 'country',
  'brandName', 'brandNameDescription', 'firstName', 'homeAddress', 'homeNumber',
  'lastName', 'nationalCode', 'projectManagerName', 'projectManagerNumber',
  'referrerFirstName', 'referrerLastName', 'referrerPhoneNumber', 'workAddress', 'workNumber',
] as const;

const PRIMARY_CONTACT_FIELDS = [
  'id', 'firstName', 'lastName', 'position', 'email', 'phone', 'mobile', 'isPrimary', 'isActive',
] as const;

const PHONE_NUMBER_FIELDS = [
  'id', 'number', 'type', 'isPrimary', 'isActive',
] as const;

const projectCustomerSnapshot = (customer: SnapshotRecord): ContractCustomerSnapshot => {
  const snapshot = projectFields(customer, CUSTOMER_FACT_FIELDS) as ContractCustomerSnapshot;
  if (isRecord(customer.primaryContact)) {
    snapshot.primaryContact = projectFields(
      customer.primaryContact,
      PRIMARY_CONTACT_FIELDS,
    ) as ContractPrimaryContactSnapshot;
  }
  if (Array.isArray(customer.phoneNumbers)) {
    snapshot.phoneNumbers = customer.phoneNumbers
      .filter(isRecord)
      .map(phoneNumber => projectFields(
        phoneNumber,
        PHONE_NUMBER_FIELDS,
      ) as ContractPhoneNumberSnapshot);
  }
  return snapshot;
};

/**
 * Keeps contract-owned customer facts while excluding live CRM navigation
 * collections that can recursively contain earlier contract snapshots.
 * Selected-project evidence remains in contractData.project.
 */
export const sanitizeContractDataCustomerSnapshot = (contractData: unknown): unknown => {
  if (!isRecord(contractData) || !isRecord(contractData.customer)) return contractData;
  return { ...contractData, customer: projectCustomerSnapshot(contractData.customer) };
};

/**
 * Freezes the accounting source contract without embedding unrelated CRM
 * history. Contract items, deliveries, payments and commercial evidence stay
 * intact for financial approval and audit reconciliation.
 */
export const buildAccountingContractSourceSnapshot = <T extends SnapshotRecord>(contract: T) => {
  const contractData = sanitizeContractDataCustomerSnapshot(contract.contractData);
  const frozenCustomer = isRecord(contractData) && isRecord(contractData.customer)
    ? contractData.customer
    : isRecord(contract.customer)
      ? projectCustomerSnapshot(contract.customer)
      : contract.customer;

  return { ...contract, customer: frozenCustomer, contractData };
};
