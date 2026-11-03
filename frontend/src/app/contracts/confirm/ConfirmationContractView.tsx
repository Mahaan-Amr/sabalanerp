'use client';
import { ErpButton, ErpCard, ErpInlineState, ErpInput } from '@/components/erp';
import { formatPriceWithRial, toFiniteNumber } from '@/lib/numberFormat';
import { normalizeProductFinishing } from '@/features/contract-creation/utils/finishingUtils';
import type { CustomerContractOutput } from '../../../../../packages/partner-sales-contracts';

type OrdinaryConfirmationData = {
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

type RetailConfirmationData = {
  contract: CustomerContractOutput;
  verifiedAt: string | null;
  linkExpiresAt: string;
  readOnly: boolean;
  banner: 'CANCELLED' | 'SUPERSEDED' | null;
};
export type ConfirmationData = OrdinaryConfirmationData | RetailConfirmationData;

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

// Retail wire money is an exact decimal string, including amounts above the
// binary number safe-integer range. Presentation must not reprice or round it.
const formatRetailMoney = (amount: string, currency: string) => {
  const [integer, fraction] = amount.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return `${`${grouped}${fraction ? `٫${fraction}` : ''}`.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])} ${currency}`;
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
  const retailData = 'readOnly' in data ? data : null;
  const retail = retailData?.contract;
  const ordinary = retailData ? null : data as OrdinaryConfirmationData;
  const fullName = `${ordinary?.contract.customer.firstName || ''} ${ordinary?.contract.customer.lastName || ''}`.trim();
  const customerName = retail?.customer.displayName || fullName || ordinary?.contract.customer.companyName || 'مشتری';
  const contractStatus = retailData?.banner === 'CANCELLED' ? 'CANCELLED'
    : retailData?.verifiedAt ? 'APPROVED' : retail?.status || ordinary?.contractStatus || '';
  const isApproved = Boolean(retailData?.readOnly) || ['APPROVED', 'SIGNED', 'PRINTED'].includes(contractStatus);
  const verifiedDate = formatPersianDate(data.verifiedAt);
  const displayItems = retail?.products || (Array.isArray(ordinary?.contract.contractData?.products) && ordinary.contract.contractData.products.length > 0
    ? ordinary.contract.contractData.products : ordinary?.contract.items || []);
  const currency = retail?.totals.currency === 'IRR' ? 'ریال' : retail?.totals.currency === 'IRT' ? 'تومان' : ordinary?.contract.currency || 'تومان';

  return (
    <main className="sds-workspace min-h-screen px-4 py-10 text-primary">
      <div className="mx-auto max-w-5xl space-y-6">
        <ErpCard className="p-6">
          <h1 className="mb-2 text-2xl font-bold">تایید دیجیتال قرارداد</h1>
          <p className="text-secondary">
            لطفا اطلاعات قرارداد را بررسی کنید. ثبت کد پیامک شده به منزله تایید نهایی قرارداد و شرایط درج شده در آن است.
          </p>
        </ErpCard>

        {retailData?.banner && <ErpInlineState kind="stale" title={retailData.banner === 'CANCELLED'
          ? 'این قرارداد لغو شده است؛ نسخه تأییدشده فقط برای مشاهده نگهداری می‌شود.'
          : 'نسخه جدید جایگزین شده است؛ این نسخه تأییدشده فقط برای مشاهده است.'} />}

        <ErpCard className="p-6">
          <h2 className="mb-4 text-xl font-semibold">اطلاعات قرارداد</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p>شماره قرارداد: <span className="font-semibold">{data.contract.contractNumber}</span></p>
            <p>مشتری: <span className="font-semibold">{customerName}</span></p>
            <p>شماره تماس: <span className="font-semibold">{retail?.customer.phone || ordinary?.contract.customer.phoneNumber || 'ثبت نشده'}</span></p>
            <p>مبلغ کل: <span className="font-semibold">{retail ? formatRetailMoney(retail.totals.payable, currency) : formatPriceWithRial(ordinary?.contract.totalAmount, currency)}</span></p>
            <p>تعداد اقلام: <span className="font-semibold">{displayItems.length}</span></p>
            <p>وضعیت: <span className="font-semibold">{statusLabel(contractStatus)}</span></p>
            {retail && <>
              <p>فروشنده: <span className="font-semibold">{retail.seller.displayName}</span></p>
              <p>تلفن فروشنده: <span dir="ltr">{retail.seller.phone}</span></p>
              <p className="sm:col-span-2">نشانی فروشنده: {retail.seller.address}</p>
              <p className="text-xs text-secondary sm:col-span-2">تأمین و تحویل توسط سبلان</p>
            </>}
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
                    const finishing = retail ? null : normalizeProductFinishing(item);
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
                        <td className="py-3">{item.quantity || 0}{retail ? ` ${item.unit}` : ''}</td>
                        <td className="py-3">{retail
                          ? <>{formatRetailMoney(item.retailUnitPrice, currency)} <span className="text-xs text-secondary">برای هر {item.unit}</span></>
                          : formatPriceWithRial(toFiniteNumber(item.totalPrice) || item.price, currency)}</td>
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
