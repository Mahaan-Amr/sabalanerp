'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSync } from 'react-icons/fa';
import { ErpInlineState, ErpPage, ErpSegmentedControl, ErpSkeleton } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, type FinancialInvoiceApprovalPayload } from '@/features/accounting/accountingUi';
import { AccountingFinancialRecordReview, type FinancialRecordForReview } from '@/features/accounting/AccountingFinancialRecordReview';
import { financialEvidenceReviewFromConflict } from '@/features/accounting/financialEvidenceReview';

type FinancialReviewResponse = {
  record: FinancialRecordForReview;
  auditRows: Array<{ id: string; action: string; createdAt: string; note?: string | null }>;
  auditTotal: number;
  auditPage: number;
  canApprove: boolean;
};

export default function AccountingFinancialRecordDetailPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [review, setReview] = useState<FinancialReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewActionUrl, setReviewActionUrl] = useState<string | null>(null);
  const [showAccountingDetails, setShowAccountingDetails] = useState(false);
  const requestedReturn = searchParams.get('returnTo') || '';
  const backHref = requestedReturn.startsWith('/dashboard/accounting/') && !requestedReturn.startsWith('//')
    ? requestedReturn : '/dashboard/accounting/invoice-candidates';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const recordResult = await accountingAPI.getFinancialRecords({ kind: 'INVOICE_CANDIDATE', recordId, page: 1, pageSize: 1 });
      const data = recordResult.data?.data;
      const record = data?.items?.[0] as FinancialRecordForReview | undefined;
      if (!recordResult.data?.success || !record || record.id !== recordId) {
        setReview(null);
        setError('این رکورد مالی پیدا نشد یا دسترسی مشاهده آن فعال نیست.');
        return;
      }
      if (record.sourceKind !== 'PARTNER_INTERNAL_RECORD' && record.contractId) {
        router.replace(`/dashboard/accounting/contracts/${encodeURIComponent(record.contractId)}?section=financial&recordId=${encodeURIComponent(record.id)}&returnTo=${encodeURIComponent(backHref)}`);
        return;
      }
      const auditResult = await accountingAPI.getAuditLogs({ recordId, page: 1, pageSize: 100 }).catch(() => null);
      const auditLoaded = Boolean(auditResult?.data?.success);
      const auditData = auditLoaded ? auditResult!.data.data : null;
      setReview({ record, auditRows: auditData?.items ?? [], auditTotal: auditData?.total ?? 0,
        auditPage: 1, canApprove: Boolean(data.actionAvailability?.approve) && auditLoaded });
      if (!auditLoaded) setError('تاریخچه مالی بارگیری نشد؛ پیش از تأیید، دوباره تلاش کنید.');
    } catch (failure) {
      setReview(null);
      setError(accountingFailureMessage(failure, 'پرونده مالی بارگیری نشد؛ اتصال یا دسترسی را بررسی و دوباره تلاش کنید.'));
    } finally {
      setLoading(false);
    }
  }, [backHref, recordId, router]);

  useEffect(() => { void load(); }, [load]);

  const loadMoreAudit = async () => {
    if (!review || auditLoading || review.auditRows.length >= review.auditTotal) return;
    setAuditLoading(true);
    try {
      const page = review.auditPage + 1;
      const result = await accountingAPI.getAuditLogs({ recordId, page, pageSize: 100 });
      if (!result.data?.success) throw new Error('audit unavailable');
      setReview(current => current && current.record.id === recordId ? {
        ...current, auditRows: [...current.auditRows, ...(result.data.data.items ?? [])],
        auditTotal: result.data.data.total ?? current.auditTotal, auditPage: page,
      } : current);
    } catch {
      setError('رویدادهای پیشین بارگیری نشد؛ دوباره تلاش کنید.');
    } finally {
      setAuditLoading(false);
    }
  };

  const approve = async (payload: FinancialInvoiceApprovalPayload) => {
    setBusy(true);
    setError(null);
    setReviewActionUrl(null);
    try {
      await accountingAPI.executeAction({ kind: 'APPROVE_FINANCIAL_INVOICE', ...payload,
        idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() });
      await load();
    } catch (failure) {
      const body = (failure as { response?: { data?: Parameters<typeof financialEvidenceReviewFromConflict>[0] } })?.response?.data;
      setReviewActionUrl(financialEvidenceReviewFromConflict(body));
      setError(accountingFailureMessage(failure, 'تأیید مالی ثبت نشد؛ مبلغ، مدارک و وضعیت پرونده را بررسی کنید.'));
    } finally {
      setBusy(false);
    }
  };

  return <ErpPage eyebrow="حسابداری" title={review?.record.partnerContext
    ? `پرونده مالی ${review.record.partnerContext.caseNumber}` : 'بررسی رکورد مالی'}
    backHref={backHref}
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, disabled: loading || busy, tone: 'neutral' }]}>
    {loading && !review && <ErpSkeleton lines={6} label="در حال بارگذاری پرونده مالی" />}
    {error && <ErpInlineState kind="error" title={error}
      action={reviewActionUrl ? { label: 'پرونده بررسی شواهد', href: reviewActionUrl } : { label: 'تلاش دوباره', onClick: load }} />}
    {review && <>
      <ErpSegmentedControl value={showAccountingDetails ? 'details' : 'daily'}
        onChange={(value) => setShowAccountingDetails(value === 'details')}
        options={[{ value: 'daily', label: 'کار روزمره' }, { value: 'details', label: 'جزئیات حسابداری' }]} />
      <AccountingFinancialRecordReview record={review.record} auditRows={review.auditRows}
        auditTotal={review.auditTotal} auditLoading={auditLoading} onLoadMoreAudit={loadMoreAudit}
        canApprove={review.canApprove} showAccountingDetails={showAccountingDetails}
        busy={busy} onApprove={approve} />
    </>}
  </ErpPage>;
}
