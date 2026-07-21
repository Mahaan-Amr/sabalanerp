'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FaCog, FaPaperPlane, FaPlus, FaSync, FaUserPlus } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { hrAPI } from '@/lib/api';
import { hiringAPI, hiringError } from '@/lib/hiringApi';

const stage: Record<string, string> = { RECEIVED: 'دریافت‌شده', SCREENING: 'بررسی مدارک', ASSESSMENT: 'ارزیابی', OFFER: 'پیشنهاد', CLOSED: 'بسته' };
const blank = { firstName: '', lastName: '', mobile: '', nationalCode: '', positionId: '' };
const field = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900';

export default function HiringCasesPage() {
  const [rows, setRows] = useState<any[]>([]); const [positions, setPositions] = useState<any[]>([]);
  const [form, setForm] = useState(blank); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = async () => { try { setLoading(true); const [cases, foundation] = await Promise.all([hiringAPI.list(), hrAPI.getFoundation()]); setRows(cases.data.data); setPositions(foundation.data.data.positions || []); } catch (e) { setError(hiringError(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const create = async () => { try { setBusy(true); setError(''); const result = await hiringAPI.create(form); const invitation = await hiringAPI.invite(result.data.data.id); setMessage(`پرونده و دعوت‌نامه ساخته شد.${invitation.data.data.debugOtp ? ` کد محیط آزمایشی: ${invitation.data.data.debugOtp}` : ''}`); setForm(blank); await load(); } catch (e) { setError(hiringError(e)); } finally { setBusy(false); } };
  const invite = async (id: string) => { try { setBusy(true); const result = await hiringAPI.invite(id); setMessage(`دعوت‌نامه ارسال شد.${result.data.data.debugOtp ? ` کد محیط آزمایشی: ${result.data.data.debugOtp}` : ''}`); } catch (e) { setError(hiringError(e)); } finally { setBusy(false); } };
  if (loading && !rows.length) return <ErpLoading />;
  return <ErpPage eyebrow="منابع انسانی · جذب" title="جذب و پرونده‌های متقاضیان" description="جریان یکپارچه متقاضی، بررسی HR، امور مالی، تبدیل به پرسنل و فعال‌سازی" backHref="/dashboard/hr" actions={[{ label: 'اختیارها', icon: FaCog, href: '/dashboard/hr/hiring/authorities' }, { label: 'به‌روزرسانی', icon: FaSync, onClick: load }]}>
    {error && <p className="rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}{message && <p className="rounded-xl bg-emerald-50 p-3 text-emerald-700">{message}</p>}
    <ErpSection title="ایجاد متقاضی و ارسال دعوت" description="کد ورود شش‌رقمی و نشانی ثابت sabalanerp.com/apply برای شماره همراه ثبت‌شده ارسال می‌شود و هفت روز اعتبار دارد."><ErpCard className="grid gap-3 p-4 md:grid-cols-5"><input className={field} placeholder="نام" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /><input className={field} placeholder="نام خانوادگی" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /><input className={field} placeholder="شماره همراه" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /><input className={field} placeholder="کد ملی (اختیاری در دعوت)" value={form.nationalCode} onChange={(e) => setForm({ ...form, nationalCode: e.target.value })} /><select className={field} value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })}><option value="">انتخاب جایگاه</option>{positions.filter((p: any) => p.isActive).map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}</select><div className="md:col-span-5"><ErpButton label="ساخت پرونده و ارسال دعوت" icon={FaPlus} disabled={busy || !form.firstName || !form.lastName || !form.mobile || !form.positionId} onClick={create} tone="success" /></div></ErpCard></ErpSection>
    <ErpSection title="صف استخدام"><div className="grid gap-3 xl:grid-cols-2">{rows.map((row) => <ErpCard key={row.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><Link href={`/dashboard/hr/hiring/${row.id}`} className="font-black hover:text-emerald-600">{row.candidate.firstName} {row.candidate.lastName}</Link><p className="mt-1 text-xs text-slate-500">{row.position.title} · {row.candidate.mobile}</p></div><ErpBadge tone={row.stage === 'CLOSED' ? 'neutral' : 'info'}>{stage[row.stage] || row.stage}</ErpBadge></div><div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs"><Status label="هویت" value={row.identityClearance} /><Status label="وثیقه" value={row.collateralClearance} /><Status label="قرارداد" value={row.contractClearance} /><Status label="جبران" value={row.compensationClearance} /></div><div className="mt-4 flex gap-2"><Link className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white" href={`/dashboard/hr/hiring/${row.id}`}>باز کردن پرونده</Link><button disabled={busy || row.stage === 'CLOSED'} onClick={() => invite(row.id)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><FaPaperPlane /> ارسال مجدد دعوت</button></div></ErpCard>)}{!rows.length && <ErpEmptyState icon={FaUserPlus} title="پرونده‌ای وجود ندارد" description="اولین متقاضی را ثبت کنید." />}</div></ErpSection>
  </ErpPage>;
}

function Status({ label, value }: { label: string; value: string }) { return <span className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800">{label}<br/><b>{value === 'APPROVED' ? 'تأیید' : value === 'IN_PROGRESS' ? 'در حال بررسی' : '—'}</b></span>; }
