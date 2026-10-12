import type { PartnerCaseView, PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';
import { partnerCommercialLabels, partnerTrackingCode } from '@sabalanerp/partner-sales-contracts';
import type { ErpTone } from '@/components/erp';
import type { PartnerCreationContext, PartnerCaseRuntimeResultSchema } from '@sabalanerp/partner-sales-contracts';

export type PartnerCaseIssue = NonNullable<ReturnType<typeof PartnerCaseRuntimeResultSchema.parse>['issues']>[number];
export type PartnerRecoveryListRow = NonNullable<Extract<PartnerCreationContext, { kind: 'PARTNER' }>['recoverableDrafts']>[number];
export type PartnerUnifiedListRow = { id: string; number: string; customerName?: string; title: string; status: string; tone: ErpTone;
  case?: PartnerCaseRuntimeRow; issue?: PartnerCaseIssue; draft?: PartnerRecoveryListRow };

export function partnerUnifiedCaseListPage(cases: readonly PartnerCaseRuntimeRow[], issues: readonly PartnerCaseIssue[],
  drafts: readonly PartnerRecoveryListRow[], search: string, tag: string, requestedPage: number) {
  const known = new Set([...cases.map(row => row.view.owner.caseId), ...issues.map(row => row.caseId)]);
  const entries: PartnerUnifiedListRow[] = [
    ...cases.map(row => { const status = partnerCaseListTag(row.view, row.pricingResponseState, row.commercial);
      return { id: row.view.owner.caseId, number: partnerCustomerLabel(row.view), customerName: row.customerName ?? row.customerOutput?.customer.displayName, title: row.view.products.map(item => item.description).join('، '),
        status, tone: partnerCaseListTags[status].tone, case: row }; }),
    ...issues.map(issue => ({ id: issue.caseId, number: issue.customerContractNumber ?? 'در انتظار شماره قرارداد',
      title: 'نیازمند بررسی', status: 'REVIEW', tone: 'warning' as const, issue })),
    ...drafts.filter(draft => !draft.caseId || !known.has(draft.caseId)).map(draft => ({
      id: draft.caseId ?? draft.recoveryId, number: draft.customerContractNumber ?? 'در انتظار شماره قرارداد', customerName: draft.customerName,
      title: draft.title ?? 'پیش‌نویس ایجاد قرارداد', status: 'RECOVERY', tone: 'neutral' as const, draft })),
  ];
  const normalize = (text: string) => text.toLocaleLowerCase('fa-IR').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const needle = normalize(search.trim());
  const filtered = entries.filter(row => (tag === 'ALL' || row.status === tag) &&
    (!needle || normalize(`${row.number} ${row.customerName ?? ''} ${row.title} ${row.id} ${row.issue ? partnerTrackingCode(row.issue.caseNumber, row.issue.trackingNumber) : row.case ? partnerTrackingCode(row.case.view.caseNumber, row.case.view.trackingNumber) : ''}`).includes(needle)));
  const pageSize = 10, totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.max(1, Math.min(requestedPage, totalPages));
  return { rows: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), totalItems: filtered.length, totalPages, currentPage, pageSize };
}

function partnerCustomerLabel(view: PartnerCaseView) {
  return view.customerContractNumber ?? 'در انتظار شماره قرارداد';
}

export const partnerCaseListTags = {
  NOTE: { label: partnerCommercialLabels.NOTE, tone: 'neutral' },
  DRAFT: { label: partnerCommercialLabels.DRAFT, tone: 'info' },
  CUSTOMER_SIGNED: { label: partnerCommercialLabels.CUSTOMER_SIGNED, tone: 'success' },
  QUOTED: { label: partnerCommercialLabels.QUOTED, tone: 'info' },
  FINAL: { label: partnerCommercialLabels.FINAL, tone: 'success' },
  COMMERCIAL_EXPIRED: { label: partnerCommercialLabels.EXPIRED, tone: 'warning' },
  READY: { label: 'آماده تکمیل', tone: 'success' },
  PARTIAL: { label: 'بخشی از قیمت‌ها دریافت شد', tone: 'warning' },
  WAITING: { label: 'در انتظار پاسخ سبلان', tone: 'info' },
  INCOMPLETE: { label: 'نیازمند تکمیل یا اصلاح', tone: 'warning' },
  EXPIRED: { label: 'نیازمند استعلام مجدد', tone: 'warning' },
  CUSTOMER_PENDING: { label: 'در انتظار تأیید مشتری', tone: 'info' },
  CUSTOMER_APPROVED: { label: 'تأییدشده مشتری', tone: 'success' },
  COMMITTED: { label: 'قطعی', tone: 'success' },
  CANCELLED: { label: 'لغو شده', tone: 'danger' },
  VOIDED: { label: 'لغو شده', tone: 'danger' },
} satisfies Record<string, { label: string; tone: ErpTone }>;
export type PartnerCaseListTag = keyof typeof partnerCaseListTags;

export function partnerCaseListTag(view: Pick<PartnerCaseView, 'state' | 'pricingState'>, responseState?: PartnerCaseRuntimeRow['pricingResponseState'], commercial?: PartnerCaseRuntimeRow['commercial']): PartnerCaseListTag {
  if (commercial) return commercial.status === 'EXPIRED' ? 'COMMERCIAL_EXPIRED' : commercial.status;
  if (view.state !== 'DRAFT') return view.state === 'AWAITING_CUSTOMER_CONFIRMATION' ? 'CUSTOMER_PENDING'
    : view.state === 'CUSTOMER_APPROVED' ? 'CUSTOMER_APPROVED' : view.state;
  if (responseState) return responseState === 'REJECTED' ? 'INCOMPLETE' : responseState;
  return view.pricingState === 'READY_TO_FINALIZE' ? 'READY'
    : view.pricingState === 'AWAITING_INQUIRY' ? 'WAITING'
      : view.pricingState === 'EXPIRED' ? 'EXPIRED' : 'INCOMPLETE';
}

export function partnerCaseListPage(rows: readonly PartnerCaseRuntimeRow[], search: string,
  tag: string, requestedPage: number) {
  const needle = search.trim().toLocaleLowerCase('fa-IR');
  const filtered = rows.filter(row => (tag === 'ALL' || partnerCaseListTag(row.view, row.pricingResponseState, row.commercial) === tag) &&
    (!needle || [row.view.caseNumber, partnerTrackingCode(row.view.caseNumber, row.view.trackingNumber),
      row.view.customerContractNumber ?? '', ...row.view.products.map(product => product.description)]
      .some(value => value.toLocaleLowerCase('fa-IR').includes(needle))));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.max(1, Math.min(requestedPage, totalPages));
  return { rows: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    totalItems: filtered.length, totalPages, currentPage, pageSize };
}
