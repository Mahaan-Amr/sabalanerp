'use client';

import { useEffect, useState } from 'react';
import { FaEye, FaPlus, FaProjectDiagram } from 'react-icons/fa';
import { CrmGuide } from '@/components/crm/CrmGuide';
import { ErpBadge, ErpEmptyState, ErpListPage, ErpPagination, type ErpColumn } from '@/components/erp';
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
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, placeholder: 'نام پروژه، مخاطب یا توضیح', onChange: (value) => { setSearch(value); setPagination((prev) => ({ ...prev, page: 1 })); } },
        { id: 'status', label: 'وضعیت', type: 'select', value: status, options: [{ label: 'همه وضعیت‌ها', value: '' }, ...POTENTIAL_PROJECT_STATUSES.map((item) => ({ label: item, value: item }))], onChange: (value) => { setStatus(value); setPagination((prev) => ({ ...prev, page: 1 })); } },
        { id: 'workType', label: 'نوع کار', type: 'select', value: workType, options: [{ label: 'همه نوع‌ها', value: '' }, ...CRM_WORK_TYPES.map((item) => ({ label: item, value: item }))], onChange: (value) => { setWorkType(value); setPagination((prev) => ({ ...prev, page: 1 })); } },
      ]}
      rowActions={(row) => [{ label: 'مشاهده', href: `/dashboard/crm/potential-projects/${row.id}`, icon: FaEye, tone: 'primary' }]}
      footer={<ErpPagination currentPage={pagination.page} totalPages={pagination.pages} totalItems={pagination.total} itemsPerPage={pagination.limit} onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))} itemLabel="پروژه" />}
    >
      <div className="flex justify-end">
        <CrmGuide steps={guideSteps} />
      </div>
      <div data-crm-guide="project-filters" />
      <div data-crm-guide="project-list" />
    </ErpListPage>
  );
}
