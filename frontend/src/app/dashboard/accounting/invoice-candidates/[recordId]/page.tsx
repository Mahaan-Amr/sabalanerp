'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FaSync } from 'react-icons/fa';
import { ErpInlineState, ErpPage, ErpSegmentedControl, ErpSkeleton } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, type FinancialInvoiceApprovalPayload } from '@/features/accounting/accountingUi';
import { AccountingFinancialRecordReview, type FinancialRecordForReview } from '@/features/accounting/AccountingFinancialRecordReview';
import { financialEvidenceReviewFromConflict } from '@/features/accounting/financialEvidenceReview';
import { submitFinancialApproval } from '@/features/accounting/submitFinancialApproval';
import { accountingReviewReturn } from '@/features/accounting/financialRecordReviewHref';
import { FinancialReviewRequestGuard, loadFinancialReview, canSubmitFinancialReview } from '@/features/accounting/financialReviewRequestGuard';
import { useAuth } from '@/contexts/AuthContext';

type FinancialReviewResponse = {
  owner: string;
  record: FinancialRecordForReview;
  auditRows: Array<{ id: string; action: string; createdAt: string; note?: string | null }>;
  auditTotal: number;
  auditPage: number;
  canApprove: boolean;
};

export default function AccountingFinancialRecordDetailPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = use(params);
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const owner = JSON.stringify([user?.id ?? null, recordId]);
  const guard = useRef(new FinancialReviewRequestGuard()).current;
  guard.select(owner);
  const [review, setReview] = useState<FinancialReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [failureState, setFailureState] = useState<{ owner: string; value: string } | null>(null);
  const error = failureState?.owner === owner ? failureState.value : null;
  const setError = useCallback((value: string | null) => setFailureState(value ? { owner, value } : null), [owner]);
  const [reviewActionUrl, setReviewActionUrl] = useState<string | null>(null);
  const [auditPermissionDenied, setAuditPermissionDenied] = useState(false);
  const [auditLoadError, setAuditLoadError] = useState(false);
  const [showAccountingDetails, setShowAccountingDetails] = useState(false);
  const backHref = accountingReviewReturn(searchParams.get('returnTo'));

  const load = useCallback(async () => {
    const epoch = guard.begin(owner);
    if (epoch === null) return;
    setLoading(true);
    setReview(null);
    setAuditLoading(false);
    setError(null);
    setAuditPermissionDenied(false);
    setAuditLoadError(false);
    try {
      const result = await loadFinancialReview<FinancialRecordForReview>({ owner, recordId, epoch, guard,
        fetchRecord: () => accountingAPI.getFinancialRecords({ kind: 'INVOICE_CANDIDATE', recordId, page: 1, pageSize: 1 }),
        fetchAudit: () => accountingAPI.getAuditLogs({ recordId, page: 1, pageSize: 100 }) });
      if (!result) return;
      if (result.kind === 'missing') {
        setReview(null);
        setError('این رکورد مالی پیدا نشد یا دسترسی مشاهده آن فعال نیست.');
        return;
      }
      setAuditPermissionDenied(result.auditDenied);
      setAuditLoadError(result.auditLoadError);
      setReview({ owner, record: result.record, auditRows: result.auditRows, auditTotal: result.auditTotal,
        auditPage: 1, canApprove: result.canApprove });
      if (result.auditLoadError) setError('تاریخچه مالی بارگیری نشد؛ پیش از تأیید، دوباره تلاش کنید.');
    } catch (failure) {
      if (!guard.isCurrent(owner, epoch)) return;
      setReview(null);
      setError(accountingFailureMessage(failure, 'پرونده مالی بارگیری نشد؛ اتصال یا دسترسی را بررسی و دوباره تلاش کنید.'));
    } finally {
      if (guard.isCurrent(owner, epoch)) setLoading(false);
    }
  }, [guard, owner, recordId, setError]);

  useEffect(() => { setBusy(false); setReviewActionUrl(null); void load(); return () => guard.invalidate(owner); }, [guard, load, owner]);

  const loadMoreAudit = async () => {
    if (!review || loading || review.owner !== owner || review.record.id !== recordId || auditLoading || review.auditRows.length >= review.auditTotal) return;
    const epoch = guard.snapshot(owner);
    const currentReview = review;
    setAuditLoading(true);
    try {
      const page = review.auditPage + 1;
      const result = await accountingAPI.getAuditLogs({ recordId, page, pageSize: 100 });
      if (!result.data?.success) throw new Error('audit unavailable');
      if (!guard.isCurrent(owner, epoch)) return;
      setReview(current => current === currentReview ? {
        ...current, auditRows: [...current.auditRows, ...(result.data.data.items ?? [])],
        auditTotal: result.data.data.total ?? current.auditTotal, auditPage: page,
      } : current);
    } catch {
      if (guard.isCurrent(owner, epoch)) setError('رویدادهای پیشین بارگیری نشد؛ دوباره تلاش کنید.');
    } finally {
      if (guard.isCurrent(owner, epoch)) setAuditLoading(false);
    }
  };

  const approve = async (payload: FinancialInvoiceApprovalPayload) => {
    if (!canSubmitFinancialReview({ loading, busy, owner, recordId, payloadId: payload.invoiceId, review })) return;
    const epoch = guard.begin(owner);
    if (epoch === null) return;
    setBusy(true);
    setAuditLoading(false);
    setError(null);
    setReviewActionUrl(null);
    try {
      await submitFinancialApproval(payload);
      if (guard.isCurrent(owner, epoch)) { setBusy(false); await load(); }
    } catch (failure) {
      const body = (failure as { response?: { data?: Parameters<typeof financialEvidenceReviewFromConflict>[0] } })?.response?.data;
      if (guard.isCurrent(owner, epoch)) {
        setReviewActionUrl(financialEvidenceReviewFromConflict(body));
        setError(accountingFailureMessage(failure, 'تأیید مالی ثبت نشد؛ مبلغ، مدارک و وضعیت پرونده را بررسی کنید.'));
      }
    } finally {
      if (guard.isCurrent(owner, epoch)) setBusy(false);
    }
  };

  const visibleReview = review?.owner === owner && review.record.id === recordId ? review : null;
  return <ErpPage eyebrow="حسابداری" title={visibleReview?.record.partnerContext
    ? `پرونده مالی ${visibleReview.record.partnerContext.caseNumber}` : 'بررسی رکورد مالی'}
    backHref={backHref}
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, disabled: loading || busy, tone: 'neutral' }]}>
    {(loading || (!visibleReview && !error)) && <ErpSkeleton lines={6} label="در حال بارگذاری پرونده مالی" />}
    {error && <ErpInlineState kind="error" title={error}
      action={reviewActionUrl ? { label: 'پرونده بررسی شواهد', href: reviewActionUrl } : { label: 'تلاش دوباره', onClick: load }} />}
    {visibleReview && !loading && <>
      <ErpSegmentedControl value={showAccountingDetails ? 'details' : 'daily'}
        onChange={(value) => setShowAccountingDetails(value === 'details')}
        options={[{ value: 'daily', label: 'کار روزمره' }, { value: 'details', label: 'جزئیات حسابداری' }]} />
      <AccountingFinancialRecordReview record={visibleReview.record} auditRows={visibleReview.auditRows}
        auditTotal={visibleReview.auditTotal} auditLoading={auditLoading} onLoadMoreAudit={loadMoreAudit}
        canApprove={visibleReview.canApprove} auditAvailable={!auditPermissionDenied} auditLoadError={auditLoadError} showAccountingDetails={showAccountingDetails}
        busy={busy} onApprove={approve} />
    </>}
  </ErpPage>;
}
