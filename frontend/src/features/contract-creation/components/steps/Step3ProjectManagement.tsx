// Step 3: Project Management Component
// Project selection from customer's projects

import React from 'react';
import { FaPlus, FaCheck, FaUserTie, FaPhone } from 'react-icons/fa';
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
                <p>هیچ پروژه‌ای برای این مشتری ثبت نشده است.</p>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('contractWizardState', JSON.stringify({
                      currentStep: currentStep,
                      wizardData: wizardData
                    }));
                    router.push(`/dashboard/crm/customers/${wizardData.customerId}?returnTo=contract&step=${currentStep}&action=addProject`);
                  }}
                  className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 border border-blue-400/70 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors text-sm font-medium"
                >
                  <FaPlus className="h-4 w-4" />
                  ایجاد پروژه
                </button>
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
                            <FaUserTie className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
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
                            <FaPhone className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
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

          {/* Secondary create project action */}
          <div className="mt-4 flex justify-start">
            <button
              type="button"
              onClick={() => {
                // Store current wizard state in localStorage
                localStorage.setItem('contractWizardState', JSON.stringify({
                  currentStep: currentStep,
                  wizardData: wizardData
                }));
                console.log('Saving wizard state for project creation:', {
                  currentStep,
                  wizardData
                });
                // Redirect to customer detail page to add project
                router.push(`/dashboard/crm/customers/${wizardData.customerId}?returnTo=contract&step=${currentStep}&action=addProject`);
              }}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-blue-400/70 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors text-sm font-medium"
            >
              <FaPlus className="h-4 w-4" />
              <span>ایجاد پروژه</span>
            </button>
          </div>
          {errors.projectId && (
            <p className="text-red-500 text-sm mt-1">{errors.projectId}</p>
          )}
        </div>
      )}
    </div>
  );
};


