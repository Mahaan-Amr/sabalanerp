'use client';
import { PartnerInquiryProductFacts } from '../../partner-sales/inquiries/PartnerInquiryProductFacts';
import { PartnerWholesalePricingSummary } from '../../partner-sales/inquiries/PartnerWholesalePricingSummary';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpLoading, ErpSheet, ErpFieldView, ErpTextarea } from '@/components/erp';
import type { WizardStep } from '../components/shared/WizardProgressBar';
import { ContractWizardFrame } from '../components/shared/ContractWizardFrame';
import { WIZARD_STEPS } from '../constants/contract.constants';
import { PartnerRetailStep } from './PartnerRetailStep';
import { partnerRetailSummary, partnerRetailIntentRows, partnerMoneyText, type PartnerRetailRow, type PartnerRetailServiceRow } from './partnerRetail';
import { saveCompletedPartnerDraft, type PartnerDraftIntent, type createPartnerCaseSubmission } from './partnerCaseSubmission';
import { inquiryRowState, isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import { partnerCaseReviewMessage, partnerDeliveryPlanIssue } from './partnerWizardEntry';
import { partnerSalesActionFeedback } from '../../partner-sales/partnerSalesErrorMessage';
import { contractCorrectionBannerTitle } from '../services/contractCorrectionPresentation';
import { formatPartnerMoney } from '../../partner-sales/presentation';
import { partnerCommercialLabels, partnerTrackingCode, type PartnerCommercialState, type PartnerCaseView } from '@sabalanerp/partner-sales-contracts';

export type PartnerWizardStep = 'date' | 'customer' | 'project' | 'products' | 'pricing' | 'delivery' | 'payment' | 'confirmation';
export interface PartnerWizardDraft {
  intent: PartnerDraftIntent;
  rows: PartnerRetailRow[];
  serviceRows?: PartnerRetailServiceRow[];
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

export const partnerWizardStepsForDraft = (draft: PartnerWizardDraft) =>
  !draft.rows.length && draft.serviceRows?.length ? partnerWizardSteps.filter(step => step.id !== 'pricing') : partnerWizardSteps;

export function requiredPartnerWizardStep(step: PartnerWizardStep, hasNumberedCase: boolean,
  _pricingReady: boolean): PartnerWizardStep {
  const current = partnerWizardSteps.findIndex(item => item.id === step);
  const pricing = partnerWizardSteps.findIndex(item => item.id === 'pricing');
  if (current < 0) return 'products';
  if (!hasNumberedCase && current >= pricing) return 'pricing';
  return step;
}

export function partnerWizardCompactStatus(view: PartnerCaseView, commercial?: PartnerCommercialState) {
  const contract = commercial ? partnerCommercialLabels[commercial.status] : view.state === 'COMMITTED' ? 'در حال دریافت وضعیت' : view.state === 'VOIDED' ? 'لغو شده' : view.state === 'DRAFT' ? 'پیش‌نویس'
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

const intentWithPricingRequest = (source: PartnerWizardDraft) => {
  const pricingRows = [
    ...source.rows.map(row => ({ rowId: `pricing:${row.productRowId}`,
      configuration: row.inquiryRow.configurationRef })),
    ...(source.materialInquiryRows ?? []).map(row => ({ rowId: `pricing:${row.pricingSubjectId}`,
      configuration: row.inquiryRow.configurationRef })),
  ];
  return { ...source.intent, ...(pricingRows.length ? { pricingRequest: {
    inquiryId: `partner-case-pricing:${source.intent.recoveryId}:1`, rows: pricingRows,
  } } : { pricingRequest: undefined }), rows: partnerRetailIntentRows(source.rows),
  customerPaymentPlan: source.intent.customerPaymentPlan };
};

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
  correctionReason?: string | null;
  readCommercialState?: (view: PartnerCaseView) => Promise<PartnerCommercialState | undefined>;
  mismatchedRowIds?: readonly string[];
  canonicalRetailReady?: boolean;
  renderSection: (step: Exclude<PartnerWizardStep, 'products' | 'pricing'>, draft: PartnerWizardDraft,
    showValidationErrors: boolean) => React.ReactNode;
  validateStep: (step: PartnerWizardStep, draft: PartnerWizardDraft) => string | null;
  onReinquire: (row?: PartnerRetailRow['inquiryRow']) => void;
  onRejectPrice?: (row: PartnerRetailRow['inquiryRow'], reason: string) => Promise<void>;
  onEditProducts?: () => void;
  onEditProduct?: (row: PartnerRetailRow['inquiryRow']) => void;
  onPreparePricingQuote?: (draft: PartnerWizardDraft) => Promise<PartnerWizardDraft>;
  onSendConfirmation?: (caseId: string) => Promise<void> | void;
  onFinalize?: (view: PartnerCaseView) => Promise<void> | void;
  onCaseNumbered?: (caseId: string) => void;
  onOpenCase: (caseId: string) => Promise<void> | void;
}

export function PartnerContractWizard({ draft, onChange, recovery, submission, now, externalError, correctionReason, readCommercialState, mismatchedRowIds = [],
  canonicalRetailReady = true, renderSection, validateStep, onReinquire, onEditProducts, onEditProduct,
  onSendConfirmation, onFinalize, onCaseNumbered, onOpenCase, onPreparePricingQuote, onRejectPrice }: PartnerContractWizardProps) {
  const result = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [quotePending, setQuotePending] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PartnerRetailRow['inquiryRow']>();
  const [rejectReason, setRejectReason] = useState('');
  const [pricingDecision, setPricingDecision] = useState<'accepted' | 'rejected'>();
  const initialPricingFlight = useRef(false);
  const initialPricingAttempt = useRef<string>();
  const recoveryFlight = useRef(false);
  const confirmationFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const paymentValidationError = useRef<string>();
  useEffect(() => {
    if (draft.step === 'payment' && paymentValidationError.current === error && !validateStep('payment', draft)) {
      paymentValidationError.current = undefined;
      setError(null);
    }
  }, [draft, error, validateStep]);
  const visibleSteps = partnerWizardStepsForDraft(draft);
  const requestedStepIndex = visibleSteps.findIndex(step => step.id === draft.step);
  const stepIndex = requestedStepIndex >= 0 ? requestedStepIndex : visibleSteps.findIndex(step => step.id === 'payment');
  const visiblePresentationSteps = presentPartnerWizardSteps(visibleSteps);
  const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount, draft.serviceRows);
  const validateWizardStep = (step: PartnerWizardStep, current: PartnerWizardDraft) =>
    validateStep(step, current) ?? (step === 'delivery'
      ? partnerDeliveryPlanIssue(current.intent.deliveries, current.rows, current.serviceRows) : null);
  const pricingEntries = [...draft.rows.filter(row => !row.parentProductRowId).map(row => ({ id: row.productRowId, inquiryRow: row.inquiryRow })),
    ...(draft.materialInquiryRows ?? []).map(row => ({ id: row.pricingSubjectId, inquiryRow: row.inquiryRow }))]
  const unusable = pricingEntries.filter(row => !isUsableInquiryRow(row.inquiryRow, now)
    || mismatchedRowIds.includes(row.inquiryRow.rowId)
    || row.inquiryRow.configurationRef.productRowId !== row.id
    || row.inquiryRow.configurationRef.recoveryId !== draft.intent.recoveryId);
  const unsentRows = result.case ? pricingEntries.filter(({ inquiryRow }) =>
    (inquiryRow.state === 'REJECTED' || inquiryRow.state === 'PENDING' && inquiryRow.submissionState === 'UNSENT') &&
    inquiryRow.successor?.state !== 'PENDING') : [];
  const waitingForSabalan = Boolean(result.case && pricingEntries.some(({ inquiryRow }) =>
    inquiryRow.successor?.state === 'PENDING' ||
    inquiryRow.state === 'PENDING' && inquiryRow.submissionState !== 'UNSENT'));
  const rowReinquiries = result.case ? unusable.filter(({ inquiryRow }) =>
    !['PENDING', 'REJECTED'].includes(inquiryRow.state) && inquiryRow.successor?.state !== 'PENDING') : [];
  const expiredRows = unusable.filter(({ inquiryRow }) => inquiryRowState(inquiryRow, now) === 'EXPIRED');
  const rejectedRows = unusable.filter(({ inquiryRow }) => inquiryRow.state === 'REJECTED');
  const mutatePending = result.phase === 'submitting' || result.phase === 'uncertain';
  const disabled = recovery.state !== 'writable' || mutatePending || quotePending || actionPending;
  const [commercialSnapshot, setCommercialSnapshot] = useState<{ key: string; value: PartnerCommercialState } | null>(null);
  const commercialKey = result.case ? `${result.case.owner.caseId}:${result.case.owner.revision}:${result.case.owner.integrityHash}` : '';
  useEffect(() => {
    let active = true;
    if (result.case && readCommercialState) void readCommercialState(result.case).then(value => {
      if (active && value) setCommercialSnapshot({ key: commercialKey, value });
    }).catch(() => { if (active) setCommercialSnapshot(null); });
    return () => { active = false; };
  }, [commercialKey, readCommercialState]);
  const compactStatus = result.case ? partnerWizardCompactStatus(result.case,
    commercialSnapshot?.key === commercialKey ? commercialSnapshot.value : undefined) : null;
  const customerNotSent = result.case && ['NOT_SENT', 'RECONFIRMATION_REQUIRED']
    .includes(result.case.customerConfirmationState) && !confirmationSent;
  const pricingReady = Boolean(result.case && (pricingEntries.length > 0 || Boolean(draft.serviceRows?.length)) && unusable.length === 0 &&
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
    const serviceOnly = !draft.rows.length && Boolean(draft.serviceRows?.length);
    const requested = draft.step === 'products' ? 'pricing' : draft.step;
    const required = serviceOnly && ['pricing', 'products'].includes(draft.step) ? 'delivery'
      : serviceOnly ? (!result.case && ['delivery', 'payment', 'confirmation'].includes(draft.step) ? 'delivery' : draft.step)
        : requiredPartnerWizardStep(requested, Boolean(result.case), pricingReady);
    if (required !== draft.step) onChange({ ...draft, step: required });
  }, [draft, onChange, pricingReady, result.case]);

  React.useEffect(() => {
    setConfirmationSent(false);
  }, [result.case?.owner.caseId, result.case?.owner.revision]);

  // The technical editor already collected retail prices. Enter pricing directly,
  // number the case once, and keep retries on the submission controller's identity.
  const requestInitialPricing = useCallback(async () => {
    if (initialPricingFlight.current || recovery.state !== 'writable' ||
      submission.getSnapshot().case || ['submitting', 'uncertain'].includes(submission.getSnapshot().phase)) return;
    initialPricingFlight.current = true;
    setError(null); setQuotePending(true);
    try {
      const prepared = onPreparePricingQuote ? await onPreparePricingQuote(draft) : draft;
      if (!canonicalRetailReady && !onPreparePricingQuote) throw new Error('Quote unavailable');
      const pricedSummary = partnerRetailSummary(prepared.rows, prepared.intent.retailDiscount, prepared.serviceRows);
      if (!pricedSummary.valid) { setError(pricedSummary.message); return; }
      if (pricedSummary.loss && !prepared.intent.belowCostConfirmed) {
        setError('زیان فروش را بررسی و تأیید کنید.'); return;
      }
      await submission.submit(intentWithPricingRequest(prepared));
      const created = submission.getSnapshot();
      if (created.phase === 'created' && created.case) onCaseNumbered?.(created.case.owner.caseId);
    } catch {
      setError('ارسال استعلام انجام نشد؛ دوباره تلاش کنید. اطلاعات محصولات حفظ شده است.');
    } finally { initialPricingFlight.current = false; setQuotePending(false); }
  }, [canonicalRetailReady, draft, onCaseNumbered, onPreparePricingQuote, recovery.state, submission]);
  useEffect(() => {
    const serviceOnly = !draft.rows.length && Boolean(draft.serviceRows?.length);
    if (recovery.state !== 'writable' || result.case || mutatePending ||
      !(draft.step === 'pricing' || serviceOnly && draft.step === 'delivery')) return;
    const attemptKey = draft.intent.recoveryId;
    if (initialPricingAttempt.current === attemptKey) return;
    initialPricingAttempt.current = attemptKey;
    void requestInitialPricing();
  }, [draft.step, draft.intent.recoveryId, draft.rows.length, draft.serviceRows?.length, recovery.state, result.case, mutatePending, requestInitialPricing]);

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
    const target = visibleSteps[index]?.id;
    if (!target) return;
    setError(null);
    if (target === 'products' && onEditProducts) { onEditProducts(); return; }
    onChange({ ...draft, step: target === 'products' ? 'pricing' : target });
    requestAnimationFrame(() => heading.current?.focus());
  };
  const currentIntent = (preparationCompleted: boolean): PartnerDraftIntent => {
    const rows = draft.rows.map(row => {
      if (row.parentProductRowId || isUsableInquiryRow(row.inquiryRow, now) && !mismatchedRowIds.includes(row.inquiryRow.rowId)) return row;
      const { approvedRowBinding: _binding, ...inquiryRow } = row.inquiryRow;
      return { ...row, inquiryRow };
    });
    const usableMaterials = new Map((draft.materialInquiryRows ?? []).filter(({ inquiryRow }) =>
      isUsableInquiryRow(inquiryRow, now) && !mismatchedRowIds.includes(inquiryRow.rowId))
      .map(({ pricingSubjectId, inquiryRow }) => [pricingSubjectId, inquiryRow.approvedRowBinding]));
    return { ...draft.intent, preparationCompleted, rows: partnerRetailIntentRows(rows),
      additionalMaterialApprovals: draft.intent.additionalMaterialApprovals?.filter(binding =>
        usableMaterials.has(binding.pricingSubjectId)),
      deliveries: draft.intent.deliveries };
  };
  const submit = async () => {
    if (disabled || stepIndex < 0) return;
    const invalid = visibleSteps.map(step => ({ step, failure: validateWizardStep(step.id, draft) })).find(item => item.failure);
    if (invalid) { onChange({ ...draft, step: invalid.step.id }); setError(invalid.failure); return; }
    if (!summary.valid) { onChange({ ...draft, step: draft.rows.length ? 'pricing' : 'delivery' }); setError(summary.message); return; }
    if (summary.loss && !draft.intent.belowCostConfirmed) {
      onChange({ ...draft, step: draft.rows.length ? 'pricing' : 'delivery' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
    }
    const ids = [...draft.rows.map(row => row.productRowId), ...(draft.serviceRows ?? []).map(row => row.serviceRowId)];
    if (!ids.length || new Set(ids).size !== ids.length) {
      setError('حداقل یک محصول کامل و بدون ردیف تکراری لازم است.'); return;
    }

    const intent = currentIntent(true);
    try {
      await saveCompletedPartnerDraft(submission, intent, caseId => {
        onChange({ ...draft, intent });
        setError(null);
        return onOpenCase(caseId);
      });
    } catch { setError('پیش‌نویس ذخیره شده است؛ باز کردن جزئیات را دوباره امتحان کنید.'); }
  };
  const commit = async () => {
    if (disabled || !pricingReady || !summary.valid || summary.wholesale === undefined) return;
    const invalid = visibleSteps.map(step => ({ step, failure: validateWizardStep(step.id, draft) })).find(item => item.failure);
    if (invalid) { setCommitOpen(false); onChange({ ...draft, step: invalid.step.id }); setError(invalid.failure); return; }
    if (summary.loss && !draft.intent.belowCostConfirmed) {
      setCommitOpen(false); onChange({ ...draft, step: draft.rows.length ? 'pricing' : 'delivery' });
      setError('زیان فروش را بررسی و تأیید کنید.'); return;
    }
    setActionPending(true); setError(null);
    try {
      await submission.submit(currentIntent(true));
      const saved = submission.getSnapshot();
      if (saved.phase !== 'created' || !saved.case || saved.case.pricingState !== 'READY_TO_FINALIZE') return;
      await onFinalize?.(saved.case);
      setCommitOpen(false);
    } catch { setError('نهایی‌سازی انجام نشد؛ پیش‌نویس حفظ شده است. وضعیت قیمت‌ها را بررسی و دوباره تلاش کنید.'); }
    finally { setActionPending(false); }
  };
  const acceptPrices = async () => {
    if (disabled || !pricingReady) return;
    // A completed preparation must still agree with the edited graph before accepting prices.
    const invalid = (draft.intent.preparationCompleted || draft.intent.deliveries.length || draft.intent.customerPaymentPlan.installments.length)
      ? ['delivery', 'payment'].map(id => ({ step: id as PartnerWizardDraft['step'], failure: validateWizardStep(id as PartnerWizardDraft['step'], draft) })).find(item => item.failure)
      : undefined;
    if (invalid) {
      onChange({ ...draft, step: invalid.step, intent: { ...draft.intent, preparationCompleted: false } });
      setError(invalid.failure); return;
    }
    setActionPending(true); setError(null);
    try {
      await submission.submit(currentIntent(Boolean(draft.intent.preparationCompleted)));
      const saved = submission.getSnapshot();
      if (saved.phase === 'created' && saved.case?.pricingState === 'READY_TO_FINALIZE') setPricingDecision('accepted');
    } finally { setActionPending(false); }
  };
  const openDecisionContract = async () => {
    const caseId = submission.getSnapshot().case?.owner.caseId;
    if (!caseId || actionPending) return;
    setActionPending(true);
    try { await onOpenCase(caseId); }
    catch { setError('تصمیم قیمت ثبت شده است؛ باز کردن قرارداد انجام نشد. دوباره تلاش کنید.'); }
    finally { setActionPending(false); }
  };

  const next = async () => {
    if (disabled || requiresReview || stepIndex < 0) return;
    const failure = validateWizardStep(draft.step, draft);
    if (failure) {
      if (draft.step === 'payment') paymentValidationError.current = failure;
      setError(failure); return;
    }
    if (draft.step === 'confirmation' && !summary.valid) {
      setError(summary.message); return;
    }
    if (draft.step === 'confirmation' && summary.loss && !draft.intent.belowCostConfirmed) {
      onChange({ ...draft, step: draft.rows.length ? 'pricing' : 'delivery' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
    }
    if (!result.case && (draft.step === 'pricing' || !draft.rows.length && draft.step === 'delivery')) {
      await requestInitialPricing(); return;
    }
    if (stepIndex < visibleSteps.length - 1) { move(stepIndex + 1); return; }
    await submit();
  };
  const sendConfirmation = async () => {
    if (!onSendConfirmation || !result.case || confirmationFlight.current || disabled) return;
    confirmationFlight.current = true;
    setActionPending(true); setError(null);
    try { await onSendConfirmation(result.case.owner.caseId); setConfirmationSent(true); }
    catch (failure) { setError(partnerSalesActionFeedback(failure, 'ارسال پیامک تأیید').message); }
    finally { confirmationFlight.current = false; setActionPending(false); }
  };
  return <ContractWizardFrame
    title="ایجاد قرارداد همکار"
    currentStep={stepIndex + 1}
    steps={visiblePresentationSteps}
    clickableSteps={Boolean(result.case)}
    onStepClick={step => move(step - 1)}
    notices={<div className="mb-4 space-y-3">
      {correctionReason && <ErpInlineState kind="stale" title={contractCorrectionBannerTitle(correctionReason)} />}
      {['pricing', 'confirmation'].includes(draft.step) && result.case && compactStatus && <ErpCard className="flex flex-wrap items-center gap-2 p-2">
        <span className="text-sm font-bold">{partnerTrackingCode(result.case.caseNumber, result.case.trackingNumber)}</span>
        <ErpBadge tone="neutral">قرارداد: {compactStatus.contract}</ErpBadge>
        <ErpBadge tone={pricingReady || result.case.pricingState === 'READY_TO_FINALIZE' ? 'success' : rejectedRows.length ? 'danger' : 'warning'}>
          قیمت سبلان: {pricingStatus}
        </ErpBadge>
        <ErpBadge tone={!confirmationSent && result.case.customerConfirmationState === 'APPROVED' ? 'success'
          : !confirmationSent && result.case.customerConfirmationState === 'REJECTED' ? 'danger' : 'info'}>
          مشتری: {confirmationSent ? 'ارسال‌شده، بدون پاسخ' : compactStatus.customer}
        </ErpBadge>
        {onSendConfirmation && draft.intent.preparationCompleted && result.case.customerConfirmationState !== 'APPROVED' &&
          <ErpButton variant={customerNotSent ? 'solid' : 'outline'} label="ارسال پیامک تأیید"
            disabled={disabled} onClick={() => void sendConfirmation()} />}
        <ErpButton variant={customerNotSent ? 'outline' : 'solid'} label="باز کردن پرونده" disabled={disabled} onClick={() => {
          void Promise.resolve().then(() => onOpenCase(result.case!.owner.caseId))
            .catch(() => setError('پرونده ذخیره شده است؛ باز کردن جزئیات را دوباره امتحان کنید.'));
        }} />
      </ErpCard>}
      {result.phase === 'created' && result.message && <ErpInlineState kind="stale" title={result.message}
        action={{ label: 'تلاش مجدد برای پاک‌سازی بازیابی', onClick: () => void submission.retry() }} />}
      {draft.step === 'pricing' && waitingForSabalan && <ErpInlineState kind="empty"
        title="استعلام قیمت برای فروشنده سبلان ارسال شده است و در وظایف بین‌واحدی او قرار دارد. پس از ثبت پاسخ، قیمت خرید شما در همین پرونده نمایش داده می‌شود." />}
      {unsentRows.some(row => row.inquiryRow.submissionState === 'UNSENT') && <ErpInlineState kind="stale"
        title="محصول اصلاح‌شده ذخیره شده است. برای دریافت قیمت تازه، استعلام همان محصول را ارسال کنید." />}
      {result.phase === 'uncertain' && <ErpInlineState kind="stale" title={result.message || 'نتیجه ثبت را با همان درخواست بررسی کنید.'} action={{ label: 'بررسی نتیجه ثبت', onClick: () => void submission.retry() }} />}
      {submissionError && <ErpInlineState kind="error" title={submissionError} />}
      {externalError && !error && <ErpInlineState kind="error" title={externalError} />}
      {error && <ErpInlineState kind="error" title={error} />}
    </div>}
    navigation={{
      onPrevious: () => move(stepIndex - 1),
      onNext: next,
      onSubmit: submit,
      loading: mutatePending || quotePending || actionPending,
      canGoPrevious: !disabled && stepIndex > 0,
      canGoNext: !disabled && !requiresReview && (Boolean(result.case) || ['date', 'customer', 'project'].includes(draft.step)),
      showSubmitOnEveryStep: false,
      labels: {
        next: draft.step === 'products' ? (result.case ? 'مشاهده نتیجه استعلام' : 'ارسال برای استعلام قیمت')
          : draft.step === 'pricing' ? 'مرحله بعدی' : 'بعدی',
        submit: draft.step === 'confirmation' ? 'ثبت یادداشت قرارداد' : 'ثبت پرونده',
      }
    }}
  >
    <div className="min-w-0 space-y-4" aria-label="ایجاد پرونده فروش همکار">
      <h2 ref={heading} tabIndex={-1} className={['date', 'customer', 'project', 'products'].includes(draft.step) ? 'sr-only' : 'text-lg font-bold'}>{visibleSteps[stepIndex]?.label}</h2>
      {draft.intent.preparationCompleted && <ErpInlineState kind="success" title="اطلاعات قرارداد تکمیل شده است؛ تغییرات این مرحله با «ثبت یادداشت قرارداد» ذخیره می‌شود." />}
      <ErpSheet open={commitOpen} onClose={() => { if (!actionPending) setCommitOpen(false); }} presentation="modal" pending={actionPending}
        title="نهایی‌سازی خرید از سبلان و ایجاد قرارداد مشتری"
        footer={<ErpButton label="پذیرش مبلغ خرید و نهایی‌سازی" disabled={disabled || !pricingReady || !summary.valid || summary.wholesale === undefined} onClick={() => void commit()} />}>
        <ErpFieldView label="فروش به مشتری" value={summary.valid ? formatPartnerMoney(summary.retail, draft.intent.retailDiscount.currency) : '—'} />
        <ErpFieldView label="خرید از سبلان" value={summary.valid && summary.wholesale !== undefined ? formatPartnerMoney(summary.wholesale, draft.intent.retailDiscount.currency) : 'در حال محاسبه'} />
        <ErpInlineState kind="stale" title="با تأیید، تعهد خرید شما از سبلان ثبت و قرارداد مشتری ایجاد می‌شود." />
        {!pricingReady && <ErpInlineState kind="stale" title="قیمت‌ها دیگر معتبر نیستند؛ استعلام را بررسی کنید." />}
      </ErpSheet>
      <ErpSheet open={Boolean(rejectTarget)} onClose={() => { if (!actionPending) setRejectTarget(undefined); }} presentation="modal" pending={actionPending}
        title="رد قیمت پیشنهادی" footer={<ErpButton label="ارسال درخواست قیمت مجدد" disabled={disabled || !rejectReason.trim()} onClick={() => {
          if (!rejectTarget || !onRejectPrice) return;
          setActionPending(true);
          void onRejectPrice(rejectTarget, rejectReason.trim()).then(() => { setRejectTarget(undefined); setPricingDecision('rejected'); })
            .catch(() => setError('درخواست قیمت مجدد ثبت نشد؛ دوباره تلاش کنید.')).finally(() => setActionPending(false));
        }} />}>
        <ErpTextarea aria-label="دلیل رد قیمت" value={rejectReason} onChange={event => setRejectReason(event.target.value)} />
      </ErpSheet>
      <ErpSheet open={Boolean(pricingDecision)} presentation="modal" pending={actionPending}
        onClose={() => void openDecisionContract()}
        title={pricingDecision === 'accepted' ? 'پذیرش قیمت‌های سبلان ثبت شد' : 'رد پیشنهاد قیمت ثبت شد'}
        footer={<ErpButton label="مشاهده قرارداد" disabled={actionPending} onClick={() => void openDecisionContract()} />}>
        <ErpInlineState kind="success" title={pricingDecision === 'accepted'
          ? 'قیمت‌های پیشنهادی سبلان با موفقیت پذیرفته شدند.'
          : 'پیشنهاد قیمت رد شد و درخواست پیشنهاد مجدد برای سبلان ارسال شد.'} />
        {error && <ErpInlineState kind="error" title={error} />}
      </ErpSheet>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {(['products', 'pricing'].includes(draft.step) || !draft.rows.length && draft.step === 'delivery') && <div className="space-y-4">
          <PartnerRetailStep rows={draft.rows} serviceRows={draft.serviceRows} discount={draft.intent.retailDiscount}
            belowCostConfirmed={draft.intent.belowCostConfirmed} disabled={disabled} summaryOnly
            onRowsChange={updateRetail} onConfirmLoss={belowCostConfirmed => onChange({ ...draft, intent: { ...draft.intent, belowCostConfirmed } })} />
          {onEditProducts && <ErpButton label="ویرایش محصولات" variant="outline" disabled={disabled} onClick={onEditProducts} />}
          {!result.case && quotePending && <ErpLoading />}
          {!result.case && !quotePending && !mutatePending && <ErpButton label="تلاش مجدد برای ارسال استعلام" disabled={disabled}
            onClick={() => void requestInitialPricing()} />}
        </div>}
        {draft.step === 'products' || draft.step === 'pricing' ? <section className="space-y-4" aria-label="استعلام قیمت سبلان">
          {result.case && pricingEntries.map(({ id, inquiryRow }) => {
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
              <PartnerInquiryProductFacts configuration={inquiryRow.configuration} />
              <p className="text-sm sds-text-secondary">قیمت پیشنهادی سبلان: <strong className="sds-text-primary">
                {price ? partnerMoneyText(price.amount, price.currency) : '—'}
              </strong></p>
              <PartnerWholesalePricingSummary policy={inquiryRow.wholesaleMandatory} pricing={inquiryRow.wholesalePricing} currency={price?.currency} />
              {rowState === 'EXPIRED' && expiresAt && <p className="text-sm sds-text-secondary">اعتبار تا {expiresAt}</p>}
              {usable && onRejectPrice && <ErpButton label="رد قیمت و درخواست پیشنهاد مجدد" tone="danger" variant="outline" disabled={disabled || inquiryRow.successor?.state === 'PENDING'}
                onClick={() => { setRejectReason(''); setRejectTarget(inquiryRow); }} />}
              {inquiryRow.noteOrReason && <ErpInlineState kind="stale" title={inquiryRow.noteOrReason} />}
              {(inquiryRow.state === 'REJECTED' || unsentRows.some(item => item.id === id)) &&
                inquiryRow.successor?.state !== 'PENDING' && onEditProduct && <ErpButton label="ویرایش این محصول" variant="outline"
                disabled={disabled} onClick={() => onEditProduct(inquiryRow)} />}
              {unsentRows.some(item => item.id === id) && <ErpButton label="استعلام مجدد همین محصول" variant="outline"
                disabled={disabled} onClick={() => onReinquire(inquiryRow)} />}
              {rowReinquiries.some(item => item.id === id) && <ErpButton label="استعلام مجدد" variant="outline"
                disabled={disabled || inquiryRow.successor?.state === 'PENDING'} onClick={() => onReinquire(inquiryRow)} />}
            </ErpCard>;
          })}
          {pricingReady && <ErpButton label={'پذیرش قیمت‌ها'} disabled={disabled} onClick={() => void acceptPrices()} />}
          {result.case && (pricingReady
            ? <ErpInlineState kind="success" title="قیمت همه محصولات دریافت شده است؛ می‌توانید قیمت‌ها را بپذیرید یا مراحل پیش‌نویس را ادامه دهید." />
            : <ErpInlineState kind="empty" title={rejectedRows.length ? 'دلیل رد را بررسی و همان محصول را ویرایش کنید؛ قیمت ردیف‌های دیگر حفظ می‌شود.'
              : expiredRows.length ? 'اعتبار برخی قیمت‌ها پایان یافته است؛ همان ردیف‌ها را دوباره استعلام کنید.'
                : 'در انتظار پاسخ سبلان؛ می‌توانید مراحل تحویل و پرداخت را ادامه دهید.'} />)}
        </section> : renderSection(draft.step, draft, Boolean(error))}
      </fieldset>
    </div>
  </ContractWizardFrame>;
}
