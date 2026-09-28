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
import { inquiryRowState, isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import { partnerCaseReviewMessage, reconcilePartnerDeliveriesToProducts } from './partnerWizardEntry';
import { partnerTrackingCode, type PartnerCaseView } from '@sabalanerp/partner-sales-contracts';

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
  externalError?: string | null;
  mismatchedRowIds?: readonly string[];
  canonicalRetailReady?: boolean;
  renderSection: (step: Exclude<PartnerWizardStep, 'products' | 'pricing'>, draft: PartnerWizardDraft,
    showValidationErrors: boolean) => React.ReactNode;
  validateStep: (step: PartnerWizardStep, draft: PartnerWizardDraft) => string | null;
  onReinquire: (row?: PartnerRetailRow['inquiryRow']) => void;
  onEditProducts?: () => void;
  onEditProduct?: (row: PartnerRetailRow['inquiryRow']) => void;
  onPreparePricingQuote?: (draft: PartnerWizardDraft) => Promise<PartnerWizardDraft>;
  onSendConfirmation?: (caseId: string) => Promise<void> | void;
  onFinalize?: (view: PartnerCaseView) => Promise<void> | void;
  onCaseNumbered?: (caseId: string) => void;
  onOpenCase: (caseId: string) => Promise<void> | void;
}

