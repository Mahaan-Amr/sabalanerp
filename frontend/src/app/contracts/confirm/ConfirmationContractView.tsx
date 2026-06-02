'use client';

import { formatPriceWithRial, toFiniteNumber } from '@/lib/numberFormat';

export type ConfirmationData = {
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
    totalAmount: number | string | null;
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

interface ConfirmationContractViewProps {
  data: ConfirmationData;
  code: string;
  error: string;
  success: string;
  submitting: boolean;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
}

const statusLabel = (status: string) => {
  if (status === 'APPROVED') return 'تایید شده';
  if (status === 'PENDING_APPROVAL') return 'در انتظار تایید';
  if (status === 'CANCELLED') return 'لغو شده';
  return status || 'نامشخص';
};

export default function ConfirmationContractView({
  data,
  code,
  error,
  success,
  submitting,
  onCodeChange,
  onVerify,
  onResend
}: ConfirmationContractViewProps) {
  const fullName = `${data.contract.customer.firstName || ''} ${data.contract.customer.lastName || ''}`.trim();
  const customerName = fullName || data.contract.customer.companyName || 'مشتری';
  const isApproved = data.contractStatus === 'APPROVED';

  return (
    <div className="min-h-screen px-4 py-10 text-primary">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="glass-liquid-card step-content-card p-6">
          <h1 className="mb-2 text-2xl font-bold">تایید دیجیتال قرارداد</h1>
          <p className="text-secondary">
            لطفا اطلاعات قرارداد را بررسی کنید. ثبت کد پیامک شده به منزله تایید نهایی قرارداد و شرایط درج شده در آن است.
          </p>
        </section>

        <section className="glass-liquid-card step-content-card p-6">
          <h2 className="mb-4 text-xl font-semibold">اطلاعات قرارداد</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p>شماره قرارداد: <span className="font-semibold">{data.contract.contractNumber}</span></p>
            <p>مشتری: <span className="font-semibold">{customerName}</span></p>
            <p>شماره تماس: <span className="font-semibold">{data.contract.customer.phoneNumber || 'ثبت نشده'}</span></p>
            <p>مبلغ کل: <span className="font-semibold">{formatPriceWithRial(data.contract.totalAmount, data.contract.currency || 'تومان')}</span></p>
            <p>تعداد اقلام: <span className="font-semibold">{data.contract.items?.length || 0}</span></p>
            <p>وضعیت: <span className="font-semibold">{statusLabel(data.contractStatus)}</span></p>
          </div>
        </section>

        {data.contract.items?.length > 0 && (
          <section className="glass-liquid-card step-content-card p-6">
            <h2 className="mb-4 text-xl font-semibold">اقلام قرارداد</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-secondary">
                    <th className="py-2 text-right">محصول</th>
                    <th className="py-2 text-right">تعداد</th>
                    <th className="py-2 text-right">مبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contract.items.map((item: any) => (
                    <tr key={item.id} className="border-b border-white/5">
                      <td className="py-3">{item.product?.namePersian || item.product?.name || item.description || 'محصول'}</td>
                      <td className="py-3">{item.quantity || 0}</td>
                      <td className="py-3">{formatPriceWithRial(toFiniteNumber(item.totalPrice) || item.price, data.contract.currency || 'تومان')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!isApproved ? (
          <section className="glass-liquid-card step-content-card p-6">
            <h2 className="mb-3 text-xl font-semibold">ثبت کد تایید</h2>
            <p className="mb-4 text-sm text-secondary">
              بعد از بررسی قرارداد، کد ارسال شده به شماره مشتری را وارد کنید.
            </p>
            <input
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              className="glass-liquid-input max-w-sm text-center"
              inputMode="numeric"
              maxLength={8}
              placeholder="کد تایید"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button disabled={submitting} onClick={onVerify} className="glass-liquid-btn-primary px-6 py-3 disabled:opacity-50">
                تایید قرارداد
              </button>
              <button disabled={submitting} onClick={onResend} className="glass-liquid-btn disabled:opacity-50">
                ارسال مجدد کد
              </button>
            </div>
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            {success && <p className="mt-4 text-sm text-emerald-400">{success}</p>}
          </section>
        ) : (
          <section className="glass-liquid-card step-content-card border-emerald-500/40 p-6 text-emerald-300">
            قرارداد قبلا تایید شده است.
          </section>
        )}
      </div>
    </div>
  );
}
