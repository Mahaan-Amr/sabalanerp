'use client';

import { useEffect, useState } from 'react';
import { FaEye, FaSync } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpListPage, ErpStatus } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import {
  isProjectReturnAllocationEditable, projectReturnAllocationApi, projectReturnAllocationStatuses, projectReturnHistoryHref, projectReturnReviewHref,
} from './projectReturnAllocationApi';
import { displayExactDecimal } from './stoneReturnApi';

export function ProjectReturnReviewList() {
  const [page, setPage] = useState<Awaited<ReturnType<typeof projectReturnAllocationApi.list>>>();
  const [after, setAfter] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

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
    rowActions={row => [{
      label: page?.canAllocate && isProjectReturnAllocationEditable(row.allocationStatus) ? 'رسیدگی' : 'مشاهده پرونده',
      href: projectReturnReviewHref(row.id), icon: FaEye, tone: 'primary',
    }]}
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
  </ErpListPage>;
}
