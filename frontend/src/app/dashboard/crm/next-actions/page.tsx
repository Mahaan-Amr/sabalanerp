'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FaEye, FaTasks } from 'react-icons/fa';
import { ErpBadge, ErpEmptyState, ErpInlineState, ErpListPage, ErpPagination, type ErpColumn } from '@/components/erp';
import { crmAPI } from '@/lib/api';
import { crmPersonName, crmUserName } from '@/lib/crmPipeline';
import PersianCalendar from '@/lib/persian-calendar';

type NextAction = {
  id: string;
  title: string;
  dueAt: string;
  status: string;
  communicationType: string;
  customer: { id: string | null; firstName: string; lastName: string };
  potentialProject?: { id: string; title: string } | null;
  assignedTo?: { firstName?: string; lastName?: string } | null;
};

export default function NextActionsPage() {
  const overdue = useSearchParams().get('due') === 'overdue';
  const [rows, setRows] = useState<NextAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 0, limit: 20 });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    crmAPI.getNextActions({ page, limit: 20, ...(overdue ? { due: 'overdue' } : {}) })
      .then(response => {
        if (!active) return;
        if (!response.data.success) throw new Error();
        setRows(response.data.data);
        setPagination(response.data.pagination);
      })
      .catch(() => { if (active) setError('دریافت اقدام‌های پیگیری انجام نشد. دوباره تلاش کنید.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, overdue, revision]);

  const columns: ErpColumn<NextAction>[] = [
    { id: 'title', header: 'اقدام', priority: 'primary', cell: row => <div className="min-w-0"><p className="font-semibold">{row.title}</p><p className="mt-1 text-xs sds-text-secondary">{row.potentialProject?.title || crmPersonName(row.customer)}</p></div> },
    { id: 'customer', header: 'مشتری', cell: row => crmPersonName(row.customer), priority: 'secondary' },
    { id: 'due', header: 'سررسید', cell: row => PersianCalendar.formatForDisplay(row.dueAt), priority: 'secondary' },
    { id: 'status', header: 'وضعیت', cell: row => <ErpBadge tone={overdue ? 'danger' : 'info'}>{row.status}</ErpBadge> },
    { id: 'type', header: 'نوع ارتباط', cell: row => row.communicationType, priority: 'meta' },
    { id: 'seller', header: 'مسئول', cell: row => crmUserName(row.assignedTo ?? undefined), priority: 'meta' },
  ];

  return <ErpListPage
    title={overdue ? 'اقدام‌های عقب‌افتاده' : 'اقدام‌های پیگیری'}
    eyebrow="ارتباط با مشتری"
    backHref="/dashboard/crm"
    rows={error ? [] : rows}
    rowKey={row => row.id}
    columns={columns}
    isLoading={loading}
    rowActions={row => row.potentialProject?.id || row.customer.id ? [{ label: 'مشاهده پرونده', icon: FaEye, href: row.potentialProject?.id ? `/dashboard/crm/potential-projects/${row.potentialProject.id}` : `/dashboard/crm/customers/${row.customer.id}`, tone: 'primary' }] : []}
    emptyState={error ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRevision(value => value + 1) }} /> : <ErpEmptyState title={overdue ? 'اقدام عقب‌افتاده‌ای ندارید' : 'اقدام پیگیری ثبت نشده است'} icon={FaTasks} />}
    footer={!error && <ErpPagination currentPage={page} totalPages={pagination.pages} totalItems={pagination.total} itemsPerPage={pagination.limit} onPageChange={setPage} itemLabel="اقدام" />}
  />;
}
