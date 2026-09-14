'use client';

import React, { useRef, useState, useSyncExternalStore } from 'react';
import { ErpButton, ErpCard, ErpInlineState, ErpLoading, ErpSheet } from '@/components/erp';
import { FaBuilding, FaCalendarAlt, FaCreditCard, FaSignature, FaTruck, FaUser, FaWarehouse } from 'react-icons/fa';
import { WizardProgressBar, type WizardStep } from '../components/shared/WizardProgressBar';
import { WizardNavigation } from '../components/shared/WizardNavigation';
import { PartnerRetailStep } from './PartnerRetailStep';
import { partnerRetailSummary, partnerRetailIntentRows, type PartnerRetailRow } from './partnerRetail';
import type { PartnerDraftIntent, createPartnerCaseSubmission } from './partnerCaseSubmission';
import { isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';

export type PartnerWizardStep = 'date' | 'customer' | 'project' | 'products' | 'delivery' | 'payment' | 'confirmation';
export interface PartnerWizardDraft {
  intent: PartnerDraftIntent;
  rows: PartnerRetailRow[];
  step: PartnerWizardStep;
}
export type PartnerRecoverySurface =
  | { state: 'loading' }
  | { state: 'writable' }
  | { state: 'offer'; resume: () => Promise<void>; discard: () => Promise<void> }
  | { state: 'takeover'; takeover: () => Promise<void>; discard: () => Promise<void> }
  | { state: 'blocked'; message: string };

const steps: Array<{ id: PartnerWizardStep; label: string; icon: WizardStep['icon'] }> = [
  { id: 'date', label: 'تاریخ قرارداد', icon: FaCalendarAlt },
  { id: 'customer', label: 'انتخاب مشتری', icon: FaUser },
  { id: 'project', label: 'مدیریت پروژه', icon: FaBuilding },
  { id: 'products', label: 'انتخاب محصولات', icon: FaWarehouse },
  { id: 'delivery', label: 'برنامه تحویل', icon: FaTruck },
  { id: 'payment', label: 'روش پرداخت', icon: FaCreditCard },
  { id: 'confirmation', label: 'تأیید دیجیتال', icon: FaSignature },
];

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
  renderSection: (step: Exclude<PartnerWizardStep, 'products'>, draft: PartnerWizardDraft) => React.ReactNode;
  validateStep: (step: PartnerWizardStep, draft: PartnerWizardDraft) => string | null;
  onReinquire: (row: PartnerRetailRow) => void;
  onOpenCase: (caseId: string) => Promise<void> | void;
}

