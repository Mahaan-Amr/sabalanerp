'use client';

import React, { useRef, useState, useSyncExternalStore } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpLoading, ErpSheet } from '@/components/erp';
import type { WizardStep } from '../components/shared/WizardProgressBar';
import { ContractWizardFrame } from '../components/shared/ContractWizardFrame';
import { WIZARD_STEPS } from '../constants/contract.constants';
import { PartnerRetailStep } from './PartnerRetailStep';
import { partnerRetailSummary, partnerRetailIntentRows, type PartnerRetailRow } from './partnerRetail';
import type { PartnerDraftIntent, createPartnerCaseSubmission } from './partnerCaseSubmission';
import { isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import type { PartnerCaseView } from '@sabalanerp/partner-sales-contracts';

export type PartnerWizardStep = 'date' | 'customer' | 'project' | 'products' | 'delivery' | 'payment' | 'confirmation';
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

const PARTNER_STEP_IDS: PartnerWizardStep[] = ['date', 'customer', 'project', 'products', 'delivery', 'payment', 'confirmation'];

/** Partner creation deliberately derives its sequence and presentation from the
 * ordinary Sales wizard. Partner policy may change actions, never the journey. */
export const partnerWizardSteps: Array<{ id: PartnerWizardStep; label: string; icon: WizardStep['icon'] }> =
  WIZARD_STEPS.map((step, index) => ({ id: PARTNER_STEP_IDS[index]!, label: step.title, icon: step.icon }));
const presentPartnerWizardSteps = (steps: typeof partnerWizardSteps): WizardStep[] => steps.map((step, index) => ({
  id: index + 1,
  title: step.label,
  titleEn: step.id,
  icon: step.icon,
  description: step.label,
}));
export const partnerWizardPresentationSteps = presentPartnerWizardSteps(partnerWizardSteps);

export const partnerWizardStepsForDraft = (_draft: PartnerWizardDraft) => partnerWizardSteps;

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
  Boolean(view && view.state === 'DRAFT' && view.pricingState === 'AWAITING_INQUIRY' && missingPriceRows > 0);

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
  renderSection: (step: Exclude<PartnerWizardStep, 'products'>, draft: PartnerWizardDraft,
    showValidationErrors: boolean) => React.ReactNode;
  validateStep: (step: PartnerWizardStep, draft: PartnerWizardDraft) => string | null;
  onReinquire: (row: PartnerRetailRow['inquiryRow']) => void;
  onEditProducts?: () => void;
  onSendConfirmation?: (caseId: string) => Promise<void> | void;
  onOpenCase: (caseId: string) => Promise<void> | void;
}

