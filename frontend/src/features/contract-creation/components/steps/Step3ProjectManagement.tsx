// Step 3: Project Management Component
// Project selection from customer's projects

import React from 'react';
import { FaPlus, FaCheck } from 'react-icons/fa';
import { useRouter } from 'next/navigation';
import type { ContractWizardData } from '../../types/contract.types';

interface Step3ProjectManagementProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  currentStep: number;
}

export const Step3ProjectManagement: React.FC<Step3ProjectManagementProps> = ({
  wizardData,
  updateWizardData,
  errors,
  currentStep
}) => {
  const router = useRouter();
  const projects = wizardData.customer?.projectAddresses || [];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          مدیریت پروژه
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          پروژه مشتری را انتخاب یا ایجاد کنید
        </p>
      </div>
      
      {wizardData.customer && (
        <div className="max-w-2xl mx-auto">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            پروژه‌های {wizardData.customer.firstName} {wizardData.customer.lastName}
          </label>
          <div className="space-y-3">
            {projects.length === 0 && (
              <div className="text-center py-6 border border-dashed border-gray-500/40 rounded-lg text-gray-400">
                هیچ پروژه‌ای برای این مشتری ثبت نشده است. برای ادامه یک پروژه جدید ایجاد کنید.
              </div>
            )}
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => updateWizardData({ 
                  projectId: project.id, 
                  project: project 
                })}
                className={`p-4 border rounded-lg cursor-pointer transition-all ${
                  wizardData.projectId === project.id
                    ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-800 dark:text-white">
                      {project.projectName || 'بدون نام پروژه'}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{project.address}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{project.city}</p>
                  </div>
                  {wizardData.projectId === project.id && (
                    <FaCheck className="text-teal-500 ml-3 flex-shrink-0 text-xl" />
                  )}
                </div>
                
                {/* Project Manager Information */}
                {(project.projectManagerName || project.projectManagerNumber) && (
                  <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Left Column */}
                      <div className="space-y-2">
                        {/* Project Manager Name */}
                        {project.projectManagerName && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 dark:text-gray-400 text-sm">?</span>
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 block">مدیر پروژه</span>
                              <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                                {project.projectManagerName}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Right Column */}
                      <div className="space-y-2">
                        {/* Project Manager Number */}
                        {project.projectManagerNumber && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 dark:text-gray-400 text-sm">?</span>
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 block">شماره مدیر پروژه</span>
                              <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                                {project.projectManagerNumber}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Quick Create Project Button */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                // Store current wizard state in localStorage
                localStorage.setItem('contractWizardState', JSON.stringify({
                  currentStep: currentStep,
                  wizardData: wizardData
                }));
                console.log('? Saving wizard state for project creation:', {
                  currentStep,
                  wizardData
                });
                // Redirect to customer detail page to add project
                router.push(`/dashboard/crm/customers/${wizardData.customerId}?returnTo=contract&step=${currentStep}&action=addProject`);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
            >
              <FaPlus className="h-4 w-4" />
              <span className="font-medium">ایجاد پروژه جدید</span>
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
              پروژه مورد نظر را پیدا نکردید؟ پروژه جدید ایجاد کنید
            </p>
          </div>
          {errors.projectId && (
            <p className="text-red-500 text-sm mt-1">{errors.projectId}</p>
          )}
        </div>
      )}
    </div>
  );
};


