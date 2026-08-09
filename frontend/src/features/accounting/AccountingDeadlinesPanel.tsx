'use client';

import React from 'react';
import Link from 'next/link';
import { FaCalendarAlt, FaMoneyCheckAlt, FaReceipt } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpInlineState,
  ErpSection,
  ErpSegmentedControl,
} from '@/components/erp';
import { dateFa, money, StatusBadge } from './accountingUi';
import {
  deadlineRegisterHref,
  deadlineRowHref,
  type DeadlineBucket,
  type DeadlineType,
} from './accountingDeadlines';

type DeadlineSelectionType = 'all' | DeadlineType;

type DeadlineItem = {
  id: string;
  type: DeadlineType;
  bucket: DeadlineBucket;
  status: string;
  dueDate: string;
  amount: string;
  currency?: string | null;
  contractId?: string | null;
  contract?: {
    contractNumber?: string | null;
    title?: string | null;
    customer?: { displayName?: string | null } | null;
  } | null;
};

type DeadlineCounts = { all: number; receivable: number; check: number };

export type AccountingDeadlines = {
  selection: { due: '' | DeadlineBucket; deadlineType: DeadlineSelectionType };
  typeCounts: DeadlineCounts;
  bucketCounts: Record<DeadlineBucket, DeadlineCounts>;
  items: DeadlineItem[];
  total: number;
};

const bucketLabels: Record<DeadlineBucket, string> = {
  overdue: 'گذشته',
  next7: 'امروز تا ۷ روز آینده',
  days8to30: '۸ تا ۳۰ روز آینده',
  later30: 'از روز ۳۱ به بعد',
};

const typeLabels: Record<DeadlineSelectionType, string> = {
  all: 'همه',
  receivable: 'دریافتنی',
  check: 'چک',
};

const selectedCount = (counts: DeadlineCounts, type: DeadlineSelectionType) => counts[type];

export default function AccountingDeadlinesPanel({
  deadlines,
  dashboardHref,
  onTypeChange,
}: {
  deadlines: AccountingDeadlines;
  dashboardHref: (patch: { due?: DeadlineBucket | ''; deadlineType?: DeadlineSelectionType }) => string;
  onTypeChange: (value: DeadlineSelectionType) => void;
}) {
  const selectedType = deadlines.selection.deadlineType;
  const selectedDue = deadlines.selection.due;

  return (
    <ErpSection
      title="سررسیدها"
      description="دریافتنی‌های باز و چک‌های تسویه‌نشده بر پایه روز تقویم تهران"
    >
      <div className="space-y-4" aria-live="polite">
        <ErpSegmentedControl
          value={selectedType}
          onChange={onTypeChange}
          options={(['all', 'receivable', 'check'] as const).map((value) => ({
            value,
            label: `${typeLabels[value]} (${deadlines.typeCounts[value].toLocaleString('fa-IR')})`,
            icon: value === 'receivable' ? FaReceipt : value === 'check' ? FaMoneyCheckAlt : FaCalendarAlt,
          }))}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(bucketLabels) as DeadlineBucket[]).map((bucket) => {
            const counts = deadlines.bucketCounts[bucket];
            const active = selectedDue === bucket;
            return (
              <ErpCard
                key={bucket}
                interactive
                className={active ? 'ring-2 ring-[var(--sds-focus-ring)]' : undefined}
              >
                <Link
                  href={dashboardHref({ due: bucket })}
                  scroll={false}
                  aria-current={active ? 'page' : undefined}
                  className="block min-h-11 rounded-t-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"
                >
                  <span className="sds-text-muted block text-xs">{bucketLabels[bucket]}</span>
                  <span className="sds-text-primary mt-1 block text-2xl font-semibold">
                    {selectedCount(counts, selectedType).toLocaleString('fa-IR')}
                  </span>
                </Link>
                <div className="grid gap-2 border-t border-[var(--sds-border-subtle)] p-2">
                  <ErpButton
                    href={deadlineRegisterHref('receivable', bucket)}
                    label={`دریافتنی ${counts.receivable.toLocaleString('fa-IR')}`}
                    tone="success"
                    className="min-h-11 w-full justify-between px-3 text-xs"
                  />
                  <ErpButton
                    href={deadlineRegisterHref('check', bucket)}
                    label={`چک ${counts.check.toLocaleString('fa-IR')}`}
                    tone="warning"
                    className="min-h-11 w-full justify-between px-3 text-xs"
                  />
                </div>
              </ErpCard>
            );
          })}
        </div>

        {deadlines.items.length === 0 ? (
          <ErpInlineState
            kind="empty"
            className="rounded-lg border"
            title={`${typeLabels[selectedType]} در ${selectedDue ? bucketLabels[selectedDue] : 'همه سررسیدها'} نتیجه‌ای ندارد. فقط دریافتنی‌های باز و چک‌های تسویه‌نشده‌ای نمایش داده می‌شوند که تاریخ سررسید دارند.`}
          />
        ) : (
          <ul className="divide-y divide-[var(--sds-border-subtle)] rounded-lg border border-[var(--sds-border-default)]">
            {deadlines.items.map((item) => {
              const Icon = item.type === 'receivable' ? FaReceipt : FaMoneyCheckAlt;
              const title = item.contract?.contractNumber
                ? `قرارداد ${item.contract.contractNumber}`
                : item.type === 'receivable' ? 'دریافتنی قدیمی' : 'چک قدیمی';
              return (
                <li key={`${item.type}:${item.id}`}>
                  <Link
                    href={deadlineRowHref(item)}
                    className="flex min-h-14 items-center gap-3 px-3 py-3 transition hover:bg-[var(--sds-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sds-focus-ring)] sm:px-4"
                  >
                    <span className="sds-tone-neutral sds-tone-surface inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="sds-text-primary block truncate text-sm font-semibold">{title}</span>
                      <span className="sds-text-muted mt-1 block truncate text-xs">
                        {item.contract?.customer?.displayName || typeLabels[item.type]} · سررسید {dateFa(item.dueDate)}
                      </span>
                    </span>
                    <span className="hidden text-left sm:block">
                      <span className="sds-text-primary block text-sm font-semibold">{money(item.amount, item.currency || undefined)}</span>
                      <span className="mt-1 block"><StatusBadge status={item.status} /></span>
                    </span>
                    <ErpBadge tone={item.type === 'receivable' ? 'success' : 'warning'}>{typeLabels[item.type]}</ErpBadge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ErpSection>
  );
}
