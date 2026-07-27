'use client';
import { useEffect, useState } from 'react';
import { FaPlus, FaTasks } from 'react-icons/fa';
import { ErpBadge, ErpEmptyState, ErpListPage, ErpPagination, type ErpColumn } from '@/components/erp';
import { crmAPI } from '@/lib/api';
import { crmPersonName, crmUserName } from '@/lib/crmPipeline';
import PersianCalendar from '@/lib/persian-calendar';

type FollowUp = {
  id: string;
  customer: any;
  potentialProject?: any;
  seller: any;
  communicationType: string;
  workType: string;
  happenedAt: string;
  summary: string;
  outcome: string;
  nextAction?: any;
};

export default function FollowUpsPage() {
  const [rows, setRows] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });

  useEffect(() => {
    fetchRows();
  }, [pagination.page]);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const response = await crmAPI.getFollowUps({ page: pagination.page, limit: pagination.limit });
      if (response.data.success) {
        setRows(response.data.data);
        setPagination((prev) => ({ ...prev, ...response.data.pagination }));
      }
    } finally {
      setLoading(false);
    }
  };

  const columns: ErpColumn<FollowUp>[] = [
    {
      id: 'summary',
      header: 'گزارش',
      priority: 'primary',
      cell: (row) => (
        <div>
          <p className="font-semibold">{row.summary}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.potentialProject?.title || crmPersonName(row.customer)}</p>
        </div>
      ),
    },
    { id: 'type', header: 'نوع ارتباط', cell: (row) => <ErpBadge tone="info">{row.communicationType}</ErpBadge>, priority: 'secondary' },
    { id: 'work', header: 'نوع کار', cell: (row) => row.workType, priority: 'secondary' },
    { id: 'seller', header: 'فروشنده', cell: (row) => crmUserName(row.seller), priority: 'meta' },
    { id: 'date', header: 'زمان', cell: (row) => PersianCalendar.formatForDisplay(row.happenedAt), priority: 'meta' },
  ];

  return (
    <ErpListPage
      title="گزارش‌های پیگیری"
      eyebrow="CRM"
      description="تاریخچه پیگیری‌های مشتریان و پروژه‌های احتمالی."
      actions={[{ label: 'ثبت گزارش', href: '/dashboard/crm/follow-ups/create', icon: FaPlus, tone: 'primary', variant: 'solid' }]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaTasks} title="گزارش پیگیری ثبت نشده است" action={{ label: 'ثبت گزارش', href: '/dashboard/crm/follow-ups/create', icon: FaPlus, tone: 'primary', variant: 'solid' }} />}
      footer={<ErpPagination currentPage={pagination.page} totalPages={pagination.pages} totalItems={pagination.total} itemsPerPage={pagination.limit} onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))} itemLabel="گزارش" />}
    >

      <div />
    </ErpListPage>
  );
}
