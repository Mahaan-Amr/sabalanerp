'use client';
import { ErpInput } from '@/components/erp';
import { useEffect, useState } from 'react';
import { FaEye, FaPlus, FaProjectDiagram } from 'react-icons/fa';
import { ErpBadge, ErpEmptyState, ErpListPage, ErpPagination, ErpSection, type ErpColumn } from '@/components/erp';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import { crmAPI } from '@/lib/api';
import { crmPersonName, crmUserName, formatToman, potentialProjectStatusTone, POTENTIAL_PROJECT_STATUSES, CRM_WORK_TYPES } from '@/lib/crmPipeline';
import PersianCalendar from '@/lib/persian-calendar';

type Project = {
  id: string;
  title: string;
  status: string;
  workType: string;
  estimatedValue?: string | number | null;
  expectedCloseDate?: string | null;
  customer: any;
  responsibleSeller: any;
  updatedAt: string;
  _count?: { followUpReports: number; nextActions: number };
};

const filterInputClass = 'mt-2 min-h-12 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-4 py-3 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] dark:focus:bg-[var(--sds-surface-raised)]';
const filterLabelClass = 'block text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]';

export default function PotentialProjectsPage() {
  const [rows, setRows] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [workType, setWorkType] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });

  useEffect(() => {
    fetchProjects();
  }, [search, status, workType, pagination.page]);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const response = await crmAPI.getPotentialProjects({
        page: pagination.page,
        limit: pagination.limit,
        search: search || undefined,
        status: status || undefined,
        workType: workType || undefined,
      });
      if (response.data.success) {
        setRows(response.data.data);
        setPagination((prev) => ({ ...prev, ...response.data.pagination }));
      }
    } finally {
      setLoading(false);
    }
  };

  const resetToFirstPage = () => setPagination((prev) => ({ ...prev, page: 1 }));

  const columns: ErpColumn<Project>[] = [
    {
      id: 'project',
      header: 'پروژه',
      priority: 'primary',
      cell: (row) => (
        <div>
          <p className="font-semibold">{row.title}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{crmPersonName(row.customer)}</p>
        </div>
      ),
    },
    { id: 'status', header: 'وضعیت', cell: (row) => <ErpBadge tone={potentialProjectStatusTone(row.status)}>{row.status}</ErpBadge> },
    { id: 'workType', header: 'نوع کار', cell: (row) => row.workType, priority: 'secondary' },
    { id: 'seller', header: 'فروشنده مسئول', cell: (row) => crmUserName(row.responsibleSeller), priority: 'secondary' },
    { id: 'value', header: 'ارزش برآوردی', cell: (row) => formatToman(row.estimatedValue), priority: 'meta' },
    { id: 'updated', header: 'آخرین تغییر', cell: (row) => PersianCalendar.formatForDisplay(row.updatedAt), priority: 'meta' },
  ];

  return (
    <ErpListPage
      title="پروژه‌های احتمالی"
      eyebrow="CRM"
      description="فرصت‌ها و پروژه‌هایی که هنوز به قرارداد فروش تبدیل نشده‌اند."
      actions={[
        { label: 'پروژه جدید', href: '/dashboard/crm/potential-projects/create', icon: FaPlus, tone: 'primary', variant: 'solid' },
      ]}
      metrics={[]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaProjectDiagram} title="پروژه احتمالی ثبت نشده است" action={{ label: 'ثبت پروژه جدید', href: '/dashboard/crm/potential-projects/create', icon: FaPlus, tone: 'primary', variant: 'solid' }} />}
      rowActions={(row) => [{ label: 'مشاهده', href: `/dashboard/crm/potential-projects/${row.id}`, icon: FaEye, tone: 'primary' }]}
      footer={<ErpPagination currentPage={pagination.page} totalPages={pagination.pages} totalItems={pagination.total} itemsPerPage={pagination.limit} onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))} itemLabel="پروژه" />}
    >

      <ErpSection className="p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className={filterLabelClass}>
            جستجو
            <ErpInput
              className={filterInputClass}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetToFirstPage();
              }}
              placeholder="نام پروژه، مخاطب یا توضیح"
            />
          </label>
          <label className={filterLabelClass}>
            وضعیت
            <EnhancedDropdown
              className="mt-2"
              value={status}
              onChange={(value) => {
                setStatus(value);
                resetToFirstPage();
              }}
              placeholder="همه وضعیت‌ها"
              options={[{ label: 'همه وضعیت‌ها', value: '' }, ...POTENTIAL_PROJECT_STATUSES.map((item) => ({ label: item, value: item }))]}
              searchable
              clearable
            />
          </label>
          <label className={filterLabelClass}>
            نوع کار
            <EnhancedDropdown
              className="mt-2"
              value={workType}
              onChange={(value) => {
                setWorkType(value);
                resetToFirstPage();
              }}
              placeholder="همه نوع‌ها"
              options={[{ label: 'همه نوع‌ها', value: '' }, ...CRM_WORK_TYPES.map((item) => ({ label: item, value: item }))]}
              searchable
              clearable
            />
          </label>
        </div>
      </ErpSection>
      <div />
    </ErpListPage>
  );
}
