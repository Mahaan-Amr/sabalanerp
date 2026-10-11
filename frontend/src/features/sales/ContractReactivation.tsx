'use client';
import { useEffect, useState } from 'react';
import { ErpButton, ErpField, ErpInlineState, ErpSheet, ErpTextarea } from '@/components/erp';
import { salesAPI } from '@/lib/api';
import { assertSuccessfulSalesResponse, getSalesOperationalErrorMessage } from './salesOperationalError';

export type ContractReactivationTarget = { id: string; expectedRevision: number };
export function ContractReactivation({ target, onClose, onReactivated }: {
  target: ContractReactivationTarget | null; onClose: () => void; onReactivated: () => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(''); setError(null); }, [target?.id]);
  const reactivate = async () => {
    if (!target || pending || reason.trim().length < 3) return;
    setPending(true); setError(null);
    try {
      assertSuccessfulSalesResponse(await salesAPI.reactivateContract(target.id, reason.trim(), target.expectedRevision));
      onClose(); onReactivated();
    } catch (failure) {
      setError(getSalesOperationalErrorMessage(failure, { failedAction: 'فعال‌سازی قرارداد', nextStep: 'وضعیت و مجوز قرارداد را بررسی کنید و دوباره تلاش کنید.' }));
    } finally { setPending(false); }
  };
  return <ErpSheet open={!!target} onClose={onClose} title="فعال‌سازی قرارداد" presentation="modal" pending={pending}
    footer={<ErpButton label="فعال‌سازی و ویرایش قرارداد" tone="success" disabled={reason.trim().length < 3 || pending} onClick={() => void reactivate()} />}>
    <ErpInlineState kind="empty" title="قرارداد به یادداشت برمی‌گردد و تأیید فروش و پذیرش مشتری دوباره لازم است." />
    <ErpField label="دلیل فعال‌سازی" required>
      <ErpTextarea value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} disabled={pending} />
    </ErpField>
    {error && <ErpInlineState kind="error" title={error} />}
  </ErpSheet>;
}
