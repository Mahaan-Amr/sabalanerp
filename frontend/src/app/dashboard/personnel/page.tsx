'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaBuilding, FaLink, FaPlus, FaRedo, FaSave, FaTrash, FaUserTie, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpListPage, ErpLoading, ErpSection, type ErpColumn, type ErpMetric } from '@/components/erp';
import { departmentsAPI, personnelAPI } from '@/lib/api';

interface Department {
  id: string;
  namePersian: string;
}

interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  department?: Department | null;
  user?: {
    id: string;
    username: string;
    email: string;
    isActive: boolean;
  } | null;
  canDelete: boolean;
  _count?: { attendanceRecords: number };
}

const emptyForm = { id: '', firstName: '', lastName: '', departmentId: '', isActive: true, confirmDuplicate: false };
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';
const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';

export default function PersonnelManagementPage() {
  const [rows, setRows] = useState<Personnel[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [personnelResponse, departmentsResponse] = await Promise.all([
        personnelAPI.getPersonnel({ includeInactive: status !== 'active', search: search || undefined, departmentId: departmentId || undefined }),
        departmentsAPI.getDepartments(),
      ]);
      if (personnelResponse.data.success) setRows(personnelResponse.data.data || []);
      if (departmentsResponse.data.success) setDepartments(departmentsResponse.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت پرسنل ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((person) => {
      const matchesSearch = !q
        || `${person.firstName} ${person.lastName}`.toLowerCase().includes(q)
        || person.user?.username?.toLowerCase().includes(q);
      const matchesDepartment = !departmentId || person.department?.id === departmentId;
      const matchesStatus = status === 'all' || (status === 'active' ? person.isActive : !person.isActive);
      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }, [rows, search, departmentId, status]);

  const metrics: ErpMetric[] = [
    { label: 'کل پرسنل', value: rows.length.toLocaleString('fa-IR'), icon: FaUsers, tone: 'primary' },
    { label: 'فعال', value: rows.filter((person) => person.isActive).length.toLocaleString('fa-IR'), icon: FaUserTie, tone: 'success' },
    { label: 'دارای کاربر', value: rows.filter((person) => person.user).length.toLocaleString('fa-IR'), icon: FaLink, tone: 'info' },
    { label: 'بخش‌ها', value: departments.length.toLocaleString('fa-IR'), icon: FaBuilding, tone: 'purple' },
  ];

  const resetForm = () => setForm(emptyForm);

  const save = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('نام و نام خانوادگی الزامی است.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        departmentId: form.departmentId || null,
        isActive: form.isActive,
        confirmDuplicate: form.confirmDuplicate,
      };
      if (form.id) {
        await personnelAPI.updatePerson(form.id, payload);
        setMessage('پرسنل ویرایش شد.');
      } else {
        await personnelAPI.createPerson(payload);
        setMessage('پرسنل ثبت شد.');
      }
      resetForm();
      await load();
    } catch (err: any) {
      if (err.response?.status === 409) {
        setForm((current) => ({ ...current, confirmDuplicate: true }));
        setError(`${err.response?.data?.error || 'رکورد مشابه وجود دارد.'} برای ثبت با وجود هشدار، دوباره ذخیره کنید.`);
      } else {
        setError(err.response?.data?.error || 'ذخیره پرسنل ناموفق بود.');
      }
    } finally {
      setSaving(false);
    }
  };

  const edit = (person: Personnel) => {
    setForm({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      departmentId: person.department?.id || '',
      isActive: person.isActive,
      confirmDuplicate: false,
    });
  };

  const toggleStatus = async (person: Personnel) => {
    setSaving(true);
    setError('');
    try {
      await personnelAPI.updatePerson(person.id, { isActive: !person.isActive });
      setMessage(person.isActive ? 'پرسنل غیرفعال شد.' : 'پرسنل فعال شد.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تغییر وضعیت ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (person: Personnel) => {
    if (!person.canDelete) {
      setError('این پرسنل سابقه عملیاتی یا کاربر متصل دارد و فقط قابل غیرفعال‌سازی است.');
      return;
    }
    if (!confirm(`پرسنل ${person.firstName} ${person.lastName} حذف شود؟`)) return;
    setSaving(true);
    setError('');
    try {
      await personnelAPI.deletePerson(person.id);
      setMessage('پرسنل حذف شد.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'حذف پرسنل ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const columns: ErpColumn<Personnel>[] = [
    {
      id: 'person',
      header: 'پرسنل',
      priority: 'primary',
      cell: (person) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{person.firstName} {person.lastName}</p>
          {person.user ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">@{person.user.username}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">بدون حساب کاربری</p>
          )}
        </div>
      ),
    },
    {
      id: 'department',
      header: 'بخش مرتبط',
      mobileLabel: 'بخش',
      priority: 'secondary',
      cell: (person) => person.department?.namePersian || 'بدون بخش',
    },
    {
      id: 'linkedUser',
      header: 'کاربر متصل',
      mobileLabel: 'کاربر متصل',
      priority: 'meta',
      cell: (person) => person.user ? <ErpBadge tone={person.user.isActive ? 'info' : 'neutral'}>{person.user.email}</ErpBadge> : <ErpBadge tone="neutral">ندارد</ErpBadge>,
    },
    {
      id: 'history',
      header: 'سابقه',
      mobileLabel: 'سابقه',
      priority: 'meta',
      cell: (person) => `${(person._count?.attendanceRecords || 0).toLocaleString('fa-IR')} حضور و غیاب`,
    },
    {
      id: 'status',
      header: 'وضعیت',
      mobileLabel: 'وضعیت',
      priority: 'secondary',
      cell: (person) => <ErpBadge tone={person.isActive ? 'success' : 'danger'}>{person.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>,
    },
  ];

  if (loading) return <ErpLoading />;

  return (
    <ErpListPage
      eyebrow="مدیریت سیستم"
      title="مدیریت پرسنل"
      description="ثبت و نگهداری فهرست پرسنل سازمانی مستقل از حساب کاربری."
      metrics={metrics}
      actions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load, tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, placeholder: 'جستجو در نام یا نام کاربری...', onChange: setSearch },
        {
          id: 'department',
          label: 'بخش',
          type: 'select',
          value: departmentId,
          onChange: setDepartmentId,
          options: [{ label: 'همه بخش‌ها', value: '' }, ...departments.map((department) => ({ label: department.namePersian, value: department.id }))],
        },
        {
          id: 'status',
          label: 'وضعیت',
          type: 'select',
          value: status,
          onChange: setStatus,
          options: [
            { label: 'فعال', value: 'active' },
            { label: 'غیرفعال', value: 'inactive' },
            { label: 'همه', value: 'all' },
          ],
        },
      ]}
      rows={filteredRows}
      rowKey={(person) => person.id}
      columns={columns}
      rowActions={(person) => [
        { label: 'ویرایش', onClick: () => edit(person), icon: FaSave, title: 'ویرایش' },
        { label: person.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی', onClick: () => toggleStatus(person), tone: person.isActive ? 'warning' : 'success', title: person.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی' },
        { label: 'حذف', onClick: () => remove(person), icon: FaTrash, tone: 'danger', disabled: !person.canDelete, title: person.canDelete ? 'حذف' : 'دارای سابقه یا کاربر متصل' },
      ]}
      emptyState={<ErpEmptyState icon={FaUserTie} title="پرسنلی پیدا نشد" description="فیلترها را تغییر دهید یا پرسنل جدید ثبت کنید." />}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      <ErpSection title={form.id ? 'ویرایش پرسنل' : 'پرسنل جدید'} description="فقط اطلاعات پایه پرسنل در نسخه اول ثبت می‌شود. حساب کاربری از مدیریت کاربران جداست.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,0.8fr)_auto] md:items-end">
          <label>
            <span className={labelClass}>نام</span>
            <input className={inputClass} value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value, confirmDuplicate: false }))} />
          </label>
          <label>
            <span className={labelClass}>نام خانوادگی</span>
            <input className={inputClass} value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value, confirmDuplicate: false }))} />
          </label>
          <label>
            <span className={labelClass}>بخش مرتبط</span>
            <select className={inputClass} value={form.departmentId} onChange={(event) => setForm((current) => ({ ...current, departmentId: event.target.value, confirmDuplicate: false }))}>
              <option value="">بدون بخش</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.namePersian}</option>)}
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 dark:border-slate-700 dark:bg-slate-800">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
            <span className="text-sm text-slate-700 dark:text-slate-200">فعال</span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ErpButton label={form.id ? 'ذخیره تغییرات' : 'ثبت پرسنل'} icon={form.id ? FaSave : FaPlus} onClick={save} disabled={saving || !form.firstName.trim() || !form.lastName.trim()} variant="solid" />
          {form.id && <ErpButton label="انصراف" onClick={resetForm} tone="neutral" variant="outline" />}
          {form.confirmDuplicate && <ErpBadge tone="warning">ثبت با تایید تکراری</ErpBadge>}
        </div>
      </ErpSection>
    </ErpListPage>
  );
}
