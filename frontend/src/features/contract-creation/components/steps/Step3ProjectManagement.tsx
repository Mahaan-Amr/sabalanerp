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
  const selectedProject = wizardData.project;

  const persistAndCreateProject = () => {
    localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep,
      wizardData
    }));
    router.push(`/dashboard/crm/customers/${wizardData.customerId}?returnTo=contract&step=${currentStep}&action=addProject`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-300">پروژه قرارداد</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">انتخاب پروژه و آدرس</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            پروژه مشتری را انتخاب کنید تا آدرس تحویل و اطلاعات مدیر پروژه برای مراحل بعدی آماده شود.
          </p>
        </div>
        {wizardData.customer && (
          <button
            type="button"
            onClick={persistAndCreateProject}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50 dark:border-blue-700 dark:bg-slate-900/60 dark:text-blue-200 dark:hover:bg-blue-900/20"
          >
            <FaPlus className="h-4 w-4" />
            <span>ایجاد پروژه</span>
          </button>
        )}
      </div>

      {errors.projectId && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {errors.projectId}
        </div>
      )}

      {selectedProject && (
        <section className="rounded-xl border border-teal-200 bg-teal-50/80 p-4 dark:border-teal-800 dark:bg-teal-900/20">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
              <FaCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-teal-700 dark:text-teal-200">پروژه انتخاب شده</p>
              <h4 className="mt-1 break-words text-base font-semibold text-slate-900 dark:text-white">
                {selectedProject.projectName || 'بدون نام پروژه'}
              </h4>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {selectedProject.address}
              </p>
            </div>
          </div>
        </section>
      )}

      {wizardData.customer && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              پروژه‌های {wizardData.customer.firstName} {wizardData.customer.lastName}
            </p>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {projects.length} پروژه
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {projects.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900/50 lg:col-span-2">
                <p className="text-base font-medium text-slate-700 dark:text-slate-200">هیچ پروژه‌ای برای این مشتری ثبت نشده است.</p>
                <button
                  type="button"
                  onClick={persistAndCreateProject}
                  className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900/20"
                >
                  <FaPlus className="h-4 w-4" />
                  ایجاد پروژه
                </button>
              </div>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => updateWizardData({ 
                  projectId: project.id, 
                  project: project 
                })}
                className={`rounded-xl border p-4 text-right shadow-sm transition ${
                  wizardData.projectId === project.id
                    ? 'border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-900/20'
                    : 'border-slate-200 bg-white hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-teal-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-base font-semibold text-slate-900 dark:text-white">
                      {project.projectName || 'بدون نام پروژه'}
                    </h4>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{project.address}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{project.city}</p>
                  </div>
                  <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                    wizardData.projectId === project.id
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    <FaCheck className="h-4 w-4" />
                  </span>
                </div>
                
                {(project.projectManagerName || project.projectManagerNumber) && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
                    {project.projectManagerName && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <FaUserTie className="h-3 w-3" />
                        {project.projectManagerName}
                      </span>
                    )}
                    {project.projectManagerNumber && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <FaPhone className="h-3 w-3" />
                        {project.projectManagerNumber}
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};


