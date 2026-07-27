// Step 3: Project Management Component
// Project selection from customer's projects

import React from 'react';
import { ErpPressable } from '@/components/erp';
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
      <div className="flex justify-end">
        {wizardData.customer && (
          <ErpPressable
            type="button"
            onClick={persistAndCreateProject}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--sds-info-border)] bg-[var(--sds-surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--sds-info)] shadow-sm transition-colors hover:bg-[var(--sds-info-surface)] dark:border-[var(--sds-info-border)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-info)] dark:hover:bg-[var(--sds-info-surface)]"
          >
            <FaPlus className="h-4 w-4" />
            <span>ایجاد پروژه</span>
          </ErpPressable>
        )}
      </div>

      {errors.projectId && (
        <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
          {errors.projectId}
        </div>
      )}

      {selectedProject && (
        <section className="rounded-xl border border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] p-4 dark:border-[var(--sds-accent)] dark:bg-[var(--sds-accent-soft)]">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--sds-accent-soft)] text-[var(--sds-text-inverse)]">
              <FaCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">پروژه انتخاب شده</p>
              <h4 className="mt-1 break-words text-base font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                {selectedProject.projectName || 'بدون نام پروژه'}
              </h4>
              <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                {selectedProject.address}
              </p>
            </div>
          </div>
        </section>
      )}

      {wizardData.customer && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
              پروژه‌های {wizardData.customer.firstName} {wizardData.customer.lastName}
            </p>
            <span className="rounded-full bg-[var(--sds-surface-subtle)] px-3 py-1 text-xs font-medium text-[var(--sds-text-secondary)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-secondary)]">
              {projects.length} پروژه
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {projects.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-8 text-center dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)] lg:col-span-2">
                <p className="text-base font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">هیچ پروژه‌ای برای این مشتری ثبت نشده است.</p>
                <ErpPressable
                  type="button"
                  onClick={persistAndCreateProject}
                  className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--sds-info-border)] px-4 py-2 text-sm font-semibold text-[var(--sds-info)] transition-colors hover:bg-[var(--sds-info-surface)] dark:border-[var(--sds-info-border)] dark:text-[var(--sds-info)] dark:hover:bg-[var(--sds-info-surface)]"
                >
                  <FaPlus className="h-4 w-4" />
                  ایجاد پروژه
                </ErpPressable>
              </div>
            )}
            {projects.map((project) => (
              <ErpPressable
                key={project.id}
                type="button"
                onClick={() => updateWizardData({ 
                  projectId: project.id, 
                  project: project 
                })}
                className={`rounded-xl border p-4 text-right shadow-sm transition ${
                  wizardData.projectId === project.id
                    ? 'border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] dark:border-[var(--sds-accent)] dark:bg-[var(--sds-accent-soft)]'
                    : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] hover:border-[var(--sds-accent)] dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)] dark:hover:border-[var(--sds-accent)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words text-base font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                      {project.projectName || 'بدون نام پروژه'}
                    </h4>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{project.address}</p>
                    {project.city && <p className="mt-1 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">{project.city}</p>}
                  </div>
                  <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                    wizardData.projectId === project.id
                      ? 'bg-[var(--sds-accent-soft)] text-[var(--sds-text-inverse)]'
                      : 'bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-secondary)]'
                  }`}>
                    <FaCheck className="h-4 w-4" />
                  </span>
                </div>
                
                {(project.projectManagerName || project.projectManagerNumber) && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--sds-border-default)] pt-3 text-xs dark:border-[var(--sds-border-subtle)]">
                    {project.projectManagerName && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1 text-[var(--sds-text-secondary)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-secondary)]">
                        <FaUserTie className="h-3 w-3" />
                        {project.projectManagerName}
                      </span>
                    )}
                    {project.projectManagerNumber && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1 text-[var(--sds-text-secondary)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-secondary)]">
                        <FaPhone className="h-3 w-3" />
                        {project.projectManagerNumber}
                      </span>
                    )}
                  </div>
                )}
              </ErpPressable>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};


