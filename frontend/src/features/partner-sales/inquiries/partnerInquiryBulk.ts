import type { PartnerConfiguredInquiryRows } from './partnerInquirySubmission';
import { inquiryRowState, isUsableInquiryRow, type PartnerInquiryRow, type PartnerInquiryView } from './inquiryPresentation';

export type PartnerInquiryBulkStatus = 'USABLE' | 'MISSING' | 'PENDING' | 'REJECTED' | 'EXPIRED' | 'REINQUIRY_REQUIRED' | 'REINQUIRY_PENDING';

export interface PartnerInquiryBulkRow {
  key: string;
  productRowId: string;
  description: string;
  status: PartnerInquiryBulkStatus;
  selectable: boolean;
  configured: PartnerConfiguredInquiryRows[number];
  inquiryRow?: PartnerInquiryRow;
}

export const partnerInquiryBulkStatusLabel: Record<PartnerInquiryBulkStatus, string> = {
  USABLE: 'استعلام معتبر', MISSING: 'استعلام ارسال نشده', PENDING: 'در انتظار پاسخ',
  REJECTED: 'ردشده', EXPIRED: 'منقضی', REINQUIRY_REQUIRED: 'نیازمند استعلام مجدد',
  REINQUIRY_PENDING: 'استعلام مجدد در انتظار پاسخ',
};

export function buildPartnerInquiryBulkRows({ configuredRows, inquiry, now, mismatchedRowIds = [] }: {
  configuredRows: PartnerConfiguredInquiryRows;
  inquiry?: PartnerInquiryView;
  now: number;
  mismatchedRowIds?: readonly string[];
}): PartnerInquiryBulkRow[] {
  return configuredRows.map(configured => {
    const productRowId = configured.configuration.productRowId;
    const inquiryRow = inquiry?.rows.find(row => row.rowId === configured.rowId)
      ?? inquiry?.rows.find(row => row.configurationRef.productRowId === productRowId);
    if (!inquiryRow) return { key: configured.rowId, productRowId, description: productRowId,
      status: 'MISSING', selectable: true, configured };
    const description = inquiryRow.description || productRowId;
    if (inquiryRow.successor?.state === 'PENDING') return { key: configured.rowId, productRowId, description,
      status: 'REINQUIRY_PENDING', selectable: false, configured, inquiryRow };
    if (mismatchedRowIds.includes(inquiryRow.rowId)) return { key: configured.rowId, productRowId, description,
      status: 'REINQUIRY_REQUIRED', selectable: true, configured, inquiryRow };
    if (isUsableInquiryRow(inquiryRow, now)) return { key: configured.rowId, productRowId, description,
      status: 'USABLE', selectable: false, configured, inquiryRow };
    const state = inquiryRowState(inquiryRow, now);
    const status: PartnerInquiryBulkStatus = state === 'PENDING' ? 'PENDING' : state === 'REJECTED' ? 'REJECTED'
      : state === 'EXPIRED' ? 'EXPIRED' : 'REINQUIRY_REQUIRED';
    return { key: configured.rowId, productRowId, description, status,
      selectable: status !== 'PENDING', configured, inquiryRow };
  });
}
