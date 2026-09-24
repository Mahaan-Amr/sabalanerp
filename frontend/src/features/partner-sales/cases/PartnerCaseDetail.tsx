'use client';

import React from 'react';
import type { CustomerContractOutput, PartnerCaseRuntimeRow, PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { ErpActionGrid, ErpBadge, ErpButton, ErpCard, ErpFieldView, ErpPage, ErpSection, ErpTwoColumn, type ErpAction, type ErpMetric, type ErpTone } from '@/components/erp';
import { FaBan, FaCalculator, FaEdit, FaEye, FaFileContract, FaFilePdf, FaMoneyBillWave, FaPrint, FaSms, FaTruck } from 'react-icons/fa';
import { formatPartnerMoney, partnerPaymentMethodCopy } from '../presentation';

export type PartnerCaseActions = {
  canPreview: boolean;
  canContinue?: boolean;
  canIssue: boolean;
  canFinalize?: boolean;
  canSendConfirmation?: boolean;
  canRequestCorrection: boolean;
  canCancel: boolean;
  canRequestVoid: boolean;
  onPreview?: () => void;
  onContinue?: () => void;
  onIssue?: () => void;
  onFinalize?: () => void;
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
const historyCopy: Record<string, string> = {
  CASE_CREATED: 'ایجاد پرونده', CASE_COMMITTED: 'تأیید و ثبت نهایی', CASE_CANCELLED: 'لغو پرونده',
  CUSTOMER_CONFIRMED: 'تأیید مشتری', CUSTOMER_REJECTED: 'رد مشتری',
  CORRECTION_REQUESTED: 'درخواست اصلاح', VOID_REQUESTED: 'درخواست ابطال',
};

export function PartnerCaseDetail({ view, actions, customerOutput, history, children }: { view: PartnerCaseView; actions: PartnerCaseActions;
  customerOutput?: CustomerContractOutput; history?: PartnerCaseRuntimeRow['history']; children?: React.ReactNode }) {
  const status = stateCopy[view.state];
  const pageActions = partnerCasePageActions(actions);
  return <ErpPage eyebrow="پرونده فروش همکار" title={`پرونده ${view.caseNumber}`} description={`قرارداد مشتری: ${view.customerContractNumber}`}
    backHref="/dashboard/sales/partner-cases" actions={pageActions} metrics={partnerCaseMetrics(view, status)}><PartnerCaseDetailContent
      view={view} actions={actions} customerOutput={customerOutput} history={history} />{children}
  </ErpPage>;
}

export function partnerCasePageActions(actions: PartnerCaseActions): ErpAction[] {
  return [
    ...(actions.canContinue ? [{ label: 'ادامه تکمیل قرارداد', icon: FaEdit, onClick: actions.onContinue }] : []),
    ...(actions.canPreview ? [{ label: 'پیش‌نمایش قرارداد', icon: FaEye, variant: 'outline' as const, onClick: actions.onPreview }] : []),
    ...(actions.canSendConfirmation ? [{ label: 'ارسال پیامک تأیید', icon: FaSms,
      tone: 'info' as const, variant: 'outline' as const, onClick: actions.onSendConfirmation }] : []),
    ...(actions.canFinalize ? [{ label: 'تأیید و نهایی‌سازی قرارداد', icon: FaFileContract,
      tone: 'success' as const, onClick: actions.onFinalize }] : []),
    ...(actions.canIssue ? [{ label: 'صدور نهایی PDF', icon: FaFilePdf, tone: 'success' as const, onClick: actions.onIssue }] : []),
  ];
}

export function partnerCaseMetrics(view: PartnerCaseView, status = stateCopy[view.state]): ErpMetric[] {
  const pricingReady = view.pricingState === 'READY_TO_FINALIZE' && view.sabalanTotals && view.resaleDifference !== undefined;
  return [
      { label: 'فروش به مشتری', value: formatPartnerMoney(view.retailTotals.payable, view.retailTotals.currency), icon: FaMoneyBillWave, tone: 'primary' },
      { label: 'خرید از سبلان', value: pricingReady ? formatPartnerMoney(view.sabalanTotals!.payable, view.sabalanTotals!.currency) : 'در انتظار استعلام', icon: FaFileContract, tone: 'info' },
      { label: 'سود بازفروش', value: pricingReady ? formatPartnerMoney(view.resaleDifference!, view.retailTotals.currency) : 'پس از تکمیل استعلام', icon: FaCalculator, tone: !pricingReady ? 'info' : Number(view.resaleDifference) < 0 ? 'danger' : 'success' },
      { label: 'وضعیت پرونده', value: status.label, icon: FaFileContract, tone: status.tone },
    ];
}

export function PartnerCaseDetailContent({ view, actions, customerOutput, history }: { view: PartnerCaseView;
  actions: PartnerCaseActions; customerOutput?: CustomerContractOutput; history?: PartnerCaseRuntimeRow['history'] }) {
  return <>
    <ErpSection title="اطلاعات قرارداد">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ErpFieldView label="شماره پرونده" value={view.caseNumber} />
        <ErpFieldView label="شماره قرارداد مشتری" value={view.customerContractNumber ?? 'در انتظار صدور'} />
        <ErpFieldView label="وضعیت قرارداد" value={stateCopy[view.state].label} />
        <ErpFieldView label="تأیید مشتری" value={{ NOT_SENT: 'ارسال نشده', SENT: 'در انتظار تأیید',
          APPROVED: 'تأییدشده', REJECTED: 'ردشده', RECONFIRMATION_REQUIRED: 'نیازمند تأیید دوباره' }[view.customerConfirmationState]} />
      </div>
    </ErpSection>
    {customerOutput && <ErpSection title="مشتری و پروژه">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ErpFieldView label="مشتری" value={customerOutput.customer.displayName} />
        <ErpFieldView label="فروشنده" value={customerOutput.seller.displayName} />
        <ErpFieldView label="تاریخ قرارداد" value={customerOutput.contractDate} />
        <ErpFieldView label="پروژه" value={customerOutput.project?.title ?? 'ثبت نشده'} />
        {customerOutput.project?.address && <ErpFieldView label="نشانی پروژه" value={customerOutput.project.address} />}
      </div>
    </ErpSection>}
    <ErpTwoColumn main={<>
      <ErpSection title="اقلام قرارداد" description="مقدار و قیمت‌های ثبت‌شده برای هر ردیف قرارداد.">
        <div className="space-y-3">{view.products.map(product => <ErpCard key={product.productRowId} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-[var(--sds-text-primary)]">{product.description}</h3>
            <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{product.quantity} {product.unit}</p></div><ErpBadge tone="neutral">ردیف {product.productRowId}</ErpBadge></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><ErpFieldView label="قیمت فروش مشتری" value={formatPartnerMoney(product.retailUnitPrice, view.retailTotals.currency)} tone="primary" />
            <ErpFieldView label="قیمت تأییدشده سبلان" value={product.wholesaleUnitPrice && view.sabalanTotals
              ? formatPartnerMoney(product.wholesaleUnitPrice, view.sabalanTotals.currency) : 'در انتظار استعلام'} tone="info" /></div>
          {customerOutput?.products.find(item => item.productRowId === product.productRowId) && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(() => { const item = customerOutput.products.find(item => item.productRowId === product.productRowId)!;
              return <>
                {item.productCode && <ErpFieldView label="کد محصول" value={item.productCode} />}
                {item.productType && <ErpFieldView label="نوع محصول" value={item.productType} />}
                {item.lengthMeters && <ErpFieldView label="طول" value={`${item.lengthMeters} متر`} />}
                {item.widthMeters && <ErpFieldView label="عرض" value={`${item.widthMeters} متر`} />}
                {item.areaSquareMeters && <ErpFieldView label="مساحت" value={`${item.areaSquareMeters} متر مربع`} />}
                {item.retailLineTotal && <ErpFieldView label="مبلغ ردیف" value={formatPartnerMoney(item.retailLineTotal, view.retailTotals.currency)} />}
              </>; })()}
          </div>}
        </ErpCard>)}</div>
      </ErpSection>
      <ErpSection title="تحویل و پرداخت"><div className="space-y-3">{view.deliveries.map((delivery, index) => <ErpCard key={delivery.deliveryId} className="p-4">
        <div className="flex items-center justify-between gap-2"><strong>تحویل {(index + 1).toLocaleString('fa-IR')} · {delivery.date}</strong><ErpBadge tone="info"><FaTruck className="ml-1 inline" />{delivery.items.length.toLocaleString('fa-IR')} ردیف</ErpBadge></div>
        <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{delivery.destination}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{delivery.items.map(item => <ErpFieldView
          key={item.productRowId} label={view.products.find(product => product.productRowId === item.productRowId)?.description ?? 'محصول'}
          value={`${item.quantity} ${view.products.find(product => product.productRowId === item.productRowId)?.unit ?? ''}`} />)}</div>
      </ErpCard>)}</div></ErpSection>
    </>} aside={<>
      <ErpSection title="پرداخت مشتری"><PaymentPlan plan={view.customerPaymentPlan} /></ErpSection>
      <ErpSection title="پرداخت به سبلان">{view.sabalanPaymentPlan
        ? <PaymentPlan plan={view.sabalanPaymentPlan} /> : <ErpBadge tone="warning">پس از تکمیل استعلام</ErpBadge>}</ErpSection>
      {history && <ErpSection title="تاریخچه پرونده"><div className="space-y-2">
        {history.map(event => <ErpCard key={event.sequence} className="p-3">
          <strong className="text-sm">{historyCopy[event.type] ?? 'رویداد پرونده'}</strong>
          <p className="sds-text-secondary mt-1 text-xs">{new Date(event.recordedAt).toLocaleString('fa-IR')}</p>
        </ErpCard>)}
      </div></ErpSection>}
      {(actions.canRequestCorrection || actions.canCancel || actions.canRequestVoid) && <ErpSection title="اقدام‌های پرونده">
        <ErpActionGrid columns={1} items={[
          ...(actions.canRequestCorrection ? [{ title: 'درخواست اصلاح', description: 'دامنه اصلاح و دلیل ثبت می‌شود.', icon: FaEdit, tone: 'warning' as const, onClick: actions.onRequestCorrection }] : []),
          ...(actions.canCancel ? [{ title: 'لغو پیش از قطعیت', description: 'هر دو رکورد با هم لغو و سوابق حفظ می‌شوند.', icon: FaBan, tone: 'danger' as const, onClick: actions.onCancel }] : []),
          ...(actions.canRequestVoid ? [{ title: 'درخواست ابطال', description: 'پس از بررسی وابستگی‌ها و تأییدهای لازم.', icon: FaBan, tone: 'danger' as const, onClick: actions.onRequestVoid }] : []),
        ]} />
      </ErpSection>}
      <ErpSection title="خروجی مشتری" description="ارسال برای مشتری و نهایی‌سازی فروشنده دو اقدام مستقل هستند.">
        <div className="grid gap-2"><ErpButton label="پیش‌نمایش" icon={FaEye} variant="outline" disabled={!actions.canPreview} onClick={actions.onPreview} />
          {actions.canSendConfirmation && <ErpButton label={view.state === 'DRAFT' ? 'ارسال پیامک تأیید' : 'ارسال دوباره پیامک تأیید'} icon={FaSms} tone="info" variant="outline" onClick={actions.onSendConfirmation} />}
          {actions.canFinalize && <ErpButton label="تأیید و نهایی‌سازی قرارداد" icon={FaFileContract}
            tone="success" onClick={actions.onFinalize} />}
          <ErpButton label="صدور PDF نهایی" icon={FaPrint} tone="success" disabled={!actions.canIssue} onClick={actions.onIssue} /></div>
      </ErpSection>
    </>} />
  </>;
}

function PaymentPlan({ plan }: { plan: PartnerCaseView['customerPaymentPlan'] }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-sm text-[var(--sds-text-secondary)]">نسخه {plan.version.toLocaleString('fa-IR')}</span><ErpBadge tone="neutral">از {plan.effectiveDate}</ErpBadge></div>
    {!plan.installments.length && <ErpBadge tone="warning">در انتظار ثبت حسابداری</ErpBadge>}
    {plan.installments.map(item => <ErpCard key={item.installmentId} className="p-3"><strong>{formatPartnerMoney(item.amount.amount, item.amount.currency)}</strong>
      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{partnerPaymentMethodCopy[item.method]} · سررسید {item.dueDate}</p></ErpCard>)}</div>;
}
