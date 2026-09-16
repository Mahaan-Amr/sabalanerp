import type { PartnerConfiguredInquiryRows } from './partnerInquirySubmission';
import { PartnerInquiryViewV2Schema, type PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
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
  detail?: string;
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
    if (mismatchedRowIds.includes(inquiryRow.rowId)) return { key: configured.rowId, productRowId, description,
      status: 'REINQUIRY_REQUIRED', selectable: true, configured, inquiryRow };
    if (isUsableInquiryRow(inquiryRow, now)) return { key: configured.rowId, productRowId, description,
      status: 'USABLE', selectable: false, configured, inquiryRow,
      ...(inquiryRow.successor?.state === 'PENDING'
        ? { detail: 'قیمت فعلی معتبر است؛ استعلام جدید در انتظار پاسخ است.' } : {}) };
    if (inquiryRow.successor?.state === 'PENDING') return { key: configured.rowId, productRowId, description,
      status: 'REINQUIRY_PENDING', selectable: false, configured, inquiryRow };
    if (inquiryRow.successor?.state === 'APPROVED') return { key: configured.rowId, productRowId, description,
      status: 'USABLE', selectable: false, configured, inquiryRow,
      detail: 'پاسخ معتبر در استعلام بعدی آماده است.' };
    if (inquiryRow.successor) return { key: configured.rowId, productRowId, description,
      status: 'REINQUIRY_REQUIRED', selectable: true, configured, inquiryRow,
      detail: 'آخرین استعلام این ردیف نیازمند ارسال مجدد است.' };
    const state = inquiryRowState(inquiryRow, now);
    const status: PartnerInquiryBulkStatus = state === 'PENDING' ? 'PENDING' : state === 'REJECTED' ? 'REJECTED'
      : state === 'EXPIRED' ? 'EXPIRED' : 'REINQUIRY_REQUIRED';
    return { key: configured.rowId, productRowId, description, status,
      selectable: status !== 'PENDING', configured, inquiryRow };
  });
}

export async function resolveLatestPartnerInquiryRow(queries: PartnerQueryV2Port, row: PartnerInquiryRow): Promise<PartnerInquiryRow> {
  let current = row;
  const visited = new Set<string>();
  for (let depth = 0; current.successor && depth < 20; depth += 1) {
    const link = current.successor;
    const key = `${link.inquiryId}:${link.rowId}:${link.revision}`;
    if (visited.has(key)) throw new Error('Cyclic inquiry lineage');
    visited.add(key);
    const response = await queries.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: link.inquiryId });
    if (!response.ok) throw new Error('Inquiry successor unavailable');
    const parsed = PartnerInquiryViewV2Schema.safeParse(response.value);
    const next = parsed.success && parsed.data.inquiryId === link.inquiryId
      ? parsed.data.rows.find(candidate => candidate.rowId === link.rowId && candidate.revision === link.revision)
      : undefined;
    if (!next) throw new Error('Inquiry successor mismatch');
    current = next;
  }
  if (current.successor) throw new Error('Inquiry lineage limit exceeded');
  return current;
}
