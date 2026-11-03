'use client';
import { ErpButton, ErpCard, ErpField, ErpInlineState, ErpInput } from '@/components/erp';
import { useState } from 'react';
import { publicContractsAPI } from '@/lib/api';
import ConfirmationContractView, { ConfirmationData } from './ConfirmationContractView';

export default function ManualContractConfirmationPage() {
  const [contractNumber, setContractNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [data, setData] = useState<ConfirmationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const lookupContract = async (options?: { preserveMessages?: boolean }) => {
    if (!contractNumber.trim() || !phoneNumber.trim()) {
      setError('شماره قرارداد و شماره تماس را وارد کنید');
      return;
    }

    setLoading(true);
    if (!options?.preserveMessages) {
      setError('');
      setSuccess('');
    }
    try {
      const response = await publicContractsAPI.lookupConfirmationContract(
        contractNumber.trim(),
        phoneNumber.trim()
      );
      if (!response.data.success) {
        setError(response.data.error || 'قرارداد قابل تایید یافت نشد');
        setData(null);
        return;
      }
      setData(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در دریافت قرارداد');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!code.trim()) {
      setError('کد تایید را وارد کنید');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const response = await publicContractsAPI.verifyManualConfirmationCode(
        contractNumber.trim(),
        phoneNumber.trim(),
        code.trim()
      );
      if (!response.data.success) {
        setError(response.data.error || 'کد تایید صحیح نیست');
        return;
      }
      setSuccess('قرارداد با موفقیت تایید شد');
      await lookupContract({ preserveMessages: true });
      setSuccess('قرارداد با موفقیت تایید شد');
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در تایید قرارداد');
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const response = await publicContractsAPI.resendManualConfirmationCode(
        contractNumber.trim(),
        phoneNumber.trim()
      );
      if (!response.data.success) {
        setError(response.data.error || 'ارسال مجدد ناموفق بود');
        return;
      }
      setSuccess('کد تایید دوباره ارسال شد');
      await lookupContract({ preserveMessages: true });
      setSuccess('کد تایید دوباره ارسال شد');
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ارسال مجدد');
    } finally {
      setSubmitting(false);
    }
  };

  if (data) {
    return (
      <ConfirmationContractView
        data={data}
        code={code}
        error={error}
        success={success}
        submitting={submitting}
        onCodeChange={setCode}
        onVerify={verifyCode}
        onResend={resendCode}
      />
    );
  }

  return (
    <main className="sds-workspace flex min-h-screen items-center justify-center px-4 py-10 text-primary">
      <ErpCard className="w-full max-w-xl p-6">
        <h1 className="mb-2 text-2xl font-bold">تایید قرارداد سبلان ERP</h1>
        <p className="mb-6 text-sm text-secondary">
          برای مشاهده قرارداد، شماره قرارداد و شماره تماس دریافت‌کننده پیامک را وارد کنید.
        </p>

        <div className="space-y-4">
          <ErpField label="شماره قرارداد">
            <ErpInput
              value={contractNumber}
              onChange={(event) => setContractNumber(event.target.value)}
              placeholder="مثلا SAL-000001"
            />
          </ErpField>
          <ErpField label="شماره تماس">
            <ErpInput
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              inputMode="tel"
              placeholder="09xxxxxxxxx"
            />
          </ErpField>
          <ErpButton
            label={loading ? 'در حال بررسی...' : 'مشاهده قرارداد'}
            disabled={loading}
            onClick={() => lookupContract()}
            variant="solid"
            className="w-full"
          />
          {error && <ErpInlineState kind="error" title={error} />}
          {success && <ErpInlineState kind="success" title={success} />}
        </div>
      </ErpCard>
    </main>
  );
}
