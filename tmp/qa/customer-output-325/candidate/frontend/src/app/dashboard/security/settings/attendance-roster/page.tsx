'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaRedo, FaSearch, FaUsers } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpSection, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { ErpInput, ErpSelect } from '@/components/erp';
import { askSecurityAction } from '@/components/SecurityNoticeHost';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

interface AttendanceRosterItem { personnel: { id: string; firstName: string; lastName: string; isActive: boolean; department?: { namePersian?: string | null } | null }; isInRoster: boolean }
const inputClass = 'min-h-12 w-full rounded-xl border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-panel)] px-3 text-sm outline-none focus:border-[var(--sds-accent)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-panel)]';

export default function AttendanceRosterSettingsPage() {
  const [items, setItems] = useState<AttendanceRosterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'included' | 'excluded'>('all');

  const load = async () => { setLoading(true); setError(''); try { const response = await securityAPI.getAttendanceRoster({ date: PersianCalendar.toGregorianDateOnly(PersianCalendar.now()) }); if (response.data.success) setItems(response.data.data || []); } catch (requestError: any) { setError(requestError.response?.data?.error || 'دریافت فهرست حضور و غیاب ناموفق بود.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => items.filter((item) => { const query = search.trim().toLowerCase(); const name = `${item.personnel.firstName} ${item.personnel.lastName}`.toLowerCase(); return (!query || name.includes(query)) && (scope === 'all' || item.isInRoster === (scope === 'included')); }), [items, scope, search]);

  const toggle = async (item: AttendanceRosterItem) => {
    const accepted = await askSecurityAction({ title: item.isInRoster ? 'خروج از فهرست حضور و غیاب' : 'افزودن به فهرست حضور و غیاب', description: item.isInRoster ? 'این تغییر از امروز اعمال می‌شود؛ سوابق تاریخی فرد حفظ خواهد شد.' : 'از امروز وضعیت حضور و غیاب این فرد در گارد محاسبه می‌شود.' });
    if (!accepted) return;
    setUpdatingId(item.personnel.id); setError(''); setMessage('');
    try { const effectiveDate = PersianCalendar.toGregorianDateOnly(PersianCalendar.now()); const response = item.isInRoster ? await securityAPI.removeAttendanceRosterMember(item.personnel.id, { effectiveDate }) : await securityAPI.addAttendanceRosterMember({ personnelId: item.personnel.id, effectiveDate }); setMessage(response.data.message || 'فهرست به‌روزرسانی شد.'); await load(); } catch (requestError: any) { setError(requestError.response?.data?.error || 'تغییر فهرست حضور و غیاب ناموفق بود.'); } finally { setUpdatingId(''); }
  };

  return <ErpWorkspacePage className="guard-workspace" title="فهرست حضور و غیاب" context={PersianCalendar.formatForDisplay(PersianCalendar.now())} backHref="/dashboard/security/settings" secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}>
    {loading && !items.length ? <ErpSkeleton lines={6} /> : error && !items.length ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: load }} /> : <>{message && <ErpInlineState kind="success" title={message} />}{error && <ErpInlineState kind="stale" title={error} action={{ label: 'تلاش مجدد', onClick: load }} />}<ErpSection><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]"><label className="relative"><span className="sr-only">جستجو</span><FaSearch className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 sds-text-muted" /><ErpInput className={`${inputClass} pr-10`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام پرسنل" /></label><ErpSelect className={inputClass} value={scope} onChange={(event) => setScope(event.target.value as any)} aria-label="عضویت"><option value="all">همه کارکنان</option><option value="included">عضو فهرست</option><option value="excluded">خارج از فهرست</option></ErpSelect></div></ErpSection><ErpSection title="کارکنان"><p className="mb-3 text-xs font-semibold sds-text-muted">{rows.length.toLocaleString('fa-IR')} نتیجه</p>{!rows.length ? <ErpEmptyState icon={FaUsers} title="پرسنلی با این فیلتر پیدا نشد" /> : <div className="divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">{rows.map((item) => <div key={item.personnel.id} className="flex min-h-16 items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate font-bold sds-text-primary ">{item.personnel.firstName} {item.personnel.lastName}</p><p className="mt-1 text-xs sds-text-muted">{item.personnel.department?.namePersian || 'بدون بخش'}</p></div><ErpStatus label={item.isInRoster ? 'عضو فهرست' : 'خارج از فهرست'} tone={item.isInRoster ? 'success' : 'neutral'} /><ErpButton label={item.isInRoster ? 'خارج‌کردن' : 'افزودن'} onClick={() => toggle(item)} disabled={Boolean(updatingId)} tone={item.isInRoster ? 'neutral' : 'success'} variant="ghost" /></div>)}</div>}</ErpSection></>}
  </ErpWorkspacePage>;
}
