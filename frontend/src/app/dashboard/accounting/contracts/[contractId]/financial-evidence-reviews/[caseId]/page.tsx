'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaArrowLeft, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpInlineState,
  ErpLoading,
  ErpPage,
  ErpSection,
} from '@/components/erp';
import { accountingAPI } from '@/lib/api';

type ReviewCase = {
  id: string;
  contractId: string;
  sourceFinancialRecordId?: string | null;
  status: string;
  severity?: string | null;
  kind: string;
  titleFa: string;
  messageFa: string;
  rule?: string | null;
  ruleLabelFa?: string | null;
  guidance: string;
  primaryAction: { kind: string; labelFa: string; href: string } | null;
  canRetryReconciliation: boolean;
  resolutionMode: 'RECONCILED_BY_EVIDENCE_RECHECK' | 'SOURCE_DRAFT_RETIRED' | 'LEGACY_UNVERIFIED';
  readyForFinancialApproval: boolean;
  witnesses: Array<{ source: string; labelFa: string; rawValue: string; transformedValue?: string; ruleLabelFa?: string; unit: string }>;
  differences: Array<{
    labelFa: string;
    value: string;
    unit: string;
    ruleLabelFa?: string;
    leftComparableValue?: string;
    rightComparableValue?: string;
  }>;
  checklist: Array<{ key: string; labelFa: string; complete: boolean }>;
  audit: {
    createdBy: string;
    createdAt?: string | null;
    lastRecheckedBy?: string | null;
    lastRecheckedAt?: string | null;
    resolvedBy?: string | null;
    resolvedAt?: string | null;
    resolutionNote?: string | null;
  };
};

const auditDateFa = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('fa-IR');
};

