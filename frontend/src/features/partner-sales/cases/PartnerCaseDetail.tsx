'use client';

import { partnerCommercialLabels, partnerInquiryLabels, type PartnerCommercialState } from '@sabalanerp/partner-sales-contracts';
import React from 'react';
import { partnerCustomerContractLabel, partnerTrackingCode, type CustomerContractOutput, type PartnerCaseRuntimeRow, type PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { ErpActionGrid, ErpBadge, ErpButton, ErpCard, ErpFieldView, ErpPage, ErpSection, ErpTwoColumn, type ErpAction, type ErpMetric, type ErpTone } from '@/components/erp';
import { FaBan, FaCalculator, FaCheck, FaDownload, FaEdit, FaEye, FaFileContract, FaFilePdf, FaMoneyBillWave, FaPrint, FaSms, FaTruck } from 'react-icons/fa';
import { formatPartnerMoney, partnerPaymentMethodCopy, partnerProductTypeCopy, partnerQuantityUnitCopy } from '../presentation';
import { ContractDetailNavigation, type ContractDetailSection } from '@/features/sales/ContractDetailNavigation';
import PersianCalendar from '@/lib/persian-calendar';

export type PartnerCaseActions = {
  canPreview: boolean;
  canContinue?: boolean;
  canReviewPricing?: boolean;
  canEditDraft?: boolean;
  canIssue: boolean;
  canFinalize?: boolean;
  canSendConfirmation?: boolean;
  canRequestCorrection: boolean;
  canCancel: boolean;
  canRequestVoid: boolean;
  onPreview?: () => void;
  onContinue?: () => void;
  onEditDraft?: () => void;
  onIssue?: () => void;
  onFinalize?: () => void;
  onSendConfirmation?: () => void;
  onRequestCorrection?: () => void;
  onCancel?: () => void;
  onRequestVoid?: () => void;
  canDownload?: boolean;
  canPrint?: boolean;
  onDownload?: () => void;
  onPrint?: () => void;
  pending?: boolean;
  decisionActions?: ErpAction[];
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
  PARTNER_SELLER_SIGNED: 'ثبت امضای فروشنده',
  CASE_CREATED: 'ایجاد پرونده', CASE_COMMITTED: 'تأیید و ثبت نهایی', CASE_CANCELLED: 'لغو پرونده',
  CUSTOMER_CONFIRMED: 'تأیید مشتری', CUSTOMER_REJECTED: 'رد مشتری',
  CORRECTION_REQUESTED: 'درخواست اصلاح', VOID_REQUESTED: 'درخواست ابطال',
};

export function PartnerCaseDetail({ view, actions, customerOutput, history, commercial, children }: { view: PartnerCaseView; actions: PartnerCaseActions;
  customerOutput?: CustomerContractOutput; history?: PartnerCaseRuntimeRow['history']; commercial?: PartnerCommercialState; children?: React.ReactNode }) {
  const status = commercial ? { label: partnerCommercialLabels[commercial.status], tone: (commercial.status === 'FINAL' ? 'success' : 'neutral') as ErpTone } : stateCopy[view.state];
  const pageActions = partnerCasePageActions(actions);
  return <ErpPage eyebrow="پرونده فروش همکار" title={`پرونده ${partnerCustomerContractLabel(view.caseNumber, view.customerContractNumber, view.trackingNumber)}`} description={`کد پیگیری: ${partnerTrackingCode(view.caseNumber, view.trackingNumber)}`}
    backHref="/dashboard/sales/partner-cases" actions={pageActions} metrics={partnerCaseMetrics(view, status)}><PartnerCaseDetailContent
      view={view} actions={actions} customerOutput={customerOutput} history={history} commercial={commercial} />{children}
  </ErpPage>;
}

export function partnerCasePageActions(actions: PartnerCaseActions): ErpAction[] {
  const items: ErpAction[] = [
    ...(actions.decisionActions ?? []),
    ...(actions.canEditDraft ? [{ label: 'ویرایش', icon: FaEdit, tone: 'info' as const, onClick: actions.onEditDraft }] : []),
    ...(!actions.canEditDraft && actions.canContinue ? [{ label: 'ویرایش', icon: FaEdit, tone: 'info' as const, onClick: actions.onContinue }] : []),
    ...(actions.canContinue && actions.canReviewPricing ? [{ label: 'ادامه تکمیل قرارداد', icon: FaEdit, tone: 'info' as const, onClick: actions.onContinue }] : []),
    ...(!actions.canEditDraft && !actions.canContinue && actions.canRequestCorrection ? [{ label: 'درخواست اصلاح', icon: FaEdit,
      tone: 'info' as const, onClick: actions.onRequestCorrection, disabled: actions.pending }] : []),
    ...(!actions.decisionActions && actions.canCancel ? [{ label: 'لغو پیش‌نویس', icon: FaBan, tone: 'danger' as const,
      onClick: actions.onCancel, disabled: actions.pending }] : []),
    ...(actions.canDownload ? [{ label: 'دانلود PDF', icon: FaDownload, tone: 'success' as const,
      onClick: actions.onDownload, disabled: actions.pending }] : []),
    ...(actions.canPrint ? [{ label: 'پرینت', icon: FaPrint, tone: 'purple' as const,
      onClick: actions.onPrint, disabled: actions.pending }] : []),
    ...(actions.canPreview ? [{ label: 'پیش‌نمایش قرارداد', icon: FaEye, variant: 'outline' as const, onClick: actions.onPreview }] : []),
    ...(actions.canSendConfirmation ? [{ label: 'ارسال پیامک تأیید', icon: FaSms,
      tone: 'info' as const, variant: 'outline' as const, onClick: actions.onSendConfirmation }] : []),
    ...(!actions.decisionActions && actions.canFinalize ? [{ label: 'پذیرش قیمت‌ها و نهایی‌سازی', icon: FaCheck,
      tone: 'success' as const, onClick: actions.onFinalize }] : []),
    ...(actions.canIssue ? [{ label: 'صدور نهایی PDF', icon: FaFilePdf, tone: 'success' as const, onClick: actions.onIssue }] : []),
  ];
  return items.map(item => ({ ...item, disabled: Boolean(actions.pending || item.disabled) }));
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

export function PartnerCaseDetailContent({ view, actions, customerOutput, history, commercial, initialSection = 'summary' }: { view: PartnerCaseView;
  actions: PartnerCaseActions; customerOutput?: CustomerContractOutput; history?: PartnerCaseRuntimeRow['history']; commercial?: PartnerCommercialState;
  initialSection?: ContractDetailSection }) {
  const [section, setSection] = React.useState<ContractDetailSection>(initialSection);
  return <>
    <ContractDetailNavigation value={section} onChange={setSection} />
    {section === 'summary' && <ErpTwoColumn main={<ErpSection title="اطلاعات قرارداد">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ErpFieldView label="کد پیگیری" value={partnerTrackingCode(view.caseNumber, view.trackingNumber)} />
        <ErpFieldView label="شماره قرارداد مشتری" value={view.customerContractNumber ?? 'در انتظار صدور'} />
        <ErpFieldView label="وضعیت قرارداد" value={commercial ? partnerCommercialLabels[commercial.status] : stateCopy[view.state].label} />
        {commercial && <ErpFieldView label="وضعیت استعلام" value={partnerInquiryLabels[commercial.inquiry]} />}
        <ErpFieldView label="تأیید مشتری" value={{ NOT_SENT: 'ارسال نشده', SENT: 'در انتظار تأیید',
          APPROVED: 'تأییدشده', REJECTED: 'ردشده', RECONFIRMATION_REQUIRED: 'نیازمند تأیید دوباره' }[view.customerConfirmationState]} />
      </div>
    </ErpSection>}
    aside={customerOutput ? <ErpSection title="مشتری و پروژه">
      <div className="grid gap-3">
        <ErpFieldView label="مشتری" value={customerOutput.customer.displayName} />
        <ErpFieldView label="فروشنده" value={customerOutput.seller.displayName} />
        <ErpFieldView label="تاریخ قرارداد" value={PersianCalendar.formatForDisplay(customerOutput.contractDate)} />
        <ErpFieldView label="پروژه" value={customerOutput.project?.title ?? 'ثبت نشده'} />
        {customerOutput.project?.address && <ErpFieldView label="نشانی پروژه" value={customerOutput.project.address} />}
      </div>
    </ErpSection> : undefined} />}
    {section === 'items' && <>
      <ErpSection title="اقلام قرارداد" description="مقدار و قیمت‌های ثبت‌شده برای هر ردیف قرارداد.">
        <div className="space-y-3">{view.products.map(product => <ErpCard key={product.productRowId} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-[var(--sds-text-primary)]">{product.description}</h3>
            <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{product.quantity} {partnerQuantityUnitCopy[product.unit] ?? product.unit}</p></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><ErpFieldView label="قیمت فروش مشتری" value={formatPartnerMoney(product.retailUnitPrice, view.retailTotals.currency)} tone="primary" />
            <ErpFieldView label="قیمت تأییدشده سبلان" value={product.wholesaleUnitPrice && view.sabalanTotals
              ? formatPartnerMoney(product.wholesaleUnitPrice, view.sabalanTotals.currency) : 'در انتظار استعلام'} tone="info" /></div>
          {product.wholesaleUnitPrice && view.catalogLayerRates?.filter(layer => layer.parentProductRowId === product.productRowId)
            .map((layer, index) => <ErpFieldView key={`${layer.parentProductRowId}:${index}`}
              label={`نرخ کاتالوگ لایهٔ ${layer.layerTitle}`}
              value={`${formatPartnerMoney(layer.rateToman, 'IRT')} · ${{ set: 'هر مجموعه', physicalPiece: 'هر قطعه', meter: 'هر متر', squareMeter: 'هر مترمربع' }[layer.layerUnit]}`} />)}
          {customerOutput?.products.find(item => item.productRowId === product.productRowId) && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(() => { const item = customerOutput.products.find(item => item.productRowId === product.productRowId)!;
              return <>
                {item.productCode && <ErpFieldView label="کد محصول" value={item.productCode} />}
                {item.productType && <ErpFieldView label="نوع محصول" value={partnerProductTypeCopy[item.productType] ?? item.productType} />}
                {item.lengthMeters && <ErpFieldView label="طول" value={`${item.lengthMeters} متر`} />}
                {item.widthMeters && <ErpFieldView label="عرض" value={`${item.widthMeters} متر`} />}
                {item.areaSquareMeters && <ErpFieldView label="مساحت" value={`${item.areaSquareMeters} متر مربع`} />}
                {item.retailLineTotal && <ErpFieldView label="مبلغ ردیف" value={formatPartnerMoney(item.retailLineTotal, view.retailTotals.currency)} />}
              </>; })()}
          </div>}
        </ErpCard>)}</div>
      </ErpSection>
      <ErpSection title="برنامه تحویل"><div className="space-y-3">{view.deliveries.map((delivery, index) => <ErpCard key={delivery.deliveryId} className="p-4">
        <div className="flex items-center justify-between gap-2"><strong>تحویل {(index + 1).toLocaleString('fa-IR')} · {PersianCalendar.formatForDisplay(delivery.date)}</strong><ErpBadge tone="info"><FaTruck className="ml-1 inline" />{delivery.items.length.toLocaleString('fa-IR')} ردیف</ErpBadge></div>
        <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{delivery.destination}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{delivery.items.map(item => <ErpFieldView
          key={item.productRowId} label={view.products.find(product => product.productRowId === item.productRowId)?.description ?? 'محصول'}
          value={`${item.quantity} ${partnerQuantityUnitCopy[view.products.find(product => product.productRowId === item.productRowId)?.unit ?? ''] ?? ''}`} />)}</div>
      </ErpCard>)}</div></ErpSection>
    </>}
    {section === 'financial' && <ErpTwoColumn main={<ErpSection title="پرداخت مشتری"><PaymentPlan plan={view.customerPaymentPlan} /></ErpSection>}
      aside={<ErpSection title="پرداخت به سبلان">{view.sabalanPaymentPlan
        ? <PaymentPlan plan={view.sabalanPaymentPlan} /> : <ErpBadge tone="warning">پس از تکمیل استعلام</ErpBadge>}</ErpSection>} />}
    {section === 'history' && <>
      {history && <ErpSection title="تاریخچه پرونده"><div className="space-y-2">
        {history.map(event => <ErpCard key={event.sequence} className="p-3">
          <strong className="text-sm">{historyCopy[event.type] ?? 'رویداد پرونده'}</strong>
          <p className="sds-text-secondary mt-1 text-xs">{new Date(event.recordedAt).toLocaleString('fa-IR')}</p>
        </ErpCard>)}
      </div></ErpSection>}
    </>}
    {section === 'summary' && <>
      {(actions.canRequestCorrection || actions.canCancel || actions.canRequestVoid) && <ErpSection title="اقدام‌های پرونده">
        <ErpActionGrid columns={1} items={[
          ...(actions.canRequestCorrection ? [{ title: 'درخواست اصلاح', description: 'دامنه اصلاح و دلیل ثبت می‌شود.', icon: FaEdit, tone: 'warning' as const, onClick: actions.onRequestCorrection, disabled: actions.pending }] : []),
          ...(actions.canCancel ? [{ title: 'لغو پیش از قطعیت', description: 'هر دو رکورد با هم لغو و سوابق حفظ می‌شوند.', icon: FaBan, tone: 'danger' as const, onClick: actions.onCancel, disabled: actions.pending }] : []),
          ...(actions.canRequestVoid ? [{ title: 'درخواست ابطال', description: 'پس از بررسی وابستگی‌ها و تأییدهای لازم.', icon: FaBan, tone: 'danger' as const, onClick: actions.onRequestVoid, disabled: actions.pending }] : []),
        ]} />
      </ErpSection>}
      <ErpSection title="خروجی مشتری" description="ارسال برای مشتری و نهایی‌سازی فروشنده دو اقدام مستقل هستند.">
        <div className="grid gap-2"><ErpButton label="پیش‌نمایش" icon={FaEye} variant="outline" disabled={actions.pending || !actions.canPreview} onClick={actions.onPreview} />
          <ErpButton label="صدور PDF نهایی" icon={FaPrint} tone="success" disabled={actions.pending || !actions.canIssue} onClick={actions.onIssue} /></div>
      </ErpSection>
    </>}
  </>;
}

function PaymentPlan({ plan }: { plan: PartnerCaseView['customerPaymentPlan'] }) {
  return <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-sm text-[var(--sds-text-secondary)]">نسخه {plan.version.toLocaleString('fa-IR')}</span><ErpBadge tone="neutral">از {PersianCalendar.formatForDisplay(plan.effectiveDate)}</ErpBadge></div>
    {!plan.installments.length && <ErpBadge tone="warning">در انتظار ثبت حسابداری</ErpBadge>}
    {plan.installments.map(item => <ErpCard key={item.installmentId} className="p-3"><strong>{formatPartnerMoney(item.amount.amount, item.amount.currency)}</strong>
      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{partnerPaymentMethodCopy[item.method]} · سررسید {PersianCalendar.formatForDisplay(item.dueDate)}</p></ErpCard>)}</div>;
}
