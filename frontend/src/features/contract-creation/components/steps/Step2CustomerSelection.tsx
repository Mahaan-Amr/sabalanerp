// Step 2: Customer Selection Component
// Customer search and selection

import React, { useRef, useState } from 'react';
import {
  ErpInlineState,
} from '@/components/erp';
import { useRouter } from 'next/navigation';
import { crmAPI } from '@/lib/api';
import type { ContractWizardData, CrmCustomer } from '../../types/contract.types';
import { applyLoadedCustomer, createCustomerSelectionUpdates } from '../../services/contractPartyIdentity';
import { persistContractLocalValue } from '../../utils/contractRecoveryJournal';
import { ContractCustomerStepView } from '../shared/ContractWizardStepViews';

interface Step2CustomerSelectionProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  customerSearchTerm: string;
  setCustomerSearchTerm: (term: string) => void;
  customers: CrmCustomer[];
  filteredCustomers: CrmCustomer[];
  currentStep: number;
  isOwnerScopedUser?: boolean;
}

export const Step2CustomerSelection: React.FC<Step2CustomerSelectionProps> = ({
  wizardData,
  updateWizardData,
  errors,
  customerSearchTerm,
  setCustomerSearchTerm,
  customers,
  filteredCustomers,
  currentStep,
  isOwnerScopedUser = false
}) => {
  const router = useRouter();
  const [storageError, setStorageError] = useState<string | null>(null);
  const selectedCustomerIdRef = useRef(wizardData.customerId);
  selectedCustomerIdRef.current = wizardData.customerId;
  const getOwnerLabel = (customer?: CrmCustomer | null) => {
    if (!customer) return 'بدون مسئول فروش';
    const ownerName = [customer.ownerUser?.firstName, customer.ownerUser?.lastName].filter(Boolean).join(' ').trim();
    return ownerName || customer.ownerUser?.username || 'بدون مسئول فروش';
  };

  const persistAndCreateCustomer = () => {
    const persisted = persistContractLocalValue(localStorage, 'contractWizardState', {
      currentStep,
      wizardData
    });
    if (!persisted) {
      setStorageError('فضای ذخیرهٔ مرورگر پر است؛ برای جلوگیری از از دست‌رفتن قرارداد، خروج از این مرحله متوقف شد.');
      return;
    }
    setStorageError(null);
    const params = new URLSearchParams({
      returnTo: 'contract',
      step: String(currentStep)
    });
    if (wizardData.contractKind === 'collaboration') {
      params.set('contractKind', 'collaboration');
      params.set('customerType', 'Collaborative');
    }
    router.push(`/dashboard/crm/customers/create?${params.toString()}`);
  };

  const handleSelectCustomer = async (customer: CrmCustomer) => {
    selectedCustomerIdRef.current = customer.id;
    updateWizardData(createCustomerSelectionUpdates(wizardData, customer));

    try {
      const fullCustomerResponse = await crmAPI.getCustomer(customer.id);
      if (fullCustomerResponse.data.success && fullCustomerResponse.data.data) {
        const updates = applyLoadedCustomer(
          customer.id,
          selectedCustomerIdRef.current,
          fullCustomerResponse.data.data
        );
        if (updates) updateWizardData(updates);
      }
    } catch (error) {
      console.error('Error fetching full customer data:', error);
    }
  };

  const rows = filteredCustomers.map(customer => ({ id: customer.id,
    title: `${customer.firstName} ${customer.lastName}`.trim(), companyName: customer.companyName || undefined,
    phone: customer.phoneNumbers?.[0]?.number, type: customer.customerType, status: customer.status,
    ownerLabel: getOwnerLabel(customer), projectCount: customer.projectAddresses?.length || 0 }));
  const selectedSource = customers.find(customer => customer.id === wizardData.customerId);
  const selectedRow = selectedSource ? { id: selectedSource.id,
    title: `${selectedSource.firstName} ${selectedSource.lastName}`.trim(), companyName: selectedSource.companyName || undefined,
    phone: selectedSource.phoneNumbers?.[0]?.number, type: selectedSource.customerType, status: selectedSource.status,
    ownerLabel: getOwnerLabel(selectedSource), projectCount: selectedSource.projectAddresses?.length || 0 } : undefined;
  return <div className="space-y-5">
    {storageError && <ErpInlineState kind="error" title={storageError} />}
    <ContractCustomerStepView customers={rows} selectedCustomer={selectedRow} selectedCustomerId={wizardData.customerId}
      searchTerm={customerSearchTerm} totalCount={customers.length} error={errors.customerId}
      onSearchChange={setCustomerSearchTerm} onCreate={persistAndCreateCustomer}
      onSelect={id => { const customer = filteredCustomers.find(item => item.id === id); if (customer) void handleSelectCustomer(customer); }} />
  </div>;
};
