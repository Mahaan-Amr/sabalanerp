export type ContractLifecycleAction = 'DELETE' | 'DEACTIVATE' | 'REACTIVATE';

export type ContractLifecycleBlocker = {
  code: string;
  count: number;
  label: string;
  details?: Array<{ id: string; kind: string; status?: string | null; reference?: string | null }>;
};

export const contractHardDeleteEligibility = ({
  status,
  dependencies,
}: {
  status: string;
  dependencies: {
    financialDocuments: number;
    conclusivePhysicalOperations: number;
    openOperations: number;
    blockingFinancialDocuments?: ContractLifecycleBlocker['details'];
    blockingPhysicalOperations?: ContractLifecycleBlocker['details'];
  };
}) => {
  const blockers: ContractLifecycleBlocker[] = [];
  if (status !== 'DRAFT' && status !== 'CANCELLED') {
    blockers.push({ code: 'STATUS_NOT_DELETABLE', count: 1, label: 'وضعیت غیرقابل حذف' });
  }
  if (dependencies.financialDocuments > 0) {
    blockers.push({
      code: 'FINANCIAL_DOCUMENTS',
      count: dependencies.financialDocuments,
      label: 'اسناد مالی',
      ...(dependencies.blockingFinancialDocuments ? { details: dependencies.blockingFinancialDocuments } : {}),
    });
  }
  if (dependencies.conclusivePhysicalOperations > 0) {
    blockers.push({
      code: 'CONCLUSIVE_PHYSICAL_OPERATIONS',
      count: dependencies.conclusivePhysicalOperations,
      label: 'عملیات فیزیکی قطعی',
      ...(dependencies.blockingPhysicalOperations ? { details: dependencies.blockingPhysicalOperations } : {}),
    });
  }
  return { eligible: blockers.length === 0, blockers };
};

export const contractDeactivationEligibility = ({
  alreadyInactive,
  openOperations,
}: {
  alreadyInactive: boolean;
  openOperations: {
    deliveries: number;
    loadings: number;
    financialWorkflows: number;
    deliveryDetails?: ContractLifecycleBlocker['details'];
    loadingDetails?: ContractLifecycleBlocker['details'];
    financialWorkflowDetails?: ContractLifecycleBlocker['details'];
  };
}) => {
  const blockers: ContractLifecycleBlocker[] = [];
  if (alreadyInactive) blockers.push({ code: 'ALREADY_INACTIVE', count: 1, label: 'قرارداد از قبل غیرفعال است' });
  if (openOperations.deliveries > 0) blockers.push({ code: 'OPEN_DELIVERIES', count: openOperations.deliveries, label: 'تحویل‌های باز', ...(openOperations.deliveryDetails ? { details: openOperations.deliveryDetails } : {}) });
  if (openOperations.loadings > 0) blockers.push({ code: 'OPEN_LOADINGS', count: openOperations.loadings, label: 'بارگیری‌های باز', ...(openOperations.loadingDetails ? { details: openOperations.loadingDetails } : {}) });
  if (openOperations.financialWorkflows > 0) blockers.push({ code: 'OPEN_FINANCIAL_WORKFLOWS', count: openOperations.financialWorkflows, label: 'گردش‌های مالی ناتمام', ...(openOperations.financialWorkflowDetails ? { details: openOperations.financialWorkflowDetails } : {}) });
  return { eligible: blockers.length === 0, blockers };
};

export const mayDirectlyPerformContractLifecycleAction = (
  role: string,
  action: ContractLifecycleAction,
): boolean => {
  if (role === 'ADMIN') return true;
  return role === 'MANAGER' && action === 'DEACTIVATE';
};
