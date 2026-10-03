'use client';

import { useEffect, useRef, useState } from 'react';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpField, ErpInlineState, ErpSelect, ErpSheet, ErpTextarea } from '@/components/erp';
import api from '@/lib/api';
import { partnerSalesActionFeedback } from '../partnerSalesErrorMessage';

type Options = { blockers?: { label: string; href: string }[]; pendingProfileId?: string; expectedOwnerUserId: string; profiles: { id: string; label: string }[] };

export function DirectCustomerTransfer({ customerId, onTransferred }: { customerId: string; onTransferred: () => void }) {
  const [options, setOptions] = useState<Options>();
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const commandRef = useRef<{ signature: string; body: Record<string, unknown>; correlationId: string }>();
  useEffect(() => {
    let active = true;
    api.get(`/crm/partner/customer-transfers/direct/options/${encodeURIComponent(customerId)}`)
      .then(response => { if (active) setOptions(response.data.data); }).catch(() => { if (active) setOptions(undefined); });
    return () => { active = false; };
  }, [customerId, optionsRevision]);
  if (!options?.expectedOwnerUserId) return null;
  const submit = async () => {
    if (pending || !profileId || !/[\u0600-\u06ff]/.test(reason)) return;
    setPending(true); setError(undefined);
    try {
      const intent = { schemaVersion: 1, customerId, toProfileId: profileId, expectedOwnerUserId: options.expectedOwnerUserId, reason: reason.trim() };
      const signature = JSON.stringify(intent);
      if (!commandRef.current || commandRef.current.signature !== signature) {
        const commandId = `direct-transfer-${crypto.randomUUID()}`, correlationId = `transfer-${crypto.randomUUID()}`;
        commandRef.current = { signature, correlationId, body: { ...intent, commandId, correlationId, idempotencyKey: commandId, payloadHash: await canonicalHash(intent) } };
      }
      const command = commandRef.current;
      const response = await api.post('/crm/partner/customer-transfers/direct', command.body, { headers: { 'X-Correlation-ID': command.correlationId } });
      if (response.data?.data?.status !== 'APPROVED') throw new Error('Transfer outcome unavailable');
      setOpen(false); setProfileId(''); setReason(''); setOptions(undefined); setOptionsRevision(value => value + 1); commandRef.current = undefined; onTransferred();
    } catch (failure) {
      const feedback = partnerSalesActionFeedback(failure, 'انتقال مشتری');
      setError(feedback.message);
      setOptionsRevision(value => value + 1);
    } finally { setPending(false); }
  };
  return <>
    <ErpButton label="انتقال به همکار" variant="outline" onClick={() => { setOpen(true); setError(undefined); }} />
    <ErpSheet open={open} onClose={() => setOpen(false)} title="انتقال مشتری به فروشنده همکار" presentation="modal" pending={pending}>
      <div className="space-y-4">
        <ErpField label="فروشنده مقصد" required><ErpSelect value={profileId} disabled={pending} onChange={event => setProfileId(event.target.value)}>
          <option value="">انتخاب کنید</option>{options.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
        </ErpSelect></ErpField>
        <ErpField label="دلیل انتقال" required><ErpTextarea value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></ErpField>
        <ErpInlineState kind="stale" title="مالکیت جاری مشتری منتقل می‌شود؛ سوابق قراردادها، مسئولیت پروژه‌ها و اعتبار فروش قبلی حفظ می‌شوند." />
        {options.blockers?.map(blocker => <div key={blocker.href} className="space-y-2"><ErpInlineState kind="stale" title={blocker.label} /><ErpButton label="رسیدگی به پرونده" href={blocker.href} variant="outline" /></div>)}
        {options.pendingProfileId && options.pendingProfileId !== profileId && <ErpInlineState kind="stale" title="یک درخواست انتقال باز وجود دارد؛ ابتدا آن را در مدیریت همکاران تعیین تکلیف کنید یا همان فروشنده مقصد را انتخاب کنید." />}
        {error && <ErpInlineState kind="error" title={error} />}
        <ErpButton label="تأیید و انتقال مشتری" disabled={pending || !profileId || !/[\u0600-\u06ff]/.test(reason) || Boolean(options.blockers?.length) || Boolean(options.pendingProfileId && options.pendingProfileId !== profileId)} onClick={() => void submit()} />
      </div>
    </ErpSheet>
  </>;
}
