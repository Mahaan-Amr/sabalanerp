'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErpButton, ErpDisclosure, ErpField, ErpFieldView, ErpInlineState, ErpSelect, ErpSection } from '@/components/erp';
import { salesAPI } from '@/lib/api';
import { assertSuccessfulSalesResponse, getSalesOperationalErrorMessage } from './salesOperationalError';

type Notice = { status: string; canRetry: boolean; canChoosePhone: boolean; availablePhoneNumbers: string[]; defaultPhoneNumber: string | null;
  lastError: string | null; attempts: { id: string; phoneNumber: string; status: string; createdAt: string }[] };
const labels: Record<string, string> = {
  PENDING: 'در انتظار ارسال', SENDING: 'در حال ارسال', RETRY: 'در انتظار تلاش مجدد', SENT: 'پیامک لغو ارسال شد',
  NEEDS_PHONE: 'نیازمند شماره مشتری', NEEDS_SELECTION: 'نیازمند انتخاب شماره مشتری', FAILED: 'ارسال ناموفق',
  UNKNOWN: 'نتیجه ارسال مشخص نیست', SUPPRESSED: 'ارسال پس از فعال‌سازی قرارداد متوقف شد',
};

export function ContractCancellationNotice({ contractId }: { contractId: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [phone, setPhone] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await salesAPI.getCancellationNotice(contractId);
    assertSuccessfulSalesResponse(response);
    const next: Notice | null = response.data.data;
    setNotice(next); setPhone(next?.defaultPhoneNumber || '');
  }, [contractId]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await salesAPI.getCancellationNotice(contractId);
        assertSuccessfulSalesResponse(response);
        if (!active) return;
        const next: Notice | null = response.data.data;
        setNotice(next);
        setPhone(current => next?.availablePhoneNumbers.includes(current) ? current : next?.defaultPhoneNumber || '');
      } catch { /* Keep the last visible delivery evidence during refresh failure. */ }
    };
    setNotice(null); setPhone(''); setError(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [contractId]);
  const retry = async () => {
    if (pending) return;
    setPending(true); setError(null);
    try {
      const response = await salesAPI.retryCancellationNotice(contractId, phone);
      assertSuccessfulSalesResponse(response);
      await load();
    } catch (failure) { setError(getSalesOperationalErrorMessage(failure, {
      failedAction: 'درخواست ارسال اطلاع‌رسانی لغو', nextStep: 'شماره فعال مشتری را بررسی و دوباره تلاش کنید.',
    })); } finally { setPending(false); }
  };
  if (!notice) return null;
  return <ErpSection title="پیامک لغو قرارداد">
    <ErpInlineState kind={notice.status === 'SENT' ? 'success' : ['UNKNOWN', 'FAILED'].includes(notice.status) ? 'error' : 'empty'}
      title={labels[notice.status] || notice.status} />
    {notice.lastError && <ErpInlineState kind="stale" title={notice.lastError} />}
    {notice.canRetry && <>
      {notice.canChoosePhone ? <ErpField label="شماره گیرنده">
        <ErpSelect value={phone} disabled={pending} onChange={event => setPhone(event.target.value)}>
          <option value="">انتخاب شماره</option>
          {notice.availablePhoneNumbers.map(number => <option key={number} value={number}>{number}</option>)}
        </ErpSelect>
      </ErpField> : <ErpFieldView label="شماره گیرنده" value={phone || 'موبایل فعال ثبت نشده است'} />}
      {notice.status === 'UNKNOWN' && <ErpInlineState kind="stale" title="ممکن است پیامک قبلی ارسال شده باشد؛ پیش از تلاش مجدد، وضعیت آن را بررسی کنید." />}
      <div className="flex flex-wrap gap-2">
        <ErpButton label="درخواست ارسال" disabled={pending || !phone} onClick={() => void retry()} />
        <ErpButton label="دریافت دوباره شماره‌ها" variant="ghost" disabled={pending}
          onClick={() => void load().catch(() => setError('دریافت شماره‌ها انجام نشد.'))} />
      </div>
    </>}
    {error && <ErpInlineState kind="error" title={error} />}
    {!!notice.attempts.length && <ErpDisclosure title="سابقه ارسال">
      {notice.attempts.map(attempt => <ErpFieldView key={attempt.id} label={new Date(attempt.createdAt).toLocaleString('fa-IR')}
        value={`${attempt.phoneNumber} — ${labels[attempt.status] || attempt.status}`} />)}
    </ErpDisclosure>}
  </ErpSection>;
}
