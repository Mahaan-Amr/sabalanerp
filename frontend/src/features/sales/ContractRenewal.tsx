'use client';
import { useEffect, useState } from 'react';
import { ErpButton, ErpField, ErpInlineState, ErpSheet, ErpTextarea } from '@/components/erp';
import { salesAPI } from '@/lib/api';
import { assertSuccessfulSalesResponse, getSalesOperationalErrorMessage } from './salesOperationalError';

export function ContractRenewal({ contractId, onClose, onRenewed }: {
  contractId: string | null;
  onClose: () => void;
  onRenewed: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(''); setError(null); }, [contractId]);
  const renew = async () => {
    if (!contractId || pending || !reason.trim()) return;
    setPending(true); setError(null);
    try {
      assertSuccessfulSalesResponse(await salesAPI.renewContract(contractId, reason.trim()));
      onClose();
      await onRenewed();
    } catch (failure) {
      setError(getSalesOperationalErrorMessage(failure, { failedAction: 'تمدید مهلت قرارداد', nextStep: 'اطلاعات قرارداد را تازه‌سازی و دوباره تلاش کنید.' }));
    } finally { setPending(false); }
  };
  return <ErpSheet open={!!contractId} onClose={onClose} title="تمدید مهلت قرارداد" presentation="modal" pending={pending}
    footer={<ErpButton label="تمدید و بازگشت به یادداشت" tone="primary" disabled={!reason.trim() || pending} onClick={() => void renew()} />}>
    <ErpInlineState kind="empty" title="تأیید فروش و امضای مشتری برای نسخه جاری باید دوباره ثبت شوند." />
    <ErpField label="دلیل تمدید" required>
      <ErpTextarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} />
    </ErpField>
    {error && <ErpInlineState kind="error" title={error} />}
  </ErpSheet>;
}
