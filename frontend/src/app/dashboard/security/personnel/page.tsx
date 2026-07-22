'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FaClock, FaPlus, FaRedo, FaSearch, FaShieldAlt } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpSection, ErpSheet, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
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

const inputClass = 'min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
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
    const accepted = await askSecurityAction({ title: person.isActive ? 'غیرفعال‌کردن دسترسی عملیاتی' : 'فعال‌کردن دسترسی عملیاتی', description: person.isActive ? 'این نیرو از عملیات جدید حراست خارج می‌شود؛ سوابق او حفظ خواهد شد.' : 'این نیرو دوباره برای عملیات مجاز حراست فعال می‌شود.' });
    if (!accepted) return;
    try { await securityAPI.updatePersonnelStatus(person.id, !person.isActive); await load(); }
    catch (requestError: any) { notifySecurity(requestError.response?.data?.error || 'تغییر وضعیت نیرو ناموفق بود.', 'error'); }
  };

  return (
    <ErpWorkspacePage title="کارکنان حراست" primaryAction={{ label: 'افزودن نیرو', icon: FaPlus, onClick: () => setShowAssignForm(true), variant: 'solid' }} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}>
      {loading && personnel.length === 0 ? <ErpSkeleton lines={6} /> : error && personnel.length === 0 ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: load }} /> : <>
        {error && <ErpInlineState kind="stale" title="آخرین به‌روزرسانی ناموفق بود؛ فهرست قبلی نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
        <ErpSection>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px]">
            <label className="relative"><span className="sr-only">جستجو</span><FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} pr-10`} placeholder="نام، نام کاربری یا ایمیل" /></label>
            <select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)} className={inputClass} aria-label="فیلتر شیفت"><option value="">همه شیفت‌ها</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.namePersian}</option>)}</select>
            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as any)} className={inputClass} aria-label="فیلتر وضعیت"><option value="all">همه وضعیت‌ها</option><option value="active">فعال</option><option value="inactive">غیرفعال</option></select>
          </div>
        </ErpSection>

        <ErpSection title="فهرست کارکنان">
          <p className="mb-3 text-xs font-semibold text-slate-500">{rows.length.toLocaleString('fa-IR')} نتیجه</p>
          {rows.length === 0 ? <ErpEmptyState icon={FaShieldAlt} title="نیرویی با این فیلترها پیدا نشد" action={{ label: 'پاک‌کردن فیلترها', onClick: () => { setSearch(''); setShiftFilter(''); setStateFilter('all'); } }} /> : <>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800 lg:hidden">
              {rows.map((person) => <article key={person.id} className="bg-white p-4 dark:bg-slate-900/70"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-bold text-slate-950 dark:text-white">{person.user.firstName} {person.user.lastName}</h2><p className="mt-1 truncate text-xs text-slate-500">{person.position} · {person.shift.namePersian}</p></div><ErpStatus label={person.isActive ? 'فعال' : 'غیرفعال'} tone={person.isActive ? 'success' : 'neutral'} /></div><div className="mt-3 flex gap-2"><ErpButton label="جزئیات" onClick={() => setDetailPerson(person)} tone="neutral" variant="ghost" /><ErpButton label={person.isActive ? 'غیرفعال‌کردن' : 'فعال‌کردن'} onClick={() => toggleActive(person)} tone={person.isActive ? 'neutral' : 'success'} variant="soft" /></div></article>)}
            </div>
            <div className="hidden lg:block"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-right text-xs text-slate-500 dark:border-slate-800"><th className="px-3 py-3">نیرو</th><th className="px-3 py-3">سمت و بخش</th><th className="px-3 py-3">شیفت</th><th className="px-3 py-3">حساب</th><th className="px-3 py-3">وضعیت</th><th className="px-3 py-3">عملیات</th></tr></thead><tbody>{rows.map((person) => <tr key={person.id} className="border-b border-slate-100 dark:border-slate-800"><td className="px-3 py-4 font-bold">{person.user.firstName} {person.user.lastName}</td><td className="px-3 py-4">{person.position} · {person.user.department?.namePersian || '—'}</td><td className="px-3 py-4"><span className="font-semibold">{person.shift.namePersian}</span><span className="mt-1 block text-xs text-slate-500">{formatTime(person.shift.startTime)} تا {formatTime(person.shift.endTime)}</span></td><td className="px-3 py-4">@{person.user.username}</td><td className="px-3 py-4"><ErpStatus label={person.isActive ? 'فعال' : 'غیرفعال'} tone={person.isActive ? 'success' : 'neutral'} /></td><td className="px-3 py-4"><div className="flex gap-1"><ErpButton label="جزئیات" onClick={() => setDetailPerson(person)} tone="neutral" variant="ghost" /><ErpButton label={person.isActive ? 'غیرفعال‌کردن' : 'فعال‌کردن'} onClick={() => toggleActive(person)} tone={person.isActive ? 'neutral' : 'success'} variant="ghost" /></div></td></tr>)}</tbody></table></div>
          </>}
        </ErpSection>
      </>}

      <ErpSheet open={showAssignForm} onClose={() => setShowAssignForm(false)} title="افزودن نیروی حراست">
        <form onSubmit={assign} className="space-y-4">
          <label className="block"><span className="mb-2 block text-sm font-semibold">کاربر</span><select value={assignFormData.userId} onChange={(event) => setAssignFormData({ ...assignFormData, userId: event.target.value })} className={inputClass} required><option value="">انتخاب کاربر واجد شرایط</option>{users.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName} ({user.department?.namePersian || user.role})</option>)}</select>{users.length === 0 && <p className="mt-2 text-xs text-slate-500">کاربر واجد شرایطی برای افزودن وجود ندارد.</p>}</label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">سمت</span><input value={assignFormData.position} onChange={(event) => setAssignFormData({ ...assignFormData, position: event.target.value })} className={inputClass} required /></label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">شیفت</span><select value={assignFormData.shiftId} onChange={(event) => setAssignFormData({ ...assignFormData, shiftId: event.target.value })} className={inputClass} required><option value="">انتخاب شیفت</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.namePersian} ({formatTime(shift.startTime)} تا {formatTime(shift.endTime)})</option>)}</select></label>
          <div className="flex justify-end gap-2 pt-2"><ErpButton label="انصراف" onClick={() => setShowAssignForm(false)} tone="neutral" variant="ghost" /><button type="submit" disabled={saving || !assignFormData.userId || !assignFormData.shiftId} className="min-h-11 rounded-xl bg-[#074747] px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'در حال ثبت…' : 'ثبت نیرو'}</button></div>
        </form>
      </ErpSheet>
      {detailPerson && <ErpSheet open onClose={() => setDetailPerson(null)} title={`${detailPerson.user.firstName} ${detailPerson.user.lastName}`}>
        <div className="space-y-6">
          <section><h3 className="font-bold">پروفایل</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">حساب</dt><dd className="mt-1 font-semibold">@{detailPerson.user.username}</dd></div><div><dt className="text-xs text-slate-500">بخش</dt><dd className="mt-1 font-semibold">{detailPerson.user.department?.namePersian || '—'}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">ایمیل</dt><dd className="mt-1 break-all font-semibold">{detailPerson.user.email || '—'}</dd></div></dl></section>
          <section className="border-t border-slate-200 pt-5 dark:border-slate-800"><h3 className="font-bold">تخصیص عملیاتی</h3><p className="mt-3 text-sm">{detailPerson.position} · {detailPerson.shift.namePersian} · {formatTime(detailPerson.shift.startTime)} تا {formatTime(detailPerson.shift.endTime)}</p><ErpStatus label={detailPerson.isActive ? 'دسترسی عملیاتی فعال' : 'دسترسی عملیاتی غیرفعال'} tone={detailPerson.isActive ? 'success' : 'neutral'} /></section>
          <section className="border-t border-slate-200 pt-5 dark:border-slate-800"><h3 className="font-bold">نقش و مجوز</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">نقش سامانه</dt><dd className="mt-1 font-semibold">{detailPerson.user.role}</dd></div><div><dt className="text-xs text-slate-500">مدیریت مجوزها</dt><dd className="mt-1 font-semibold">جدا از اطلاعات پرسنلی</dd></div></dl></section>
          <section className="border-t border-slate-200 pt-5 dark:border-slate-800"><h3 className="font-bold">سابقه</h3><p className="mt-3 text-sm text-slate-500">شروع تخصیص: {detailPerson.assignedAt || detailPerson.createdAt ? new Date(detailPerson.assignedAt || detailPerson.createdAt || '').toLocaleString('fa-IR') : '—'}</p></section>
        </div>
      </ErpSheet>}
    </ErpWorkspacePage>
  );
}
