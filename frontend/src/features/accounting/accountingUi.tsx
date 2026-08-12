'use client';
import { ErpInput } from '@/components/erp';
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
import PersianCalendarComponent from '@/components/PersianCalendar';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { ErpBadge, ErpButton, ErpCard, type ErpTone } from '@/components/erp';
import { formatPrice, toFiniteNumber } from '@/lib/numberFormat';
import PersianCalendar from '@/lib/persian-calendar';
import { InlineFieldError } from '@/lib/formErrors';

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
  signedAt?: string | null;
  contractDate?: string | null;
  customer: {
    id?: string;
    displayName: string;
    nationalCode?: string;
    economicCode?: string;
  };
  status: string;
  isInactive?: boolean;
  inactiveAt?: string | null;
  inactiveReason?: string | null;
  accounting: {
    sourceStatus: string;
    eligibleForFinancialRecords: boolean;
    eligibilityReason?: string;
    invoiceStatus: string;
    receivableStatus: string;
    taxStatus: string;
    openFlags: number;
    openBlockerFlags: number;
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
    sepidarAmount?: string | null;
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

export type AccountingPaginatedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const emptyAccountingPagination = { page: 1, pageSize: 50, total: 0 };

export const readAccountingListResponse = <T,>(payload: any, fallbackPageSize = 50): AccountingPaginatedResult<T> => {
  if (Array.isArray(payload)) {
    return { items: payload, page: 1, pageSize: fallbackPageSize, total: payload.length };
  }
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    page: Number(payload?.page) || 1,
    pageSize: Number(payload?.pageSize) || fallbackPageSize,
    total: Number(payload?.total) || 0,
  };
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

export const correctionStatusLabels: Record<string, string> = {
  OPEN: 'در انتظار بررسی مدیر',
  ACKNOWLEDGED: 'در جریان',
  APPROVED_FOR_SALES_EDIT: 'تایید شده برای اصلاح فروش',
  SALES_EDITED: 'اصلاح شده توسط فروش',
  RESOLVED: 'بسته شده',
  CANCELLED: 'رد یا لغو شده',
};

export const money = (amount?: string | number | null, _currency = 'ریال') => {
  const value = toFiniteNumber(amount);
  return formatPrice(value, 'ریال');
};

export const dateFa = (value?: string | Date | null) => {
  if (!value) return '—';
  return PersianCalendar.formatForDisplay(String(value));
};

export const toneForStatus = (status?: string): ErpTone => {
  if (!status) return 'neutral';
  if (['SIGNED', 'SETTLED', 'ACCEPTED', 'READY', 'CLEARED', 'RECONCILED', 'RESOLVED'].includes(status)) return 'success';
  if (['APPROVED', 'ISSUED', 'OPEN', 'RECEIVED', 'SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY', 'APPROVED_FOR_SALES_EDIT'].includes(status)) return 'info';
  if (['PENDING_APPROVAL', 'DRAFT', 'PARTIALLY_PAID', 'RECEIVED', 'DEPOSITED', 'SALES_EDITED'].includes(status)) return 'warning';
  if (['CANCELLED', 'VOIDED', 'OVERDUE', 'REJECTED', 'NEEDS_CORRECTION', 'BOUNCED', 'DISPUTED'].includes(status)) return 'danger';
  return 'neutral';
};

export function StatusBadge({ label, status, tone }: { label?: string; status?: string; tone?: ErpTone }) {
  return (
    <ErpBadge tone={tone || toneForStatus(status)}>
      {label || (status ? correctionStatusLabels[status] || taxStatusLabels[status] || receivableStatusLabels[status] || invoiceStatusLabels[status] || contractStatusLabels[status] || status : '—')}
    </ErpBadge>
  );
}

export function QueueList<T>({
  title,
  items,
  emptyText,
  actions = [],
  renderItem,
}: {
  title: string;
  items: T[];
  emptyText: string;
  actions?: Array<{
    label: string;
    href: string;
    icon?: React.ComponentType<{ className?: string }>;
    tone?: ErpTone;
  }>;
  renderItem: (item: T) => React.ReactNode;
}) {
  return (
    <ErpCard className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</h2>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <ErpButton
                key={`${action.href}-${action.label}`}
                label={action.label}
                href={action.href}
                icon={action.icon}
                tone={action.tone || 'neutral'}
                variant="soft"
              />
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--sds-border-default)] p-4 text-sm text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:text-[var(--sds-text-muted)]">{emptyText}</p>
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
    <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--sds-accent)]/10 text-[var(--sds-accent)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]">
          <DisplayIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</p>
            {status}
          </div>
          {meta && <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{meta}</p>}
          {amount && <p className="mt-2 text-sm font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{amount}</p>}
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

export type FinancialInvoiceApprovalPayload = {
  invoiceId: string;
  systemInvoiceNumber: string;
  systemInvoiceDate: string;
  sepidarAmount: number;
};

type FinancialInvoiceApprovalFormProps = {
  invoice?: {
    id: string;
    amount: string | number;
    status: string;
    systemInvoiceNumber?: string | null;
    systemInvoiceDate?: string | null;
    sepidarAmount?: string | number | null;
  } | null;
  busy?: boolean;
  compact?: boolean;
  onApprove: (payload: FinancialInvoiceApprovalPayload) => void | Promise<void>;
};

const isInvoiceLocked = (invoice?: FinancialInvoiceApprovalFormProps['invoice']) =>
  !invoice || ['ISSUED', 'POSTED', 'VOIDED'].includes(invoice.status);

export function FinancialInvoiceApprovalForm({
  invoice,
  busy = false,
  compact = false,
  onApprove,
}: FinancialInvoiceApprovalFormProps) {
  const [systemInvoiceNumber, setSystemInvoiceNumber] = React.useState('');
  const [systemInvoiceDate, setSystemInvoiceDate] = React.useState(PersianCalendar.now());
  const [sepidarAmount, setSepidarAmount] = React.useState(0);
  const [errors, setErrors] = React.useState<Partial<Record<'systemInvoiceNumber' | 'systemInvoiceDate' | 'sepidarAmount', string>>>({});

  React.useEffect(() => {
    if (!invoice) return;
    setSystemInvoiceNumber(invoice.systemInvoiceNumber || '');
    setSystemInvoiceDate(invoice.systemInvoiceDate ? PersianCalendar.toPersian(invoice.systemInvoiceDate) : PersianCalendar.now());
    setSepidarAmount(invoice.sepidarAmount != null ? toFiniteNumber(invoice.sepidarAmount) : 0);
    setErrors({});
  }, [invoice?.id]);

  if (!invoice) return null;

  const expectedAmount = toFiniteNumber(invoice.amount);
  const hasMismatch = sepidarAmount > 0 && Math.round(sepidarAmount) !== Math.round(expectedAmount);
  const locked = isInvoiceLocked(invoice);
  const fieldClass = (field: keyof typeof errors) =>
    `min-h-11 w-full rounded-lg border bg-[var(--sds-surface-subtle)] px-3 text-sm text-[var(--sds-text-primary)] outline-none focus:border-[var(--sds-border-strong)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] ${errors[field] ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'}`;

  const clearError = (field: keyof typeof errors) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const approve = () => {
    const nextErrors: typeof errors = {};

    if (!systemInvoiceNumber.trim()) {
      nextErrors.systemInvoiceNumber = 'شماره فاکتور سیستمی الزامی است';
    }
    if (!systemInvoiceDate.trim()) {
      nextErrors.systemInvoiceDate = 'تاریخ فاکتور سیستمی الزامی است';
    }
    if (sepidarAmount <= 0) {
      nextErrors.sepidarAmount = 'مبلغ سپیدار باید بیشتر از صفر باشد';
    } else if (Math.round(sepidarAmount) !== Math.round(expectedAmount)) {
      nextErrors.sepidarAmount = 'مبلغ سپیدار باید با مبلغ صورتحساب برابر باشد';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    onApprove({
      invoiceId: invoice.id,
      systemInvoiceNumber: systemInvoiceNumber.trim(),
      systemInvoiceDate: PersianCalendar.toGregorian(systemInvoiceDate).toISOString(),
      sepidarAmount,
    });
  };

  if (locked) {
    return (
      <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3 text-sm dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
        <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">تایید مالی ثبت شده</p>
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] sm:grid-cols-3">
          <span>شماره فاکتور: {invoice.systemInvoiceNumber || '—'}</span>
          <span>تاریخ: {invoice.systemInvoiceDate ? dateFa(invoice.systemInvoiceDate) : '—'}</span>
          <span>مبلغ سپیدار: {money(invoice.sepidarAmount)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-3 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
      <div className={compact ? 'space-y-3' : 'grid grid-cols-1 gap-3 lg:grid-cols-3'}>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">شماره فاکتور سیستمی</span>
          <ErpInput
            className={fieldClass('systemInvoiceNumber')}
            value={systemInvoiceNumber}
            onChange={(event) => {
              clearError('systemInvoiceNumber');
              setSystemInvoiceNumber(event.target.value);
            }}
          />
          <InlineFieldError message={errors.systemInvoiceNumber} className="mt-1 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">تاریخ فاکتور سیستمی</span>
          <div className={fieldClass('systemInvoiceDate')}>
            <PersianCalendarComponent
              value={systemInvoiceDate}
              onChange={(value) => {
                clearError('systemInvoiceDate');
                setSystemInvoiceDate(value);
              }}
              placeholder="انتخاب تاریخ"
              className="min-h-11 w-full"
            />
          </div>
          <InlineFieldError message={errors.systemInvoiceDate} className="mt-1 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">مبلغ سپیدار (ریال)</span>
          <FormattedNumberInput
            value={sepidarAmount}
            onChange={(value) => {
              clearError('sepidarAmount');
              setSepidarAmount(value);
            }}
            min={0}
            placeholder="مبلغ سپیدار"
            className={fieldClass('sepidarAmount')}
          />
          <InlineFieldError message={errors.sepidarAmount} className="mt-1 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]" />
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-xs ${hasMismatch ? 'text-[var(--sds-danger)] dark:text-[var(--sds-danger)]' : 'text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]'}`}>
          مبلغ صورتحساب سبلان: {money(expectedAmount)}
        </p>
        <ErpButton
          label="تایید مالی"
          icon={accountingIcons.ok}
          tone="success"
          disabled={busy}
          onClick={approve}
        />
      </div>
    </div>
  );
}
