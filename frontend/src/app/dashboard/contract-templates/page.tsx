'use client';
import { useEffect, useMemo, useState } from 'react';
import { FaCopy, FaEdit, FaEye, FaFileContract, FaPlus, FaTrash } from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpEmptyState, ErpListPage, ErpLoading, type ErpColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { contractTemplatesAPI } from '@/lib/api';

interface ContractTemplate {
  id: string;
  name: string;
  namePersian: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  createdByUser: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
  _count: {
    contracts: number;
  };
}

export default function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchTemplates();
  }, [categoryFilter, statusFilter]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: any = {};
      if (categoryFilter) params.category = categoryFilter;
      if (statusFilter !== 'all') params.isActive = statusFilter === 'active';

      const response = await contractTemplatesAPI.getAll(params);
      if (response.data.success) {
        setTemplates(response.data.data);
      } else {
        setError('خطا در دریافت قالب‌ها');
      }
    } catch (error: any) {
      console.error('Error fetching templates:', error);
      setError(error.response?.data?.error || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm('آیا از حذف این قالب قرارداد مطمئن هستید؟')) return;
    try {
      await contractTemplatesAPI.delete(templateId);
      setTemplates((prev) => prev.filter((template) => template.id !== templateId));
    } catch (error: any) {
      console.error('Error deleting template:', error);
      alert('خطا در حذف قالب: ' + (error.response?.data?.error || 'خطای نامشخص'));
    }
  };

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => (
      template.namePersian.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      Boolean(template.description && template.description.toLowerCase().includes(searchTerm.toLowerCase()))
    ));
  }, [templates, searchTerm]);

  const getCategoryLabel = (category: string | null) => {
    switch (category) {
      case 'sales': return 'فروش';
      case 'service': return 'خدمات';
      case 'maintenance': return 'نگهداری';
      default: return 'عمومی';
    }
  };

  const getCategoryTone = (category: string | null): ErpTone => {
    switch (category) {
      case 'sales': return 'primary';
      case 'service': return 'warning';
      case 'maintenance': return 'info';
      default: return 'neutral';
    }
  };

  if (loading) return <ErpLoading />;

  if (error) {
    return (
      <ErpEmptyState
        icon={FaFileContract}
        title="خطا در دریافت قالب‌ها"
        description={error}
        action={{ label: 'تلاش دوباره', onClick: fetchTemplates, tone: 'primary', variant: 'solid' }}
      />
    );
  }

  const metrics: ErpMetric[] = [
    { label: 'کل قالب‌ها', value: templates.length.toLocaleString('fa-IR'), icon: FaFileContract, tone: 'primary' },
    { label: 'فعال', value: templates.filter((template) => template.isActive).length.toLocaleString('fa-IR'), icon: FaCopy, tone: 'success' },
    { label: 'غیرفعال', value: templates.filter((template) => !template.isActive).length.toLocaleString('fa-IR'), icon: FaTrash, tone: 'danger' },
    { label: 'قراردادهای وابسته', value: templates.reduce((sum, template) => sum + template._count.contracts, 0).toLocaleString('fa-IR'), icon: FaFileContract, tone: 'info' },
  ];

  const columns: ErpColumn<ContractTemplate>[] = [
    {
      id: 'template',
      header: 'قالب',
      priority: 'primary',
      cell: (template) => (
        <div>
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{template.namePersian}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{template.name}</p>
          {template.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{template.description}</p>}
        </div>
      ),
    },
    { id: 'category', header: 'دسته', mobileLabel: 'دسته', priority: 'secondary', cell: (template) => <ErpBadge tone={getCategoryTone(template.category)}>{getCategoryLabel(template.category)}</ErpBadge> },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'meta', cell: (template) => <ErpBadge tone={template.isActive ? 'success' : 'danger'}>{template.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge> },
    { id: 'contracts', header: 'قراردادها', mobileLabel: 'قراردادها', priority: 'meta', align: 'center', cell: (template) => `${template._count.contracts.toLocaleString('fa-IR')} قرارداد` },
    { id: 'creator', header: 'ایجادکننده', mobileLabel: 'ایجادکننده', priority: 'hidden-mobile', cell: (template) => `${template.createdByUser.firstName} ${template.createdByUser.lastName}` },
  ];

  return (
    <ErpListPage
      eyebrow="قراردادها"
      title="قالب‌های قرارداد"
      metrics={metrics}
      actions={[{ label: 'قالب جدید', href: '/dashboard/contract-templates/create', icon: FaPlus, tone: 'primary', variant: 'solid' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchTerm, placeholder: 'جستجو در قالب‌ها...', onChange: setSearchTerm },
        {
          id: 'category',
          label: 'دسته',
          type: 'select',
          value: categoryFilter,
          onChange: setCategoryFilter,
          options: [
            { label: 'همه دسته‌ها', value: '' },
            { label: 'فروش', value: 'sales' },
            { label: 'خدمات', value: 'service' },
            { label: 'نگهداری', value: 'maintenance' },
          ],
        },
        {
          id: 'status',
          label: 'وضعیت',
          type: 'select',
          value: statusFilter,
          onChange: setStatusFilter,
          options: [
            { label: 'همه وضعیت‌ها', value: 'all' },
            { label: 'فعال', value: 'active' },
            { label: 'غیرفعال', value: 'inactive' },
          ],
        },
      ]}
      rows={filteredTemplates}
      rowKey={(template) => template.id}
      columns={columns}
      rowActions={(template) => [
        { label: 'مشاهده', href: `/dashboard/contract-templates/${template.id}`, icon: FaEye, title: 'مشاهده' },
        { label: 'ویرایش', href: `/dashboard/contract-templates/${template.id}/edit`, icon: FaEdit, title: 'ویرایش' },
        { label: 'استفاده', href: `/dashboard/contracts/create?template=${template.id}`, icon: FaCopy, tone: 'primary', title: 'استفاده' },
        { label: 'حذف قالب', onClick: () => handleDelete(template.id), icon: FaTrash, tone: 'danger', title: 'حذف قالب' },
      ]}
      emptyState={
        <ErpEmptyState
          icon={FaFileContract}
          title={searchTerm ? 'قالبی یافت نشد' : 'هنوز قالبی ثبت نشده است'}
          description={searchTerm ? 'عبارت جستجو را تغییر دهید و دوباره تلاش کنید.' : 'برای شروع، یک قالب قرارداد جدید ایجاد کنید.'}
          action={!searchTerm ? { label: 'ایجاد قالب جدید', href: '/dashboard/contract-templates/create', icon: FaPlus, tone: 'primary', variant: 'solid' } : undefined}
        />
      }
    >
      <ErpActionGrid
        columns={3}
        compact
        items={[
          { title: 'ایجاد قالب قرارداد', href: '/dashboard/contract-templates/create', icon: FaPlus, tone: 'primary' },
          { title: 'ایجاد قرارداد جدید', href: '/dashboard/contracts/create', icon: FaFileContract, tone: 'success' },
          { title: 'مشاهده قراردادها', href: '/dashboard/contracts', icon: FaFileContract, tone: 'neutral' },
        ]}
      />
    </ErpListPage>
  );
}
