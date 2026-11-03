'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaKey, FaSignOutAlt } from 'react-icons/fa';
import { authAPI } from '@/lib/api';
import { ErpButton, ErpCard, ErpInlineState, ErpInput, erpFieldLabelClassName } from '@/components/erp';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (form.newPassword.length < 8) { setError('رمز جدید باید حداقل ۸ نویسه باشد.'); return; }
    if (form.newPassword !== form.confirmPassword) { setError('تکرار رمز جدید مطابقت ندارد.'); return; }
    setSaving(true); setError('');
    try { await authAPI.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword }); router.push('/dashboard'); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'تغییر رمز عبور انجام نشد.'); }
    finally { setSaving(false); }
  };

  const logout = async () => { await authAPI.logout().catch(() => undefined); router.push('/login'); };

  return (
    <main className="sds-workspace grid min-h-screen place-items-center bg-[var(--sds-surface-canvas)] p-4" dir="rtl">
      <ErpCard className="w-full max-w-md p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--sds-accent-soft)] text-[var(--sds-accent)] shadow-[var(--sds-shadow-raised)]"><FaKey /></span>
          <div><h1 className="text-xl font-black sds-text-primary">تغییر رمز عبور</h1><p className="mt-1 text-xs sds-text-muted">نشست فعلی حفظ و نشست‌های دیگر قطع می‌شوند.</p></div>
        </div>
        {error && <div className="mt-4"><ErpInlineState kind="error" title={error} /></div>}
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="block"><span className={erpFieldLabelClassName}>رمز فعلی یا موقت</span><ErpInput type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /></label>
          <label className="block"><span className={erpFieldLabelClassName}>رمز جدید</span><ErpInput type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} minLength={8} required /></label>
          <label className="block"><span className={erpFieldLabelClassName}>تکرار رمز جدید</span><ErpInput type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} minLength={8} required /></label>
          <ErpButton label={saving ? 'در حال ثبت...' : 'ثبت رمز جدید'} icon={FaKey} className="w-full" disabled={saving} onClick={() => void submit()} />
          <ErpButton label="خروج از حساب" icon={FaSignOutAlt} tone="neutral" variant="ghost" className="w-full" onClick={() => void logout()} />
        </form>
      </ErpCard>
    </main>
  );
}
