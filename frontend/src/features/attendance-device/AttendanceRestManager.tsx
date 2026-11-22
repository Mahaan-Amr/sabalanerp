'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpSelect } from '@/components/erp';
import PersianTimePicker from '@/components/PersianTimePicker';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';

type Assignment = { id: string; effectiveFrom: string; hasRest: boolean; reason: string };
type Data = { canEdit: boolean; policies: { id: string; effectiveFrom: string; startTime: string; endTime: string; reason: string }[]; personnel: { id: string; firstName: string; lastName: string; attendanceRestAssignments: Assignment[] }[] };
const dateLabel = (date: string) => new Date(date).toLocaleDateString('fa-IR', { timeZone: 'UTC' });
export default function AttendanceRestManager({ personnelId }: { personnelId?: string }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [effectiveDate, setDate] = useState(() => PersianCalendar.now()), [start, setStart] = useState('13:00'), [end, setEnd] = useState('14:00');
  const [entitlement, setEntitlement] = useState(''), [selected, setSelected] = useState<string[]>(personnelId ? [personnelId] : []);
  const load = useCallback(async () => { const response = await api.get('/hr/personnel-attendance-rest'); setData(response.data.data); }, []);
  useEffect(() => { void load().catch(e => setError(e.response?.data?.error || 'دریافت تنظیم استراحت ناموفق بود.')); }, [load]);
  const save = async (kind: 'policies' | 'assignments') => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`/hr/personnel-attendance-rest/${kind}`, { effectiveDate: PersianCalendar.toGregorianDateOnly(effectiveDate), ...(kind === 'policies' ? { startTime: start, endTime: end } : { personnelIds: selected, hasRest: entitlement === 'YES' }) });
      await load(); setNotice('نسخه تاریخ‌اثردار ذخیره شد.');
    } catch (e: any) { setError(e.response?.data?.error || 'ذخیره استراحت ناموفق بود.'); }
    finally { setBusy(false); }
  };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
  const currentPolicy = data?.policies.find(p => p.effectiveFrom.slice(0, 10) <= today);
  const people = data?.personnel.filter(p => !personnelId || p.id === personnelId) || [];
  return <div className="space-y-4">
    {error && <ErpInlineState kind="error" title={error} />}{notice && <ErpInlineState kind="success" title={notice} />}
    {!data && !error && <ErpInlineState kind="stale" title="در حال دریافت تنظیمات استراحت…" />}
    {data && <>
      <ErpCard className="space-y-3 p-4"><p>{currentPolicy ? `بازه جاری استراحت: ${currentPolicy.startTime} تا ${currentPolicy.endTime}` : 'بازه استراحت هنوز شروع نشده است.'}</p>
        {personnelId && <ErpButton label="مدیریت بازه مشترک و تخصیص گروهی" href="/dashboard/hr/personnel/attendance-rest" variant="ghost" />}
        {!data.canEdit && <ErpInlineState kind="permission" title="تغییر استراحت نیازمند مجوز مدیریت برنامه کار پرسنل است." />}
        {data.canEdit && <>
          <ErpField label="تاریخ اجرای نسخه جدید"><HrPersianCalendar value={effectiveDate} onChange={setDate} /></ErpField>
          {!personnelId && <><div className="grid gap-3 sm:grid-cols-2"><ErpField label="شروع استراحت"><PersianTimePicker value={start} onChange={setStart} ariaLabel="شروع استراحت مشترک" /></ErpField><ErpField label="پایان استراحت"><PersianTimePicker value={end} onChange={setEnd} ariaLabel="پایان استراحت مشترک" /></ErpField></div><ErpInlineState kind="stale" title="نسخه ثبت‌شده بازنویسی نمی‌شود؛ تغییر بعدی با تاریخ اجرای تازه ثبت می‌شود." /></>}
          {!personnelId && <ErpButton label="ثبت بازه مشترک" disabled={busy || !start || !end || start === end} onClick={() => save('policies')} />}
          <ErpField label="تخصیص استراحت"><ErpSelect value={entitlement} onChange={e => setEntitlement(e.target.value)}><option value="">انتخاب کنید</option><option value="YES">دارای استراحت</option><option value="NO">بدون استراحت</option></ErpSelect></ErpField>
          {!personnelId && <ErpCheckbox label="انتخاب همه پرسنل نمایش‌داده‌شده" checked={Boolean(people.length) && people.every(p => selected.includes(p.id))} onChange={e => setSelected(e.target.checked ? people.map(p => p.id) : [])} />}
        </>}
      </ErpCard>
      <div className="space-y-2">{people.map(p => {
        const current = p.attendanceRestAssignments.find(a => a.effectiveFrom.slice(0, 10) <= today);
        return <ErpCard key={p.id} className="space-y-2 p-3">
          {data.canEdit && !personnelId ? <ErpCheckbox label={`${p.firstName} ${p.lastName}`} checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /> : <strong>{p.firstName} {p.lastName}</strong>}
          <p>{current ? current.hasRest ? 'دارای استراحت' : 'بدون استراحت' : 'تخصیص تعیین‌نشده'}</p>
          {p.attendanceRestAssignments.slice(0, 5).map(a => <p key={a.id} className="text-xs sds-text-muted">از {dateLabel(a.effectiveFrom)} · {a.hasRest ? 'دارای استراحت' : 'بدون استراحت'}</p>)}
        </ErpCard>;
      })}</div>
      {data.canEdit && <ErpButton label={`ثبت تخصیص ${selected.length.toLocaleString('fa-IR')} نفر`} disabled={busy || !selected.length || selected.length > 100 || !entitlement} onClick={() => save('assignments')} />}
      {!personnelId && data.policies.map(p => <ErpCard key={p.id} className="p-3"><p>{dateLabel(p.effectiveFrom)} · {p.startTime} تا {p.endTime}</p></ErpCard>)}
    </>}
  </div>;
}
