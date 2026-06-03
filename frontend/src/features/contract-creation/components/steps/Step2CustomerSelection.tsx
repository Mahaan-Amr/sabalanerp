// Step 2: Customer Selection Component
// Customer search and selection

import React from 'react';
import { FaSearch, FaPlus, FaCheck, FaPhone, FaBuilding, FaUser } from 'react-icons/fa';
import { useRouter } from 'next/navigation';
import { crmAPI } from '@/lib/api';
import type { ContractWizardData, CrmCustomer } from '../../types/contract.types';

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
  const hasSearch = customerSearchTerm.trim().length > 0;

  const getOwnerLabel = (customer?: CrmCustomer | null) => {
    if (!customer) return 'بدون مسئول فروش';
    const ownerName = [customer.ownerUser?.firstName, customer.ownerUser?.lastName].filter(Boolean).join(' ').trim();
    return ownerName || customer.ownerUser?.username || 'بدون مسئول فروش';
  };

  const persistAndCreateCustomer = () => {
    localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep,
      wizardData
    }));
    router.push(`/dashboard/crm/customers/create?returnTo=contract&step=${currentStep}`);
  };

  const handleSelectCustomer = async (customer: CrmCustomer) => {
    updateWizardData({
      customerId: customer.id,
      customer: {
        ...customer,
        projectAddresses: customer.projectAddresses || [],
        phoneNumbers: customer.phoneNumbers || []
      }
    });

    try {
      const fullCustomerResponse = await crmAPI.getCustomer(customer.id);
      if (fullCustomerResponse.data.success && fullCustomerResponse.data.data) {
        updateWizardData({
          customer: {
            ...fullCustomerResponse.data.data,
            projectAddresses: fullCustomerResponse.data.data.projectAddresses || [],
            phoneNumbers: fullCustomerResponse.data.data.phoneNumbers || []
          }
        });
      }
    } catch (error) {
      console.error('Error fetching full customer data:', error);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-300">CRM</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">انتخاب مشتری</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            مشتری قرارداد را انتخاب کنید تا پروژه‌ها، اطلاعات تماس و مالکیت فروش درست به جریان بعدی منتقل شود.
          </p>
        </div>
        <button
          type="button"
          onClick={persistAndCreateCustomer}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-teal-300 bg-white px-4 py-2 text-sm font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-50 dark:border-teal-700 dark:bg-slate-900/60 dark:text-teal-200 dark:hover:bg-teal-900/20"
        >
          <FaPlus className="h-4 w-4" />
          <span>ایجاد مشتری</span>
        </button>
      </div>

      {errors.customerId && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {errors.customerId}
        </div>
      )}

      {selectedCustomer && (
        <section className="rounded-xl border border-teal-200 bg-teal-50/80 p-4 dark:border-teal-800 dark:bg-teal-900/20">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
              <FaCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-teal-700 dark:text-teal-200">مشتری انتخاب شده</p>
              <h4 className="mt-1 break-words text-base font-semibold text-slate-900 dark:text-white">
                {selectedCustomer.firstName} {selectedCustomer.lastName}
              </h4>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
                {selectedCustomer.companyName && <span>{selectedCustomer.companyName}</span>}
                {selectedCustomer.phoneNumbers?.[0]?.number && <span>{selectedCustomer.phoneNumbers[0].number}</span>}
                <span>مسئول فروش: {getOwnerLabel(selectedCustomer)}</span>
                <span>{selectedCustomer.projectAddresses?.length || 0} پروژه</span>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 sm:p-4">
        <div className="relative">
          <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="جستجو با نام، شرکت، کد ملی یا شماره تلفن"
            value={customerSearchTerm}
            onChange={(e) => setCustomerSearchTerm(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-4 pr-10 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-400 dark:focus:border-teal-400 dark:focus:bg-slate-900"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{hasSearch ? `${filteredCustomers.length} نتیجه پیدا شد` : `نمایش ${filteredCustomers.length} مشتری اخیر`}</span>
          <span>{`${customers.length} مشتری در CRM`}</span>
        </div>
      </section>

      {filteredCustomers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <p className="text-base font-medium text-slate-700 dark:text-slate-200">
            {hasSearch ? 'مشتری‌ای با این عبارت پیدا نشد' : 'هیچ مشتری‌ای موجود نیست'}
          </p>
          <button
            type="button"
            onClick={persistAndCreateCustomer}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-teal-300 px-4 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-50 dark:border-teal-700 dark:text-teal-200 dark:hover:bg-teal-900/20"
          >
            <FaPlus className="h-4 w-4" />
            ایجاد مشتری
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filteredCustomers.map((customer) => {
            const isSelected = wizardData.customerId === customer.id;
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => handleSelectCustomer(customer)}
                className={`rounded-xl border p-4 text-right shadow-sm transition ${
                  isSelected
                    ? 'border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-900/20'
                    : 'border-slate-200 bg-white hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-teal-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-base font-semibold text-slate-900 dark:text-white">
                      {customer.firstName} {customer.lastName}
                    </h4>
                    {customer.companyName && (
                      <p className="mt-1 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <FaBuilding className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{customer.companyName}</span>
                      </p>
                    )}
                  </div>
                  <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                    isSelected ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {isSelected ? <FaCheck className="h-4 w-4" /> : <FaUser className="h-4 w-4" />}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                    {customer.customerType}
                  </span>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                    {customer.status}
                  </span>
                  {customer.phoneNumbers?.[0]?.number && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <FaPhone className="h-3 w-3" />
                      {customer.phoneNumbers[0].number}
                    </span>
                  )}
                  <span className="rounded-full bg-purple-50 px-2 py-1 font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-200">
                    مسئول فروش: {getOwnerLabel(customer)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};


