'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { publicContractsAPI } from '@/lib/api';
import { formatPriceWithRial } from '@/lib/numberFormat';

type ConfirmationData = {
  sessionId: string;
  status: string;
  contractStatus: string;
  otpExpiresAt: string;
  linkExpiresAt: string;
  contract: {
    id: string;
    contractNumber: string;
    title: string;
    titlePersian: string;
    contractData: any;
    totalAmount: number;
    currency: string;
    customer: {
      firstName?: string;
      lastName?: string;
      companyName?: string;
      phoneNumber?: string;
    };
    items: any[];
    deliveries: any[];
    payments: any[];
  };
};

export default function PublicContractConfirmationPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => String(params?.token || ''), [params]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [code, setCode] = useState('');
  const [data, setData] = useState<ConfirmationData | null>(null);

  const loadData = async () => {
    if (!token) {
      return;
    }

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
  };

  useEffect(() => {
    loadData();
  }, [token]);

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
      setSuccess('کد تایید مجددا ارسال شد');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'خطا در ارسال مجدد');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">در حال بارگذاری...</div>;
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-slate-800 border border-red-500/40 rounded-xl p-6">
          <h1 className="text-xl font-bold mb-3">خطا در دسترسی به قرارداد</h1>
          <p className="text-red-300">{error || 'لینک تایید معتبر نیست'}</p>
        </div>
      </div>
    );
  }

  const fullName = `${data.contract.customer.firstName || ''} ${data.contract.customer.lastName || ''}`.trim();

  return (
    <div className="min-h-screen bg-slate-900 text-white py-10 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h1 className="text-2xl font-bold mb-2">تایید دیجیتال قرارداد</h1>
          <p className="text-slate-300 text-sm">ثبت کد تایید به منزله قبول و تایید نهایی قرارداد و شرایط مندرج در آن است.</p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 space-y-3">
          <h2 className="text-lg font-semibold">اطلاعات قرارداد</h2>
          <p>شماره قرارداد: <span className="font-semibold">{data.contract.contractNumber}</span></p>
          <p>مشتری: <span className="font-semibold">{fullName || data.contract.customer.companyName || 'مشتری'}</span></p>
          <p>تلفن: <span className="font-semibold">{data.contract.customer.phoneNumber || 'ثبت نشده'}</span></p>
          <p>مبلغ کل: <span className="font-semibold">{formatPriceWithRial(Number(data.contract.totalAmount || 0), data.contract.currency || 'تومان')}</span></p>
          <p>تعداد اقلام: <span className="font-semibold">{data.contract.items?.length || 0}</span></p>
          <p>وضعیت فعلی: <span className="font-semibold">{data.contractStatus}</span></p>
        </div>

        {data.contractStatus !== 'APPROVED' ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold">ورود کد تایید</h2>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 px-4 py-3 text-center tracking-[0.4em]"
              maxLength={8}
              placeholder="کد تایید"
            />
            <div className="flex gap-3">
              <button disabled={submitting} onClick={verifyCode} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
                تایید قرارداد
              </button>
              <button disabled={submitting} onClick={resendCode} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                ارسال مجدد کد
              </button>
            </div>
            {error && <p className="text-red-300 text-sm">{error}</p>}
            {success && <p className="text-emerald-300 text-sm">{success}</p>}
          </div>
        ) : (
          <div className="bg-emerald-900/40 border border-emerald-500/40 rounded-xl p-6">
            قرارداد قبلا تایید شده است.
          </div>
        )}
      </div>
    </div>
  );
}
