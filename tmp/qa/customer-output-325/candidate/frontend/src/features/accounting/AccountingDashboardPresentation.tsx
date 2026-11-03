import React from 'react';
import {
  FaBalanceScale,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaFileInvoice,
  FaHistory,
  FaMoneyCheckAlt,
  FaReceipt,
  FaUserClock,
  FaUserPlus,
} from 'react-icons/fa';
import {
  ErpNeumorphicMetricGrid,
  ErpSkeleton,
  ErpSkeletonBlock,
  type ErpTone,
} from '@/components/erp';
import { HR_HIRING_METRIC_VIEWS } from '@/features/hr-hiring/hrHiringMetricViews';

type CommandCenter = Record<string, { count?: number } | undefined>;
type HiringMetrics = {
  status: 'available';
  actionableCollateralOrContractCases: number;
  activeCollateralTemplates: number;
} | {
  status: 'pending' | 'failed' | 'unavailable';
  actionableCollateralOrContractCases?: number;
  activeCollateralTemplates?: number;
};

type MetricContext = {
  commandCenter: CommandCenter;
  hrMetrics: HiringMetrics;
};

type AccountingMetricDefinition = {
  id: string;
  label: string;
  href: string;
  icon: typeof FaClipboardCheck;
  tone: ErpTone;
  value: (context: MetricContext) => number | null;
  hint?: (context: MetricContext) => string | undefined;
};

const count = (key: string) => ({ commandCenter }: MetricContext) => commandCenter[key]?.count || 0;
const hiringValue = (key: 'actionableCollateralOrContractCases' | 'activeCollateralTemplates') => (
  ({ hrMetrics }: MetricContext) => hrMetrics.status === 'available' ? hrMetrics[key] : null
);
const hiringHint = ({ hrMetrics }: MetricContext) => hrMetrics.status === 'pending'
  ? 'در حال بررسی دسترسی'
  : undefined;

const accountingMetricDefinitions: AccountingMetricDefinition[] = [
  { id: 'reviewable-contracts', label: 'قراردادهای قابل بررسی', href: '/dashboard/accounting/contracts?view=reviewable', icon: FaClipboardCheck, tone: 'primary', value: count('reviewableContracts') },
  { id: 'invoice-candidates', label: 'پیش‌نویس صورتحساب‌ها', href: '/dashboard/accounting/invoice-candidates?view=actionable', icon: FaFileInvoice, tone: 'info', value: count('invoiceCandidates') },
  { id: 'payments', label: 'دریافت‌ها و چک‌ها', href: '/dashboard/accounting/payments?view=due-soon', icon: FaMoneyCheckAlt, tone: 'warning', value: count('checksDue') },
  { id: 'receivables', label: 'دریافتنی‌ها', href: '/dashboard/accounting/receivables?view=open', icon: FaReceipt, tone: 'success', value: count('openReceivables') },
  { id: 'hiring-collateral', label: 'استخدام: وثیقه و قرارداد', href: `/dashboard/hr/hiring?view=${HR_HIRING_METRIC_VIEWS.actionableCollateralOrContracts}`, icon: FaUserPlus, tone: 'info', value: hiringValue('actionableCollateralOrContractCases'), hint: hiringHint },
  { id: 'collateral-templates', label: 'قالب وثیقه استخدام', href: `/dashboard/hr/hiring/collateral-templates?view=${HR_HIRING_METRIC_VIEWS.activeCollateralTemplates}`, icon: FaClipboardCheck, tone: 'neutral', value: hiringValue('activeCollateralTemplates'), hint: hiringHint },
  { id: 'tax', label: 'مالیات و سامانه مودیان', href: '/dashboard/accounting/tax?view=needs-attention', icon: FaBalanceScale, tone: 'purple', value: count('taxNotReady') },
  { id: 'corrections', label: 'بررسی اصلاحات', href: '/dashboard/accounting/correction-requests?view=active', icon: FaExclamationTriangle, tone: 'warning', value: count('correctionRequests') },
  { id: 'audit', label: 'سوابق عملیات', href: '/dashboard/accounting/audit', icon: FaHistory, tone: 'neutral', value: count('auditHistory') },
  { id: 'performance', label: 'عملکرد حسابداران', href: '/dashboard/accounting/performance?view=last30days', icon: FaUserClock, tone: 'primary', value: count('accountantPerformance') },
];

export function AccountingDashboardSkeleton() {
  return (
    <div className="space-y-5" aria-label="در حال بارگذاری داشبورد حسابداری">
      <ErpNeumorphicMetricGrid
        label="در حال بارگذاری شاخص‌های عملیاتی"
        items={accountingMetricDefinitions.map((item) => ({
          ...item,
          value: <ErpSkeletonBlock className="h-8 w-12 rounded-lg" />,
          href: undefined,
          hint: undefined,
        }))}
      />
      <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,.9fr)]">
        <ErpSkeleton label="در حال بارگذاری روند مالی" className="h-full overflow-hidden p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <ErpSkeletonBlock className="h-5 w-44 rounded-full" />
              <ErpSkeletonBlock className="h-4 w-64 max-w-full rounded-full" />
            </div>
            <ErpSkeletonBlock className="h-11 w-11" />
          </div>
          <ErpSkeletonBlock className="h-12 rounded-lg" />
          <ErpSkeletonBlock className="h-52" />
        </ErpSkeleton>
        <ErpSkeleton label="در حال بارگذاری سررسیدها" className="h-full p-4 sm:p-5">
          <ErpSkeletonBlock className="h-5 w-24 rounded-full" />
          <ErpSkeletonBlock className="h-4 w-64 max-w-full rounded-full" />
          <ErpSkeletonBlock className="h-12 rounded-lg" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <ErpSkeletonBlock key={index} className="h-48" />
            ))}
          </div>
        </ErpSkeleton>
      </div>
    </div>
  );
}

export function AccountingOperationalMetricGrid({ commandCenter, hrMetrics }: MetricContext) {
  const context = { commandCenter, hrMetrics };
  return (
    <ErpNeumorphicMetricGrid
      label="شاخص‌های عملیاتی حسابداری"
      items={accountingMetricDefinitions.map((item) => {
        const value = item.value(context);
        return {
          ...item,
          value: value === null ? '—' : value.toLocaleString('fa-IR'),
          hint: item.hint?.(context),
        };
      })}
    />
  );
}
