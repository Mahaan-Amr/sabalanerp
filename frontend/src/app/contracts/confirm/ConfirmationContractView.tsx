'use client';
import React, { useState } from 'react';
import { ErpButton, ErpCard, ErpInlineState, ErpInput, ErpSheet } from '@/components/erp';
import ManualContractSummary from './ManualContractSummary';
import type { CustomerContractOutput } from '../../../../../packages/partner-sales-contracts';

type OrdinaryConfirmationData = {
  sessionId: string;
  status: string;
  contractStatus: string;
  commercialFlowVersion?: number;
  verifiedAt?: string | null;
  otpExpiresAt: string;
  linkExpiresAt: string;
  contract: {
    commercialFlowVersion?: number;
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
  sellerFinalized: boolean;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED';
  readOnly: boolean;
  banner: 'CANCELLED' | 'SUPERSEDED' | null;
};
export type ConfirmationData = OrdinaryConfirmationData | RetailConfirmationData;

interface ConfirmationContractViewProps {
  fullManualSummary?: boolean;
  data: ConfirmationData;
  code: string;
  error: string;
  success: string;
  submitting: boolean;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onReject?: () => void;
}

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
  fullManualSummary = false,
  data,
  code,
  error,
  success,
  submitting,
  onCodeChange,
  onVerify,
  onResend,
  onReject
}: ConfirmationContractViewProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const retailData = 'readOnly' in data ? data : null;
  const retail = retailData?.contract;
  const ordinary = retailData ? null : data as OrdinaryConfirmationData;
  const isApproved = retailData ? retailData.decision === 'APPROVED' : ordinary?.status === 'VERIFIED';
  const isRejected = retailData?.decision === 'REJECTED';
  const verifiedDate = formatPersianDate(data.verifiedAt);

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

        {retailData && !retailData.sellerFinalized && <ErpInlineState kind="permission"
          title="پیش‌نویس — هنوز توسط فروشنده نهایی نشده" />}
        {isRejected && <ErpInlineState kind="error" title="رد این نسخه توسط مشتری ثبت شده است." />}

        <ManualContractSummary data={ordinary ?? undefined} customerOutput={retail} />

        {!isApproved && !isRejected && !retailData?.readOnly ? (
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
              {retailData && onReject && <ErpButton label="رد این نسخه" disabled={submitting}
                onClick={() => setRejectOpen(true)} variant="outline" tone="danger" />}
              <ErpButton label="ارسال مجدد کد" disabled={submitting} onClick={onResend} variant="outline" tone="neutral" />
            </div>
            {error && <ErpInlineState kind="error" title={error} className="mt-4" />}
            {success && <ErpInlineState kind="success" title={success} className="mt-4" />}
          </ErpCard>
        ) : isApproved ? (
          <ErpInlineState kind="success" title={verifiedDate ? `تایید شده در تاریخ ${verifiedDate}` : 'تایید شده'} />
        ) : null}
      </div>
      <ErpSheet open={rejectOpen} onClose={() => { if (!submitting) setRejectOpen(false); }}
        title="رد این نسخه قرارداد" presentation="modal" pending={submitting}
        footer={<div className="flex gap-3">
          <ErpButton label="انصراف" disabled={submitting} variant="outline" tone="neutral"
            onClick={() => setRejectOpen(false)} />
          <ErpButton label="بله، این نسخه رد شود" disabled={submitting} tone="danger"
            onClick={() => { setRejectOpen(false); onReject?.(); }} />
        </div>}>
        <ErpInlineState kind="error" title={retailData?.sellerFinalized
          ? 'رد شما ثبت می‌شود، اما تعهد نهایی‌شده فروشنده به سبلان خودکار لغو نمی‌شود و ادامه کار از مسیر رسمی اصلاح یا لغو انجام خواهد شد.'
          : 'با ثبت رد، فروشنده باید نسخه را اصلاح و دوباره برای شما ارسال کند.'} />
      </ErpSheet>
    </main>
  );
}
