'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaEye, FaFileInvoice, FaSync } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpListPage, ErpStatus } from '@/components/erp';
import SepidarDispatchInvoices from '@/features/accounting/SepidarDispatchInvoices';
import { userFacingError } from '@/features/dispatch/userFacingError';
import {
  isProjectReturnAllocationEditable, projectReturnAllocationApi, projectReturnAllocationStatuses, projectReturnHistoryHref, projectReturnReviewHref, projectReturnSepidarApi,
} from './projectReturnAllocationApi';
import { displayExactDecimal } from './stoneReturnApi';

const handleSepidarError = () => false;

export function ProjectReturnReviewList() {
  const [page, setPage] = useState<Awaited<ReturnType<typeof projectReturnAllocationApi.list>>>();
  const [after, setAfter] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [sepidar, setSepidar] = useState<{ caseId: string; draftId: string } | null>(null);
  const [notice, setNotice] = useState('');
  const sepidarCaseId = sepidar?.caseId;
  const sepidarApi = useMemo(() => sepidarCaseId ? projectReturnSepidarApi(sepidarCaseId) : null, [sepidarCaseId]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void projectReturnAllocationApi.list(after).then(next => {
      if (current) setPage(previous => ({
        ...next, items: after ? [...(previous?.items ?? []), ...next.items] : next.items,
      }));
    }).catch(reason => {
      if (current) setError(userFacingError(reason, 'دریافت فهرست مرجوعی‌های پروژه ناموفق بود.'));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [after, retry]);

  return <ErpListPage
    title="مرجوعی‌ها"
    eyebrow="بررسی و پیگیری"
    backHref="/dashboard/accounting/workflows/review"
    actions={[
      { label: 'به‌روزرسانی', icon: FaSync, tone: 'neutral', disabled: loading,
        onClick: () => { setAfter(undefined); setRetry(value => value + 1); } },
      { label: 'سوابق مرجوعی سنگ', href: projectReturnHistoryHref, variant: 'soft' },
    ]}
    mobileLayout="table"
    rows={page?.items ?? []}
    rowKey={row => row.id}
    rowActionMode="menu"
    rowActions={row => {
      const reference = row.sepidarReference;
      return [{
        label: page?.canAllocate && isProjectReturnAllocationEditable(row.allocationStatus) ? 'رسیدگی' : 'مشاهده پرونده',
        href: projectReturnReviewHref(row.id), icon: FaEye, tone: 'primary',
      }, ...(page?.canAllocate && row.allocationStatus === 'ALLOCATION_COMPLETE' && reference ? [{
        label: reference.registered ? 'اصلاح فاکتور سپیدار' : 'ثبت فاکتور سپیدار',
        icon: FaFileInvoice, tone: 'neutral' as const,
        onClick: () => { setNotice(''); setSepidar({ caseId: row.id, draftId: reference.draftId }); },
      }] : [])];
    }}
    isLoading={loading && !page?.items.length}
    columns={[
      { id: 'customer', header: 'مشتری', cell: row => <strong className="break-words">{row.customerName}</strong> },
      { id: 'status', header: 'وضعیت', cell: row =>
        <span className="whitespace-nowrap"><ErpStatus {...projectReturnAllocationStatuses[row.allocationStatus]} /></span> },
      { id: 'projects', header: 'پروژه‌ها',
        cell: row => <span className="break-words">{row.version.projects.map(project => project.projectName).join('، ') || '—'}</span> },
      { id: 'products', header: 'محصول', cell: row =>
        row.version.items.length === 1 ? row.version.items[0].productName : `${displayExactDecimal(String(row.version.items.length))} محصول` },
      { id: 'received', header: 'زمان ثبت', cell: row =>
        new Date(row.version.submittedAt ?? row.version.assignedAt ?? row.createdAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) },
    ]}
    emptyState={error ? null : <ErpEmptyState title="مرجوعی پروژه‌ای ثبت نشده است" />}
    footer={page?.nextCursor && !error ? <ErpButton label="نمایش موارد بیشتر" variant="soft" disabled={loading}
      onClick={() => setAfter(page.nextCursor ?? undefined)} /> : null}
  >
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />}
    {notice && <ErpInlineState kind="success" title={notice} />}
    {sepidar && sepidarApi && <SepidarDispatchInvoices key={sepidar.draftId} loadingId={sepidar.draftId}
      subject="return" contracts={[]} api={sepidarApi} blocked={false} onError={handleSepidarError}
      onClose={() => setSepidar(null)} onSaved={(invoices, _audit, correction) => {
        setNotice(correction ? 'فاکتورهای سپیدار مرجوعی اصلاح شدند.' : 'فاکتورهای سپیدار مرجوعی ثبت شدند.');
        setPage(current => current && ({
          ...current, items: current.items.map(row => row.id === sepidar.caseId && row.sepidarReference?.draftId === sepidar.draftId
            ? { ...row, sepidarReference: { draftId: sepidar.draftId, registered: invoices.length > 0 } } : row),
        }));
        setSepidar(null);
      }} />}
  </ErpListPage>;
}
