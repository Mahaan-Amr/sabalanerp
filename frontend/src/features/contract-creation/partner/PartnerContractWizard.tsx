'use client';

import React, { useRef, useState, useSyncExternalStore } from 'react';
import { ErpButton, ErpCard, ErpInlineState, ErpLoading, ErpSheet } from '@/components/erp';
import { PartnerRetailStep } from './PartnerRetailStep';
import { partnerRetailSummary, partnerRetailIntentRows, type PartnerRetailRow } from './partnerRetail';
import type { PartnerDraftIntent, createPartnerCaseSubmission } from './partnerCaseSubmission';
import { isUsableInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';

export type PartnerWizardStep = 'customer' | 'retail' | 'delivery' | 'payment' | 'review';
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

const steps: Array<{ id: PartnerWizardStep; label: string }> = [
  { id: 'customer', label: 'مشتری' }, { id: 'retail', label: 'قیمت فروش' },
  { id: 'delivery', label: 'تحویل' }, { id: 'payment', label: 'پرداخت' }, { id: 'review', label: 'بازبینی' },
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
  renderSection: (step: Exclude<PartnerWizardStep, 'retail'>, draft: PartnerWizardDraft) => React.ReactNode;
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
    if (draft.step === 'retail' || draft.step === 'review') {
      if (!summary.valid) { setError(summary.message); return; }
      if (summary.loss && !draft.intent.belowCostConfirmed) {
        onChange({ ...draft, step: 'retail' }); setError('زیان فروش را بررسی و تأیید کنید.'); return;
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
    <ol aria-label="مراحل ایجاد پرونده" className="flex flex-wrap gap-3 text-sm text-[var(--sds-text-secondary)]">
      {steps.map((step, index) => <li key={step.id} aria-current={step.id === draft.step ? 'step' : undefined} className={step.id === draft.step ? 'font-bold text-[var(--sds-accent)]' : ''}>{(index + 1).toLocaleString('fa-IR')} · {step.label}</li>)}
    </ol>
    {unusable.map(row => <ErpInlineState key={row.productRowId} kind="stale" title={`قیمت «${row.inquiryRow.description}» نیاز به استعلام مجدد دارد؛ ورودی‌های پرونده حفظ شده‌اند.`}
      action={{ label: 'استعلام مجدد', disabled: mutatePending, onClick: () => onReinquire(row) }} />)}
    {result.phase === 'uncertain' && <ErpInlineState kind="stale" title={result.message || 'نتیجه ثبت را با همان درخواست بررسی کنید.'} action={{ label: 'بررسی نتیجه ثبت', onClick: () => void submission.retry() }} />}
    {result.phase === 'editing' && result.message && <ErpInlineState kind="error" title={result.message} />}
    <ErpCard className="min-w-0 space-y-4 p-4 sm:p-6">
      <h2 ref={heading} tabIndex={-1} className="text-lg font-bold">{steps[stepIndex]?.label}</h2>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {draft.step === 'retail' ? <PartnerRetailStep rows={draft.rows} discount={draft.intent.retailDiscount} belowCostConfirmed={draft.intent.belowCostConfirmed} disabled={disabled}
          onRowsChange={updateRetail} onDiscountChange={retailDiscount => onChange({ ...draft, intent: { ...draft.intent, retailDiscount, belowCostConfirmed: false } })}
          onConfirmLoss={belowCostConfirmed => onChange({ ...draft, intent: { ...draft.intent, belowCostConfirmed } })} /> : renderSection(draft.step, draft)}
      </fieldset>
    </ErpCard>
    {error && <ErpInlineState kind="error" title={error} />}
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--sds-radius-card)] border border-[var(--sds-border-default)] bg-[var(--sds-surface-panel)] p-4">
      <ErpButton label="قبلی" variant="outline" disabled={disabled || stepIndex <= 0} onClick={() => move(stepIndex - 1)} />
      <ErpButton label={stepIndex === steps.length - 1 ? 'ثبت پرونده' : 'ادامه'} variant="solid" disabled={disabled || (stepIndex === steps.length - 1 && unusable.length > 0)} onClick={next} />
    </div>
  </section>;
}
