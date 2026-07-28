'use client';
import { ErpSelect } from '@/components/erp';
import { useEffect, useState } from 'react';
import { ErpButton, ErpCard, ErpPage, ErpSection } from '@/components/erp';
import { usersAPI } from '@/lib/api';
import { hiringAPI, hiringError } from '@/lib/hiringApi';
import { authorityLabel } from '@/features/hr/hrDisplay';

const authorities = ['HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER', 'HR_PAYROLL_PROCESSOR', 'HR_PAYROLL_MANAGER', 'FINANCE_RECORDER', 'FINANCE_MANAGER', 'HIRING_MANAGER'];
const field = 'w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]';

export default function HiringAuthoritiesPage() {
  const [users, setUsers] = useState<any[]>([]); const [rows, setRows] = useState<any[]>([]); const [userId, setUserId] = useState(''); const [authority, setAuthority] = useState(authorities[0]); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const load = async () => { try { const [u, a] = await Promise.all([usersAPI.getUsers(1, 200), hiringAPI.authorities()]); setUsers(u.data.data?.users || u.data.data || []); setRows(a.data.data); } catch (e) { setError(hiringError(e)); } };
  useEffect(() => { void load(); }, []);
  const save = async () => { try { await hiringAPI.setAuthority({ userId, authority }); setMessage('اختیار سازمانی ثبت شد.'); await load(); } catch (e) { setError(hiringError(e)); } };
  return <ErpPage eyebrow="منابع انسانی · تنظیمات استخدام" title="اختیارهای تأیید استخدام" description="دسترسی عمومی مدیریت سامانه یا محیط کاری جایگزین اختیار کسب‌وکاری تأیید نیست." backHref="/dashboard/hr/hiring">
    {message && <p className="rounded-xl bg-[var(--sds-success-surface)] p-3 text-[var(--sds-success)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">{message}</p>}{error && <p className="rounded-xl bg-[var(--sds-danger-surface)] p-3 text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">{error}</p>}
    <ErpSection title="واگذاری اختیار"><ErpCard className="grid gap-3 p-4 md:grid-cols-3"><ErpSelect className={field} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">انتخاب کاربر</option>{users.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} · {u.username}</option>)}</ErpSelect><ErpSelect className={field} value={authority} onChange={(e) => setAuthority(e.target.value)}>{authorities.map((a) => <option key={a} value={a}>{authorityLabel(a)}</option>)}</ErpSelect><ErpButton label="ثبت اختیار" disabled={!userId} onClick={save} /></ErpCard></ErpSection>
    <ErpSection title="اختیارهای فعال"><div className="grid gap-2 md:grid-cols-2">{rows.map((row) => { const user = users.find((u) => u.id === row.userId); return <ErpCard key={row.id} className="flex justify-between p-3 text-sm"><span>{user ? `${user.firstName} ${user.lastName}` : row.userId}</span><b>{authorityLabel(row.authority)}</b></ErpCard>; })}</div></ErpSection>
  </ErpPage>;
}
