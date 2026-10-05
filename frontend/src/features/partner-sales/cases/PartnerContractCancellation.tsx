'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpField, ErpInlineState, ErpSection, ErpSheet, ErpTextarea } from '@/components/erp';
import { cancelPartnerCase, reactivatePartnerCase, readPartnerCases, sendPartnerConfirmation } from './partnerCaseHttpPort';
import { partnerSalesActionFeedback } from '../partnerSalesErrorMessage';
import { assertSuccessfulSalesResult } from '@/features/sales/salesOperationalError';
export function PartnerContractCancellation({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [row, setRow] = useState<PartnerCaseRuntimeRow>();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmationFeedback, setConfirmationFeedback] = useState<{ kind: 'success' | 'error'; message: string }>();
  const confirmationFlight = useRef(false);
  const lifecycleFlight = useRef(false);
  const commandId = useRef('');
  const cancelled = row && ['CANCELLED', 'VOIDED'].includes(row.view.state);
  const reload = useCallback(async () => { const next = await readPartnerCases(caseId); setRow(next.find(item => item.view.owner.caseId === caseId)); }, [caseId]);
  useEffect(() => { let active = true; setRow(undefined); void readPartnerCases(caseId).then(rows => { if (active) setRow(rows.find(item => item.view.owner.caseId === caseId)); }).catch(() => { if (active) setRow(undefined); }); return () => { active = false; }; }, [caseId]);
  if (!row || (!row.actions.canCancel && !row.actions.canSendConfirmation && !cancelled)) return null;
  return <ErpSection title="عملیات تأیید قرارداد">
    <div className="flex flex-wrap gap-3">
      {row.actions.canSendConfirmation && <ErpButton label="ارسال پیامک تأیید" tone="primary" disabled={pending} onClick={() => {
        if (confirmationFlight.current) return;
        confirmationFlight.current = true;
        setPending(true); setConfirmationFeedback(undefined);
        void sendPartnerConfirmation(caseId).then(result => {
          assertSuccessfulSalesResult(result);
          setConfirmationFeedback({ kind: 'success', message: 'پیامک تأیید قرارداد برای مشتری ارسال شد.' });
        }).catch(failure => setConfirmationFeedback({ kind: 'error', message: partnerSalesActionFeedback(failure, 'ارسال پیامک تأیید').message }))
          .finally(() => { confirmationFlight.current = false; setPending(false); });
      }} />}
      {row.actions.canCancel && <ErpButton label="لغو قرارداد" tone="danger" disabled={pending} onClick={() => { commandId.current = crypto.randomUUID(); setReason(''); setOpen(true); }} />}
      {cancelled && <ErpButton label="فعال‌سازی قرارداد" tone="success" disabled={pending || !row.actions.canReactivate}
        title={!row.actions.canReactivate ? 'مجوز تازه حسابداری یا تمدید مهلت قرارداد لازم است.' : undefined}
        onClick={() => { commandId.current = crypto.randomUUID(); setReason(''); setOpen(true); }} />}
    </div>
    {confirmationFeedback && <ErpInlineState kind={confirmationFeedback.kind} title={confirmationFeedback.message} />}
    <ErpSheet open={open} onClose={() => { if (!pending) setOpen(false); }} title={cancelled ? 'فعال‌سازی قرارداد' : 'لغو قرارداد'} presentation="modal" pending={pending}
      footer={<ErpButton label={cancelled ? 'تأیید فعال‌سازی قرارداد' : 'تأیید لغو قرارداد'} tone={cancelled ? 'success' : 'danger'} disabled={pending || reason.trim().length < 3} onClick={() => {
        if (lifecycleFlight.current) return;
        lifecycleFlight.current = true; setPending(true); setError(undefined);
        void (cancelled ? reactivatePartnerCase(row, reason.trim(), commandId.current) : cancelPartnerCase(row.view, reason.trim())).then(async result => {
          assertSuccessfulSalesResult(result);
          setOpen(false); await reload();
          if (cancelled) window.location.reload(); else router.refresh();
        }).catch(failure => setError(partnerSalesActionFeedback(failure, cancelled ? 'فعال‌سازی قرارداد' : 'لغو قرارداد').message))
          .finally(() => { lifecycleFlight.current = false; setPending(false); });
      }} /> }>
      <ErpField label={cancelled ? 'دلیل فعال‌سازی' : 'دلیل لغو'}><ErpTextarea value={reason} onChange={event => setReason(event.target.value)} /></ErpField>
      {error && <ErpInlineState kind="error" title={error} />}
    </ErpSheet>
  </ErpSection>;
}
