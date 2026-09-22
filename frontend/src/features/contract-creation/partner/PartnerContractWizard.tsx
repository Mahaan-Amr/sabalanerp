'use client';

import React, { useRef, useState, useSyncExternalStore } from 'react';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpLoading, ErpSheet } from '@/components/erp';
import type { WizardStep } from '../components/shared/WizardProgressBar';
import { ContractWizardFrame } from '../components/shared/ContractWizardFrame';
import { WIZARD_STEPS } from '../constants/contract.constants';
import { PartnerRetailStep } from './PartnerRetailStep';
import { alignPartnerCustomerPaymentPlan, partnerRetailSummary, partnerRetailIntentRows, type PartnerRetailRow } from './partnerRetail';
import type { PartnerDraftIntent, createPartnerCaseSubmission } from './partnerCaseSubmission';
import { isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import type { PartnerCaseView } from '@sabalanerp/partner-sales-contracts';

export type PartnerWizardStep = 'date' | 'customer' | 'project' | 'products' | 'pricing' | 'delivery' | 'payment' | 'confirmation';
export interface PartnerWizardDraft {
  intent: PartnerDraftIntent;
  rows: PartnerRetailRow[];
  materialInquiryRows?: Array<{ pricingSubjectId: string; inquiryRow: PartnerRetailRow['inquiryRow'] }>;
  step: PartnerWizardStep;
}
export type PartnerRecoverySurface =
  | { state: 'loading' }
  | { state: 'writable' }
  | { state: 'offer'; resume: () => Promise<void>; discard: () => Promise<void> }
  | { state: 'takeover'; takeover: () => Promise<void>; discard: () => Promise<void> }
  | { state: 'blocked'; message: string };

const PARTNER_STEP_IDS: Exclude<PartnerWizardStep, 'pricing'>[] = ['date', 'customer', 'project', 'products', 'delivery', 'payment', 'confirmation'];

/** Partner creation deliberately derives its sequence and presentation from the
 * ordinary Sales wizard. Partner policy may change actions, never the journey. */
const ordinaryPartnerSteps: Array<{ id: PartnerWizardStep; label: string; icon: WizardStep['icon'] }> =
  WIZARD_STEPS.map((step, index) => ({ id: PARTNER_STEP_IDS[index]!, label: step.title, icon: step.icon }));
export const partnerWizardSteps: Array<{ id: PartnerWizardStep; label: string; icon: WizardStep['icon'] }> = [
  ...ordinaryPartnerSteps.slice(0, 4),
  { id: 'pricing', label: 'استعلام قیمت', icon: FaFileInvoiceDollar },
  ...ordinaryPartnerSteps.slice(4),
];
const presentPartnerWizardSteps = (steps: typeof partnerWizardSteps): WizardStep[] => steps.map((step, index) => ({
  id: index + 1,
  title: step.label,
  titleEn: step.id,
  icon: step.icon,
  description: step.label,
}));
export const partnerWizardPresentationSteps = presentPartnerWizardSteps(partnerWizardSteps);

export const partnerWizardStepsForDraft = (_draft: PartnerWizardDraft) => partnerWizardSteps;

export function requiredPartnerWizardStep(step: PartnerWizardStep, hasNumberedCase: boolean,
  pricingReady: boolean): PartnerWizardStep {
  const current = partnerWizardSteps.findIndex(item => item.id === step);
  const pricing = partnerWizardSteps.findIndex(item => item.id === 'pricing');
  if (current < 0) return 'products';
  if (!hasNumberedCase && current >= pricing) return 'products';
  if (hasNumberedCase && !pricingReady && current > pricing) return 'pricing';
  return step;
}

export function partnerWizardCompactStatus(view: PartnerCaseView) {
  const contract = view.state === 'DRAFT' ? 'پیش‌نویس'
    : view.state === 'AWAITING_CUSTOMER_CONFIRMATION' ? 'در انتظار مشتری'
      : view.state === 'CUSTOMER_APPROVED' ? 'تأییدشده مشتری' : view.state;
  const pricing = view.pricingState === 'READY_TO_FINALIZE' ? 'آماده نهایی‌سازی'
    : view.pricingState === 'AWAITING_INQUIRY' ? 'در انتظار استعلام'
      : view.pricingState === 'EXPIRED' ? 'منقضی' : 'ناقص';
  const customer = view.customerConfirmationState === 'NOT_SENT' ? 'ارسال‌نشده'
    : view.customerConfirmationState === 'SENT' ? 'ارسال‌شده، بدون پاسخ'
      : view.customerConfirmationState === 'APPROVED' ? 'تأییدشده'
        : view.customerConfirmationState === 'REJECTED' ? 'ردشده' : 'نیازمند تأیید نسخه جدید';
  return { contract, pricing, customer };
}

export const partnerCaseNeedsAutomaticPricingInquiry = (view: PartnerCaseView | undefined, missingPriceRows: number) =>
  false;

/** Host-supplied sections reuse the existing customer/delivery/payment editors
 * and their validation. They receive the recovery-owned draft, never internal
 * price inputs. The integration owner supplies authenticated adapters; no fixture is a fallback.
 */
export interface PartnerContractWizardProps {
  draft: PartnerWizardDraft;
  onChange: (draft: PartnerWizardDraft) => void;
  recovery: PartnerRecoverySurface;
  submission: ReturnType<typeof createPartnerCaseSubmission>;
  now: number;
  mismatchedRowIds?: readonly string[];
  canonicalRetailReady?: boolean;
  renderSection: (step: Exclude<PartnerWizardStep, 'products' | 'pricing'>, draft: PartnerWizardDraft,
    showValidationErrors: boolean) => React.ReactNode;
  validateStep: (step: PartnerWizardStep, draft: PartnerWizardDraft) => string | null;
  onReinquire: (row?: PartnerRetailRow['inquiryRow']) => void;
  onEditProducts?: () => void;
  onEditProduct?: (row: PartnerRetailRow['inquiryRow']) => void;
  onSendConfirmation?: (caseId: string) => Promise<void> | void;
  onFinalize?: (view: PartnerCaseView) => Promise<void> | void;
  onCaseNumbered?: (caseId: string) => void;
  onOpenCase: (caseId: string) => Promise<void> | void;
}

export function PartnerContractWizard({ draft, onChange, recovery, submission, now, mismatchedRowIds = [],
  canonicalRetailReady = true, renderSection, validateStep, onReinquire, onEditProducts, onEditProduct,
  onSendConfirmation, onFinalize, onCaseNumbered, onOpenCase }: PartnerContractWizardProps) {
  const result = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const recoveryFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const visibleSteps = partnerWizardStepsForDraft(draft);
  const requestedStepIndex = visibleSteps.findIndex(step => step.id === draft.step);
  const stepIndex = requestedStepIndex >= 0 ? requestedStepIndex : visibleSteps.findIndex(step => step.id === 'payment');
  const visiblePresentationSteps = presentPartnerWizardSteps(visibleSteps);
  const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
  const pricingEntries = [...draft.rows.map(row => ({ id: row.productRowId, inquiryRow: row.inquiryRow })),
    ...(draft.materialInquiryRows ?? []).map(row => ({ id: row.pricingSubjectId, inquiryRow: row.inquiryRow }))]
  const unusable = pricingEntries.filter(row => !isUsableInquiryRow(row.inquiryRow, now)
    || mismatchedRowIds.includes(row.inquiryRow.rowId)
    || row.inquiryRow.configurationRef.productRowId !== row.id
    || row.inquiryRow.configurationRef.recoveryId !== draft.intent.recoveryId);
  const awaitingInitialPricing = !result.case && pricingEntries.length > 0 && pricingEntries.every(({ inquiryRow }) =>
    inquiryRow.state === 'PENDING' && !inquiryRow.approvedRowBinding && !inquiryRow.approvedPrice);
  const waitingForSabalan = result.case?.state === 'DRAFT' && result.case.pricingState === 'AWAITING_INQUIRY';
  const expiredPackage = result.case?.pricingState === 'EXPIRED';
  const rowReinquiries = result.case && !expiredPackage ? unusable.filter(({ inquiryRow }) =>
    inquiryRow.state !== 'PENDING' && inquiryRow.successor?.state !== 'PENDING') : [];
  const mutatePending = result.phase === 'submitting' || result.phase === 'uncertain';
  const disabled = recovery.state !== 'writable' || mutatePending;
  const compactStatus = result.case ? partnerWizardCompactStatus(result.case) : null;
  const customerNotSent = result.case && ['NOT_SENT', 'RECONFIRMATION_REQUIRED']
    .includes(result.case.customerConfirmationState) && !confirmationSent;
  const pricingReady = Boolean(result.case && pricingEntries.length > 0 && unusable.length === 0 &&
    pricingEntries.every(({ inquiryRow }) => inquiryRow.state === 'APPROVED' && inquiryRow.approvedPrice && inquiryRow.approvedRowBinding));

  React.useEffect(() => {
    const required = requiredPartnerWizardStep(draft.step, Boolean(result.case), pricingReady);
    if (required !== draft.step) onChange({ ...draft, step: required });
  }, [draft, onChange, pricingReady, result.case]);

  React.useEffect(() => {
    setConfirmationSent(false);
  }, [result.case?.owner.caseId, result.case?.owner.revision]);

  const recover = async (operation: () => Promise<void>) => {
    if (recoveryFlight.current) return;
    recoveryFlight.current = true; setRecoveryPending(true); setError(null);
    try { await operation(); setDiscardOpen(false); }
    catch { setError('بازیابی انجام نشد؛ اطلاعات قبلی حفظ شده است. دوباره تلاش کنید.'); }
    finally { recoveryFlight.current = false; setRecoveryPending(false); }
  };

  if (recovery.state === 'loading') return <ErpLoading />;
  if (recovery.state === 'blocked') return <ErpInlineState kind="permission" title={recovery.message} />;
  if (recovery.state === 'offer' || recovery.state === 'takeover') return <section dir="rtl" className="space-y-4">
    <ErpInlineState kind="stale" title={recovery.state === 'takeover' ? 'این پیش‌نویس در جای دیگری در حال ویرایش است.' : 'یک پیش‌نویس ناتمام دارید.'}
      action={{ label: recovery.state === 'takeover' ? 'ادامه ویرایش در اینجا' : 'ادامه پیش‌نویس قبلی', disabled: recoveryPending,
        onClick: () => void recover(recovery.state === 'takeover' ? recovery.takeover : recovery.resume) }}
      actions={[{ label: 'شروع قرارداد جدید', variant: 'outline', disabled: recoveryPending, onClick: () => setDiscardOpen(true) }]} />
    <ErpSheet open={discardOpen} onClose={() => setDiscardOpen(false)} title="کنار گذاشتن پیش‌نویس" presentation="modal" pending={recoveryPending}
      footer={<ErpButton tone="danger" label="کنار گذاشتن و شروع جدید" disabled={recoveryPending} onClick={() => void recover(recovery.discard)} />}>
      <p>اطلاعات پیش‌نویس قبلی در همه محل‌های ویرایش پاک می‌شود. ادامه می‌دهید؟</p>
    </ErpSheet>
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;

  const updateRetail = (rows: PartnerRetailRow[]) => onChange({ ...draft, rows, intent: {
    ...draft.intent, belowCostConfirmed: false,
    rows: partnerRetailIntentRows(rows),
  } });
  const move = (index: number) => {
    const pricingIndex = visibleSteps.findIndex(step => step.id === 'pricing');
    if (index > pricingIndex && !pricingReady) {
      setError('ابتدا پاسخ قیمت همه محصولات را دریافت و تأیید کنید.');
      onChange({ ...draft, step: 'pricing' });
      return;
    }
    setError(null); onChange({ ...draft, step: visibleSteps[index].id });
    requestAnimationFrame(() => heading.current?.focus());
  };
  const intentWithPricingRequest = () => {
    const pricingRows = [
      ...draft.rows.map(row => ({ rowId: `pricing:${row.productRowId}`,
        configuration: row.inquiryRow.configurationRef })),
      ...(draft.materialInquiryRows ?? []).map(row => ({ rowId: `pricing:${row.pricingSubjectId}`,
        configuration: row.inquiryRow.configurationRef })),
    ];
    return { ...draft.intent, pricingRequest: {
      inquiryId: `partner-case-pricing:${draft.intent.recoveryId}:1`, rows: pricingRows,
    }, rows: partnerRetailIntentRows(draft.rows),
    customerPaymentPlan: alignPartnerCustomerPaymentPlan(draft.rows, draft.intent.retailDiscount,
      draft.intent.customerPaymentPlan) };
  };
  const submit = async () => {
    if (disabled || stepIndex < 0) return;
    const invalid = visibleSteps.map(step => ({ step, failure: validateStep(step.id, draft) })).find(item => item.failure);
    if (invalid) { onChange({ ...draft, step: invalid.step.id }); setError(invalid.failure); return; }
    if (!summary.valid) { onChange({ ...draft, step: 'products' }); setError(summary.message); return; }
    if (summary.loss && !draft.intent.belowCostConfirmed) {
      onChange({ ...draft, step: 'products' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
    }
    if (!draft.rows.length || new Set(draft.rows.map(row => row.productRowId)).size !== draft.rows.length) {
      setError('حداقل یک محصول کامل و بدون ردیف تکراری لازم است.'); return;
    }
    await submission.submit({ ...draft.intent, rows: partnerRetailIntentRows(draft.rows) });
    const saved = submission.getSnapshot();
    if (draft.step === 'confirmation' && saved.phase === 'created' && saved.case && onFinalize) {
      try { await onFinalize(saved.case); }
      catch { setError('نهایی‌سازی قرارداد انجام نشد؛ پرونده ذخیره شده است و می‌توانید دوباره تلاش کنید.'); }
    }
  };
  const next = async () => {
    if (disabled || stepIndex < 0) return;
    if (draft.step === 'products' && !canonicalRetailReady) {
      setError('محاسبه مبلغ نهایی محصولات هنوز کامل نشده است؛ چند لحظه صبر کنید.'); return;
    }
    const failure = validateStep(draft.step, draft);
    if (failure) { setError(failure); return; }
    if ((draft.step === 'products' || draft.step === 'confirmation') && !summary.valid) {
      setError(summary.message); return;
    }
    if ((draft.step === 'products' || draft.step === 'confirmation') && summary.loss && !draft.intent.belowCostConfirmed) {
      onChange({ ...draft, step: 'products' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
    }
    if (draft.step === 'products' && !result.case) {
      await submission.submit(intentWithPricingRequest());
      const created = submission.getSnapshot();
      if (created.phase === 'created' && created.case) {
        onCaseNumbered?.(created.case.owner.caseId);
        move(visibleSteps.findIndex(step => step.id === 'pricing'));
      }
      return;
    }
    if (draft.step === 'pricing') {
      if (!pricingReady) { setError('پاسخ قیمت همه محصولات هنوز کامل و معتبر نیست.'); return; }
      await submission.submit({ ...draft.intent, rows: partnerRetailIntentRows(draft.rows) });
      const accepted = submission.getSnapshot();
      if (accepted.phase === 'created' && accepted.case?.pricingState === 'READY_TO_FINALIZE') {
        move(visibleSteps.findIndex(step => step.id === 'delivery'));
      }
      return;
    }
    if (stepIndex < visibleSteps.length - 1) { move(stepIndex + 1); return; }
    await submit();
  };
  return <ContractWizardFrame
    title="ایجاد فروش همکار"
    currentStep={stepIndex + 1}
    steps={visiblePresentationSteps}
    clickableSteps={Boolean(result.case)}
    onStepClick={step => move(step - 1)}
    notices={<div className="mb-4 space-y-3">
      {result.phase === 'created' && result.case && compactStatus && <ErpCard className="flex flex-wrap items-center gap-2 p-2">
        <span className="text-sm font-bold">{result.case.caseNumber}</span>
        <ErpBadge tone="neutral">قرارداد: {compactStatus.contract}</ErpBadge>
        <ErpBadge tone={result.case.pricingState === 'READY_TO_FINALIZE' ? 'success' : 'warning'}>قیمت سبلان: {compactStatus.pricing}</ErpBadge>
        <ErpBadge tone={!confirmationSent && result.case.customerConfirmationState === 'APPROVED' ? 'success'
          : !confirmationSent && result.case.customerConfirmationState === 'REJECTED' ? 'danger' : 'info'}>
          مشتری: {confirmationSent ? 'ارسال‌شده، بدون پاسخ' : compactStatus.customer}
        </ErpBadge>
        {onSendConfirmation && result.case.state === 'COMMITTED' && result.case.customerConfirmationState !== 'REJECTED' &&
          (customerNotSent ? <ErpButton variant="solid" label="ارسال برای مشتری" onClick={() => {
            setError(null); void Promise.resolve().then(() => onSendConfirmation(result.case!.owner.caseId))
              .then(() => setConfirmationSent(true)).catch(() => setError('ارسال پیامک انجام نشد؛ پرونده ذخیره شده و می‌توانید دوباره تلاش کنید.'));
          }} /> : <ErpButton variant="outline" label="ارسال مجدد برای مشتری" onClick={() => {
            setError(null); void Promise.resolve().then(() => onSendConfirmation(result.case!.owner.caseId))
              .then(() => setConfirmationSent(true)).catch(() => setError('ارسال مجدد پیامک انجام نشد؛ پرونده ذخیره شده است.'));
          }} />)}
        <ErpButton variant={customerNotSent ? 'outline' : 'solid'} label="باز کردن پرونده" onClick={() => {
          void Promise.resolve().then(() => onOpenCase(result.case!.owner.caseId))
            .catch(() => setError('پرونده ذخیره شده است؛ باز کردن جزئیات را دوباره امتحان کنید.'));
        }} />
      </ErpCard>}
      {result.phase === 'created' && result.message && <ErpInlineState kind="stale" title={result.message}
        action={{ label: 'تلاش مجدد برای پاک‌سازی بازیابی', onClick: () => void submission.retry() }} />}
      {awaitingInitialPricing && draft.step === 'products' && <ErpInlineState kind="empty"
        title="با ادامه از این مرحله، پرونده شماره‌دار می‌شود و استعلام قیمت برای فروشنده سبلان ارسال خواهد شد." />}
      {waitingForSabalan && <ErpInlineState kind="empty"
        title="استعلام قیمت برای فروشنده سبلان ارسال شده است و در وظایف بین‌واحدی او قرار دارد. پس از ثبت پاسخ، قیمت خرید شما در همین پرونده نمایش داده می‌شود." />}
      {expiredPackage && unusable.length > 0 && <ErpInlineState kind="stale"
        title={`بسته قیمت این پرونده منقضی شده است؛ هر ${unusable.length.toLocaleString('fa-IR')} ردیف باید دوباره قیمت‌گذاری شود. یک استعلام جانشین برای کل بسته ساخته می‌شود و هیچ قیمت قبلی خودکار منتقل نخواهد شد.`}
        action={{ label: 'استعلام مجدد کل بسته', disabled: mutatePending,
          onClick: () => onReinquire() }} />}
      {result.phase === 'uncertain' && <ErpInlineState kind="stale" title={result.message || 'نتیجه ثبت را با همان درخواست بررسی کنید.'} action={{ label: 'بررسی نتیجه ثبت', onClick: () => void submission.retry() }} />}
      {result.phase === 'editing' && result.message && <ErpInlineState kind="error" title={result.message} />}
      {error && <ErpInlineState kind="error" title={error} />}
    </div>}
    navigation={{
      onPrevious: () => move(stepIndex - 1),
      onNext: next,
      onSubmit: submit,
      loading: mutatePending,
      canGoPrevious: !disabled && stepIndex > 0,
      canGoNext: !disabled && (draft.step !== 'pricing' || pricingReady)
        && (draft.step !== 'products' || canonicalRetailReady),
      showSubmitOnEveryStep: false,
      labels: {
        next: draft.step === 'products' ? 'ارسال برای استعلام قیمت'
          : draft.step === 'pricing' ? (pricingReady ? 'ساخت پرونده' : 'در انتظار تکمیل استعلام') : 'بعدی',
        submit: draft.step === 'confirmation' ? 'تأیید و نهایی‌سازی قرارداد' : 'ثبت پرونده',
      }
    }}
  >
    <div className="min-w-0 space-y-4" aria-label="ایجاد پرونده فروش همکار">
      <h2 ref={heading} tabIndex={-1} className="text-lg font-bold">{visibleSteps[stepIndex]?.label}</h2>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {draft.step === 'products' ? <div className="space-y-4"><PartnerRetailStep rows={draft.rows} discount={draft.intent.retailDiscount} belowCostConfirmed={draft.intent.belowCostConfirmed} disabled={disabled}
          onRowsChange={updateRetail} onConfirmLoss={belowCostConfirmed => onChange({ ...draft, intent: { ...draft.intent, belowCostConfirmed } })} />
          {onEditProducts && <ErpButton label="ویرایش محصولات و استعلام قیمت" variant="outline" disabled={disabled}
            onClick={onEditProducts} />}
          <div className="flex flex-wrap gap-2">{draft.rows.filter(row => rowReinquiries.some(item => item.id === row.productRowId)).map(row => <ErpButton key={row.productRowId}
            label={`استعلام مجدد ${row.inquiryRow.description}`} variant="outline"
            disabled={disabled || row.inquiryRow.successor?.state === 'PENDING'} onClick={() => onReinquire(row.inquiryRow)} />)}</div>
          {rowReinquiries.some(item => draft.materialInquiryRows?.some(row => row.pricingSubjectId === item.id)) && <div className="flex flex-wrap gap-2">{draft.materialInquiryRows!.filter(row => rowReinquiries.some(item => item.id === row.pricingSubjectId)).map(row => <ErpButton key={row.pricingSubjectId}
            label={`استعلام مجدد ${row.inquiryRow.description}`} variant="outline"
            disabled={disabled || row.inquiryRow.successor?.state === 'PENDING'} onClick={() => onReinquire(row.inquiryRow)} />)}</div>}
        </div> : draft.step === 'pricing' ? <section className="space-y-4" aria-label="استعلام قیمت سبلان">
          {pricingEntries.map(({ id, inquiryRow }) => {
            const usable = !unusable.some(item => item.id === id);
            const price = inquiryRow.approvedPrice;
            return <ErpCard key={id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="font-semibold">{inquiryRow.description}</h3>
                <ErpBadge tone={usable ? 'success' : inquiryRow.state === 'REJECTED' ? 'danger' : 'info'}>
                  {usable ? 'قیمت سبلان دریافت شد' : inquiryRow.state === 'REJECTED' ? 'نیازمند اصلاح' : 'در انتظار پاسخ'}
                </ErpBadge>
              </div>
              <p className="text-sm sds-text-secondary">قیمت پیشنهادی سبلان: <strong className="sds-text-primary">
                {price ? `${price.amount} ${price.currency === 'IRR' ? 'ریال' : 'تومان'}` : '—'}
              </strong></p>
              {inquiryRow.noteOrReason && <ErpInlineState kind="stale" title={inquiryRow.noteOrReason} />}
              {inquiryRow.state === 'REJECTED' && onEditProduct && <ErpButton label="ویرایش این محصول" variant="outline"
                disabled={disabled} onClick={() => onEditProduct(inquiryRow)} />}
              {rowReinquiries.some(item => item.id === id) && <ErpButton label="استعلام مجدد" variant="outline"
                disabled={disabled || inquiryRow.successor?.state === 'PENDING'} onClick={() => onReinquire(inquiryRow)} />}
            </ErpCard>;
          })}
          {pricingReady
            ? <ErpInlineState kind="success" title="قیمت همه محصولات دریافت شده است. با ادامه، این قیمت‌ها را برای پرونده می‌پذیرید." />
            : <ErpInlineState kind="empty" title="پرونده برای فروشنده سبلان ارسال شده است. پس از پاسخ همه ردیف‌ها، ادامه به برنامه تحویل فعال می‌شود." />}
        </section> : renderSection(draft.step, draft, Boolean(error))}
      </fieldset>
    </div>
  </ContractWizardFrame>;
}
