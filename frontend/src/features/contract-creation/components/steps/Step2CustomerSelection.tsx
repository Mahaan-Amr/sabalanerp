import { contractNavigationStorage } from '@/features/contract-creation/utils/contractNavigationStorage';
﻿// Step 2: Customer Selection Component
// Customer search and selection

import React, { useEffect, useRef, useState } from 'react';
import {
  ErpInlineState,
} from '@/components/erp';
import { useRouter } from 'next/navigation';
import { crmAPI, type CrmCustomerOption } from '@/lib/api';
import { assertSuccessfulSalesResponse, getSalesOperationalErrorKind, getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';
import type { ContractWizardData } from '../../types/contract.types';
import { applyLoadedCustomer, createCustomerSelectionUpdates } from '../../services/contractPartyIdentity';
import { persistContractLocalValue } from '../../utils/contractRecoveryJournal';
import { ContractCustomerStepView, type ContractCustomerOption } from '../shared/ContractWizardStepViews';

interface Step2CustomerSelectionProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  customerSearchTerm: string;
  setCustomerSearchTerm: (term: string) => void;
  canLoadCustomers: boolean;
  customerScopeId?: string;
  customerType?: string;
  onSelectionPending: (pending: boolean) => void;
  onSelectionAccess: (permitted: boolean) => void;
  currentStep: number;
}

type CustomerReadFailure = { kind: 'error' | 'permission' | 'stale'; message: string };

const readFailure = (error: unknown, failedAction: string): CustomerReadFailure => ({
  kind: getSalesOperationalErrorKind(error),
  message: getSalesOperationalErrorMessage(error, { failedAction, nextStep: 'دوباره تلاش کنید.' })
});

const toRow = (customer: CrmCustomerOption): ContractCustomerOption => ({
  id: customer.id,
  title: [customer.firstName, customer.lastName].filter(Boolean).join(' '),
  companyName: customer.companyName || undefined,
  phone: customer.phone || undefined,
  type: customer.customerType,
  status: customer.status,
  ownerLabel: [customer.ownerUser?.firstName, customer.ownerUser?.lastName].filter(Boolean).join(' ')
    || customer.ownerUser?.username || 'بدون مسئول فروش'
});

