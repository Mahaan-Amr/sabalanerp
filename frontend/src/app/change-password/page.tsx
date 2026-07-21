'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authAPI } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (form.newPassword.length < 8) return setError('رمز جدید باید حداقل ۸ کاراکتر باشد.');
    if (form.newPassword !== form.confirmPassword) return setError('تکرار رمز جدید مطابقت ندارد.');
    setSaving(true); setError('');
    try {
      await authAPI.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      router.push('/dashboard');
    } catch (err: any) { setError(err.response?.data?.error || 'تغییر رمز عبور ناموفق بود.'); }
    finally { setSaving(false); }
  };
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4" dir="rtl">
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-7 text-white shadow-2xl">
      <h1 className="text-2xl font-bold">تغییر رمز عبور</h1>
      <p className="mt-2 text-sm text-slate-300">برای ادامه، رمز موقت را با رمز شخصی خود جایگزین کنید.</p>
      {error && <p className="mt-4 rounded-lg bg-red-500/15 p-3 text-sm text-red-200">{error}</p>}
      <div className="mt-5 space-y-4">
        <input type="password" className="min-h-12 w-full rounded-lg bg-white/10 px-4" placeholder="رمز فعلی یا موقت" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <input type="password" className="min-h-12 w-full rounded-lg bg-white/10 px-4" placeholder="رمز جدید" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <input type="password" className="min-h-12 w-full rounded-lg bg-white/10 px-4" placeholder="تکرار رمز جدید" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
        <button className="min-h-12 w-full rounded-lg bg-teal-500 font-bold text-slate-950 disabled:opacity-50" disabled={saving} onClick={submit}>ثبت رمز جدید</button>
        <button className="w-full text-sm text-slate-300" onClick={async () => { await authAPI.logout().catch(() => undefined); router.push('/login'); }}>خروج</button>
      </div>
    </section>
  </main>;
}
