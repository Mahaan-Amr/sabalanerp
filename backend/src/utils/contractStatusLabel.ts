import { partnerCommercialLabels, type PartnerCommercialState } from '@sabalanerp/partner-sales-contracts';
const legacy: Record<string, string> = {
  DRAFT: 'پیش‌نویس', PENDING_APPROVAL: 'در انتظار تایید', APPROVED: 'تایید شده',
  SIGNED: 'امضا شده', PRINTED: 'چاپ شده', CANCELLED: 'لغو شده', EXPIRED: 'منقضی شده',
};
const ordinary: Record<string, string> = {
  ...legacy, DRAFT: 'یادداشت', PENDING_APPROVAL: 'پیش‌نویس', APPROVED: 'امضا شده', SIGNED: 'قطعی',
};
export const contractStatusLabel = (contract: { status?: string; commercialFlowVersion?: number; partnerKind?: string | null; partnerCaseId?: string | null; partnerCommercialStatus?: string }) => {
  if (contract.partnerCommercialStatus) return partnerCommercialLabels[contract.partnerCommercialStatus as PartnerCommercialState['status']] || contract.partnerCommercialStatus;
  const labels = contract.commercialFlowVersion === 1 && !contract.partnerKind && !contract.partnerCaseId ? ordinary : legacy;
  return labels[contract.status || 'DRAFT'] || contract.status || 'پیش‌نویس';
};
