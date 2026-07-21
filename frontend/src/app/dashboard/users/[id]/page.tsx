'use client';

import { useEffect, useState } from 'react';
import { FaDesktop, FaEdit, FaKey, FaShieldAlt, FaTrash, FaUser } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSummaryGrid } from '@/components/erp';
import { authAPI, usersAPI } from '@/lib/api';

export default function UserDetailsPage({ params }: { params: { id: string } }) {
  const [user, setUser] = useState<any>(null);
  const [currentRole, setCurrentRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authTab, setAuthTab] = useState('active');
  const [authRows, setAuthRows] = useState<any[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [message, setMessage] = useState('');
  const [erasurePreview, setErasurePreview] = useState<any>(null);
  const [erasureReason, setErasureReason] = useState('');
  const [erasurePassword, setErasurePassword] = useState('');

  const load = async () => {
    try {
      const [userResponse, meResponse] = await Promise.all([usersAPI.getUser(params.id), authAPI.getMe()]);
      setUser(userResponse.data.data); setCurrentRole(meResponse.data.data.role);
    } catch (err: any) { setError(err.response?.data?.error || 'دریافت اطلاعات کاربر ناموفق بود.'); }
    finally { setLoading(false); }
  };
  const loadAuthentication = async (tab = authTab) => {
    const response = await usersAPI.getAuthentication(params.id, { tab });
    setAuthRows(response.data.data || []);
  };
  useEffect(() => { load(); }, [params.id]);
  useEffect(() => { if (currentRole === 'ADMIN') loadAuthentication(); }, [currentRole, authTab]);

  const resetPassword = async () => {
    if (temporaryPassword.length < 8 || !adminPassword) return setMessage('رمز موقت حداقل ۸ کاراکتر و رمز مدیر الزامی است.');
    try {
      await usersAPI.resetPassword(params.id, { temporaryPassword, adminPassword, requireChange: requirePasswordChange });
      setTemporaryPassword(''); setAdminPassword(''); setRequirePasswordChange(false); setMessage('رمز جدید ثبت و همه نشست‌های کاربر لغو شد.');
      await loadAuthentication('active');
    } catch (err: any) { setMessage(err.response?.data?.error || 'بازنشانی رمز ناموفق بود.'); }
  };
  const eraseAccount = async () => {
    const preview = await usersAPI.getErasurePreview(params.id);
    setErasurePreview(preview.data.data);
  };
  const confirmErasure = async () => {
    if (!erasureReason.trim() || !erasurePassword) return setMessage('دلیل حذف و رمز عبور مدیر الزامی است.');
    await usersAPI.eraseUser(params.id, { reason: erasureReason.trim(), adminPassword: erasurePassword });
    window.location.href = '/dashboard/users';
  };

  if (loading) return <ErpLoading />;
  if (error || !user) return <ErpEmptyState icon={FaUser} title="کاربر پیدا نشد" description={error} action={{ label: 'بازگشت', href: '/dashboard/users' }} />;
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const creator = user.creatorDisplayNameSnapshot
    ? user.createdByUser?.erasedAt
      ? `کاربر حذف‌شده — ${user.creatorDisplayNameSnapshot}`
      : `${user.creatorDisplayNameSnapshot}${user.creatorUsernameSnapshot ? ` (@${user.creatorUsernameSnapshot})` : ''}`
    : 'نامشخص — داده تاریخی';

  return <ErpPage eyebrow="مدیریت سیستم" title={fullName || user.username} description="جزئیات حساب، منشأ ایجاد و شواهد امنیتی کاربر." backHref="/dashboard/users" actions={[
    { label: 'ویرایش', href: `/dashboard/users/${user.id}/edit`, icon: FaEdit, tone: 'primary', variant: 'solid' },
    { label: 'مدیریت دسترسی‌ها', href: `/dashboard/admin/permissions?userId=${user.id}`, icon: FaShieldAlt, tone: 'neutral', variant: 'outline' },
  ]} metrics={[
    { label: 'وضعیت', value: user.isActive ? 'فعال' : 'غیرفعال', icon: FaUser, tone: user.isActive ? 'success' : 'danger' },
    { label: 'نقش', value: user.role, icon: FaShieldAlt, tone: user.role === 'ADMIN' ? 'danger' : 'info' },
    { label: 'بخش', value: user.department?.namePersian || 'بدون بخش', icon: FaUser, tone: 'neutral' },
    { label: 'تاریخ ایجاد', value: new Date(user.createdAt).toLocaleDateString('fa-IR'), icon: FaUser, tone: 'neutral' },
  ]}>
    <ErpSection title="اطلاعات حساب"><ErpSummaryGrid columns={3} items={[
      { label: 'نام کامل', value: fullName }, { label: 'ایمیل', value: user.email }, { label: 'نام کاربری', value: `@${user.username}` },
      { label: 'شماره تماس', value: user.profile?.phone || 'ثبت نشده' }, { label: 'وضعیت تغییر رمز', value: user.mustChangePassword ? <ErpBadge tone="warning">الزامی در ورود بعدی</ErpBadge> : 'عادی' }, { label: 'آخرین بروزرسانی', value: new Date(user.updatedAt).toLocaleDateString('fa-IR') },
    ]} /></ErpSection>

    <ErpSection title="منشأ ایجاد حساب"><ErpSummaryGrid columns={3} items={[
      { label: 'ایجادکننده', value: creator, tone: user.creatorDisplayNameSnapshot ? 'info' : 'warning' },
      { label: 'شناسه ایجادکننده', value: user.createdByUserId || '—' },
      { label: 'نوع انتساب', value: user.creatorAttributionKind === 'AUTOMATIC' ? 'ثبت خودکار' : user.creatorAttributionKind === 'MANUAL' ? 'ثبت دستی و حسابرسی‌شده' : 'نامشخص تاریخی' },
      { label: 'منبع ایجاد', value: user.creationSource },
      { label: 'زمان انتساب', value: user.creatorAttributedAt ? new Date(user.creatorAttributedAt).toLocaleString('fa-IR') : '—' },
      { label: 'دلیل انتساب دستی', value: user.creatorAttributionReason || '—' },
    ]} />{currentRole === 'ADMIN' && user.creatorAttributionKind === 'UNKNOWN' && <div className="mt-4"><ErpButton label="ثبت ایجادکننده تاریخی" variant="outline" onClick={async () => { const creatorId = window.prompt('شناسه کاربر ایجادکننده را وارد کنید:'); if (!creatorId?.trim()) return; const reason = window.prompt('دلیل و منبع این انتساب تاریخی:'); if (!reason?.trim()) return; await usersAPI.attributeCreator(user.id, { creatorId: creatorId.trim(), reason: reason.trim() }); await load(); }} /></div>}</ErpSection>

    {currentRole === 'ADMIN' && <ErpSection title="امنیت حساب و دستگاه‌ها" description="نشست‌ها، تاریخچه ورود و تلاش‌های ناموفق فقط برای مدیر سیستم قابل مشاهده است.">
      {message && <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
      <div className="mb-4 flex flex-wrap gap-2">
        {[['active', 'نشست‌های فعال'], ['history', 'تاریخچه نشست'], ['failed', 'ورودهای ناموفق']].map(([value, label]) => <ErpButton key={value} label={label} variant={authTab === value ? 'solid' : 'outline'} tone={authTab === value ? 'primary' : 'neutral'} onClick={() => setAuthTab(value)} />)}
        <ErpButton label="لغو همه نشست‌ها" tone="warning" variant="outline" onClick={async () => { const reason = window.prompt('دلیل لغو همه نشست‌ها:'); if (reason?.trim()) { await usersAPI.revokeAllUserSessions(user.id, reason.trim()); await loadAuthentication(); } }} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{authRows.map((row) => <ErpCard key={row.id} className="p-4">
        {authTab === 'failed' ? <><p className="font-semibold">{row.attemptedIdentifier || 'شناسه نامشخص'}</p><p className="mt-2 text-xs" dir="ltr">{row.ipAddress || '—'} · {row.browser || ''} · {row.operatingSystem || ''}</p><p className="mt-1 text-xs text-slate-500">{new Date(row.createdAt).toLocaleString('fa-IR')} · {row.safeCategory}</p></> : <>
          <p className="font-semibold"><FaDesktop className="ml-2 inline" />{row.browser || 'مرورگر نامشخص'} · {row.operatingSystem || ''}</p><p className="mt-2 text-xs" dir="ltr">{row.ipAddress || '—'} · {row.approximateLocation || 'مکان تقریبی نامشخص'}</p><p className="mt-1 text-xs text-slate-500">آخرین فعالیت: {new Date(row.lastActivityAt).toLocaleString('fa-IR')}</p>
          {!row.revokedAt && <div className="mt-3"><ErpButton label="قطع دسترسی" tone="danger" variant="outline" onClick={async () => { const reason = window.prompt('دلیل قطع دسترسی:'); if (reason?.trim()) { await usersAPI.revokeUserSession(user.id, row.id, reason.trim()); await loadAuthentication(); } }} /></div>}
        </>}
      </ErpCard>)}</div>
      <div className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-3">
        <input type="password" className="min-h-11 rounded-lg border px-3" placeholder="رمز جدید" value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} />
        <input type="password" className="min-h-11 rounded-lg border px-3" placeholder="رمز عبور مدیر" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
        <ErpButton label="بازنشانی رمز" icon={FaKey} tone="warning" variant="solid" onClick={resetPassword} />
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-3">
          <input type="checkbox" checked={requirePasswordChange} onChange={(event) => setRequirePasswordChange(event.target.checked)} />
          الزام کاربر به تغییر این رمز در ورود بعدی
        </label>
      </div>
      <div className="mt-6 border-t border-red-200 pt-4"><ErpButton label="حذف دائمی حساب با حفظ سوابق" icon={FaTrash} tone="danger" variant="outline" onClick={eraseAccount} /></div>
    </ErpSection>}
    {erasurePreview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="پیش‌نمایش حذف دائمی حساب">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <h2 className="text-xl font-bold text-red-700">حذف دائمی حساب {erasurePreview.displayName}</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">اطلاعات ورود، نشست‌ها، پروفایل شخصی و دسترسی‌ها حذف می‌شوند؛ رکورد پرسنل و سوابق کسب‌وکار حفظ خواهند شد.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          {Object.entries(erasurePreview.references || {}).map(([key, value]) => <div key={key} className="rounded-lg border p-3"><span className="block text-slate-500">{key}</span><strong>{String(value)}</strong></div>)}
        </div>
        <textarea className="mt-4 min-h-24 w-full rounded-lg border p-3" placeholder="دلیل اجباری حذف" value={erasureReason} onChange={(event) => setErasureReason(event.target.value)} />
        <input type="password" className="mt-3 min-h-11 w-full rounded-lg border px-3" placeholder="رمز عبور مدیر" value={erasurePassword} onChange={(event) => setErasurePassword(event.target.value)} />
        <div className="mt-5 flex gap-2">
          <ErpButton label="تایید حذف دائمی" tone="danger" variant="solid" onClick={confirmErasure} />
          <ErpButton label="انصراف" tone="neutral" variant="outline" onClick={() => { setErasurePreview(null); setErasureReason(''); setErasurePassword(''); }} />
        </div>
      </div>
    </div>}
  </ErpPage>;
}