export default function FinancialEvidenceReviewPage({
  params,
}: {
  params: { contractId: string; caseId: string };
}) {
  const [reviewCase, setReviewCase] = useState<ReviewCase | null>(null);
  const [contractNumber, setContractNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await accountingAPI.getContract(params.contractId);
      const data = response.data?.data;
      const found = (data?.financialEvidenceReviewCases || [])
        .find((item: ReviewCase) => item.id === params.caseId);
      if (!found) {
        setReviewCase(null);
        setError('پرونده بررسی در این قرارداد پیدا نشد یا دیگر در دسترس نیست.');
        return;
      }
      setReviewCase(found);
      setContractNumber(data?.contract?.contractNumber || '');
    } catch (requestError: any) {
      setError(requestError?.response?.status === 403
        ? 'شما به فضای کاری حسابداری دسترسی ندارید.'
        : requestError?.response?.data?.error || 'دریافت پرونده بررسی انجام نشد.');
    } finally {
      setLoading(false);
    }
  }, [params.caseId, params.contractId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <ErpLoading />;

  const accountingHref = `/dashboard/accounting/contracts/${encodeURIComponent(params.contractId)}`;
  if (!reviewCase) {
    return (
      <ErpPage eyebrow="حسابداری" title="پرونده بررسی یافت نشد" backHref={accountingHref}>
        <ErpInlineState kind="error" title={error || 'پرونده بررسی در دسترس نیست.'} />
      </ErpPage>
    );
  }

  const resolved = reviewCase.status === 'RESOLVED';
  const readyForFinancialApproval = reviewCase.readyForFinancialApproval;
  const sourceDraftRetired = resolved && reviewCase.resolutionMode === 'SOURCE_DRAFT_RETIRED';
  const primaryAction = readyForFinancialApproval
    ? {
        label: 'ادامه تأیید مالی',
        href: `${accountingHref}#financial-records`,
        icon: FaCheckCircle,
        tone: 'success' as const,
      }
    : reviewCase.primaryAction ? {
        label: reviewCase.primaryAction.labelFa,
        href: reviewCase.primaryAction.href,
        icon: FaArrowLeft,
        tone: 'warning' as const,
      } : null;
  return (
    <ErpPage
      eyebrow="حسابداری"
      title={reviewCase.titleFa}
      description={`قرارداد ${contractNumber || params.contractId} — بدون تغییر دستی کمیت؛ فقط اصلاح مبدأ یا بازیابی شواهد و سپس بازآزمایی قطعی.`}
      backHref={accountingHref}
    >
      <div
        data-testid="financial-evidence-review-case"
        className="scroll-mt-24 rounded-[var(--sds-radius-lg)] ring-2 ring-[var(--sds-focus-ring)] ring-offset-4 ring-offset-[var(--sds-surface-canvas)]"
      >
        <ErpSection
          title="وضعیت پرونده"
          actions={primaryAction ? [primaryAction] : []}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <ErpBadge tone={readyForFinancialApproval ? 'success' : sourceDraftRetired ? 'warning' : 'danger'}>
                {readyForFinancialApproval
                  ? 'آماده ادامه تأیید مالی'
                  : sourceDraftRetired
                    ? 'پیش‌فاکتور ناسازگار کنار گذاشته شد'
                    : 'تأیید مالی مسدود'}
              </ErpBadge>
              <ErpBadge tone="neutral" variant="outline">
                {readyForFinancialApproval
                  ? 'شواهد تطبیق‌یافته'
                  : reviewCase.kind === 'QUANTITY'
                    ? 'تعارض کمیت'
                    : 'تعارض شواهد مالی'}
              </ErpBadge>
            </div>
            <p className="text-sm leading-7 text-[var(--sds-text-primary)]">{reviewCase.messageFa}</p>
            <ErpInlineState
              kind={readyForFinancialApproval ? 'success' : 'stale'}
              title={readyForFinancialApproval
                ? 'بازآزمایی قطعی موفق بوده است؛ می‌توانید به پرونده حسابداری برگردید و تأیید مالی را ادامه دهید.'
                : sourceDraftRetired
                  ? 'پیش‌فاکتور ناسازگار حذف شده است. پس از تکمیل اصلاح فروش، به پرونده حسابداری برگردید و یک پیش‌فاکتور تازه بسازید؛ تأیید مالی پیش‌فاکتور تازه دوباره همه شواهد را کنترل می‌کند.'
                : reviewCase.guidance}
            />
            {error && <ErpInlineState kind="error" title={error} />}
          </div>
        </ErpSection>
      </div>

      <ErpSection title="شواهد کمیت" description="مقادیر خام بدون گردکردن پنهانی نمایش داده می‌شوند.">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {reviewCase.witnesses.map((witness, index) => (
            <ErpCard key={`${witness.source}-${index}`}>
              <p className="text-sm font-semibold text-[var(--sds-text-primary)]">{witness.labelFa}</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-[var(--sds-text-secondary)]">مقدار خام</p>
                  <p className="mt-1 font-mono text-base text-[var(--sds-accent)]" dir="ltr">
                    {witness.rawValue} {witness.unit}
                  </p>
                </div>
                {witness.transformedValue && (
                  <div>
                    <p className="text-xs text-[var(--sds-text-secondary)]">مقدار قابل‌مقایسه طبق قاعده منبع</p>
                    <p className="mt-1 font-mono text-base font-semibold text-[var(--sds-text-primary)]" dir="ltr">
                      {witness.transformedValue} {witness.unit}
                    </p>
                    {witness.ruleLabelFa && <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{witness.ruleLabelFa}</p>}
                  </div>
                )}
              </div>
            </ErpCard>
          ))}
          {reviewCase.witnesses.length === 0 && (
            <ErpInlineState kind="empty" title="شاهد کمیتی قابل نمایش در این پرونده ثبت نشده است." />
          )}
        </div>
        {(reviewCase.ruleLabelFa || reviewCase.differences.length > 0) && (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {reviewCase.ruleLabelFa && (
              <ErpCard>
                <p className="text-xs text-[var(--sds-text-secondary)]">قاعده تاریخی تبدیل</p>
                <p className="mt-2 text-sm font-semibold text-[var(--sds-text-primary)]">{reviewCase.ruleLabelFa}</p>
              </ErpCard>
            )}
            {reviewCase.differences.map((difference) => (
              <ErpCard key={difference.labelFa} tone="danger">
                <p className="text-xs text-[var(--sds-text-secondary)]">{difference.labelFa}</p>
                <p className="mt-2 font-mono text-base font-semibold" dir="ltr">{difference.value} {difference.unit}</p>
                {difference.leftComparableValue && difference.rightComparableValue && (
                  <p className="mt-2 text-xs text-[var(--sds-text-secondary)]" dir="ltr">
                    {difference.leftComparableValue} − {difference.rightComparableValue}
                  </p>
                )}
                {difference.ruleLabelFa && <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{difference.ruleLabelFa}</p>}
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSection title="ردپای حسابرسی" description="ثبت و بازآزمایی این پرونده قابل پیگیری است و مقدار تجاری را بازنویسی نمی‌کند.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ErpCard>
            <p className="text-xs text-[var(--sds-text-secondary)]">ایجاد پرونده توسط</p>
            <p className="mt-2 text-sm font-semibold text-[var(--sds-text-primary)]">{reviewCase.audit.createdBy}</p>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{auditDateFa(reviewCase.audit.createdAt)}</p>
          </ErpCard>
          <ErpCard>
            <p className="text-xs text-[var(--sds-text-secondary)]">آخرین بازآزمایی</p>
            <p className="mt-2 text-sm font-semibold text-[var(--sds-text-primary)]">{reviewCase.audit.lastRecheckedBy || 'هنوز انجام نشده'}</p>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{auditDateFa(reviewCase.audit.lastRecheckedAt)}</p>
          </ErpCard>
          <ErpCard>
            <p className="text-xs text-[var(--sds-text-secondary)]">تصمیم نهایی</p>
            <p className="mt-2 text-sm font-semibold text-[var(--sds-text-primary)]">{reviewCase.audit.resolvedBy || 'پرونده هنوز باز است'}</p>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{auditDateFa(reviewCase.audit.resolvedAt)}</p>
          </ErpCard>
        </div>
        {reviewCase.audit.resolutionNote && (
          <ErpInlineState
            kind={readyForFinancialApproval ? 'success' : 'stale'}
            title={reviewCase.audit.resolutionNote}
            className="mt-3"
          />
        )}
      </ErpSection>

      <ErpSection title="مراحل رفع مانع">
        <ol className="space-y-3">
          {reviewCase.checklist.map((item, index) => (
            <li key={item.key} className="flex min-h-11 items-center gap-3 rounded-[var(--sds-radius-lg)] border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3 py-2">
              {item.complete
                ? <FaCheckCircle className="h-5 w-5 text-[var(--sds-success)]" aria-hidden="true" />
                : <FaExclamationTriangle className="h-5 w-5 text-[var(--sds-warning)]" aria-hidden="true" />}
              <span className="text-sm font-medium text-[var(--sds-text-primary)]">{index + 1}. {item.labelFa}</span>
            </li>
          ))}
        </ol>
        {!resolved && reviewCase.primaryAction && (
          <div className="mt-4 flex flex-wrap gap-2">
            <ErpButton
              label={reviewCase.primaryAction.labelFa}
              href={reviewCase.primaryAction.href}
              tone="warning"
              variant="outline"
            />
          </div>
        )}
      </ErpSection>
    </ErpPage>
  );
}
