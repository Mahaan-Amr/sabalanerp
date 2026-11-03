import type { PartnerInquiryViewV2 } from '@sabalanerp/partner-sales-contracts';

export type PartnerInquiryView = PartnerInquiryViewV2;
export type PartnerInquiryRow = PartnerInquiryView['rows'][number];

export function inquiryRowState(row: PartnerInquiryRow, now: number): PartnerInquiryRow['state'] {
  if (row.state !== 'APPROVED') return row.state;
  return !Number.isFinite(now) || !row.expiresAt || !Number.isFinite(Date.parse(row.expiresAt))
    || now >= Date.parse(row.expiresAt) ? 'EXPIRED' : row.state;
}

export function usableInquiryRows(inquiry: PartnerInquiryView, now: number): PartnerInquiryRow[] {
  return inquiry.rows.filter(row => isUsableInquiryRow(row, now));
}

export function isUsableInquiryRow(row: PartnerInquiryRow, now: number): boolean {
  return Boolean(inquiryRowState(row, now) === 'APPROVED'
    && row.approvedPrice && row.approvedRowBinding && row.approvedAt
    && row.approvedRowBinding.rowId === row.rowId && row.approvedRowBinding.revision === row.revision
    && now >= Date.parse(row.approvedAt) && Number.isFinite(Date.parse(row.expiresAt || '')));
}

export const inquiryStateLabel: Record<PartnerInquiryRow['state'], string> = {
  PENDING: 'در انتظار پاسخ', APPROVED: 'قیمت تأییدشده', REJECTED: 'ردشده',
  EXPIRED: 'پایان اعتبار', SUPERSEDED: 'جایگزین‌شده', CANCELLED: 'لغوشده',
};

export function inquirySummary(inquiry: PartnerInquiryView): string {
  if (!inquiry.rows.length) return 'هنوز استعلامی ارسال نشده است';
  const pending = inquiry.rows.filter(row => row.state === 'PENDING').length;
  return pending === inquiry.rows.length ? 'ارسال‌شده' : pending ? 'پاسخ جزئی' : 'پاسخ‌ها دریافت شد';
}

export const persianCount = (value: number): string => value.toLocaleString('fa-IR');
export const inquiryMoney = (row: PartnerInquiryRow): string => row.approvedPrice
  ? `${row.approvedPrice.amount.replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])} ${row.approvedPrice.currency === 'IRR' ? 'ریال' : 'تومان'}`
  : '—';
