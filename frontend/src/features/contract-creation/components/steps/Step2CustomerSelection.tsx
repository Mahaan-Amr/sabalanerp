// Step 2: Customer Selection Component
// Customer search and selection

import React, { useRef, useState } from 'react';
import {
  ErpButton,
  ErpInput,
  ErpInlineState,
  ErpNeumorphicCard,
  ErpNeumorphicInteractiveCard,
  ErpNeumorphicSelectedSummary,
} from '@/components/erp';
import { FaSearch, FaPlus, FaCheck, FaPhone, FaBuilding, FaUser } from 'react-icons/fa';
import { useRouter } from 'next/navigation';
import { crmAPI } from '@/lib/api';
import type { ContractWizardData, CrmCustomer } from '../../types/contract.types';
import { applyLoadedCustomer, createCustomerSelectionUpdates } from '../../services/contractPartyIdentity';
import { persistContractLocalValue } from '../../utils/contractRecoveryJournal';

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
  const selectedCustomer = wizardData.customer;
  const [storageError, setStorageError] = useState<string | null>(null);
  const selectedCustomerIdRef = useRef(wizardData.customerId);
  selectedCustomerIdRef.current = wizardData.customerId;
  const hasSearch = customerSearchTerm.trim().length > 0;

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

  return (
    <div className="space-y-5">
      {storageError && <ErpInlineState kind="error" title={storageError} />}
      <div className="flex justify-end">
        <ErpButton
          label="ایجاد مشتری"
          icon={FaPlus}
          onClick={persistAndCreateCustomer}
          tone="primary"
          variant="outline"
          className="flex-nowrap whitespace-nowrap px-4"
        />
      </div>

      {errors.customerId && (
        <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
          {errors.customerId}
        </div>
      )}

      {selectedCustomer && (
        <ErpNeumorphicSelectedSummary
          icon={FaCheck}
          label="مشتری انتخاب شده"
          title={`${selectedCustomer.firstName} ${selectedCustomer.lastName}`}
        >
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--sds-text-secondary)]">
            {selectedCustomer.companyName && <span>{selectedCustomer.companyName}</span>}
            {selectedCustomer.phoneNumbers?.[0]?.number && <span>{selectedCustomer.phoneNumbers[0].number}</span>}
            <span>مسئول فروش: {getOwnerLabel(selectedCustomer)}</span>
            <span>{selectedCustomer.projectAddresses?.length || 0} پروژه</span>
          </div>
        </ErpNeumorphicSelectedSummary>
      )}

      <ErpNeumorphicCard className="p-3 sm:p-4">
        <div className="relative">
          <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sds-text-muted)]" />
          <ErpInput
            type="text"
            placeholder="جستجو با نام، شرکت، کد ملی یا شماره تلفن"
            value={customerSearchTerm}
            onChange={(e) => setCustomerSearchTerm(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] py-3 pl-4 pr-10 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-primary)] dark:placeholder-slate-400 dark:focus:border-[var(--sds-accent)] dark:focus:bg-[var(--sds-surface-subtle)]"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
          <span>{hasSearch ? `${filteredCustomers.length} نتیجه پیدا شد` : `نمایش ${filteredCustomers.length} مشتری اخیر`}</span>
          <span>{`${customers.length} مشتری در CRM`}</span>
        </div>
      </ErpNeumorphicCard>

      {filteredCustomers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-8 text-center dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
          <p className="text-base font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
            {hasSearch ? 'مشتری‌ای با این عبارت پیدا نشد' : 'هیچ مشتری‌ای موجود نیست'}
          </p>
          <ErpButton
            label="ایجاد مشتری"
            icon={FaPlus}
            onClick={persistAndCreateCustomer}
            tone="primary"
            variant="outline"
            className="mt-5 flex-nowrap whitespace-nowrap px-4"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filteredCustomers.map((customer) => {
            const isSelected = wizardData.customerId === customer.id;
            return (
              <ErpNeumorphicInteractiveCard
                key={customer.id}
                type="button"
                onClick={() => handleSelectCustomer(customer)}
                className={`rounded-xl p-4 text-right ${
                  isSelected
                    ? 'border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] dark:border-[var(--sds-accent)] dark:bg-[var(--sds-accent-soft)]'
                    : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] hover:border-[var(--sds-accent)] dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)] dark:hover:border-[var(--sds-accent)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-base font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                      {customer.firstName} {customer.lastName}
                    </h4>
                    {customer.companyName && (
                      <p className="mt-1 flex items-center gap-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                        <FaBuilding className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{customer.companyName}</span>
                      </p>
                    )}
                  </div>
                  <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                    isSelected ? 'bg-[var(--sds-accent-soft)] text-[var(--sds-accent-on-soft)]' : 'bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-secondary)]'
                  }`}>
                    {isSelected ? <FaCheck className="h-4 w-4" /> : <FaUser className="h-4 w-4" />}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1 font-medium text-[var(--sds-text-secondary)]">
                    {customer.customerType}
                  </span>
                  <span className="rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1 font-medium text-[var(--sds-text-secondary)]">
                    {customer.status}
                  </span>
                  {customer.phoneNumbers?.[0]?.number && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1 text-[var(--sds-text-secondary)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-secondary)]">
                      <FaPhone className="h-3 w-3" />
                      {customer.phoneNumbers[0].number}
                    </span>
                  )}
                  <span className="rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1 font-medium text-[var(--sds-text-secondary)]">
                    مسئول فروش: {getOwnerLabel(customer)}
                  </span>
                </div>
              </ErpNeumorphicInteractiveCard>
            );
          })}
        </div>
      )}
    </div>
  );
};
