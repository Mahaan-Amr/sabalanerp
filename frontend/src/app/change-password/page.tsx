'use client';
import { ErpInput, ErpPressable } from '@/components/erp';
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
  return <main className="sds-workspace flex min-h-screen items-center justify-center bg-[var(--sds-surface-raised)] p-4" dir="rtl">
    <section className="w-full max-w-md rounded-2xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-7 text-[var(--sds-text-primary)] shadow-2xl">
      <h1 className="text-2xl font-bold">تغییر رمز عبور</h1>
      <p className="mt-2 text-sm text-[var(--sds-text-muted)]">برای ادامه، رمز موقت را با رمز شخصی خود جایگزین کنید.</p>
      {error && <p className="mt-4 rounded-lg bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)]">{error}</p>}
      <div className="mt-5 space-y-4">
        <ErpInput type="password" className="min-h-12 w-full rounded-lg bg-[var(--sds-surface-raised)] px-4" placeholder="رمز فعلی یا موقت" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <ErpInput type="password" className="min-h-12 w-full rounded-lg bg-[var(--sds-surface-raised)] px-4" placeholder="رمز جدید" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <ErpInput type="password" className="min-h-12 w-full rounded-lg bg-[var(--sds-surface-raised)] px-4" placeholder="تکرار رمز جدید" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
        <ErpPressable type="submit" className="min-h-12 w-full rounded-lg bg-[var(--sds-accent)] font-bold text-[var(--sds-text-inverse)] disabled:opacity-50" disabled={saving} onClick={submit}>ثبت رمز جدید</ErpPressable>
        <ErpPressable type="submit" className="w-full text-sm text-[var(--sds-text-muted)]" onClick={async () => { await authAPI.logout().catch(() => undefined); router.push('/login'); }}>خروج</ErpPressable>
      </div>
    </section>
  </main>;
}
