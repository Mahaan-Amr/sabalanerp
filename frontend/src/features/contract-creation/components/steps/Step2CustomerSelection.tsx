// Step 2: Customer Selection Component
// Customer search and selection

import React from 'react';
import { FaSearch, FaPlus, FaCheck } from 'react-icons/fa';
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

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          انتخاب مشتری
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          مشتری را از سیستم CRM انتخاب کنید
        </p>
      </div>
      
      <div className="max-w-2xl mx-auto">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          جستجو و انتخاب مشتری
        </label>
        
        {/* Search Input */}
        <div className="relative mb-4">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <FaSearch className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="جستجو برای مشاهده همه مشتریان (نام، شرکت، کد ملی، شماره تلفن...)"
            value={customerSearchTerm}
            onChange={(e) => setCustomerSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        <div className="mb-4 px-4 py-2 rounded-lg border border-teal-500/30 bg-teal-500/10 text-xs text-teal-200">
          {isOwnerScopedUser
            ? 'فقط مشتریان متعلق به شما نمایش داده می‌شود. برای یافتن سریع‌تر از جستجو استفاده کنید.'
            : 'مشتری را از CRM انتخاب کنید. در صورت نیاز مشتری جدید بسازید.'}
        </div>

        {/* Quick Create Customer Button */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              // Store current wizard state in localStorage
              localStorage.setItem('contractWizardState', JSON.stringify({
                currentStep: currentStep,
                wizardData: wizardData
              }));
              console.log('? Saving wizard state for customer creation:', {
                currentStep,
                wizardData
              });
              // Redirect to customer creation
              router.push(`/dashboard/crm/customers/create?returnTo=contract&step=${currentStep}`);
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            <FaPlus className="h-4 w-4" />
            <span className="font-medium">ایجاد مشتری جدید</span>
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
            مشتری مورد نظر را پیدا نکردید؟ مشتری جدید ایجاد کنید
          </p>
        </div>
        
        <div className="space-y-3">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                {customerSearchTerm ? 'مشتری‌ای با این عبارت پیدا نشد' : 'هیچ مشتری‌ای موجود نیست'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCustomers.map((customer) => (
                <div
                  key={customer.id}
                  onClick={async () => {
                    // First update with basic customer data
                    updateWizardData({ 
                      customerId: customer.id, 
                      customer: {
                        ...customer,
                        projectAddresses: customer.projectAddresses || [],
                        phoneNumbers: customer.phoneNumbers || []
                      }
                    });
                    
                    // Fetch full CRM customer data
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
                      // Continue with basic customer data if fetch fails
                    }
                  }}
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    wizardData.customerId === customer.id
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-lg text-gray-800 dark:text-white">
                        {customer.firstName} {customer.lastName}
                      </h4>
                      {customer.companyName && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{customer.companyName}</p>
                      )}
                    </div>
                    
                    {wizardData.customerId === customer.id && (
                      <FaCheck className="text-teal-500 ml-3 flex-shrink-0 text-xl" />
                    )}
                  </div>
                  
                  {/* Customer Details: type, status, phone */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                      {customer.customerType}
                    </span>
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                      {customer.status}
                    </span>
                    {customer.phoneNumbers && customer.phoneNumbers.length > 0 && (
                      <>
                        <span className="text-gray-500 dark:text-gray-400 text-sm">?</span>
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                          {customer.phoneNumbers[0].number}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Preview indicator when not searching */}
              {!customerSearchTerm.trim() && customers.length > 10 && (
                <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <div className="flex items-center justify-center gap-2 text-blue-600 dark:text-blue-400">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium">
                      نمایش {filteredCustomers.length} از {customers.length} مشتری
                    </span>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  </div>
                  <p className="text-xs text-blue-500 dark:text-blue-400 text-center mt-1">
                    برای مشاهده همه مشتریان از جستجو استفاده کنید
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        {errors.customerId && (
          <p className="text-red-500 text-sm mt-1">{errors.customerId}</p>
        )}
      </div>
    </div>
  );
};


