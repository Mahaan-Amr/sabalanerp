import React, { type ReactNode } from 'react';
import { FaCreditCard, FaFileContract, FaListAlt, FaMoneyCheckAlt, FaTools, FaTruck, FaUser } from 'react-icons/fa';
import { partnerTrackingCode, type PartnerCaseView, type PartnerTechnicalDraft, type PartnerTechnicalPreview, type PartnerTechnicalProduct } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpInlineState, ErpNeumorphicCard, ErpNeumorphicDisclosure } from '@/components/erp';
import { toPersianDateFieldValue } from '@/components/erp/persianDateFieldValue';
import { formatPartnerMoney, multiplyPartnerDecimal, partnerProductTypeCopy, partnerQuantityUnitCopy } from '../../partner-sales/presentation';
import { contractPaymentMethodOptions } from '../components/shared/ContractPaymentMethodSelect';
import type { PartnerWizardDraft } from './PartnerContractWizard';
import { partnerPaymentChoice } from './partnerPaymentMethodAdapter';
import { partnerPaymentAllocation, partnerRetailSubtotal, partnerRetailSummary } from './partnerRetail';

const dateText = (value?: string) => value ? toPersianDateFieldValue(value, 'iso-date') || '—' : '—';
const quantityText = (quantity: string, unit: string) => `${quantity} ${partnerQuantityUnitCopy[unit] ?? unit}`;
const contractStates: Record<PartnerCaseView['state'], string> = {
  DRAFT: 'پیش‌نویس', AWAITING_CUSTOMER_CONFIRMATION: 'در انتظار تأیید مشتری', CUSTOMER_APPROVED: 'تأیید مشتری',
  COMMITTED: 'ثبت قطعی', CANCELLED: 'لغوشده', VOIDED: 'باطل‌شده',
};
const customerStates: Record<PartnerCaseView['customerConfirmationState'], string> = {
  NOT_SENT: 'ارسال‌نشده', SENT: 'ارسال‌شده، بدون پاسخ', APPROVED: 'تأییدشده', REJECTED: 'ردشده',
  RECONFIRMATION_REQUIRED: 'نیازمند تأیید مجدد',
};

function SummarySection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <ErpNeumorphicCard className="p-4">
    <h4 className="sds-text-secondary mb-3 flex items-center gap-2 font-semibold">{icon}{title}</h4>
    <dl className="space-y-2 text-sm">{children}</dl>
  </ErpNeumorphicCard>;
}
function SummaryRow({ label, children, emphasis = false }: { label: string; children: ReactNode; emphasis?: boolean }) {
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
    <dt className="sds-text-secondary">{label}:</dt>
    <dd className={`min-w-0 break-words ${emphasis ? 'text-[var(--sds-accent)] font-semibold' : 'sds-text-primary font-medium'}`}>{children}</dd>
  </div>;
}
function DetailSection({ title, icon, open, children }: { title: string; icon: ReactNode; open?: boolean; children: ReactNode }) {
  return <ErpNeumorphicDisclosure open={open}>
    <summary className="sds-text-primary flex cursor-pointer items-center gap-2 px-4 py-3 font-semibold">{icon}{title}</summary>
    <div className="overflow-x-auto px-4 pb-4">{children}</div>
  </ErpNeumorphicDisclosure>;
}
function DetailTable({ label, headers, rows }: { label: string; headers: string[]; rows: { id: string; cells: ReactNode[] }[] }) {
  if (!rows.length) return <p className="sds-text-muted text-sm">—</p>;
  return <table aria-label={label} className="w-full text-sm">
    <thead><tr className="sds-text-secondary border-b border-[var(--sds-border-default)] text-right">
      {headers.map(header => <th key={header} scope="col" className="px-2 py-2">{header}</th>)}
    </tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} className="sds-text-secondary border-b border-[var(--sds-border-subtle)]">
      {row.cells.map((cell, index) => <td key={index} className="px-2 py-2">{cell ?? '—'}</td>)}
    </tr>)}</tbody>
  </table>;
}

