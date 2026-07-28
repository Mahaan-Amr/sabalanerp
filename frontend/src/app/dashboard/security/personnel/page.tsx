'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FaClock, FaPlus, FaRedo, FaSearch, FaShieldAlt } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpSection, ErpSheet, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { ErpInput, ErpPressable, ErpSelect } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import { askSecurityAction, notifySecurity } from '@/components/SecurityNoticeHost';

interface SecurityPersonnel {
  id: string;
  user: { id: string; firstName: string; lastName: string; username: string; email: string; role: string; department?: { name: string; namePersian: string } };
  shift: { id: string; name: string; namePersian: string; startTime: string; endTime: string };
  position: string;
  isActive: boolean;
  assignedAt?: string;
  createdAt?: string;
}

interface User { id: string; firstName: string; lastName: string; username: string; email: string; role: string; department?: { name: string; namePersian: string } }
interface Shift { id: string; name: string; namePersian: string; startTime: string; endTime: string; isActive: boolean }

const inputClass = 'min-h-12 w-full rounded-xl border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-panel)] px-3 text-sm sds-text-primary outline-none transition focus:border-[var(--sds-accent)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-panel)] ';
const formatTime = (time: string) => new Date(`2000-01-01T${time}`).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

export default function PersonnelPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [personnel, setPersonnel] = useState<SecurityPersonnel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [shiftFilter, setShiftFilter] = useState('');
  const [detailPerson, setDetailPerson] = useState<SecurityPersonnel | null>(null);
  const [assignFormData, setAssignFormData] = useState({ userId: '', shiftId: '', position: 'نگهبان' });

  const load = async () => {
    setLoading(true); setError('');
    try {
      const results = await Promise.allSettled([securityAPI.getPersonnel(), securityAPI.getShifts(), securityAPI.getEligiblePersonnelUsers()]);
      if (results[0].status === 'fulfilled' && results[0].value.data.success) setPersonnel(results[0].value.data.data || []);
      if (results[1].status === 'fulfilled' && results[1].value.data.success) setShifts(results[1].value.data.data || []);
      if (results[2].status === 'fulfilled' && results[2].value.data.success) setUsers(results[2].value.data.data || []);
      if (results.some((result) => result.status === 'rejected')) setError('بخشی از اطلاعات کارکنان دریافت نشد؛ اطلاعات موفق نمایش داده می‌شود.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get('q') || '');
    setShiftFilter(params.get('shift') || '');
    const state = params.get('state');
    if (state === 'active' || state === 'inactive') setStateFilter(state);
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (stateFilter !== 'all') params.set('state', stateFilter);
      if (shiftFilter) params.set('shift', shiftFilter);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [pathname, router, search, shiftFilter, stateFilter]);

  const rows = useMemo(() => personnel.filter((person) => {
    const query = search.trim().toLowerCase();
    const identity = `${person.user.firstName} ${person.user.lastName} ${person.user.username} ${person.user.email}`.toLowerCase();
    return (!query || identity.includes(query)) && (!shiftFilter || person.shift.id === shiftFilter) && (stateFilter === 'all' || person.isActive === (stateFilter === 'active'));
  }), [personnel, search, shiftFilter, stateFilter]);

  const assign = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await securityAPI.assignPersonnel(assignFormData);
      if (response.data.success) {
        setShowAssignForm(false); setAssignFormData({ userId: '', shiftId: '', position: 'نگهبان' });
        notifySecurity('نیرو با موفقیت ثبت شد.'); await load();
      }
    } catch (requestError: any) { notifySecurity(requestError.response?.data?.error || 'ثبت نیرو ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (person: SecurityPersonnel) => {
    const accepted = await askSecurityAction({ title: person.isActive ? 'غیرفعال‌کردن دسترسی عملیاتی' : 'فعال‌کردن دسترسی عملیاتی', description: person.isActive ? 'این نیرو از عملیات جدید گارد خارج می‌شود؛ سوابق او حفظ خواهد شد.' : 'این نیرو دوباره برای عملیات مجاز گارد فعال می‌شود.' });
    if (!accepted) return;
    try { await securityAPI.updatePersonnelStatus(person.id, !person.isActive); await load(); }
    catch (requestError: any) { notifySecurity(requestError.response?.data?.error || 'تغییر وضعیت نیرو ناموفق بود.', 'error'); }
  };

  return (
    <ErpWorkspacePage title="کارکنان گارد" primaryAction={{ label: 'افزودن نیرو', icon: FaPlus, onClick: () => setShowAssignForm(true), variant: 'solid' }} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}>
      {loading && personnel.length === 0 ? <ErpSkeleton lines={6} /> : error && personnel.length === 0 ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: load }} /> : <>
        {error && <ErpInlineState kind="stale" title="آخرین به‌روزرسانی ناموفق بود؛ فهرست قبلی نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
        <ErpSection>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px]">
            <label className="relative"><span className="sr-only">جستجو</span><FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 sds-text-muted" /><ErpInput value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} pr-10`} placeholder="نام، نام کاربری یا ایمیل" /></label>
            <ErpSelect value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)} className={inputClass} aria-label="فیلتر شیفت"><option value="">همه شیفت‌ها</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.namePersian}</option>)}</ErpSelect>
            <ErpSelect value={stateFilter} onChange={(event) => setStateFilter(event.target.value as any)} className={inputClass} aria-label="فیلتر وضعیت"><option value="all">همه وضعیت‌ها</option><option value="active">فعال</option><option value="inactive">غیرفعال</option></ErpSelect>
          </div>
        </ErpSection>

        <ErpSection title="فهرست کارکنان">
          <p className="mb-3 text-xs font-semibold sds-text-muted">{rows.length.toLocaleString('fa-IR')} نتیجه</p>
          {rows.length === 0 ? <ErpEmptyState icon={FaShieldAlt} title="نیرویی با این فیلترها پیدا نشد" action={{ label: 'پاک‌کردن فیلترها', onClick: () => { setSearch(''); setShiftFilter(''); setStateFilter('all'); } }} /> : <>
            <div className="divide-y divide-[var(--sds-border-subtle)] overflow-hidden rounded-xl border border-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)] lg:hidden">
              {rows.map((person) => <article key={person.id} className="bg-[var(--sds-surface-panel)] p-4 dark:bg-[var(--sds-surface-panel)]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-bold sds-text-primary ">{person.user.firstName} {person.user.lastName}</h2><p className="mt-1 truncate text-xs sds-text-muted">{person.position} · {person.shift.namePersian}</p></div><ErpStatus label={person.isActive ? 'فعال' : 'غیرفعال'} tone={person.isActive ? 'success' : 'neutral'} /></div><div className="mt-3 flex gap-2"><ErpButton label="جزئیات" onClick={() => setDetailPerson(person)} tone="neutral" variant="ghost" /><ErpButton label={person.isActive ? 'غیرفعال‌کردن' : 'فعال‌کردن'} onClick={() => toggleActive(person)} tone={person.isActive ? 'neutral' : 'success'} variant="soft" /></div></article>)}
            </div>
            <div className="hidden lg:block"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--sds-border-subtle)] text-right text-xs sds-text-muted dark:border-[var(--sds-border-subtle)]"><th className="px-3 py-3">نیرو</th><th className="px-3 py-3">سمت و بخش</th><th className="px-3 py-3">شیفت</th><th className="px-3 py-3">حساب</th><th className="px-3 py-3">وضعیت</th><th className="px-3 py-3">عملیات</th></tr></thead><tbody>{rows.map((person) => <tr key={person.id} className="border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]"><td className="px-3 py-4 font-bold">{person.user.firstName} {person.user.lastName}</td><td className="px-3 py-4">{person.position} · {person.user.department?.namePersian || '—'}</td><td className="px-3 py-4"><span className="font-semibold">{person.shift.namePersian}</span><span className="mt-1 block text-xs sds-text-muted">{formatTime(person.shift.startTime)} تا {formatTime(person.shift.endTime)}</span></td><td className="px-3 py-4">@{person.user.username}</td><td className="px-3 py-4"><ErpStatus label={person.isActive ? 'فعال' : 'غیرفعال'} tone={person.isActive ? 'success' : 'neutral'} /></td><td className="px-3 py-4"><div className="flex gap-1"><ErpButton label="جزئیات" onClick={() => setDetailPerson(person)} tone="neutral" variant="ghost" /><ErpButton label={person.isActive ? 'غیرفعال‌کردن' : 'فعال‌کردن'} onClick={() => toggleActive(person)} tone={person.isActive ? 'neutral' : 'success'} variant="ghost" /></div></td></tr>)}</tbody></table></div>
          </>}
        </ErpSection>
      </>}

      <ErpSheet open={showAssignForm} onClose={() => setShowAssignForm(false)} title="افزودن نیروی گارد">
        <form onSubmit={assign} className="space-y-4">
          <label className="block"><span className="mb-2 block text-sm font-semibold">کاربر</span><ErpSelect value={assignFormData.userId} onChange={(event) => setAssignFormData({ ...assignFormData, userId: event.target.value })} className={inputClass} required><option value="">انتخاب کاربر واجد شرایط</option>{users.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName} ({user.department?.namePersian || user.role})</option>)}</ErpSelect>{users.length === 0 && <p className="mt-2 text-xs sds-text-muted">کاربر واجد شرایطی برای افزودن وجود ندارد.</p>}</label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">سمت</span><ErpInput value={assignFormData.position} onChange={(event) => setAssignFormData({ ...assignFormData, position: event.target.value })} className={inputClass} required /></label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">شیفت</span><ErpSelect value={assignFormData.shiftId} onChange={(event) => setAssignFormData({ ...assignFormData, shiftId: event.target.value })} className={inputClass} required><option value="">انتخاب شیفت</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.namePersian} ({formatTime(shift.startTime)} تا {formatTime(shift.endTime)})</option>)}</ErpSelect></label>
          <div className="flex justify-end gap-2 pt-2"><ErpButton label="انصراف" onClick={() => setShowAssignForm(false)} tone="neutral" variant="ghost" /><ErpPressable type="submit" disabled={saving || !assignFormData.userId || !assignFormData.shiftId} className="min-h-11 rounded-xl bg-[var(--sds-accent)] px-4 text-sm font-bold text-[var(--sds-on-accent)] disabled:opacity-50">{saving ? 'در حال ثبت…' : 'ثبت نیرو'}</ErpPressable></div>
        </form>
      </ErpSheet>
      {detailPerson && <ErpSheet open onClose={() => setDetailPerson(null)} title={`${detailPerson.user.firstName} ${detailPerson.user.lastName}`}>
        <div className="space-y-6">
          <section><h3 className="font-bold">پروفایل</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs sds-text-muted">حساب</dt><dd className="mt-1 font-semibold">@{detailPerson.user.username}</dd></div><div><dt className="text-xs sds-text-muted">بخش</dt><dd className="mt-1 font-semibold">{detailPerson.user.department?.namePersian || '—'}</dd></div><div className="col-span-2"><dt className="text-xs sds-text-muted">ایمیل</dt><dd className="mt-1 break-all font-semibold">{detailPerson.user.email || '—'}</dd></div></dl></section>
          <section className="border-t border-[var(--sds-border-subtle)] pt-5 dark:border-[var(--sds-border-subtle)]"><h3 className="font-bold">تخصیص عملیاتی</h3><p className="mt-3 text-sm">{detailPerson.position} · {detailPerson.shift.namePersian} · {formatTime(detailPerson.shift.startTime)} تا {formatTime(detailPerson.shift.endTime)}</p><ErpStatus label={detailPerson.isActive ? 'دسترسی عملیاتی فعال' : 'دسترسی عملیاتی غیرفعال'} tone={detailPerson.isActive ? 'success' : 'neutral'} /></section>
          <section className="border-t border-[var(--sds-border-subtle)] pt-5 dark:border-[var(--sds-border-subtle)]"><h3 className="font-bold">نقش و مجوز</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs sds-text-muted">نقش سامانه</dt><dd className="mt-1 font-semibold">{detailPerson.user.role}</dd></div><div><dt className="text-xs sds-text-muted">مدیریت مجوزها</dt><dd className="mt-1 font-semibold">جدا از اطلاعات پرسنلی</dd></div></dl></section>
          <section className="border-t border-[var(--sds-border-subtle)] pt-5 dark:border-[var(--sds-border-subtle)]"><h3 className="font-bold">سابقه</h3><p className="mt-3 text-sm sds-text-muted">شروع تخصیص: {detailPerson.assignedAt || detailPerson.createdAt ? new Date(detailPerson.assignedAt || detailPerson.createdAt || '').toLocaleString('fa-IR') : '—'}</p></section>
        </div>
      </ErpSheet>}
    </ErpWorkspacePage>
  );
}
