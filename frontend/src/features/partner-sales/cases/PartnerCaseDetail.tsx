'use client';

import React from 'react';
import type { PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { ErpActionGrid, ErpBadge, ErpButton, ErpCard, ErpFieldView, ErpPage, ErpSection, ErpTwoColumn, type ErpAction, type ErpMetric, type ErpTone } from '@/components/erp';
import { FaBan, FaCalculator, FaEdit, FaEye, FaFileContract, FaFilePdf, FaMoneyBillWave, FaPrint, FaSms, FaTruck } from 'react-icons/fa';
import { formatPartnerMoney, partnerPaymentMethodCopy } from '../presentation';

export type PartnerCaseActions = {
  canPreview: boolean;
  canIssue: boolean;
  canSendConfirmation?: boolean;
  canRequestCorrection: boolean;
  canCancel: boolean;
  canRequestVoid: boolean;
  onPreview?: () => void;
  onIssue?: () => void;
  onSendConfirmation?: () => void;
  onRequestCorrection?: () => void;
  onCancel?: () => void;
  onRequestVoid?: () => void;
};

const stateCopy: Record<PartnerCaseView['state'], { label: string; tone: ErpTone }> = {
  DRAFT: { label: 'پیش‌نویس', tone: 'neutral' },
  AWAITING_CUSTOMER_CONFIRMATION: { label: 'در انتظار تأیید مشتری', tone: 'warning' },
  CUSTOMER_APPROVED: { label: 'تأییدشده مشتری', tone: 'info' },
  COMMITTED: { label: 'قطعی', tone: 'success' },
  CANCELLED: { label: 'لغوشده', tone: 'danger' },
  VOIDED: { label: 'باطل‌شده', tone: 'danger' },
};

export function PartnerCaseDetail({ view, actions, children }: { view: PartnerCaseView; actions: PartnerCaseActions; children?: React.ReactNode }) {
  const status = stateCopy[view.state];
  const pageActions: ErpAction[] = [
    ...(actions.canPreview ? [{ label: 'پیش‌نمایش قرارداد', icon: FaEye, variant: 'outline' as const, onClick: actions.onPreview }] : []),
    ...(actions.canIssue ? [{ label: 'صدور نهایی PDF', icon: FaFilePdf, tone: 'success' as const, onClick: actions.onIssue }] : []),
  ];
  return <ErpPage eyebrow="پرونده فروش همکار" title={`پرونده ${view.caseNumber}`} description={`قرارداد مشتری: ${view.customerContractNumber}`}
    backHref="/dashboard/sales/contracts" actions={pageActions} metrics={partnerCaseMetrics(view, status)}><PartnerCaseDetailContent view={view} actions={actions} />{children}
  </ErpPage>;
}

export function partnerCaseMetrics(view: PartnerCaseView, status = stateCopy[view.state]): ErpMetric[] {
  return [
      { label: 'فروش به مشتری', value: formatPartnerMoney(view.retailTotals.payable, view.retailTotals.currency), icon: FaMoneyBillWave, tone: 'primary' },
      { label: 'خرید از سبلان', value: formatPartnerMoney(view.sabalanTotals.payable, view.sabalanTotals.currency), icon: FaFileContract, tone: 'info' },
      { label: 'سود بازفروش', value: formatPartnerMoney(view.resaleDifference, view.retailTotals.currency), icon: FaCalculator, tone: Number(view.resaleDifference) >= 0 ? 'success' : 'danger' },
      { label: 'وضعیت پرونده', value: status.label, icon: FaFileContract, tone: status.tone },
    ];
}

export function PartnerCaseDetailContent({ view, actions }: { view: PartnerCaseView; actions: PartnerCaseActions }) {
  return <>
    <ErpTwoColumn main={<>
      <ErpSection title="محصولات پرونده">
        <div className="space-y-3">{view.products.map(product => <ErpCard key={product.productRowId} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-[var(--sds-text-primary)]">{product.description}</h3>
            <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{product.quantity} {product.unit}</p></div><ErpBadge tone="neutral">ردیف {product.productRowId}</ErpBadge></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><ErpFieldView label="قیمت فروش مشتری" value={formatPartnerMoney(product.retailUnitPrice, view.retailTotals.currency)} tone="primary" />
            <ErpFieldView label="قیمت تأییدشده سبلان" value={formatPartnerMoney(product.wholesaleUnitPrice, view.sabalanTotals.currency)} tone="info" /></div>
        </ErpCard>)}</div>
      </ErpSection>
      <ErpSection title="برنامه تحویل"><div className="space-y-3">{view.deliveries.map(delivery => <ErpCard key={delivery.deliveryId} className="p-4">
        <div className="flex items-center justify-between gap-2"><strong>{delivery.date}</strong><ErpBadge tone="info"><FaTruck className="ml-1 inline" />{delivery.items.length.toLocaleString('fa-IR')} ردیف</ErpBadge></div>
        <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{delivery.destination}</p></ErpCard>)}</div></ErpSection>
    </>} aside={<>
      <ErpSection title="پرداخت مشتری"><PaymentPlan plan={view.customerPaymentPlan} /></ErpSection>
      <ErpSection title="پرداخت به سبلان"><PaymentPlan plan={view.sabalanPaymentPlan} /></ErpSection>
      {(actions.canRequestCorrection || actions.canCancel || actions.canRequestVoid) && <ErpSection title="اقدام‌های پرونده">
        <ErpActionGrid columns={1} items={[
          ...(actions.canRequestCorrection ? [{ title: 'درخواست اصلاح', description: 'دامنه اصلاح و دلیل ثبت می‌شود.', icon: FaEdit, tone: 'warning' as const, onClick: actions.onRequestCorrection }] : []),
          ...(actions.canCancel ? [{ title: 'لغو پیش از قطعیت', description: 'هر دو رکورد با هم لغو و سوابق حفظ می‌شوند.', icon: FaBan, tone: 'danger' as const, onClick: actions.onCancel }] : []),
          ...(actions.canRequestVoid ? [{ title: 'درخواست ابطال', description: 'پس از بررسی وابستگی‌ها و تأییدهای لازم.', icon: FaBan, tone: 'danger' as const, onClick: actions.onRequestVoid }] : []),
        ]} />
      </ErpSection>}
      <ErpSection title="خروجی مشتری" description="پیش‌نمایش هیچ تعهدی ایجاد نمی‌کند؛ صدور نهایی می‌تواند پرونده را قطعی کند.">
        <div className="grid gap-2"><ErpButton label="پیش‌نمایش" icon={FaEye} variant="outline" disabled={!actions.canPreview} onClick={actions.onPreview} />
          {actions.canSendConfirmation && <ErpButton label="ارسال دوباره کد تأیید" icon={FaSms} tone="info" variant="outline" onClick={actions.onSendConfirmation} />}
          <ErpButton label="صدور نهایی و چاپ" icon={FaPrint} tone="success" disabled={!actions.canIssue} onClick={actions.onIssue} /></div>
      </ErpSection>
    </>} />
  </>;
}

function PaymentPlan({ plan }: { plan: PartnerCaseView['customerPaymentPlan'] }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-sm text-[var(--sds-text-secondary)]">نسخه {plan.version.toLocaleString('fa-IR')}</span><ErpBadge tone="neutral">از {plan.effectiveDate}</ErpBadge></div>
    {plan.installments.map(item => <ErpCard key={item.installmentId} className="p-3"><strong>{formatPartnerMoney(item.amount.amount, item.amount.currency)}</strong>
      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{partnerPaymentMethodCopy[item.method]} · سررسید {item.dueDate}</p></ErpCard>)}</div>;
}
