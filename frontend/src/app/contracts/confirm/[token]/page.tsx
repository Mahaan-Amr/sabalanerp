'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { publicContractsAPI } from '@/lib/api';
import ConfirmationContractView, { ConfirmationData } from '../ConfirmationContractView';
import { ErpCard, ErpInlineState, ErpLoading } from '@/components/erp';

export default function TokenContractConfirmationPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => String(params?.token || ''), [params]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [code, setCode] = useState('');
  const [data, setData] = useState<ConfirmationData | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError('');
    try {
      const response = await publicContractsAPI.getConfirmationContract(token);
      if (!response.data.success) {
        setError(response.data.error || 'لینک تایید معتبر نیست');
        setData(null);
        return;
      }
      setData(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در بارگذاری قرارداد');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const verifyCode = async () => {
    if (!code.trim()) {
      setError('کد تایید را وارد کنید');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const response = await publicContractsAPI.verifyConfirmationCode(token, code.trim());
      if (!response.data.success) {
        setError(response.data.error || 'کد تایید صحیح نیست');
        return;
      }
      setSuccess('قرارداد با موفقیت تایید شد');
      await loadData();
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
      const response = await publicContractsAPI.resendConfirmationCode(token);
      if (!response.data.success) {
        setError(response.data.error || 'ارسال مجدد ناموفق بود');
        return;
      }
      setSuccess('کد تایید دوباره ارسال شد');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ارسال مجدد');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <main className="sds-workspace flex min-h-screen items-center justify-center text-primary"><ErpLoading /></main>;
  }

  if (!data) {
    return (
      <main className="sds-workspace flex min-h-screen items-center justify-center p-6 text-primary">
        <ErpCard className="w-full max-w-lg p-6">
          <h1 className="mb-3 text-xl font-bold">خطا در دسترسی به قرارداد</h1>
          <ErpInlineState kind="error" title={error || 'لینک تایید معتبر نیست'} />
        </ErpCard>
      </main>
    );
  }

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
