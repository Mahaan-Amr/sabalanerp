'use client';

import { useEffect, useState } from 'react';
import { FaCog, FaFolderOpen, FaPlus, FaSave, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { securityAPI } from '@/lib/api';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const emptyCategoryForm = { id: '', name: '', description: '', displayOrder: 0, isActive: true };
const emptyTypeForm = { id: '', categoryId: '', name: '', description: '', displayOrder: 0, isActive: true };

interface ReportCategory {
  id: string;
  name: string;
  description?: string | null;
  displayOrder: number;
  isActive: boolean;
  reportTypes?: any[];
}

interface OperationalPerson {
  id: string;
  user: {
    firstName: string;
    lastName: string;
    username?: string;
    department?: { name?: string; namePersian?: string } | null;
  };
  shift?: { namePersian?: string } | null;
}

const personName = (person: OperationalPerson) => `${person.user.firstName} ${person.user.lastName}`.trim();

export default function SecuritySettingsPage() {
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [operationalPersonnel, setOperationalPersonnel] = useState<OperationalPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadReportSettings = async () => {
    const [categoryResponse, typeResponse] = await Promise.all([
      securityAPI.getInstantReportCategories(true),
      securityAPI.getInstantReportTypes(true)
    ]);
    if (categoryResponse.data.success) setCategories(categoryResponse.data.data || []);
    if (typeResponse.data.success) setTypes(typeResponse.data.data || []);
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [personnelResponse] = await Promise.all([securityAPI.getOperationalPersonnel(), loadReportSettings()]);
      if (personnelResponse.data.success) setOperationalPersonnel(personnelResponse.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت تنظیمات حراست ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveCategory = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (categoryForm.id) {
        await securityAPI.updateInstantReportCategory(categoryForm.id, categoryForm);
        setMessage('دسته‌بندی گزارش ویرایش شد.');
      } else {
        await securityAPI.createInstantReportCategory(categoryForm);
        setMessage('دسته‌بندی گزارش ثبت شد.');
      }
      setCategoryForm(emptyCategoryForm);
      await loadReportSettings();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ذخیره دسته‌بندی گزارش ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const saveType = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (typeForm.id) {
        await securityAPI.updateInstantReportType(typeForm.id, typeForm);
        setMessage('نوع گزارش ویرایش شد.');
      } else {
        await securityAPI.createInstantReportType(typeForm);
        setMessage('نوع گزارش ثبت شد.');
      }
      setTypeForm(emptyTypeForm);
      await loadReportSettings();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ذخیره نوع گزارش ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="تنظیمات حراست"
      description="مدیریت دسته‌بندی و نوع گزارش‌های لحظه‌ای و مشاهده جمعیت عملیاتی A/B/C حراست."
      metrics={[
        { label: 'دسته‌بندی گزارش', value: categories.length.toLocaleString('fa-IR'), icon: FaFolderOpen, tone: 'info' },
        { label: 'نوع گزارش', value: types.length.toLocaleString('fa-IR'), icon: FaCog, tone: 'info' },
        { label: 'نیروی عملیاتی جاری', value: operationalPersonnel.length.toLocaleString('fa-IR'), icon: FaUsers, tone: 'success' }
      ]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100">{error}</div>}

      <ErpSection title="جمعیت عملیاتی جاری حراست" description="حضور و غیاب، داشبورد و گزارش‌ها فقط از سه نیروی A/B/C آخرین برنامه منتشرشده استفاده می‌کنند.">
        {operationalPersonnel.length === 0 ? (
          <ErpEmptyState icon={FaUsers} title="برنامه شیفت منتشرشده‌ای وجود ندارد" description="برای تعیین جمعیت عملیاتی حراست، یک برنامه A/B/C را منتشر کنید." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {operationalPersonnel.map((person, index) => (
              <ErpCard key={person.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{personName(person)}</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{person.shift?.namePersian || person.user.department?.namePersian || 'حراست'}</p>
                  </div>
                  <ErpBadge tone="success">{['A', 'B', 'C'][index]}</ErpBadge>
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSection title={categoryForm.id ? 'ویرایش دسته‌بندی گزارش' : 'دسته‌بندی گزارش جدید'}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_160px_auto] lg:items-end">
          <label>
            <span className={labelClass}>نام دسته‌بندی</span>
            <input className={inputClass} value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>توضیحات</span>
            <input className={inputClass} value={categoryForm.description || ''} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>ترتیب نمایش</span>
            <input className={inputClass} type="number" min={0} value={categoryForm.displayOrder} onChange={(event) => setCategoryForm((current) => ({ ...current, displayOrder: Number(event.target.value || 0) }))} />
          </label>
          <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 dark:border-slate-700 dark:bg-slate-800">
            <input type="checkbox" checked={categoryForm.isActive} onChange={(event) => setCategoryForm((current) => ({ ...current, isActive: event.target.checked }))} />
            <span className="text-sm text-slate-700 dark:text-slate-200">فعال</span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ErpButton label={categoryForm.id ? 'ذخیره دسته‌بندی' : 'ثبت دسته‌بندی'} icon={categoryForm.id ? FaSave : FaPlus} onClick={saveCategory} disabled={saving || !categoryForm.name.trim()} variant="solid" />
          {categoryForm.id && <ErpButton label="انصراف" onClick={() => setCategoryForm(emptyCategoryForm)} tone="neutral" variant="outline" />}
        </div>
      </ErpSection>

      <ErpSection title="دسته‌بندی‌های گزارش لحظه‌ای">
        {categories.length === 0 ? (
          <ErpEmptyState icon={FaFolderOpen} title="دسته‌بندی گزارش تعریف نشده است" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {categories.map((category) => (
              <ErpCard key={category.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{category.name}</p>
                      <ErpBadge tone={category.isActive ? 'success' : 'neutral'}>{category.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">ترتیب: {category.displayOrder.toLocaleString('fa-IR')} · نوع‌ها: {(category.reportTypes?.length || 0).toLocaleString('fa-IR')}</p>
                    {category.description && <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{category.description}</p>}
                  </div>
                  <ErpButton label="ویرایش" onClick={() => setCategoryForm({ id: category.id, name: category.name, description: category.description || '', displayOrder: category.displayOrder || 0, isActive: category.isActive })} tone="neutral" variant="outline" />
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSection title={typeForm.id ? 'ویرایش نوع گزارش' : 'نوع گزارش جدید'}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1.5fr)_160px_auto] lg:items-end">
          <label>
            <span className={labelClass}>دسته‌بندی</span>
            <select className={inputClass} value={typeForm.categoryId} onChange={(event) => setTypeForm((current) => ({ ...current, categoryId: event.target.value }))}>
              <option value="">انتخاب دسته‌بندی</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>نام</span>
            <input className={inputClass} value={typeForm.name} onChange={(event) => setTypeForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>توضیحات</span>
            <input className={inputClass} value={typeForm.description || ''} onChange={(event) => setTypeForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>ترتیب نمایش</span>
            <input className={inputClass} type="number" min={0} value={typeForm.displayOrder} onChange={(event) => setTypeForm((current) => ({ ...current, displayOrder: Number(event.target.value || 0) }))} />
          </label>
          <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 dark:border-slate-700 dark:bg-slate-800">
            <input type="checkbox" checked={typeForm.isActive} onChange={(event) => setTypeForm((current) => ({ ...current, isActive: event.target.checked }))} />
            <span className="text-sm text-slate-700 dark:text-slate-200">فعال</span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ErpButton label={typeForm.id ? 'ذخیره تغییرات' : 'ثبت نوع گزارش'} icon={typeForm.id ? FaSave : FaPlus} onClick={saveType} disabled={saving || !typeForm.categoryId || !typeForm.name.trim()} variant="solid" />
          {typeForm.id && <ErpButton label="انصراف" onClick={() => setTypeForm(emptyTypeForm)} tone="neutral" variant="outline" />}
        </div>
      </ErpSection>

      <ErpSection title="انواع گزارش لحظه‌ای">
        {types.length === 0 ? (
          <ErpEmptyState icon={FaCog} title="نوع گزارش تعریف نشده است" />
        ) : (
          <div className="space-y-3">
            {types.map((type) => (
              <ErpCard key={type.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{type.name}</p>
                      <ErpBadge tone={type.isActive ? 'success' : 'neutral'}>{type.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                      {type.category && <ErpBadge tone={type.category.isActive ? 'info' : 'warning'}>{type.category.name}</ErpBadge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">ترتیب: {type.displayOrder.toLocaleString('fa-IR')}</p>
                    {type.description && <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{type.description}</p>}
                  </div>
                  <ErpButton
                    label="ویرایش"
                    onClick={() => setTypeForm({ id: type.id, categoryId: type.categoryId || type.category?.id || '', name: type.name, description: type.description || '', displayOrder: type.displayOrder || 0, isActive: type.isActive })}
                    tone="neutral"
                    variant="outline"
                  />
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>
    </ErpPage>
  );
}
