'use client';

import React from 'react';
import {
  FaBalanceScale,
  FaBell,
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaFileInvoice,
  FaFlag,
  FaMoneyCheckAlt,
  FaReceipt,
  FaTimesCircle
} from 'react-icons/fa';
import { ErpBadge, ErpCard, type ErpTone } from '@/components/erp';
import { formatDisplayNumber, toFiniteNumber } from '@/lib/numberFormat';
import PersianCalendar from '@/lib/persian-calendar';

export type AccountingMetric = {
  count?: number;
  amount?: string;
  urgentCount?: number;
};

export type AccountingContractRow = {
  contractId: string;
  contractNumber: string;
  titlePersian: string;
  createdAt?: string;
  customer: {
    id?: string;
    displayName: string;
    nationalCode?: string;
    economicCode?: string;
  };
  status: string;
  accounting: {
    sourceStatus: string;
    eligibleForFinancialRecords: boolean;
    eligibilityReason?: string;
    invoiceStatus: string;
    receivableStatus: string;
    taxStatus: string;
    openFlags: number;
    openCorrections: number;
    totalContractAmount: string;
    invoicedAmount: string;
    receivedAmount: string;
    remainingAmount: string;
  };
  financialRecords?: Array<{
    id: string;
    kind: string;
    status: string;
    amount: string;
    currency?: string;
    systemInvoiceNumber?: string | null;
    systemInvoiceDate?: string | null;
    financiallyApprovedAt?: string | null;
    createdAt: string;
  }>;
  nextBestActions?: Array<{
    kind: string;
    labelFa: string;
    enabled: boolean;
    disabledReason?: string;
  }>;
};

export const contractStatusLabels: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده',
};

export const contractStatusTones: Record<string, ErpTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  SIGNED: 'success',
  PRINTED: 'purple',
  CANCELLED: 'danger',
  EXPIRED: 'neutral',
};

export const invoiceStatusLabels: Record<string, string> = {
  NONE: 'بدون صورتحساب',
  DRAFT: 'پیش‌نویس',
  READY: 'آماده بررسی',
  APPROVED_FOR_ISSUE: 'آماده صدور',
  ISSUED: 'صادر شده',
  VOIDED: 'باطل شده',
};

export const receivableStatusLabels: Record<string, string> = {
  NONE: 'بدون دریافتنی',
  OPEN: 'باز',
  PARTIALLY_PAID: 'پرداخت بخشی',
  SETTLED: 'تسویه شده',
  OVERDUE: 'سررسید گذشته',
  VOIDED: 'باطل شده',
};

export const taxStatusLabels: Record<string, string> = {
  NOT_READY: 'آماده نیست',
  READY: 'آماده',
  MISSING_DATA: 'اطلاعات ناقص',
  NOT_REQUIRED: 'غیرمشمول',
  SUBMITTED_MANUALLY: 'ثبت دستی',
  SUBMITTED_EXTERNALLY: 'ارسال بیرونی',
  ACCEPTED: 'پذیرفته شده',
  REJECTED: 'رد شده',
  NEEDS_CORRECTION: 'نیازمند اصلاح',
};

export const sourceStatusLabels: Record<string, string> = {
  VISIBLE_ONLY: 'فقط قابل مشاهده',
  ELIGIBLE: 'آماده اقدام مالی',
  HAS_FINANCIAL_RECORDS: 'دارای رکورد مالی',
  BLOCKED: 'مسدود',
  NEEDS_CORRECTION: 'نیازمند اصلاح',
};

const normalizeCurrency = (currency?: string | null): 'toman' | 'rial' => {
  const normalized = String(currency || '').trim().toLowerCase();
  if (normalized === 'rial' || normalized === 'irr' || normalized === 'ریال') return 'rial';
  return 'toman';
};

export const money = (amount?: string | number | null, currency = 'تومان') => {
  const value = toFiniteNumber(amount);
  const unit = normalizeCurrency(currency);
  const convertedValue = unit === 'toman' ? value * 10 : value / 10;

  if (unit === 'rial') {
    return `${formatDisplayNumber(value)} ریال (${formatDisplayNumber(convertedValue)} تومان)`;
  }

  return `${formatDisplayNumber(value)} تومان (${formatDisplayNumber(convertedValue)} ریال)`;
};

export const dateFa = (value?: string | Date | null) => {
  if (!value) return '—';
  return PersianCalendar.formatForDisplay(String(value));
};

export const toneForStatus = (status?: string): ErpTone => {
  if (!status) return 'neutral';
  if (['SIGNED', 'SETTLED', 'ACCEPTED', 'READY', 'CLEARED', 'RECONCILED'].includes(status)) return 'success';
  if (['APPROVED', 'ISSUED', 'OPEN', 'RECEIVED', 'SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'].includes(status)) return 'info';
  if (['PENDING_APPROVAL', 'DRAFT', 'PARTIALLY_PAID', 'RECEIVED', 'DEPOSITED'].includes(status)) return 'warning';
  if (['CANCELLED', 'VOIDED', 'OVERDUE', 'REJECTED', 'NEEDS_CORRECTION', 'BOUNCED', 'DISPUTED'].includes(status)) return 'danger';
  return 'neutral';
};

export function StatusBadge({ label, status, tone }: { label?: string; status?: string; tone?: ErpTone }) {
  return (
    <ErpBadge tone={tone || toneForStatus(status)}>
      {label || (status ? taxStatusLabels[status] || receivableStatusLabels[status] || invoiceStatusLabels[status] || contractStatusLabels[status] || status : '—')}
    </ErpBadge>
  );
}

export function QueueList<T>({
  title,
  items,
  emptyText,
  renderItem,
}: {
  title: string;
  items: T[];
  emptyText: string;
  renderItem: (item: T) => React.ReactNode;
}) {
  return (
    <ErpCard className="p-4">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{emptyText}</p>
        ) : (
          items.map(renderItem)
        )}
      </div>
    </ErpCard>
  );
}

export function CompactQueueItem({
  icon: Icon,
  title,
  meta,
  amount,
  status,
  footer,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  meta?: React.ReactNode;
  amount?: React.ReactNode;
  status?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const DisplayIcon = Icon || FaBell;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#074747]/10 text-[#074747] dark:bg-teal-900/30 dark:text-teal-100">
          <DisplayIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
            {status}
          </div>
          {meta && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{meta}</p>}
          {amount && <p className="mt-2 text-sm font-semibold text-[#074747] dark:text-teal-200">{amount}</p>}
          {footer && <div className="mt-3">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export const accountingIcons = {
  invoice: FaFileInvoice,
  receivable: FaReceipt,
  payment: FaMoneyCheckAlt,
  tax: FaBalanceScale,
  correction: FaExclamationTriangle,
  audit: FaClock,
  flag: FaFlag,
  ok: FaCheckCircle,
  danger: FaTimesCircle,
};
