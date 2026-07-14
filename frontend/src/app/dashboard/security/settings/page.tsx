'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaCalendarAlt, FaCog, FaFolderOpen, FaPlus, FaSave, FaSearch, FaUserMinus, FaUserPlus, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { departmentsAPI, securityAPI } from '@/lib/api';
import { PersianCalendar } from '@/lib/persian-calendar';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const emptyCategoryForm = { id: '', name: '', description: '', displayOrder: 0, isActive: true };
const emptyTypeForm = { id: '', categoryId: '', name: '', description: '', displayOrder: 0, isActive: true };

interface Department {
  id: string;
  name: string;
  namePersian?: string;
}

interface ReportCategory {
  id: string;
  name: string;
  description?: string | null;
  displayOrder: number;
  isActive: boolean;
  reportTypes?: any[];
}

interface RosterRow {
  personnel: {
    id: string;
    firstName: string;
    lastName: string;
    department?: Department | null;
    user?: { username?: string; email?: string } | null;
  };
  isInRoster: boolean;
  membership?: {
    id: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  } | null;
}

const toIsoDate = (persianDate: string) => PersianCalendar.toGregorian(persianDate).toISOString();
const personName = (row: RosterRow) => `${row.personnel.firstName} ${row.personnel.lastName}`.trim();

export default function SecuritySettingsPage() {
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [rosterDate, setRosterDate] = useState(PersianCalendar.now());
  const [rosterDepartmentId, setRosterDepartmentId] = useState('');
  const [rosterSearch, setRosterSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState('');
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

  const loadRoster = async () => {
    setRosterLoading(true);
    try {
      const response = await securityAPI.getAttendanceRoster({
        date: toIsoDate(rosterDate),
        departmentId: rosterDepartmentId || undefined
      });
      if (response.data.success) setRosterRows(response.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت فهرست حضور و غیاب حراست ناموفق بود.');
    } finally {
      setRosterLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [departmentsResponse] = await Promise.all([departmentsAPI.getDepartments(), loadReportSettings()]);
      if (departmentsResponse.data.success) setDepartments(departmentsResponse.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت تنظیمات حراست ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading) loadRoster();
  }, [loading, rosterDate, rosterDepartmentId]);

  const filteredRosterRows = useMemo(() => {
    const query = rosterSearch.trim().toLowerCase();
    if (!query) return rosterRows;
    return rosterRows.filter((row) => {
      const text = `${personName(row)} ${row.personnel.department?.namePersian || row.personnel.department?.name || ''} ${row.personnel.user?.username || ''}`.toLowerCase();
      return text.includes(query);
    });
  }, [rosterRows, rosterSearch]);

  const rosterCounts = useMemo(() => ({
    total: rosterRows.length,
    selected: rosterRows.filter((row) => row.isInRoster).length
  }), [rosterRows]);

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

  const updateRoster = async (row: RosterRow, action: 'add' | 'remove') => {
    setActionLoadingId(`${action}-${row.personnel.id}`);
    setError('');
    setMessage('');
    try {
      const payload = { effectiveDate: toIsoDate(rosterDate) };
      const response = action === 'add'
        ? await securityAPI.addAttendanceRosterMember({ personnelId: row.personnel.id, ...payload })
        : await securityAPI.removeAttendanceRosterMember(row.personnel.id, payload);
      setMessage(response.data.message || (action === 'add' ? 'فرد به فهرست اضافه شد.' : 'فرد از فهرست حذف شد.'));
      await loadRoster();
    } catch (err: any) {
      setError(err.response?.data?.error || 'به‌روزرسانی فهرست حضور و غیاب حراست ناموفق بود.');
    } finally {
      setActionLoadingId('');
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="تنظیمات حراست"
      description="مدیریت دسته‌بندی و نوع گزارش‌های لحظه‌ای و فهرست حضور و غیاب حراست."
      metrics={[
        { label: 'دسته‌بندی گزارش', value: categories.length.toLocaleString('fa-IR'), icon: FaFolderOpen, tone: 'info' },
        { label: 'نوع گزارش', value: types.length.toLocaleString('fa-IR'), icon: FaCog, tone: 'info' },
        { label: 'داخل فهرست حضور', value: rosterCounts.selected.toLocaleString('fa-IR'), icon: FaUsers, tone: 'success' }
      ]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100">{error}</div>}

      <ErpSection title="فهرست حضور و غیاب حراست" description="فقط افراد داخل این فهرست در حضور و غیاب، شاخص‌ها و گزارش‌های حراست حساب می‌شوند.">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
          <label>
            <span className={labelClass}>تاریخ اثرگذاری</span>
            <PersianCalendarComponent value={rosterDate} onChange={setRosterDate} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>دپارتمان</span>
            <select className={inputClass} value={rosterDepartmentId} onChange={(event) => setRosterDepartmentId(event.target.value)}>
              <option value="">همه دپارتمان‌ها</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.namePersian || department.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>جستجو</span>
            <div className="relative">
              <FaSearch className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputClass} pr-11`} value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="نام، نام کاربری یا دپارتمان" />
            </div>
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <FaCalendarAlt className="ml-2 inline text-[#074747] dark:text-teal-300" />
          تغییرات با تاریخ انتخاب‌شده اعمال می‌شود. برای اثرگذاری از فردا، تاریخ فردا را انتخاب کنید.
        </div>

        {rosterLoading ? (
          <div className="mt-4"><ErpLoading /></div>
        ) : filteredRosterRows.length === 0 ? (
          <ErpEmptyState icon={FaUsers} title="پرسنلی برای نمایش وجود ندارد" />
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filteredRosterRows.map((row) => {
              const loadingAction = actionLoadingId.endsWith(row.personnel.id);
              return (
                <ErpCard key={row.personnel.id} className="p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-slate-900 dark:text-white">{personName(row)}</p>
                        <ErpBadge tone={row.isInRoster ? 'success' : 'neutral'}>{row.isInRoster ? 'داخل فهرست' : 'خارج از فهرست'}</ErpBadge>
                      </div>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{row.personnel.department?.namePersian || row.personnel.department?.name || 'بدون دپارتمان'}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {row.isInRoster && row.membership?.effectiveFrom
                          ? `از ${PersianCalendar.toPersian(row.membership.effectiveFrom)} در فهرست است`
                          : 'در تاریخ انتخاب‌شده در فهرست حضور نیست'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {row.isInRoster ? (
                        <ErpButton label="حذف از فهرست" icon={FaUserMinus} onClick={() => updateRoster(row, 'remove')} tone="warning" variant="soft" disabled={loadingAction} />
                      ) : (
                        <ErpButton label="افزودن به فهرست" icon={FaUserPlus} onClick={() => updateRoster(row, 'add')} variant="solid" disabled={loadingAction} />
                      )}
                    </div>
                  </div>
                </ErpCard>
              );
            })}
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
