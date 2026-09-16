// Step 3: Project Management Component
// Project selection from customer's projects

import React, { useState } from 'react';
import {
  ErpInlineState,
} from '@/components/erp';
import { useRouter } from 'next/navigation';
import type { ContractWizardData } from '../../types/contract.types';
import { persistContractLocalValue } from '../../utils/contractRecoveryJournal';
import { ContractProjectStepView } from '../shared/ContractWizardStepViews';

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
  const [storageError, setStorageError] = useState<string | null>(null);

  const persistAndCreateProject = () => {
    const persisted = persistContractLocalValue(localStorage, 'contractWizardState', {
      currentStep,
      wizardData
    });
    if (!persisted) {
      setStorageError('فضای ذخیرهٔ مرورگر پر است؛ برای جلوگیری از از دست‌رفتن قرارداد، خروج از این مرحله متوقف شد.');
      return;
    }
    setStorageError(null);
    router.push(`/dashboard/crm/customers/${wizardData.customerId}?returnTo=contract&step=${currentStep}&action=addProject`);
  };

  return <div className="space-y-5">
    {storageError && <ErpInlineState kind="error" title={storageError} />}
    <ContractProjectStepView
      customerName={wizardData.customer ? `${wizardData.customer.firstName} ${wizardData.customer.lastName}`.trim() : undefined}
      projects={projects.map(project => ({ id: project.id, title: project.projectName || 'بدون نام پروژه',
        address: project.address, city: project.city || undefined, managerName: project.projectManagerName,
        managerPhone: project.projectManagerNumber }))}
      selectedProjectId={wizardData.projectId} error={errors.projectId} onCreate={persistAndCreateProject}
      onSelect={id => { const project = projects.find(item => item.id === id); if (project) updateWizardData({ projectId: project.id, project }); }}
    />
  </div>;
};
