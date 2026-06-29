'use client';

import { useEffect, useState } from 'react';
import { FaEye, FaPlus, FaSync, FaTruck } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, ErpQuickFilters } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { StatusBadge, dateFa, driverName } from '../logistics-ui';

export default function LogisticsLoadingsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const response = await logisticsAPI.getLoadings(status === 'ALL' ? undefined : { status });
      if (response.data.success) setRows(response.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  return (
    <ErpListPage
      title="بارگیری‌ها"
      eyebrow="لجستیک"
      description="رجیستر عملیاتی بارگیری‌ها؛ فقط اسناد نهایی روی مانده پروژه اثر می‌گذارند."
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: load, tone: 'neutral' },
        { label: 'بارگیری جدید', icon: FaPlus, href: '/dashboard/logistics/loadings/new', tone: 'primary', variant: 'solid' },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      isLoading={loading}
      columns={[
        { id: 'number', header: 'شماره', priority: 'primary', cell: (row) => <a className="font-semibold text-[#074747] dark:text-teal-200" href={`/dashboard/logistics/loadings/${row.id}`}>{row.loadingNumber}</a> },
        { id: 'status', header: 'وضعیت', cell: (row) => <StatusBadge status={row.status} /> },
        { id: 'project', header: 'پروژه', cell: (row) => <span>{row.customerName} · {row.projectName}</span> },
        { id: 'driver', header: 'راننده', cell: (row) => driverName(row.driverSnapshot) },
        { id: 'date', header: 'تاریخ', cell: (row) => dateFa(row.loadingDate) },
        { id: 'lines', header: 'ردیف', align: 'center', cell: (row) => (row.lineCount || 0).toLocaleString('fa-IR') },
      ]}
      rowActions={(row) => [{ label: 'مشاهده', icon: FaEye, href: `/dashboard/logistics/loadings/${row.id}` }]}
      emptyState={<ErpEmptyState icon={FaTruck} title="بارگیری‌ای برای نمایش وجود ندارد" action={{ label: 'بارگیری جدید', href: '/dashboard/logistics/loadings/new', icon: FaPlus }} />}
      footer={<ErpPagination currentPage={1} totalPages={1} onPageChange={() => undefined} totalItems={rows.length} itemsPerPage={rows.length || 1} itemLabel="بارگیری" />}
    >
      <ErpQuickFilters
        value={status}
        onChange={setStatus}
        items={[
          { id: 'all', label: 'همه', value: 'ALL' },
          { id: 'draft', label: 'پیش‌نویس', value: 'DRAFT', tone: 'warning' },
          { id: 'finalized', label: 'نهایی‌شده', value: 'FINALIZED', tone: 'success' },
          { id: 'cancelled', label: 'لغوشده', value: 'CANCELLED', tone: 'danger' },
        ]}
      />
    </ErpListPage>
  );
}