export function PartnerContractWizard({ draft, onChange, recovery, submission, now, mismatchedRowIds = [], renderSection, validateStep, onReinquire, onOpenCase }: PartnerContractWizardProps) {
  const result = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const recoveryFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const stepIndex = steps.findIndex(step => step.id === draft.step);
  const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
  const unusable = draft.rows.filter(row => !isUsableInquiryRow(row.inquiryRow, now)
    || mismatchedRowIds.includes(row.inquiryRow.rowId)
    || row.inquiryRow.configurationRef.productRowId !== row.productRowId
    || row.inquiryRow.configurationRef.recoveryId !== draft.intent.recoveryId);
  const mutatePending = result.phase === 'submitting' || result.phase === 'uncertain';
  const disabled = recovery.state !== 'writable' || mutatePending;

  const recover = async (operation: () => Promise<void>) => {
    if (recoveryFlight.current) return;
    recoveryFlight.current = true; setRecoveryPending(true); setError(null);
    try { await operation(); setDiscardOpen(false); }
    catch { setError('بازیابی انجام نشد؛ اطلاعات قبلی حفظ شده است. دوباره تلاش کنید.'); }
    finally { recoveryFlight.current = false; setRecoveryPending(false); }
  };

  if (result.phase === 'created' && result.case) return <section dir="rtl" className="space-y-4">
    <ErpInlineState kind="success" title={`پرونده ${result.case.caseNumber} ثبت شد.`} />
    {result.message && <ErpInlineState kind="stale" title={result.message} action={{ label: 'تلاش مجدد برای پاک‌سازی بازیابی', onClick: () => void submission.retry() }} />}
    <ErpButton variant="solid" label="باز کردن پرونده" onClick={() => {
      void Promise.resolve().then(() => onOpenCase(result.case!.owner.caseId))
        .catch(() => setError('پرونده ثبت شده است؛ باز کردن جزئیات را دوباره امتحان کنید.'));
    }} />
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;
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
    setError(null); onChange({ ...draft, step: steps[index].id });
    requestAnimationFrame(() => heading.current?.focus());
  };
  const next = () => {
    if (disabled || stepIndex < 0) return;
    const failure = validateStep(draft.step, draft);
    if (failure) { setError(failure); return; }
    if (draft.step === 'products' || draft.step === 'confirmation') {
      if (!summary.valid) { setError(summary.message); return; }
      if (summary.loss && !draft.intent.belowCostConfirmed) {
        onChange({ ...draft, step: 'products' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
      }
    }
    if (stepIndex < steps.length - 1) { move(stepIndex + 1); return; }
    const invalid = steps.map(step => ({ step, failure: validateStep(step.id, draft) })).find(item => item.failure);
    if (invalid) { onChange({ ...draft, step: invalid.step.id }); setError(invalid.failure); return; }
    if (!draft.rows.length || unusable.length || new Set(draft.rows.map(row => row.productRowId)).size !== draft.rows.length) {
      setError('اعتبار قیمت ردیف‌ها را با استعلام مجدد تکمیل کنید.'); return;
    }
    // The visible rows own retail intent. A recovered or updated projection
    // must never submit stale hidden prices or approval bindings.
    void submission.submit({ ...draft.intent, rows: partnerRetailIntentRows(draft.rows) });
  };
  return <section dir="rtl" aria-label="ایجاد پرونده فروش همکار" className="min-w-0 space-y-4">
    <WizardProgressBar currentStep={stepIndex + 1} steps={steps.map((step, index) => ({ id: index + 1,
      title: step.label, titleEn: step.id, icon: step.icon, description: step.label }))} />
    {unusable.map(row => <ErpInlineState key={row.productRowId} kind="stale" title={`قیمت «${row.inquiryRow.description}» نیاز به استعلام مجدد دارد؛ ورودی‌های پرونده حفظ شده‌اند.`}
      action={{ label: 'استعلام مجدد', disabled: mutatePending, onClick: () => onReinquire(row) }} />)}
    {result.phase === 'uncertain' && <ErpInlineState kind="stale" title={result.message || 'نتیجه ثبت را با همان درخواست بررسی کنید.'} action={{ label: 'بررسی نتیجه ثبت', onClick: () => void submission.retry() }} />}
    {result.phase === 'editing' && result.message && <ErpInlineState kind="error" title={result.message} />}
    <ErpCard className="min-w-0 space-y-4 p-4 sm:p-6">
      <h2 ref={heading} tabIndex={-1} className="text-lg font-bold">{steps[stepIndex]?.label}</h2>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {draft.step === 'products' ? <PartnerRetailStep rows={draft.rows} discount={draft.intent.retailDiscount} belowCostConfirmed={draft.intent.belowCostConfirmed} disabled={disabled}
          onRowsChange={updateRetail} onDiscountChange={retailDiscount => onChange({ ...draft, intent: { ...draft.intent, retailDiscount, belowCostConfirmed: false } })}
          onConfirmLoss={belowCostConfirmed => onChange({ ...draft, intent: { ...draft.intent, belowCostConfirmed } })} /> : renderSection(draft.step, draft)}
      </fieldset>
    </ErpCard>
    {error && <ErpInlineState kind="error" title={error} />}
    <WizardNavigation currentStep={stepIndex + 1} totalSteps={steps.length}
      onPrevious={() => move(stepIndex - 1)} onNext={next} onSubmit={next} loading={mutatePending}
      canGoPrevious={!disabled && stepIndex > 0}
      canGoNext={!disabled && !(stepIndex === steps.length - 1 && unusable.length > 0)}
      labels={{ submit: 'ثبت پرونده' }} />
  </section>;
}