export function PartnerContractWizard({ draft, onChange, recovery, submission, now, mismatchedRowIds = [], renderSection, validateStep, onReinquire, onEditProducts, onSendConfirmation, onOpenCase }: PartnerContractWizardProps) {
  const result = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const automaticInquiryKey = useRef<string | null>(null);
  const recoveryFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const visibleSteps = partnerWizardStepsForDraft(draft);
  const requestedStepIndex = visibleSteps.findIndex(step => step.id === draft.step);
  const stepIndex = requestedStepIndex >= 0 ? requestedStepIndex : visibleSteps.findIndex(step => step.id === 'payment');
  const visiblePresentationSteps = presentPartnerWizardSteps(visibleSteps);
  const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
  const unusable = [...draft.rows.map(row => ({ id: row.productRowId, inquiryRow: row.inquiryRow })),
    ...(draft.materialInquiryRows ?? []).map(row => ({ id: row.pricingSubjectId, inquiryRow: row.inquiryRow }))]
    .filter(row => !isUsableInquiryRow(row.inquiryRow, now)
    || mismatchedRowIds.includes(row.inquiryRow.rowId)
    || row.inquiryRow.configurationRef.productRowId !== row.id
    || row.inquiryRow.configurationRef.recoveryId !== draft.intent.recoveryId);
  const mutatePending = result.phase === 'submitting' || result.phase === 'uncertain';
  const disabled = recovery.state !== 'writable' || mutatePending;
  const compactStatus = result.case ? partnerWizardCompactStatus(result.case) : null;
  const customerNotSent = result.case && ['NOT_SENT', 'RECONFIRMATION_REQUIRED']
    .includes(result.case.customerConfirmationState) && !confirmationSent;

  React.useEffect(() => {
    if (requestedStepIndex < 0 && draft.step === 'delivery') onChange({ ...draft, step: 'payment' });
  }, [draft, onChange, requestedStepIndex]);

  React.useEffect(() => {
    setConfirmationSent(false);
  }, [result.case?.owner.caseId, result.case?.owner.revision]);

  React.useEffect(() => {
    if (!partnerCaseNeedsAutomaticPricingInquiry(result.case, unusable.length) || !result.case || !unusable[0]) return;
    const key = `${result.case.owner.caseId}:${result.case.owner.revision}`;
    if (automaticInquiryKey.current === key) return;
    automaticInquiryKey.current = key;
    onReinquire(unusable[0].inquiryRow);
  }, [onReinquire, result.case, unusable]);

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
      action={{ label: recovery.state === 'takeover' ? 'ادامه ویرایش در اینجا' : 'ادامه پیش‌نویس', disabled: recoveryPending,
        onClick: () => void recover(recovery.state === 'takeover' ? recovery.takeover : recovery.resume) }}
      actions={[{ label: 'شروع پرونده جدید', variant: 'outline', disabled: recoveryPending, onClick: () => setDiscardOpen(true) }]} />
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
    setError(null); onChange({ ...draft, step: visibleSteps[index].id });
    requestAnimationFrame(() => heading.current?.focus());
  };
  const submit = () => {
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
    // The visible rows own retail intent. A recovered or updated projection
    // must never submit stale hidden prices or approval bindings.
    const deliveryFactsFor = (productRowId: string) => draft.intent.deliveries.flatMap(delivery =>
      delivery.items.filter(item => item.productRowId === productRowId)
        .map(item => ({ date: delivery.date, quantity: item.quantity })));
    const pricingRows = [
      ...draft.rows.map(row => ({ rowId: `pricing:${row.productRowId}`,
        configuration: row.inquiryRow.configurationRef,
        ...(deliveryFactsFor(row.productRowId).length ? { deliveryFacts: deliveryFactsFor(row.productRowId) } : {}) })),
      ...(draft.materialInquiryRows ?? []).map(row => ({ rowId: `pricing:${row.pricingSubjectId}`,
        configuration: row.inquiryRow.configurationRef })),
    ];
    const initialPricing = result.case ? {} : { pricingRequest: {
      inquiryId: `partner-case-pricing:${draft.intent.recoveryId}:1`, rows: pricingRows,
    } };
    void submission.submit({ ...draft.intent, ...initialPricing, rows: partnerRetailIntentRows(draft.rows) });
  };
  const next = () => {
    if (disabled || stepIndex < 0) return;
    const failure = validateStep(draft.step, draft);
    if (failure) { setError(failure); return; }
    if ((draft.step === 'products' || draft.step === 'confirmation') && !summary.valid) {
      setError(summary.message); return;
    }
    if ((draft.step === 'products' || draft.step === 'confirmation') && summary.loss && !draft.intent.belowCostConfirmed) {
      onChange({ ...draft, step: 'products' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
    }
    if (stepIndex < visibleSteps.length - 1) { move(stepIndex + 1); return; }
    submit();
  };
  const editMode = Boolean(result.case);
  return <ContractWizardFrame
    title="ایجاد فروش همکار"
    currentStep={stepIndex + 1}
    steps={visiblePresentationSteps}
    clickableSteps={editMode}
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
      {unusable.length > 0 && <ErpInlineState kind="stale"
        title={`بسته قیمت این پرونده منقضی شده است؛ هر ${unusable.length.toLocaleString('fa-IR')} ردیف باید دوباره قیمت‌گذاری شود. یک استعلام جانشین برای کل بسته ساخته می‌شود و هیچ قیمت قبلی خودکار منتقل نخواهد شد.`}
        action={{ label: 'استعلام مجدد کل بسته', disabled: mutatePending,
          onClick: () => onReinquire(unusable[0].inquiryRow) }} />}
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
      canGoNext: !disabled,
      showSubmitOnEveryStep: editMode,
      labels: { submit: result.phase === 'created' ? 'ذخیره تغییرات' : 'ذخیره قرارداد' }
    }}
  >
    <div className="min-w-0 space-y-4" aria-label="ایجاد پرونده فروش همکار">
      <h2 ref={heading} tabIndex={-1} className="text-lg font-bold">{visibleSteps[stepIndex]?.label}</h2>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {draft.step === 'products' ? <div className="space-y-4"><PartnerRetailStep rows={draft.rows} discount={draft.intent.retailDiscount} belowCostConfirmed={draft.intent.belowCostConfirmed} disabled={disabled}
          onRowsChange={updateRetail} onConfirmLoss={belowCostConfirmed => onChange({ ...draft, intent: { ...draft.intent, belowCostConfirmed } })} />
          {onEditProducts && <ErpButton label="ویرایش محصولات و استعلام قیمت" variant="outline" disabled={disabled}
            onClick={onEditProducts} />}
          <div className="flex flex-wrap gap-2">{draft.rows.map(row => <ErpButton key={row.productRowId}
            label={`استعلام مجدد ${row.inquiryRow.description}`} variant="outline"
            disabled={disabled || row.inquiryRow.successor?.state === 'PENDING'} onClick={() => onReinquire(row.inquiryRow)} />)}</div>
          {(draft.materialInquiryRows?.length ?? 0) > 0 && <div className="flex flex-wrap gap-2">{draft.materialInquiryRows!.map(row => <ErpButton key={row.pricingSubjectId}
            label={`استعلام مجدد ${row.inquiryRow.description}`} variant="outline"
            disabled={disabled || row.inquiryRow.successor?.state === 'PENDING'} onClick={() => onReinquire(row.inquiryRow)} />)}</div>}
        </div> : renderSection(draft.step, draft, Boolean(error))}
      </fieldset>
    </div>
  </ContractWizardFrame>;
}
