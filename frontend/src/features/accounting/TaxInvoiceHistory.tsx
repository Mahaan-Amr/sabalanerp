"use client";

import { useEffect, useState } from "react";
import { ErpBadge, ErpCard, ErpInlineState, ErpSkeleton } from "@/components/erp";
import { accountingAPI } from "@/lib/api";
import { isPrivateClientScopeFailure } from "@/lib/privateClientScope";
import { accountingFailureMessage } from "./accountingUi";

interface TaxAttempt {
  id: string;
  attemptNumber: number;
  requestHash: string;
  safeResponse: unknown;
  receiptNumber: string | null;
  errorCode: string | null;
  status: string;
  attemptedAt: string;
  completedAt: string | null;
}

interface TaxOutboxHistory {
  id: string;
  status: string;
  requestIdentity: string;
  protocolVersion: string;
  payloadHash: string;
  attempts: TaxAttempt[];
}

const attemptStatusFa: Record<string, string> = {
  SUCCEEDED: "موفق",
  FAILED: "ناموفق",
  UNKNOWN: "نتیجه نامشخص",
};
export const taxOutboxStatusFa: Record<string, string> = {
  NEEDS_CHANNEL: "نیازمند کانال",
  PENDING: "در انتظار ارسال",
  PROCESSING: "در حال ارسال",
  RETRY_PENDING: "در انتظار تلاش دوباره",
  SENT: "ارسال‌شده",
  UNKNOWN: "نتیجه نامشخص",
};
const taxAttemptTimeFormat = new Intl.DateTimeFormat("fa-IR", {
  timeZone: "Asia/Tehran",
  dateStyle: "short",
  timeStyle: "short",
  hourCycle: "h23",
});
export const formatTaxAttemptTime = (value: string | null) =>
  value ? taxAttemptTimeFormat.format(new Date(value)) : "—";

export function TaxInvoiceHistory({ invoiceId, onDenied }: {
  invoiceId: string;
  onDenied: (message: string) => void;
}) {
  const [messages, setMessages] = useState<TaxOutboxHistory[]>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    void accountingAPI.getTaxInvoiceAttempts(invoiceId, request.signal).then(response => {
      if (!request.signal.aborted) setMessages(response.data.data.outboxMessages);
    }).catch(reason => {
      if (request.signal.aborted) return;
      const message = accountingFailureMessage(reason, "تاریخچه تلاش‌ها بارگیری نشد.");
      if (isPrivateClientScopeFailure(reason)) onDenied(message);
      else setError(message);
    });
    return () => request.abort();
  }, [invoiceId, onDenied, retry]);

  if (error) return <ErpInlineState kind="error" title={error} action={{ label: "تلاش دوباره", onClick: () => {
    setError(undefined);
    setRetry(current => current + 1);
  } }} />;
  if (!messages) return <ErpSkeleton lines={3} label="در حال بارگیری تاریخچه ارسال" />;
  if (!messages.length) return <ErpInlineState kind="empty" title="تلاش ارسالی ثبت نشده است." />;

  return <div className="grid gap-3">
    {messages.map(message => <ErpCard key={message.id} className="min-w-0 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 break-all font-semibold">درخواست <bdi>{message.requestIdentity}</bdi></h3>
        <ErpBadge tone={message.status === "SENT" ? "success" : "neutral"}>
          {taxOutboxStatusFa[message.status] ?? message.status}
        </ErpBadge>
      </div>
      <p className="text-sm sds-text-secondary">نسخه پروتکل {message.protocolVersion}</p>
      <p className="break-all text-sm">هش محتوای ارسال <bdi>{message.payloadHash}</bdi></p>
      {message.attempts.length ? <ol className="space-y-3">
        {message.attempts.map(attempt => <li key={attempt.id} className="space-y-2 border-t border-[var(--sds-border-subtle)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">تلاش {attempt.attemptNumber.toLocaleString("fa-IR")}</h4>
            <ErpBadge tone={attempt.status === "SUCCEEDED" ? "success" : "warning"}>
              {attemptStatusFa[attempt.status] ?? attempt.status}
            </ErpBadge>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <span>زمان تلاش {formatTaxAttemptTime(attempt.attemptedAt)}</span>
            <span>زمان پایان {formatTaxAttemptTime(attempt.completedAt)}</span>
            {attempt.errorCode && <span className="break-all">کد خطا <bdi>{attempt.errorCode}</bdi></span>}
            {attempt.receiptNumber && <span className="break-all">شماره رسید <bdi>{attempt.receiptNumber}</bdi></span>}
            <span className="break-all md:col-span-2">هش درخواست <bdi>{attempt.requestHash}</bdi></span>
          </div>
          {attempt.safeResponse != null && <div>
            <p className="text-sm sds-text-secondary">پاسخ ثبت‌شده سامانه مالیاتی</p>
            <pre dir="ltr" className="mt-1 whitespace-pre-wrap break-all text-sm">{JSON.stringify(attempt.safeResponse, undefined, 2)}</pre>
          </div>}
        </li>)}
      </ol> : <ErpInlineState kind="empty" title="تلاش ارسالی ثبت نشده است." />}
    </ErpCard>)}
  </div>;
}
