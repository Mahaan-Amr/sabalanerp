'use client';

import { useCallback, useEffect, useState } from 'react';
import { canonicalHash, type PartnerDirectActivationViewV4 } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpCombobox, ErpInlineState, ErpSection,
  ErpSheet, ErpSummaryGrid, ErpTextarea } from '@/components/erp';
import { createPartnerDirectActivationHttpPort } from './partnerDirectActivationHttpPort';
import { createPartnerRuntimeCommandPort } from '../workspaces/partnerRuntimeCommandPort';
import { createPartnerManagementHttpPort } from '../management/partnerManagementHttpPort';

const port = createPartnerDirectActivationHttpPort();
const runtimeCommandPort = createPartnerRuntimeCommandPort();
const managementCommandPort = createPartnerManagementHttpPort();

export function UserPartnerActivationSection({ userId }: { userId: string }) {
  const [view, setView] = useState<PartnerDirectActivationViewV4>();
  const [responderId, setResponderId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<'ACTIVE' | 'SUSPENDED' | 'TERMINATED'>();
  const [responderOpen, setResponderOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string }>();
  const load = useCallback(async () => {
    const result = await port.query({ schemaVersion: 4, purpose: 'PARTNER_DIRECT_ACTIVATION', userId });
    if (!result.ok) { if (result.error.code !== 'FORBIDDEN') setMessage({ kind: 'error', text: result.error.message }); return; }
    setView(result.value);
    setResponderId(result.value.subject.responderId ?? result.value.responders[0]?.id ?? '');
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  async function activate() {
    if (!view || !responderId || !confirmed || pending) return;
    setPending(true); setMessage(undefined);
    try {
      const intent = { schemaVersion: 4 as const, type: 'PROFILE_DIRECT_ACTIVATE' as const,
        userId, responderId, expectedUserUpdatedAt: view.subject.userUpdatedAt, consequenceConfirmed: true as const };
      const commandId = crypto.randomUUID();
      const result = await port.execute({ ...intent, commandId, correlationId: commandId,
        idempotency: { actorId: view.actorId, operation: intent.type, targetId: userId,
          key: crypto.randomUUID(), payloadHash: await canonicalHash(intent) } });
      if (!result.ok) { setMessage({ kind: 'error', text: result.error.message }); return; }
      setOpen(false); setConfirmed(false);
      setMessage({ kind: 'success', text: 'حساب به فروشنده همکار فعال تبدیل شد.' });
      await load();
    } finally { setPending(false); }
  }

  async function revertActivation() {
    if (!view?.subject.profileId || !view.subject.profileRevision || !confirmed || pending) return;
    setPending(true); setMessage(undefined);
    try {
      const intent = { schemaVersion: 4 as const, type: 'PROFILE_DIRECT_ACTIVATION_REVERT' as const,
        userId, profileId: view.subject.profileId, expectedProfileRevision: view.subject.profileRevision,
        consequenceConfirmed: true as const };
      const commandId = crypto.randomUUID();
      const result = await port.revert({ ...intent, commandId, correlationId: commandId,
        idempotency: { actorId: view.actorId, operation: intent.type, targetId: intent.profileId,
          key: crypto.randomUUID(), payloadHash: await canonicalHash(intent) } });
      if (!result.ok) { setMessage({ kind: 'error', text: result.error.message }); return; }
      setRevertOpen(false); setConfirmed(false);
      setMessage({ kind: 'success', text: 'تبدیل بازگردانده شد و دسترسی‌های قبلی بازیابی شدند.' });
      await load();
    } finally { setPending(false); }
  }

  async function transitionProfile() {
    if (!view?.subject.profileId || !view.subject.profileRevision || !lifecycleTarget ||
        !/[\u0600-\u06ff]/.test(reason) || pending) return;
    setPending(true); setMessage(undefined);
    try {
      const intent = { schemaVersion: 1 as const, type: 'PROFILE_TRANSITION' as const,
        profileId: view.subject.profileId, expectedRevision: view.subject.profileRevision,
        to: lifecycleTarget, reason: reason.trim(), gateEvidenceIds: [] };
      const commandId = crypto.randomUUID();
      const result = await runtimeCommandPort.execute({ ...intent, commandId, correlationId: commandId,
        idempotency: { actorId: view.actorId, operation: intent.type, targetId: intent.profileId,
          key: crypto.randomUUID(), payloadHash: await canonicalHash(intent) } });
      if (!result.ok) { setMessage({ kind: 'error', text: result.error.message }); return; }
      setLifecycleTarget(undefined); setReason('');
      setMessage({ kind: 'success', text: lifecycleTarget === 'SUSPENDED' ? 'همکاری تعلیق شد.' :
        lifecycleTarget === 'TERMINATED' ? 'همکاری خاتمه یافت.' : 'همکاری دوباره فعال شد.' });
      await load();
    } finally { setPending(false); }
  }

  async function changeResponder() {
    if (!view?.subject.profileId || !view.subject.profileRevision || !responderId ||
        responderId === view.subject.responderId ||
        !/[\u0600-\u06ff]/.test(reason) || pending) return;
    setPending(true); setMessage(undefined);
    try {
      const intent = { schemaVersion: 2 as const, type: 'RESPONDER_ASSIGN' as const,
        profileId: view.subject.profileId, expectedRevision: view.subject.profileRevision,
        responderId, reason: reason.trim() };
      const commandId = crypto.randomUUID();
      const result = await managementCommandPort.execute({ ...intent, commandId, correlationId: commandId,
        idempotency: { actorId: view.actorId, operation: intent.type, targetId: intent.profileId,
          key: crypto.randomUUID(), payloadHash: await canonicalHash(intent) } });
      if (!result.ok) { setMessage({ kind: 'error', text: result.error.message }); return; }
      setResponderOpen(false); setReason('');
      setMessage({ kind: 'success', text: 'پاسخ‌دهنده تغییر کرد و استعلام‌های در انتظار منتقل شدند.' });
      await load();
    } finally { setPending(false); }
  }

  if (!view) return message ? <ErpInlineState kind={message.kind} title={message.text} /> : null;
  const { subject } = view;
  const active = subject.partnerState === 'ACTIVE';
  return <ErpSection title="فروشنده همکار">
    <ErpCard className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ErpBadge tone={active ? 'success' : subject.partnerState === 'SUSPENDED' ? 'warning' : 'neutral'}>
          {active ? 'فروشنده همکار فعال' : subject.partnerState === 'PENDING' ? 'در انتظار تبدیل' :
            subject.partnerState === 'SUSPENDED' ? 'تعلیق‌شده' : subject.partnerState === 'TERMINATED' ? 'خاتمه‌یافته' : 'کاربر عادی'}
        </ErpBadge>
        {subject.canActivate && <ErpButton label="تبدیل به فروشنده همکار" onClick={() => setOpen(true)} />}
        {active && subject.profileId && <ErpButton label="تغییر پاسخ‌دهنده" variant="outline"
          onClick={() => { setReason(''); setResponderOpen(true); }} />}
        {active && <ErpButton label="تعلیق همکاری" variant="outline" tone="warning"
          onClick={() => { setReason(''); setLifecycleTarget('SUSPENDED'); }} />}
        {subject.partnerState === 'SUSPENDED' && <ErpButton label="فعال‌سازی دوباره"
          onClick={() => { setReason(''); setLifecycleTarget('ACTIVE'); }} />}
        {(active || subject.partnerState === 'SUSPENDED') && <ErpButton label="خاتمه همکاری" variant="outline" tone="danger"
          onClick={() => { setReason(''); setLifecycleTarget('TERMINATED'); }} />}
        {subject.canRevert && <ErpButton label="بازگردانی تبدیل" tone="danger" variant="outline"
          onClick={() => { setConfirmed(false); setRevertOpen(true); }} />}
        {subject.priorResponsibilityCount > 0 && <ErpInlineState kind="stale"
          title={`${subject.priorResponsibilityCount.toLocaleString('fa-IR')} مسئولیت داخلی قبلی فقط برای مشاهده و درخواست انتقال باقی مانده است.`} />}
      </div>
      {(active || subject.partnerState === 'SUSPENDED' || subject.partnerState === 'TERMINATED') &&
        <ErpSummaryGrid items={[
          { label: 'مشتریان', value: subject.customerCount.toLocaleString('fa-IR') },
          { label: 'استعلام‌ها', value: subject.inquiryCount.toLocaleString('fa-IR') },
          { label: 'پرونده‌ها', value: subject.caseCount.toLocaleString('fa-IR') },
          { label: 'پاسخ‌دهنده قیمت', value: view.responders.find(row => row.id === subject.responderId)?.label ?? subject.responderId ?? '—' },
          { label: 'تاریخ تبدیل', value: subject.convertedAt ? new Date(subject.convertedAt).toLocaleString('fa-IR') : '—' },
          { label: 'تبدیل‌کننده', value: subject.convertedBy ?? '—' },
        ]} />}
      {message && <ErpInlineState kind={message.kind} title={message.text} />}
      {!subject.canActivate && subject.partnerState === 'NONE' && subject.blocker &&
        <ErpInlineState kind="stale" title={subject.blocker.message} />}
    </ErpCard>
    <ErpSheet open={open} onClose={() => { if (!pending) setOpen(false); }} title="تبدیل به فروشنده همکار"
      presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setOpen(false)} />
        <ErpButton label="تأیید و فعال‌سازی" disabled={pending || !confirmed || !responderId} onClick={() => void activate()} />
      </div>}>
      <div className="space-y-4" dir="rtl">
        <ErpCombobox label="پاسخ‌دهنده قیمت" value={responderId} onChange={setResponderId}
          options={view.responders.map(row => ({ value: row.id, label: row.label }))} disabled={pending} />
        {subject.priorResponsibilityCount > 0 && <ErpInlineState kind="stale"
          title={`${subject.priorResponsibilityCount.toLocaleString('fa-IR')} مسئولیت قبلی فقط برای مشاهده و درخواست انتقال باقی می‌ماند.`} />}
        <ErpCheckbox checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)}
          label="حذف دسترسی‌های داخلی ناسازگار را تأیید می‌کنم." />
      </div>
    </ErpSheet>
    <ErpSheet open={revertOpen} onClose={() => { if (!pending) setRevertOpen(false); }}
      title="بازگردانی تبدیل" presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setRevertOpen(false)} />
        <ErpButton label="تأیید بازگردانی" tone="danger" disabled={pending || !confirmed}
          onClick={() => void revertActivation()} />
      </div>}>
      <ErpCheckbox checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)}
        label="بازگردانی حساب و دسترسی‌های قبلی را تأیید می‌کنم." />
    </ErpSheet>
    <ErpSheet open={responderOpen} onClose={() => { if (!pending) setResponderOpen(false); }}
      title="تغییر پاسخ‌دهنده قیمت" presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setResponderOpen(false)} />
        <ErpButton label="ثبت تغییر" disabled={pending || !responderId || responderId === subject.responderId ||
          !/[\u0600-\u06ff]/.test(reason)}
          onClick={() => void changeResponder()} />
      </div>}>
      <div className="space-y-4" dir="rtl">
        <ErpCombobox label="پاسخ‌دهنده جدید" value={responderId} onChange={setResponderId}
          options={view.responders.map(row => ({ value: row.id, label: row.label }))} disabled={pending} />
        <ErpTextarea value={reason} onChange={event => setReason(event.target.value)} placeholder="دلیل تغییر" maxLength={4000} />
      </div>
    </ErpSheet>
    <ErpSheet open={Boolean(lifecycleTarget)} onClose={() => { if (!pending) setLifecycleTarget(undefined); }}
      title={lifecycleTarget === 'SUSPENDED' ? 'تعلیق همکاری' : lifecycleTarget === 'TERMINATED' ? 'خاتمه همکاری' : 'فعال‌سازی دوباره'}
      presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setLifecycleTarget(undefined)} />
        <ErpButton label="ثبت" tone={lifecycleTarget === 'TERMINATED' ? 'danger' : 'primary'}
          disabled={pending || !/[\u0600-\u06ff]/.test(reason)} onClick={() => void transitionProfile()} />
      </div>}>
      <div className="space-y-4" dir="rtl">
        {lifecycleTarget === 'TERMINATED' && <ErpInlineState kind="stale" title="خاتمه همکاری برگشت‌پذیر نیست؛ سوابق مالی و تحویل حفظ می‌شوند." />}
        <ErpTextarea value={reason} onChange={event => setReason(event.target.value)} placeholder="دلیل" maxLength={4000} />
      </div>
    </ErpSheet>
  </ErpSection>;
}
