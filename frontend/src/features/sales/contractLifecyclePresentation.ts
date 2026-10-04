import { partnerCommercialLabels, type PartnerCommercialState } from '@sabalanerp/partner-sales-contracts';
export type ContractLifecyclePresentation = {
  status: string;
  commercialFlowVersion?: number;
  partnerCommercialStatus?: string;
  partnerSalesApproved?: boolean;
  partnerKind?: string | null;
  partnerCaseId?: string | null;
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

export const contractLifecycleLabel = (contract: Pick<ContractLifecyclePresentation, 'status' | 'commercialFlowVersion' | 'partnerCommercialStatus'>) =>
  (contract.partnerCommercialStatus ? partnerCommercialLabels[contract.partnerCommercialStatus as PartnerCommercialState['status']] : undefined) ||
  (isCurrentContractFlow(contract) ? currentLabels : legacyLabels)[contract.status] || contract.status;

// Preserve historical stored evidence while using canonical filter labels.
export const contractLifecycleFilterOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'یادداشت', value: 'DRAFT' },
  { label: 'پیش‌نویس', value: 'PENDING_APPROVAL' },
  { label: 'امضا شده', value: 'APPROVED' },
  { label: 'استعلام شده', value: 'QUOTED' },
  { label: 'قطعی', value: 'SIGNED' },
  { label: 'چاپ شده', value: 'PRINTED' },
  { label: 'لغو شده', value: 'CANCELLED' },
  { label: 'منقضی شده', value: 'EXPIRED' },
];

export const contractLifecycleFilterStatus = (contract: ContractLifecyclePresentation) =>
  ({ NOTE: 'DRAFT', DRAFT: 'PENDING_APPROVAL', CUSTOMER_SIGNED: 'APPROVED', FINAL: 'SIGNED', QUOTED: 'QUOTED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED' } as Record<string, string>)[contract.partnerCommercialStatus || ''] || contract.status;