/** Presentation only: the Partner wizard retains all approval and save commands. */
export function PartnerConfirmationStep({ draft, caseView, customer, technicalDraft, technicalPreview, products = [], actions }: {
  draft: PartnerWizardDraft; caseView?: PartnerCaseView | null;
  customer?: { displayName: string; phone?: string | null };
  technicalDraft: PartnerTechnicalDraft; technicalPreview?: PartnerTechnicalPreview; actions?: ReactNode;
  products?: readonly PartnerTechnicalProduct[];
}) {
  const currency = draft.intent.retailDiscount.currency;
  const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount, draft.serviceRows);
  const money = (amount?: string | null) => amount == null ? '—' : formatPartnerMoney(amount, currency);
  const allocation = summary.valid ? partnerPaymentAllocation({ amount: summary.retail, currency }, draft.intent.customerPaymentPlan.installments) : null;
  const services = draft.serviceRows ?? [];
  const operations = (technicalPreview?.rows ?? []).flatMap(row => {
    const result = row.operations?.ok ? row.operations.result : undefined;
    if (!result) return [];
    const product = draft.rows.find(item => item.productRowId === row.productRowId)?.inquiryRow.description ?? '—';
    return [...result.tools.map(tool => ({ id: tool.toolSelectionId, cells: [product, 'ابزار', tool.name, quantityText(tool.finalQuantity, tool.unit)] })),
      ...result.finishings.map(finishing => ({ id: finishing.finishingSelectionId, cells: [product, 'پرداخت سنگ', finishing.name, quantityText(finishing.finalQuantity, finishing.unit)] }))];
  });
  return <div className="mx-auto max-w-6xl space-y-6">
    <ErpNeumorphicCard className="p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h3 className="sds-text-primary text-2xl font-bold">خلاصه قرارداد</h3>
        <FaFileContract aria-hidden className="text-[var(--sds-accent)] text-3xl" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <SummarySection title="اطلاعات قرارداد" icon={<FaFileContract aria-hidden className="text-[var(--sds-accent)]" />}>
            <SummaryRow label="شماره قرارداد">{caseView ? partnerTrackingCode(caseView.caseNumber, caseView.trackingNumber) : 'پس از ثبت'}</SummaryRow>
            <SummaryRow label="تاریخ قرارداد">{dateText(draft.intent.contractDate)}</SummaryRow>
            <SummaryRow label="وضعیت">{caseView ? contractStates[caseView.state] : 'پیش‌نویس'}</SummaryRow>
          </SummarySection>
          <SummarySection title="اطلاعات مشتری" icon={<FaUser aria-hidden className="text-[var(--sds-accent)]" />}>
            <SummaryRow label="نام">{customer?.displayName ?? '—'}</SummaryRow>
            <SummaryRow label="شماره موبایل تأیید">{customer?.phone || 'موبایل معتبر ثبت نشده'}</SummaryRow>
          </SummarySection>
        </div>
        <div className="space-y-4">
          <SummarySection title="جمع‌بندی مالی" icon={<FaCreditCard aria-hidden className="text-[var(--sds-accent)]" />}>
            <SummaryRow label="جمع محصولات">{money(partnerRetailSubtotal(draft.rows, currency))}</SummaryRow>
            <SummaryRow label="جمع خدمات مستقل">{money(partnerRetailSubtotal([], currency, services))}</SummaryRow>
            <SummaryRow label="مبلغ فروش به مشتری">{money(summary.valid ? summary.retail : null)}</SummaryRow>
            <SummaryRow label="مبلغ توافق‌شده با سبلان">{money(summary.valid ? summary.wholesale : null)}</SummaryRow>
            {Number(draft.intent.retailDiscount.amount) > 0 && <SummaryRow label="تخفیف ثبت‌شدهٔ قبلی">{money(draft.intent.retailDiscount.amount)}</SummaryRow>}
            <SummaryRow label="جمع پرداختی">{money(allocation?.paid)}</SummaryRow>
            <SummaryRow label="مبلغ نهایی قرارداد" emphasis>{money(summary.valid ? summary.retail : null)}</SummaryRow>
            <SummaryRow label="مانده پرداخت" emphasis>{money(allocation?.remaining)}</SummaryRow>
          </SummarySection>
          <SummarySection title="وضعیت تأیید مشتری">
            <SummaryRow label="وضعیت"><ErpBadge tone={caseView?.customerConfirmationState === 'APPROVED' ? 'success' : caseView?.customerConfirmationState === 'REJECTED' ? 'danger' : 'info'}>
              {customerStates[caseView?.customerConfirmationState ?? 'NOT_SENT']}
            </ErpBadge></SummaryRow>
          </SummarySection>
        </div>
      </div>
    </ErpNeumorphicCard>
    <div className="grid grid-cols-1 gap-3">
      <DetailSection title={`محصولات قرارداد (${draft.rows.length})`} icon={<FaListAlt aria-hidden className="text-[var(--sds-accent)]" />} open>
        <DetailTable label="محصولات قرارداد" headers={['کد', 'نام', 'نوع', 'ابعاد', 'تعداد', 'مقدار', 'مبلغ کل']} rows={draft.rows.map(row => {
          const technical = technicalDraft.rows.find(item => item.productRowId === row.productRowId);
          const product = technical && products.find(item => item.catalogItemId === technical.catalogItemId && item.catalogSnapshotVersion === technical.catalogSnapshotVersion);
          const configuration = technical?.configuration;
          const dimensions = configuration && 'lengthMeters' in configuration
            ? `${configuration.lengthMeters ?? '—'}m × ${('widthMeters' in configuration ? configuration.widthMeters : 'crossDimensionMeters' in configuration ? configuration.crossDimensionMeters : undefined) ?? '—'}m` : '—';
          const total = row.retailLineTotal?.amount ?? multiplyPartnerDecimal(row.quantity, (row.retailEffectiveUnitPrice ?? row.retailUnitPrice).amount);
          return { id: row.productRowId, cells: [product?.code, row.inquiryRow.description, technical ? partnerProductTypeCopy[technical.family] : '—',
            dimensions, configuration && 'quantity' in configuration ? configuration.quantity : '—', quantityText(row.quantity, row.unit), money(total)] };
        })} />
      </DetailSection>
      <DetailSection title={`خدمات و عملیات وابسته (${operations.length})`} icon={<FaTools aria-hidden className="text-[var(--sds-accent)]" />}>
        <DetailTable label="خدمات و عملیات وابسته" headers={['محصول', 'دسته', 'شرح', 'مقدار']} rows={operations} />
      </DetailSection>
      <DetailSection title={`خدمات مستقل (${services.length})`} icon={<FaTools aria-hidden className="text-[var(--sds-accent)]" />} open>
        <DetailTable label="خدمات مستقل" headers={['شرح', 'مقدار', 'نرخ', 'هزینه']} rows={services.map(row => ({ id: row.serviceRowId,
          cells: [row.title, quantityText(row.quantity, row.unit), formatPartnerMoney(row.retailUnitPrice.amount, row.retailUnitPrice.currency),
            money(row.retailLineTotal?.amount ?? multiplyPartnerDecimal(row.quantity, row.retailUnitPrice.amount))] }))} />
      </DetailSection>
      <DetailSection title={`برنامه تحویل (${draft.intent.deliveries.length})`} icon={<FaTruck aria-hidden className="text-[var(--sds-accent)]" />}>
        <div className="space-y-3">{draft.intent.deliveries.map(delivery => <ErpNeumorphicCard key={delivery.deliveryId} className="space-y-2 p-3 text-sm">
          <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <SummaryRow label="تاریخ">{dateText(delivery.date)}</SummaryRow><SummaryRow label="آدرس">{delivery.destination}</SummaryRow>
            <SummaryRow label="مدیر پروژه">{delivery.projectManagerName || '—'}</SummaryRow><SummaryRow label="تحویل‌گیرنده">{delivery.receiverName || '—'}</SummaryRow>
          </dl>
          <p className="sds-text-secondary">توضیحات: {delivery.notes || '—'}</p>
          <ul className="list-disc space-y-1 pr-5">{delivery.items.map(item => {
            const product = draft.rows.find(row => row.productRowId === item.productRowId);
            return <li key={item.productRowId}>{product?.inquiryRow.description ?? 'محصول'} ({quantityText(item.quantity, product?.unit ?? '')})</li>;
          })}{(delivery.serviceItems ?? []).map(item => {
            const service = services.find(row => row.serviceRowId === item.serviceRowId);
            return <li key={item.serviceRowId}>{service?.title ?? 'خدمت'} ({quantityText(item.quantity, service?.unit ?? '')})</li>;
          })}</ul>
        </ErpNeumorphicCard>)}</div>
      </DetailSection>
      <DetailSection title={`برنامه پرداخت (${draft.intent.customerPaymentPlan.installments.length})`} icon={<FaMoneyCheckAlt aria-hidden className="text-[var(--sds-accent)]" />}>
        <DetailTable label="برنامه پرداخت" headers={['روش', 'مبلغ', 'تاریخ پرداخت', 'تاریخ تحویل چک', 'شماره چک', 'صاحب چک']} rows={draft.intent.customerPaymentPlan.installments.map(item => ({
          id: item.installmentId, cells: [contractPaymentMethodOptions.find(option => option.value === partnerPaymentChoice(item))?.label ?? '—',
            formatPartnerMoney(item.amount.amount, item.amount.currency), dateText(item.dueDate), dateText(item.check?.handoverDate), item.check?.number, item.check?.ownerName],
        }))} />
      </DetailSection>
    </div>
    {actions}
    <ErpInlineState kind="empty" title="با «ثبت یادداشت قرارداد»، تغییرات ذخیره می‌شود. قطعی‌شدن و ثبت تعهد خرید پس از تأیید فروشنده، پذیرش مشتری و پذیرش قیمت معتبر انجام می‌شود." />
  </div>;
}
