export type ContractLifecyclePresentation = {
  status: string;
  commercialFlowVersion?: number;
  commercialRevision?: number;
  commercialExpiresAt?: string | null;
  commercialExpiryDays?: number;
  firstFinancialRecordAt?: string | null;
  commercialActions?: {
    canApproveSales: boolean;
    canSendConfirmation: boolean;
    canEdit: boolean;
    canRenew: boolean;
  };
};

const legacyLabels: Record<string, string> = {
  DRAFT: 'پیش‌نویس', PENDING_APPROVAL: 'در انتظار تایید', APPROVED: 'تایید شده',
  SIGNED: 'امضا شده', PRINTED: 'چاپ شده', CANCELLED: 'لغو شده', EXPIRED: 'منقضی شده',
};
const currentLabels: Record<string, string> = {
  ...legacyLabels, DRAFT: 'یادداشت', PENDING_APPROVAL: 'پیش‌نویس', APPROVED: 'امضا شده', SIGNED: 'قطعی',
};

export const isCurrentContractFlow = (contract: Pick<ContractLifecyclePresentation, 'commercialFlowVersion'>) =>
  contract.commercialFlowVersion === 1;

export const contractLifecycleLabel = (contract: Pick<ContractLifecyclePresentation, 'status' | 'commercialFlowVersion'>) =>
  (isCurrentContractFlow(contract) ? currentLabels : legacyLabels)[contract.status] || contract.status;

// Stored status meanings differ for untouched historical contracts. Keep both meanings explicit in mixed lists.
export const contractLifecycleFilterOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'یادداشت / پیش‌نویس قدیمی', value: 'DRAFT' },
  { label: 'پیش‌نویس / در انتظار تایید قدیمی', value: 'PENDING_APPROVAL' },
  { label: 'امضا شده / تایید شده قدیمی', value: 'APPROVED' },
  { label: 'قطعی / امضا شده قدیمی', value: 'SIGNED' },
  { label: 'چاپ شده قدیمی', value: 'PRINTED' },
  { label: 'لغو شده', value: 'CANCELLED' },
  { label: 'منقضی شده', value: 'EXPIRED' },
];