export function PartnerContractWizard({ draft, onChange, recovery, submission, now, externalError, mismatchedRowIds = [],
  canonicalRetailReady = true, renderSection, validateStep, onReinquire, onEditProducts, onEditProduct,
  onSendConfirmation, onFinalize, onCaseNumbered, onOpenCase, onPreparePricingQuote }: PartnerContractWizardProps) {
  const result = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [quotePending, setQuotePending] = useState(false);
  const recoveryFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const visibleSteps = partnerWizardStepsForDraft(draft);
  const requestedStepIndex = visibleSteps.findIndex(step => step.id === draft.step);
  const stepIndex = requestedStepIndex >= 0 ? requestedStepIndex : visibleSteps.findIndex(step => step.id === 'payment');
  const visiblePresentationSteps = presentPartnerWizardSteps(visibleSteps);
  const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
  const pricingEntries = [...draft.rows.filter(row => !row.parentProductRowId).map(row => ({ id: row.productRowId, inquiryRow: row.inquiryRow })),
    ...(draft.materialInquiryRows ?? []).map(row => ({ id: row.pricingSubjectId, inquiryRow: row.inquiryRow }))]
  const unusable = pricingEntries.filter(row => !isUsableInquiryRow(row.inquiryRow, now)
    || mismatchedRowIds.includes(row.inquiryRow.rowId)
    || row.inquiryRow.configurationRef.productRowId !== row.id
    || row.inquiryRow.configurationRef.recoveryId !== draft.intent.recoveryId);
  const awaitingInitialPricing = !result.case && pricingEntries.length > 0 && pricingEntries.every(({ inquiryRow }) =>
    inquiryRow.state === 'PENDING' && !inquiryRow.approvedRowBinding && !inquiryRow.approvedPrice);
  const unsentRows = result.case ? pricingEntries.filter(({ inquiryRow }) =>
    inquiryRow.state === 'PENDING' && inquiryRow.submissionState === 'UNSENT' &&
    inquiryRow.successor?.state !== 'PENDING') : [];
  const waitingForSabalan = Boolean(result.case && pricingEntries.some(({ inquiryRow }) =>
    inquiryRow.state === 'PENDING' && (inquiryRow.submissionState !== 'UNSENT' ||
      inquiryRow.successor?.state === 'PENDING')));
  const rowReinquiries = result.case ? unusable.filter(({ inquiryRow }) =>
    !['PENDING', 'REJECTED'].includes(inquiryRow.state) && inquiryRow.successor?.state !== 'PENDING') : [];
  const expiredRows = unusable.filter(({ inquiryRow }) => inquiryRowState(inquiryRow, now) === 'EXPIRED');
  const rejectedRows = unusable.filter(({ inquiryRow }) => inquiryRow.state === 'REJECTED');
  const mutatePending = result.phase === 'submitting' || result.phase === 'uncertain';
  const disabled = recovery.state !== 'writable' || mutatePending || quotePending;
  const compactStatus = result.case ? partnerWizardCompactStatus(result.case) : null;
  const customerNotSent = result.case && ['NOT_SENT', 'RECONFIRMATION_REQUIRED']
    .includes(result.case.customerConfirmationState) && !confirmationSent;
  const pricingReady = Boolean(result.case && pricingEntries.length > 0 && unusable.length === 0 &&
    pricingEntries.every(({ inquiryRow }) => inquiryRow.state === 'APPROVED' && inquiryRow.approvedPrice && inquiryRow.approvedRowBinding));
  const pricingStatus = result.case?.state === 'DRAFT'
    ? pricingReady ? 'آماده پذیرش'
      : rejectedRows.length ? 'نیازمند اصلاح'
        : expiredRows.length ? 'پایان اعتبار قیمت'
          : waitingForSabalan ? 'در انتظار پاسخ' : compactStatus?.pricing
    : compactStatus?.pricing;
  const requiresReview = result.errorCode === 'INTEGRITY_CONFLICT';
  const submissionError = result.phase === 'editing' && result.message
    ? requiresReview && result.case
      ? partnerCaseReviewMessage(result.case.caseNumber, result.case.trackingNumber)
      : result.errorCode === 'APPROVAL_EXPIRED' && expiredRows[0]
        ? `${expiredRows[0].inquiryRow.description}: اعتبار قیمت پایان یافته است؛ همین ردیف را دوباره استعلام کنید.`
        : result.message : null;

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
  const intentWithPricingRequest = (source: PartnerWizardDraft) => {
    const pricingRows = [
      ...source.rows.map(row => ({ rowId: `pricing:${row.productRowId}`,
        configuration: row.inquiryRow.configurationRef })),
      ...(source.materialInquiryRows ?? []).map(row => ({ rowId: `pricing:${row.pricingSubjectId}`,
        configuration: row.inquiryRow.configurationRef })),
    ];
    return { ...source.intent, pricingRequest: {
      inquiryId: `partner-case-pricing:${source.intent.recoveryId}:1`, rows: pricingRows,
    }, rows: partnerRetailIntentRows(source.rows),
    customerPaymentPlan: alignPartnerCustomerPaymentPlan(source.rows, source.intent.retailDiscount,
      source.intent.customerPaymentPlan) };
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
    if (disabled || requiresReview || stepIndex < 0) return;
    const failure = validateStep(draft.step, draft);
    if (failure) { setError(failure); return; }
    if (draft.step === 'confirmation' && !summary.valid) {
      setError(summary.message); return;
    }
    if (draft.step === 'confirmation' && summary.loss && !draft.intent.belowCostConfirmed) {
      onChange({ ...draft, step: 'products' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
    }
    if (draft.step === 'products' && !result.case) {
      setError(null); setQuotePending(true);
      try {
        const prepared = onPreparePricingQuote ? await onPreparePricingQuote(draft) : draft;
        if (!canonicalRetailReady && !onPreparePricingQuote) throw new Error('Quote unavailable');
        const pricedSummary = partnerRetailSummary(prepared.rows, prepared.intent.retailDiscount);
        if (!pricedSummary.valid) { setError(pricedSummary.message); return; }
        if (pricedSummary.loss && !prepared.intent.belowCostConfirmed) {
          setError('زیان فروش را بررسی و تأیید کنید.'); return;
        }
        await submission.submit(intentWithPricingRequest(prepared));
      } catch {
        setError('محاسبه مبلغ محصولات انجام نشد؛ دوباره «ارسال برای استعلام قیمت» را بزنید.');
        return;
      } finally { setQuotePending(false); }
      const created = submission.getSnapshot();
      if (created.phase === 'created' && created.case) {
        onCaseNumbered?.(created.case.owner.caseId);
        move(visibleSteps.findIndex(step => step.id === 'pricing'));
      }
      return;
    }
    if (draft.step === 'pricing') {
      if (!pricingReady) {
        const blocked = rejectedRows[0] ?? expiredRows[0] ?? unusable[0];
        setError(blocked ? `${blocked.inquiryRow.description}: ${rejectedRows.includes(blocked)
          ? 'دلیل رد را بررسی و این محصول را ویرایش کنید.'
          : expiredRows.includes(blocked) ? 'اعتبار قیمت پایان یافته است؛ همین ردیف را دوباره استعلام کنید.'
            : 'پاسخ معتبر قیمت این ردیف هنوز آماده نیست.'}` : 'پاسخ قیمت همه محصولات هنوز کامل نیست.');
        return;
      }
      const acceptedIntent = { ...draft.intent, rows: partnerRetailIntentRows(draft.rows),
        deliveries: reconcilePartnerDeliveriesToProducts(draft.intent.deliveries, draft.rows) };
      await submission.submit(acceptedIntent);
      const accepted = submission.getSnapshot();
      if (accepted.phase === 'created' && accepted.case?.pricingState === 'READY_TO_FINALIZE') {
        setError(null);
        onChange({ ...draft, intent: acceptedIntent, step: 'delivery' });
        requestAnimationFrame(() => heading.current?.focus());
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
      {result.case && compactStatus && <ErpCard className="flex flex-wrap items-center gap-2 p-2">
        <span className="text-sm font-bold">{partnerTrackingCode(result.case.caseNumber, result.case.trackingNumber)}</span>
        <ErpBadge tone="neutral">قرارداد: {compactStatus.contract}</ErpBadge>
        <ErpBadge tone={pricingReady || result.case.pricingState === 'READY_TO_FINALIZE' ? 'success' : rejectedRows.length ? 'danger' : 'warning'}>
          قیمت سبلان: {pricingStatus}
        </ErpBadge>
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
      {unsentRows.length > 0 && <ErpInlineState kind="stale"
        title="محصول اصلاح‌شده ذخیره شده است. برای دریافت قیمت تازه، استعلام همان محصول را ارسال کنید." />}
      {result.phase === 'uncertain' && <ErpInlineState kind="stale" title={result.message || 'نتیجه ثبت را با همان درخواست بررسی کنید.'} action={{ label: 'بررسی نتیجه ثبت', onClick: () => void submission.retry() }} />}
      {submissionError && <ErpInlineState kind="error" title={submissionError} />}
      {externalError && <ErpInlineState kind="error" title={externalError} />}
      {error && <ErpInlineState kind="error" title={error} />}
    </div>}
    navigation={{
      onPrevious: () => move(stepIndex - 1),
      onNext: next,
      onSubmit: submit,
      loading: mutatePending || quotePending,
      hidePrimaryIcon: draft.step === 'pricing' && !pricingReady,
      canGoPrevious: !disabled && stepIndex > 0,
      canGoNext: !disabled && !requiresReview && (draft.step !== 'pricing' || pricingReady),
      showSubmitOnEveryStep: false,
      labels: {
        next: draft.step === 'products' ? (result.case ? 'مشاهده نتیجه استعلام' : 'ارسال برای استعلام قیمت')
          : draft.step === 'pricing' ? (pricingReady ? 'پذیرش قیمت‌ها و ادامه' : 'در انتظار تکمیل استعلام') : 'بعدی',
        submit: draft.step === 'confirmation' ? 'تأیید و نهایی‌سازی قرارداد' : 'ثبت پرونده',
      }
    }}
  >
    <div className="min-w-0 space-y-4" aria-label="ایجاد پرونده فروش همکار">
      <h2 ref={heading} tabIndex={-1} className="text-lg font-bold">{visibleSteps[stepIndex]?.label}</h2>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {draft.step === 'products' ? <div className="space-y-4"><PartnerRetailStep rows={draft.rows} discount={draft.intent.retailDiscount} belowCostConfirmed={draft.intent.belowCostConfirmed} disabled={disabled}
          onRowsChange={updateRetail} onConfirmLoss={belowCostConfirmed => onChange({ ...draft, intent: { ...draft.intent, belowCostConfirmed } })} />
          {onEditProducts && <ErpButton label="ویرایش محصولات" variant="outline" disabled={disabled}
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
            const rowState = inquiryRowState(inquiryRow, now);
            const expiresAt = inquiryRow.expiresAt && Number.isFinite(Date.parse(inquiryRow.expiresAt))
              ? new Date(inquiryRow.expiresAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' }) : null;
            return <ErpCard key={id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="font-semibold">{inquiryRow.description}</h3>
                <ErpBadge tone={usable ? 'success' : rowState === 'REJECTED' ? 'danger' : rowState === 'EXPIRED' ? 'warning' : 'info'}>
                  {usable ? 'قیمت سبلان دریافت شد' : rowState === 'REJECTED' ? 'رد شد؛ نیازمند اصلاح'
                    : rowState === 'EXPIRED' ? 'اعتبار قیمت پایان یافته' : rowState === 'PENDING' ? 'در انتظار پاسخ' : 'نیازمند استعلام'}
                </ErpBadge>
              </div>
              <p className="text-sm sds-text-secondary">قیمت پیشنهادی سبلان: <strong className="sds-text-primary">
                {price ? `${price.amount} ${price.currency === 'IRR' ? 'ریال' : 'تومان'}` : '—'}
              </strong></p>
              {rowState === 'EXPIRED' && expiresAt && <p className="text-sm sds-text-secondary">اعتبار تا {expiresAt}</p>}
              {inquiryRow.noteOrReason && <ErpInlineState kind="stale" title={inquiryRow.noteOrReason} />}
              {inquiryRow.state === 'REJECTED' && onEditProduct && <ErpButton label="ویرایش این محصول" variant="outline"
                disabled={disabled} onClick={() => onEditProduct(inquiryRow)} />}
              {unsentRows.some(item => item.id === id) && <ErpButton label="استعلام مجدد همین محصول" variant="outline"
                disabled={disabled} onClick={() => onReinquire(inquiryRow)} />}
              {rowReinquiries.some(item => item.id === id) && <ErpButton label="استعلام مجدد" variant="outline"
                disabled={disabled || inquiryRow.successor?.state === 'PENDING'} onClick={() => onReinquire(inquiryRow)} />}
            </ErpCard>;
          })}
          {pricingReady
            ? <ErpInlineState kind="success" title="قیمت همه محصولات دریافت شده است. با ادامه، این قیمت‌ها را برای پرونده می‌پذیرید." />
            : <ErpInlineState kind="empty" title={rejectedRows.length ? 'دلیل رد را بررسی و همان محصول را ویرایش کنید؛ قیمت ردیف‌های دیگر حفظ می‌شود.'
              : expiredRows.length ? 'اعتبار برخی قیمت‌ها پایان یافته است؛ همان ردیف‌ها را دوباره استعلام کنید.'
                : 'پرونده برای فروشنده سبلان ارسال شده است. پس از پاسخ همه ردیف‌ها، ادامه به برنامه تحویل فعال می‌شود.'} />}
        </section> : renderSection(draft.step, draft, Boolean(error))}
      </fieldset>
    </div>
  </ContractWizardFrame>;
}
