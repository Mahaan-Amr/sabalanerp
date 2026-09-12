'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { canonicalHash, type PartnerActivationViewV3 } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpSection,
  ErpSelect, ErpSummaryGrid } from '@/components/erp';
import { createPartnerActivationHttpPort } from './partnerActivationHttpPort';
import { createPartnerOperationsHttpPort } from './partnerOperationsHttpPort';
import { activationOperationAvailability } from './activationUiPolicy';

const port = createPartnerActivationHttpPort();
const operations = createPartnerOperationsHttpPort();
const uid = () => crypto.randomUUID();

export function PartnerActivationPanel() {
  const [view, setView] = useState<PartnerActivationViewV3>();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [identityEvidenceId, setIdentityEvidenceId] = useState('');
  const [commercialPolicyId, setCommercialPolicyId] = useState('');
  const [creditPolicyId, setCreditPolicyId] = useState('');
  const [responderId, setResponderId] = useState('');
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  const [cohortName, setCohortName] = useState('فروشندگان همکار');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'stale'; text: string }>();

  const load = useCallback(async (userId?: string) => {
    const result = await port.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION', ...(userId ? { userId } : {}) });
    if (!result.ok) { setMessage({ kind: 'error', text: result.error.message }); return; }
    setView(result.value);
  }, []);

  useEffect(() => { void load(selectedUserId || undefined); }, [load, selectedUserId]);
  const selected = view?.candidates.find(candidate => candidate.userId === selectedUserId);
  const releaseReady = view?.release.status === 'READY';
  const canBootstrap = Boolean(selected && releaseReady && view?.cohort?.enrollmentOpen && identityEvidenceId &&
    commercialPolicyId && creditPolicyId && responderId && conversionConfirmed);
  const activation = view?.subject;
  const canActivate = Boolean(activation?.actions.some(action => action.action === 'PROFILE_ACTIVATE' && action.enabled) &&
    activation.profileId && activation.profileRevision);

  async function bootstrap() {
    if (!view || !selected || !canBootstrap || pending) return;
    setPending(true); setMessage(undefined);
    try {
      const intent = { schemaVersion: 3 as const, type: 'PROFILE_BOOTSTRAP' as const, userId: selected.userId,
        expectedControlRevision: view.release.controlRevision, cohortId: view.cohort!.id,
        cohortName: view.cohort!.name, identityEvidenceId,
        commercialTermsPolicyId: commercialPolicyId, creditTermsPolicyId: creditPolicyId, responderId,
        reason: 'آماده‌سازی کامل حساب برای فعالیت فروشنده همکار' };
      const commandId = uid();
      const result = await port.execute({ ...intent, commandId, correlationId: commandId,
        idempotency: { actorId: view.actorId, operation: intent.type, targetId: selected.userId,
          key: uid(), payloadHash: await canonicalHash(intent) } });
      if (!result.ok) setMessage({ kind: 'error', text: result.error.message });
      else { setMessage({ kind: 'success', text: 'حساب به وضعیت در انتظار تبدیل شد؛ اکنون باید از کنترل عملیات در cohort عضو شود.' }); await load(selected.userId); }
    } finally { setPending(false); }
  }

  async function activate() {
    if (!view || !activation?.profileId || !activation.profileRevision || !canActivate || pending) return;
    setPending(true); setMessage(undefined);
    try {
      const intent = { schemaVersion: 3 as const, type: 'PROFILE_ACTIVATE' as const,
        profileId: activation.profileId, expectedProfileRevision: activation.profileRevision,
        expectedControlRevision: view.release.controlRevision,
        reason: 'فعال‌سازی نهایی فروشنده همکار پس از بازبینی شواهد' };
      const commandId = uid();
      const result = await port.execute({ ...intent, commandId, correlationId: commandId,
        idempotency: { actorId: view.actorId, operation: intent.type, targetId: activation.profileId,
          key: uid(), payloadHash: await canonicalHash(intent) } });
      if (!result.ok) setMessage({ kind: 'error', text: result.error.message });
      else { setMessage({ kind: 'success', text: 'فروشنده همکار فعال شد و مسیرهای کاری خودش را می‌بیند.' }); await load(activation.userId); }
    } finally { setPending(false); }
  }

  async function runOperation(work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>, success: string) {
    if (pending) return;
    setPending(true); setMessage(undefined);
    try {
      const result = await work();
      if (!result.ok) setMessage({ kind: 'error', text: result.error.message });
      else { setMessage({ kind: 'success', text: success }); await load(selectedUserId || activation?.userId); }
    } finally { setPending(false); }
  }

  const operationAvailability = activationOperationAvailability(view);

  return <ErpSection title="راه‌اندازی فروشنده همکار">
    <div className="space-y-4" dir="rtl">
      <ErpCard className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold">آمادگی انتشار</h3>
          <ErpBadge tone={releaseReady ? 'success' : 'warning'}>{releaseReady ? 'آماده' : 'بسته'}</ErpBadge>
        </div>
        {!releaseReady && <ErpInlineState kind="stale" title="فعال‌سازی تا ثبت بسته GO معتبر انتشار بسته می‌ماند." />}
        {view?.release.releaseId && <ErpSummaryGrid items={[{ label: 'نسخه انتشار', value: view.release.releaseId },
          { label: 'اعتبار تا', value: view.release.expiresAt || '—' }]} />}
      </ErpCard>
      {releaseReady && <ErpCard className="space-y-4 p-4">
        <h3 className="font-bold">کنترل مستقل cohort و عملیات</h3>
        {!view?.cohort ? <div className="flex flex-wrap items-end gap-3">
          <ErpField label="نام cohort" required><ErpInput value={cohortName} disabled={pending}
            onChange={event => setCohortName(event.target.value)} /></ErpField>
          <ErpButton label="تعریف cohort" disabled={pending || !cohortName.trim()} onClick={() => void runOperation(
            () => operations.defineCohort({ id: `partner-cohort-${uid()}`, name: cohortName,
              expectedRevision: view!.release.controlRevision, reason: 'تعریف cohort فروشندگان همکار پس از آمادگی انتشار' }),
            'cohort تعریف شد و به‌صورت ایمن متوقف باقی ماند.')} />
        </div> : <div className="flex flex-wrap gap-3">
          {operationAvailability.canOpenEnrollment && <ErpButton label="بازکردن عضویت cohort" disabled={pending}
            onClick={() => void runOperation(() => operations.pause({ actorId: view.actorId, kind: 'ENROLLMENT', paused: false,
              expectedRevision: view.release.controlRevision, reason: 'بازکردن کنترل‌شده عضویت فروشندگان همکار' }),
            'عضویت cohort باز شد.')} />}
          {operationAvailability.canEnroll && activation && <ErpButton label="عضوکردن فروشنده در cohort"
            disabled={pending} onClick={() => void runOperation(() => operations.enroll({ sellerId: activation.userId,
              expectedRevision: view.release.controlRevision, reason: 'عضویت مستقل فروشنده آماده در cohort' }),
            'فروشنده در cohort عضو شد.')} />}
          {operationAvailability.canOpenOperations && activation && <ErpButton label="بازکردن عملیات فروش همکار"
            disabled={pending} onClick={() => void runOperation(() => operations.pause({ actorId: view.actorId,
              kind: 'OPERATIONAL', paused: false, expectedRevision: view.release.controlRevision,
              reason: 'بازکردن عملیات پس از عضویت و کنترل رخدادهای باز' }), 'عملیات فروش همکار باز شد.')} />}
        </div>}
      </ErpCard>}
      {!activation && <ErpCard className="grid gap-4 p-4 lg:grid-cols-2">
        {view?.cohort && !view.cohort.enrollmentOpen && <div className="lg:col-span-2"><ErpInlineState kind="stale"
          title="ثبت‌نام cohort متوقف است؛ ابتدا آن را از کنترل مستقل عملیات و با شواهد آمادگی جاری باز کنید." /></div>}
        <ErpField label="کاربر" required><ErpSelect value={selectedUserId} disabled={pending}
          onChange={event => { const id = event.target.value; setSelectedUserId(id);
            setIdentityEvidenceId('');
            setConversionConfirmed(false); }}>
          <option value="">انتخاب کنید</option>{view?.candidates.map(candidate =>
            <option key={candidate.userId} value={candidate.userId}>{candidate.displayName}</option>)}</ErpSelect></ErpField>
        <ErpField label="هویت تجاری تأییدشده" required hint="برای اشخاص حقیقی و حقوقی، فقط شواهد جاری صادرشده از مسیر معتبر هویت نمایش داده می‌شود؛ داده نمونه production را فعال نمی‌کند."><ErpSelect value={identityEvidenceId} disabled={pending}
          onChange={event => setIdentityEvidenceId(event.target.value)}><option value="">انتخاب کنید</option>
          {view?.identityEvidence.map(option => <option key={option.id} value={option.id}>{option.label} — {option.personType === 'NATURAL' ? 'حقیقی' : 'حقوقی'}</option>)}</ErpSelect></ErpField>
        <ErpField label="شرایط تجاری" required><ErpSelect value={commercialPolicyId} disabled={pending} onChange={event => setCommercialPolicyId(event.target.value)}>
          <option value="">انتخاب کنید</option>{view?.commercialTerms.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</ErpSelect></ErpField>
        <ErpField label="شرایط اعتبار و پرداخت" required><ErpSelect value={creditPolicyId} disabled={pending} onChange={event => setCreditPolicyId(event.target.value)}>
          <option value="">انتخاب کنید</option>{view?.creditTerms.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</ErpSelect></ErpField>
        <ErpField label="پاسخ‌دهنده قیمت" required><ErpSelect value={responderId} disabled={pending} onChange={event => setResponderId(event.target.value)}>
          <option value="">انتخاب کنید</option>{view?.responders.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</ErpSelect></ErpField>
        <div className="space-y-3 lg:col-span-2">
          <ErpInlineState kind="stale" title="این تبدیل، نقش داخلی حساب را به فروشنده همکار تغییر می‌دهد و دسترسی‌های مستقیم فروش، CRM و سایر مجوزهای داخلی را پس از کنترل مسئولیت‌های باز غیرفعال می‌کند. سابقه تصمیم‌ها حفظ می‌شود و فعال‌سازی نهایی برگشت‌پذیرِ عادی نیست." />
          <ErpCheckbox checked={conversionConfirmed} disabled={pending}
            onChange={event => setConversionConfirmed(event.target.checked)}
            label="پیامدهای تبدیل حساب و لغو دسترسی‌های داخلی را بازبینی و تأیید کردم." />
          <ErpButton label="تبدیل حساب به وضعیت در انتظار" disabled={!canBootstrap || pending} onClick={() => void bootstrap()} />
        </div>
      </ErpCard>}
      {activation && <ErpCard className="space-y-4 p-4">
        <h3 className="font-bold">بازبینی نهایی {activation.displayName}</h3>
        {!activation.gates.find(gate => gate.id === 'COHORT')?.ready &&
          <ErpInlineState kind="stale" title="حساب آماده است، اما توقف ثبت‌نام/عملیات فقط باید از کنترل مستقل عملیات و پس از بازبینی رخدادها باز شود." />}
        <div className="grid gap-2 sm:grid-cols-2">{activation.gates.map(gate => <div key={gate.id}
          className="flex items-center justify-between gap-3 rounded-lg border p-3"><span>{gate.label}</span>
          <ErpBadge tone={gate.ready ? 'success' : 'warning'}>{gate.ready ? 'تکمیل' : 'ناقص'}</ErpBadge></div>)}</div>
        <ErpButton label="فعال‌سازی نهایی" disabled={!canActivate || pending} onClick={() => void activate()} />
      </ErpCard>}
      {message && <ErpInlineState kind={message.kind} title={message.text} />}
      <ErpCard className="space-y-3 p-4"><h3 className="font-bold">مسیر کار از دید فروشنده همکار</h3>
        <ol className="list-inside list-decimal space-y-2 sds-text-secondary">
          <li>ورود با حساب خودش و انتخاب «فروش همکار» از داشبورد، سپس «ایجاد فروش همکار».</li>
          <li>ثبت/انتخاب مشتری و محصول در همان فرم و ارسال استعلام قیمت برای پاسخ‌دهنده تعیین‌شده.</li>
          <li>پس از تأیید قیمت، ساخت پرونده فروش همکار و تکمیل شرایط پرداخت و تحویل.</li>
          <li>مشاهده PDF مشتری، وضعیت حسابداری، وصول و تحویل فقط در محدوده پرونده‌های خودش.</li>
        </ol></ErpCard>
    </div>
  </ErpSection>;
}
