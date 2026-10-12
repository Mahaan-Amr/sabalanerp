'use client';
import { useEffect, useRef, useState } from 'react';
import { ErpButton, ErpField, ErpFieldView, ErpInlineState, ErpLoading, ErpSelect, ErpSheet } from '@/components/erp';
import { salesAPI } from '@/lib/api';
import { assertSuccessfulSalesResponse, getSalesOperationalErrorMessage } from './salesOperationalError';

export function ContractConfirmationResend({ contractId, onClose, onSent }: {
  contractId: string | null; onClose: () => void; onSent: (phoneNumber: string) => void;
}) {
  const [phones, setPhones] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [previousPhone, setPreviousPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = async (id: string) => {
    const request = ++sequence.current;
    setLoading(true); setError(null); setPhones([]); setPhone(''); setPreviousPhone(null);
    try {
      const response = await salesAPI.getConfirmationRecipients(id);
      assertSuccessfulSalesResponse(response);
      if (request !== sequence.current) return;
      const data = response.data.data;
      setPhones(data.availablePhoneNumbers || []);
      setPhone(data.defaultPhoneNumber || '');
      setPreviousPhone(data.sessionStatus === 'PENDING' ? data.phoneNumber : null);
    } catch (failure) {
      if (request === sequence.current) setError(getSalesOperationalErrorMessage(failure, {
        failedAction: 'دریافت شماره گیرنده', nextStep: 'شماره‌های مشتری را دوباره دریافت کنید.'
      }));
    } finally { if (request === sequence.current) setLoading(false); }
  };
  useEffect(() => {
    if (contractId) void load(contractId);
    return () => { sequence.current += 1; };
  }, [contractId]);
  const send = async () => {
    if (!contractId || pending || loading || !phone) return;
    setPending(true); setError(null);
    try {
      const response = await salesAPI.resendConfirmation(contractId, phone);
      assertSuccessfulSalesResponse(response);
      onSent(response.data.data.phoneNumber);
      onClose();
    } catch (failure) {
      setError(getSalesOperationalErrorMessage(failure, {
        failedAction: 'ارسال دوباره کد تأیید', nextStep: 'شماره گیرنده و زمان مجاز ارسال را بررسی کنید و دوباره تلاش کنید.',
        uncertainMutation: true,
      }));
    } finally { setPending(false); }
  };
  return <ErpSheet open={!!contractId} onClose={onClose} title="ارسال دوباره کد تأیید" presentation="modal" pending={pending}
    footer={<ErpButton label="ارسال کد تأیید" tone="primary" disabled={loading || pending || !phone} onClick={() => void send()} />}>
    {loading ? <ErpLoading /> : phones.length > 1 ?
      <ErpField label="شماره گیرنده" required><ErpSelect value={phone} disabled={pending} onChange={event => setPhone(event.target.value)}>
        {phones.map(number => <option key={number} value={number}>{number}</option>)}
      </ErpSelect></ErpField> : <ErpFieldView label="شماره گیرنده" value={phone || 'موبایل فعال و معتبر ثبت نشده است'} />}
    {previousPhone && phone && previousPhone !== phone && <ErpInlineState kind="stale" title="گیرنده تغییر کرده است؛ پس از ارسال موفق، کد و لینک قبلی بی‌اعتبار می‌شوند." />}
    {error && <ErpInlineState kind="error" title={error} />}
    {!loading && <ErpButton label="دریافت دوباره شماره‌ها" variant="ghost" disabled={pending} onClick={() => contractId && void load(contractId)} />}
  </ErpSheet>;
}
