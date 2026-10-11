import type { ContractWizardData, CrmCustomer } from '../types/contract.types';
import { createCustomerSelectionUpdates } from './contractPartyIdentity';
import PersianCalendar from '@/lib/persian-calendar';

// Retain commercial graph relationships while assigning identities to a new Contract.
export const buildReplacementWizardData = (source: { customer: CrmCustomer; contractData: ContractWizardData },
  makeIdentity: () => string = () => crypto.randomUUID()): ContractWizardData => {
  const ids = new Map<string, string>();
  const items = { products: source.contractData.products || [], serviceRows: source.contractData.serviceRows || [] };
  const localIdentityKeys = new Set(['rowId', 'stairSystemId', 'sourceBatchId', 'sourceRowId']);
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (localIdentityKeys.has(key) && typeof child === 'string' && child && !ids.has(child)) ids.set(child, makeIdentity());
      collect(child);
    }
  };
  collect(items);
  const copy = (value: unknown): any => {
    if (typeof value === 'string') return ids.get(value) || value;
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['sourceContractItemId', 'contractItemId', 'retiredAt', 'retiredByCorrectionId'].includes(key))
      .map(([key, child]) => [key, copy(child)]));
    return value;
  };
  const customer = createCustomerSelectionUpdates({ customerId: '', customer: null, projectId: '', project: null }, source.customer);
  return { contractKind: source.contractData.contractKind || 'standard',
    contractDate: PersianCalendar.now('jYYYY/jMM/jDD'), contractNumber: '', creatorSequenceNumber: null,
    ...customer, selectedProductTypeForAddition: null, ...copy(items), deliveries: [],
    payment: { payments: [], currency: 'تومان', totalContractAmount: 0 }, discount: null, signature: null };
};
