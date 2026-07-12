'use client';

import { useEffect, useState } from 'react';
import { FaEye, FaPlus, FaProjectDiagram } from 'react-icons/fa';
import { CrmGuide } from '@/components/crm/CrmGuide';
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

const guideSteps = [
  {
    targetId: 'project-filters',
    title: 'فیلتر پروژه‌ها',
    body: 'برای پیدا کردن پروژه‌های احتمالی بر اساس وضعیت، نوع کار یا جستجوی نام مخاطب و پروژه از این بخش استفاده کنید.',
    fields: ['جستجو', 'وضعیت', 'نوع کار/معامله'],
  },
  {
    targetId: 'project-list',
    title: 'فهرست پروژه‌های احتمالی',
    body: 'هر ردیف یک فرصت قبل از قرارداد است. جزئیات پیگیری و اقدام‌های بعدی داخل صفحه پروژه دیده می‌شود.',
    mistakes: ['ساخت قرارداد فروش برای پروژه‌ای که هنوز آماده قرارداد نیست'],
  },
];

const filterInputClass = 'mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const filterLabelClass = 'block text-sm font-semibold text-slate-700 dark:text-slate-200';

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
          <p className="mt-1 text-xs text-slate-500">{crmPersonName(row.customer)}</p>
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
        { label: 'راهنما', onClick: () => {}, disabled: true, tone: 'info', variant: 'outline' },
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
      <div className="flex justify-end">
        <CrmGuide steps={guideSteps} />
      </div>
      <ErpSection className="p-4">
        <div data-crm-guide="project-filters" className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className={filterLabelClass}>
            جستجو
            <input
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
      <div data-crm-guide="project-list" />
    </ErpListPage>
  );
}