export const Step2CustomerSelection: React.FC<Step2CustomerSelectionProps> = ({
  wizardData,
  updateWizardData,
  errors,
  customerSearchTerm,
  setCustomerSearchTerm,
  canLoadCustomers,
  customerScopeId,
  customerType,
  onSelectionPending,
  onSelectionAccess,
  currentStep
}) => {
  const router = useRouter();
  const [storageError, setStorageError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<{ key: string; rows: CrmCustomerOption[]; error?: CustomerReadFailure }>();
  const [restored, setRestored] = useState<{ key: string; row?: CrmCustomerOption; error?: CustomerReadFailure }>();
  const [selectionError, setSelectionError] = useState<CustomerReadFailure>();
  const [searchRetry, retrySearch] = useState(0);
  const [restoreRetry, retryRestore] = useState(0);
  const [pendingSelection, setPendingSelection] = useState(false);
  const selectionRequest = useRef<AbortController>();
  const query = customerSearchTerm.trim();
  const scopeKey = JSON.stringify([customerScopeId, customerType]);
  const searchKey = JSON.stringify([scopeKey, query, searchRetry]);
  const customerId = wizardData.customerId;
  const restoreKey = JSON.stringify([scopeKey, customerId, restoreRetry]);
  const result = canLoadCustomers && searchResult?.key === searchKey ? searchResult : undefined;
  const list = result?.rows ?? [];
  const visibleSelection = list.find(row => row.id === customerId);
  const restoredSelection = canLoadCustomers && restored?.key === restoreKey ? restored : undefined;
  const selectedOption = result?.error?.kind === 'permission' ? undefined : visibleSelection ?? restoredSelection?.row;
  const storedCustomer = wizardData.customer?.id === customerId ? wizardData.customer : null;

  useEffect(() => {
    if (!canLoadCustomers) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await crmAPI.getCustomerOptions({
          search: query || undefined, limit: query ? 20 : 3, customerType
        }, controller.signal);
        assertSuccessfulSalesResponse(response);
        if (!controller.signal.aborted) setSearchResult({ key: searchKey, rows: response.data.data });
      } catch (error) {
        if (!controller.signal.aborted) setSearchResult({
          key: searchKey, rows: [], error: readFailure(error, 'جستجوی مشتری')
        });
      }
    }, query ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canLoadCustomers, query, customerType, searchKey]);

  useEffect(() => {
    if (!canLoadCustomers || !customerId || !result || result.error?.kind === 'permission' || visibleSelection || restoredSelection) return;
    const controller = new AbortController();
    crmAPI.getCustomerOptions({ id: customerId, limit: 1, customerType }, controller.signal).then(response => {
      assertSuccessfulSalesResponse(response);
      if (!controller.signal.aborted) {
        setRestored({ key: restoreKey, row: response.data.data.find(row => row.id === customerId) });
      }
    }).catch(error => {
      if (!controller.signal.aborted) setRestored({ key: restoreKey, error: readFailure(error, 'بازیابی مشتری') });
    });
    return () => controller.abort();
  }, [canLoadCustomers, customerId, customerType, restoreKey, restoredSelection, result, visibleSelection]);

  useEffect(() => {
    if (selectedOption) onSelectionAccess(true);
    else if (!canLoadCustomers || result?.error?.kind === 'permission' || restoredSelection) onSelectionAccess(false);
  }, [canLoadCustomers, onSelectionAccess, restoredSelection, result?.error?.kind, selectedOption]);

  useEffect(() => {
    if (!selectedOption || storedCustomer || pendingSelection) return;
    const controller = new AbortController();
    crmAPI.getCustomer(customerId, controller.signal).then(response => {
      assertSuccessfulSalesResponse(response);
      if (controller.signal.aborted) return;
      const updates = applyLoadedCustomer(customerId, customerId, response.data.data);
      if (updates) updateWizardData(updates);
    }).catch(error => {
      if (!controller.signal.aborted) setSelectionError(readFailure(error, 'دریافت اطلاعات مشتری'));
    });
    return () => controller.abort();
  }, [customerId, pendingSelection, restoreRetry, selectedOption, storedCustomer, updateWizardData]);

  useEffect(() => () => {
    selectionRequest.current?.abort();
    setPendingSelection(false);
    onSelectionPending(false);
  }, [scopeKey, canLoadCustomers, onSelectionPending]);

  const persistAndCreateCustomer = () => {
    const persisted = persistContractLocalValue(contractNavigationStorage, 'contractWizardState', {
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

  const handleSelectCustomer = async (customer: CrmCustomerOption) => {
    selectionRequest.current?.abort();
    const controller = new AbortController();
    selectionRequest.current = controller;
    setPendingSelection(true);
    onSelectionPending(true);
    setSelectionError(undefined);
    try {
      const response = await crmAPI.getCustomer(customer.id, controller.signal);
      assertSuccessfulSalesResponse(response);
      if (controller.signal.aborted) return;
      if (response.data.data?.id !== customer.id) throw new Error('CUSTOMER_SELECTION_UNAVAILABLE');
      setRestored({ key: JSON.stringify([scopeKey, customer.id, restoreRetry]), row: customer });
      updateWizardData(createCustomerSelectionUpdates(wizardData, response.data.data));
    } catch (error) {
      if (!controller.signal.aborted) setSelectionError(readFailure(error, 'دریافت اطلاعات مشتری'));
    } finally {
      if (!controller.signal.aborted) {
        setPendingSelection(false);
        onSelectionPending(false);
      }
    }
  };

  const selectedRow = selectedOption ? { ...toRow(selectedOption), projectCount: storedCustomer?.projectAddresses?.length } : undefined;
  const listError = result?.error;
  const restoreError = restoredSelection?.error;
  const inaccessible = restoredSelection && !restoredSelection.row && !restoreError && !visibleSelection;
  const retryRestoration = () => { setSelectionError(undefined); retryRestore(previous => previous + 1); };
  return <div className="space-y-5">
    {storageError && <ErpInlineState kind="error" title={storageError} />}
    {customerScopeId && !canLoadCustomers &&
      <ErpInlineState kind="permission" title="برای دریافت مشتریان از CRM دسترسی لازم را ندارید." />}
    {listError && <ErpInlineState kind={listError.kind} title={listError.message}
      action={{ label: 'تلاش دوباره', onClick: () => retrySearch(previous => previous + 1) }} />}
    {restoreError && <ErpInlineState kind={restoreError.kind} title={restoreError.message}
      action={{ label: 'تلاش دوباره', onClick: retryRestoration }} />}
    {inaccessible && <ErpInlineState kind="stale" title="مشتری پیش‌نویس در دسترس نیست." />}
    {selectionError && <ErpInlineState kind={selectionError.kind} title={selectionError.message}
      action={selectedOption && !storedCustomer ? { label: 'تلاش دوباره', onClick: retryRestoration } : undefined} />}
    {pendingSelection && <ErpInlineState kind="empty" title="در حال دریافت اطلاعات مشتری…" />}
    <ContractCustomerStepView customers={list.map(toRow)} selectedCustomer={selectedRow} selectedCustomerId={customerId}
      searchTerm={customerSearchTerm} error={errors.customerId}
      loading={canLoadCustomers && !result} showResults={canLoadCustomers && !listError}
      onSearchChange={setCustomerSearchTerm} onCreate={persistAndCreateCustomer}
      onSelect={id => { const customer = list.find(item => item.id === id); if (customer) void handleSelectCustomer(customer); }} />
  </div>;
};
