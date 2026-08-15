'use client';
import { ErpButton, ErpCard, ErpInlineState, ErpInput } from '@/components/erp';
import { formatPriceWithRial, toFiniteNumber } from '@/lib/numberFormat';
import { normalizeProductFinishing } from '@/features/contract-creation/utils/finishingUtils';

export type ConfirmationData = {
  sessionId: string;
  status: string;
  contractStatus: string;
  verifiedAt?: string | null;
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

const formatPersianDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
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
  const verifiedDate = formatPersianDate(data.verifiedAt);
  const displayItems = Array.isArray(data.contract.contractData?.products) && data.contract.contractData.products.length > 0
    ? data.contract.contractData.products
    : data.contract.items || [];

  return (
    <main className="sds-workspace min-h-screen px-4 py-10 text-primary">
      <div className="mx-auto max-w-5xl space-y-6">
        <ErpCard className="p-6">
          <h1 className="mb-2 text-2xl font-bold">تایید دیجیتال قرارداد</h1>
          <p className="text-secondary">
            لطفا اطلاعات قرارداد را بررسی کنید. ثبت کد پیامک شده به منزله تایید نهایی قرارداد و شرایط درج شده در آن است.
          </p>
        </ErpCard>

        <ErpCard className="p-6">
          <h2 className="mb-4 text-xl font-semibold">اطلاعات قرارداد</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p>شماره قرارداد: <span className="font-semibold">{data.contract.contractNumber}</span></p>
            <p>مشتری: <span className="font-semibold">{customerName}</span></p>
            <p>شماره تماس: <span className="font-semibold">{data.contract.customer.phoneNumber || 'ثبت نشده'}</span></p>
            <p>مبلغ کل: <span className="font-semibold">{formatPriceWithRial(data.contract.totalAmount, data.contract.currency || 'تومان')}</span></p>
            <p>تعداد اقلام: <span className="font-semibold">{displayItems.length}</span></p>
            <p>وضعیت: <span className="font-semibold">{statusLabel(data.contractStatus)}</span></p>
          </div>
        </ErpCard>

        {displayItems.length > 0 && (
          <ErpCard className="p-6">
            <h2 className="mb-4 text-xl font-semibold">اقلام قرارداد</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--sds-border-default)] text-secondary">
                    <th className="py-2 text-right">محصول</th>
                    <th className="py-2 text-right">تعداد</th>
                    <th className="py-2 text-right">مبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map((item: any, index: number) => {
                    const finishing = normalizeProductFinishing(item);
                    return (
                      <tr key={item.id || `${item.productId || 'item'}-${index}`} className="border-b border-[var(--sds-border-default)]">
                        <td className="py-3">
                          <div>{item.product?.namePersian || item.product?.name || item.stoneName || item.description || 'محصول'}</div>
                          {finishing && (
                            <div className="mt-1 text-xs text-secondary">
                              {finishing.name || item.finishingName || 'فینیشینگ'}: {finishing.amountLabel} × {finishing.rateLabel}
                            </div>
                          )}
                        </td>
                        <td className="py-3">{item.quantity || 0}</td>
                        <td className="py-3">{formatPriceWithRial(toFiniteNumber(item.totalPrice) || item.price, data.contract.currency || 'تومان')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ErpCard>
        )}

        {!isApproved ? (
          <ErpCard className="p-6">
            <h2 className="mb-3 text-xl font-semibold">ثبت کد تایید</h2>
            <p className="mb-4 text-sm text-secondary">
              بعد از بررسی قرارداد، کد ارسال شده به شماره مشتری را وارد کنید.
            </p>
            <ErpInput
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              className="max-w-sm text-center"
              inputMode="numeric"
              maxLength={8}
              placeholder="کد تایید"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <ErpButton label="تایید قرارداد" disabled={submitting} onClick={onVerify} variant="solid" />
              <ErpButton label="ارسال مجدد کد" disabled={submitting} onClick={onResend} variant="outline" tone="neutral" />
            </div>
            {error && <ErpInlineState kind="error" title={error} className="mt-4" />}
            {success && <ErpInlineState kind="success" title={success} className="mt-4" />}
          </ErpCard>
        ) : (
          <ErpInlineState kind="success" title={verifiedDate ? `تایید شده در تاریخ ${verifiedDate}` : 'تایید شده'} />
        )}
      </div>
    </main>
  );
}
