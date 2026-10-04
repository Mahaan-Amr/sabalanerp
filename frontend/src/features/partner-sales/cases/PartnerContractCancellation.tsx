'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpField, ErpInlineState, ErpSection, ErpSheet, ErpTextarea } from '@/components/erp';
import { cancelPartnerCase, readPartnerCases, sendPartnerConfirmation } from './partnerCaseHttpPort';
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
  useEffect(() => { let active = true; setRow(undefined); void readPartnerCases(caseId).then(rows => { if (active) setRow(rows.find(item => item.view.owner.caseId === caseId)); }).catch(() => { if (active) setRow(undefined); }); return () => { active = false; }; }, [caseId]);
  if (!row || (!row.actions.canCancel && !row.actions.canSendConfirmation)) return null;
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
      {row.actions.canCancel && <ErpButton label="لغو قرارداد" tone="danger" disabled={pending} onClick={() => setOpen(true)} />}
    </div>
    {confirmationFeedback && <ErpInlineState kind={confirmationFeedback.kind} title={confirmationFeedback.message} />}
    <ErpSheet open={open} onClose={() => { if (!pending) setOpen(false); }} title="لغو قرارداد" presentation="modal" pending={pending}
      footer={<ErpButton label="تأیید لغو قرارداد" tone="danger" disabled={pending || reason.trim().length < 3} onClick={() => {
        setPending(true); setError(undefined);
        void cancelPartnerCase(row.view, reason.trim()).then(() => router.replace(`/dashboard/sales/contracts/${encodeURIComponent(row.customerContractId || caseId)}`))
          .catch(failure => setError(partnerSalesActionFeedback(failure, 'لغو قرارداد').message)).finally(() => setPending(false));
      }} /> }>
      <ErpField label="دلیل لغو"><ErpTextarea value={reason} onChange={event => setReason(event.target.value)} /></ErpField>
      {error && <ErpInlineState kind="error" title={error} />}
    </ErpSheet>
  </ErpSection>;
}
