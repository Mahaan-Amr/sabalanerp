'use client';
import { ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpSheet, ErpTextarea } from '@/components/erp';
import { useEffect, useState, use } from 'react';
import { FaDesktop, FaEdit, FaKey, FaShieldAlt, FaTrash, FaUser } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSummaryGrid } from '@/components/erp';
import { authAPI, usersAPI } from '@/lib/api';

export default function UserDetailsPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const [user, setUser] = useState<any>(null);
  const [currentRole, setCurrentRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authTab, setAuthTab] = useState('active');
  const [authRows, setAuthRows] = useState<any[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [feedback, setFeedback] = useState<null | { kind: 'success' | 'error'; text: string }>(null);
  const [erasureFeedback, setErasureFeedback] = useState('');
  const [erasurePreview, setErasurePreview] = useState<any>(null);
  const [erasureReason, setErasureReason] = useState('');
  const [erasurePassword, setErasurePassword] = useState('');
  const [accountAction, setAccountAction] = useState<null | { kind: 'attribute-creator' | 'revoke-all' | 'revoke-session'; sessionId?: string }>(null);
  const [actionCreatorId, setActionCreatorId] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [erasureBusy, setErasureBusy] = useState(false);

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
    if (temporaryPassword.length < 8 || !adminPassword) return setFeedback({ kind: 'error', text: 'رمز موقت حداقل ۸ کاراکتر و رمز مدیر الزامی است.' });
    try {
      await usersAPI.resetPassword(params.id, { temporaryPassword, adminPassword, requireChange: requirePasswordChange });
      setTemporaryPassword(''); setAdminPassword(''); setRequirePasswordChange(false); setFeedback({ kind: 'success', text: 'رمز جدید ثبت و همه نشست‌های کاربر لغو شد.' });
      await loadAuthentication('active');
    } catch (err: any) { setFeedback({ kind: 'error', text: err.response?.data?.error || 'بازنشانی رمز ناموفق بود.' }); }
  };
  const eraseAccount = async () => {
    setErasureFeedback('');
    const preview = await usersAPI.getErasurePreview(params.id);
    setErasurePreview(preview.data.data);
  };
  const confirmErasure = async () => {
    if (erasureBusy) return;
    if (!erasureReason.trim() || !erasurePassword) return setErasureFeedback('دلیل حذف و رمز عبور مدیر الزامی است.');
    setErasureBusy(true);
    setErasureFeedback('');
    try {
      await usersAPI.eraseUser(params.id, { reason: erasureReason.trim(), adminPassword: erasurePassword });
      window.location.href = '/dashboard/hr/users';
    } catch (err: any) {
      setErasureFeedback(err.response?.data?.error || 'حذف دائمی حساب ناموفق بود.');
    } finally {
      setErasureBusy(false);
    }
  };
  const closeAccountAction = () => {
    if (actionBusy) return;
    setAccountAction(null);
    setActionCreatorId('');
    setActionReason('');
  };
  const confirmAccountAction = async () => {
    if (!accountAction || !actionReason.trim()) return;
    if (accountAction.kind === 'attribute-creator' && !actionCreatorId.trim()) return;
    setActionBusy(true);
    setFeedback(null);
    try {
      if (accountAction.kind === 'attribute-creator') {
        await usersAPI.attributeCreator(user.id, { creatorId: actionCreatorId.trim(), reason: actionReason.trim() });
        await load();
      } else if (accountAction.kind === 'revoke-all') {
        await usersAPI.revokeAllUserSessions(user.id, actionReason.trim());
        await loadAuthentication();
      } else if (accountAction.sessionId) {
        await usersAPI.revokeUserSession(user.id, accountAction.sessionId, actionReason.trim());
        await loadAuthentication();
      }
      setAccountAction(null);
      setActionCreatorId('');
      setActionReason('');
    } catch (err: any) {
      setFeedback({ kind: 'error', text: err.response?.data?.error || 'انجام عملیات امنیتی ناموفق بود.' });
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <ErpLoading />;
  if (error || !user) return <ErpEmptyState icon={FaUser} title="کاربر پیدا نشد" description={error} action={{ label: 'بازگشت', href: '/dashboard/hr/users' }} />;
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const creator = user.creatorDisplayNameSnapshot
    ? user.createdByUser?.erasedAt
      ? `کاربر حذف‌شده — ${user.creatorDisplayNameSnapshot}`
      : `${user.creatorDisplayNameSnapshot}${user.creatorUsernameSnapshot ? ` (@${user.creatorUsernameSnapshot})` : ''}`
    : 'نامشخص — داده تاریخی';

  return <ErpPage eyebrow="مدیریت سیستم" title={fullName || user.username} description="جزئیات حساب، منشأ ایجاد و شواهد امنیتی کاربر." backHref="/dashboard/hr/users" actions={[
    { label: 'ویرایش', href: `/dashboard/hr/users/${user.id}/edit`, icon: FaEdit, tone: 'primary', variant: 'solid' },
    { label: 'مدیریت دسترسی‌ها', href: `/dashboard/hr/permissions?userId=${user.id}`, icon: FaShieldAlt, tone: 'neutral', variant: 'outline' },
  ]} metrics={[
    { label: 'وضعیت', value: user.isActive ? 'فعال' : 'غیرفعال', icon: FaUser, tone: user.isActive ? 'success' : 'danger' },
    { label: 'نقش', value: user.role, icon: FaShieldAlt, tone: user.role === 'ADMIN' ? 'neutral' : 'info' },
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
    ]} />{currentRole === 'ADMIN' && user.creatorAttributionKind === 'UNKNOWN' && <div className="mt-4"><ErpButton label="ثبت ایجادکننده تاریخی" variant="outline" onClick={() => setAccountAction({ kind: 'attribute-creator' })} /></div>}</ErpSection>

    {currentRole === 'ADMIN' && <ErpSection title="امنیت حساب و دستگاه‌ها">
      <p className="mb-4 text-sm leading-6 text-[var(--sds-text-secondary)]">نشست‌ها، تاریخچه ورود و تلاش‌های ناموفق فقط برای مدیر سیستم قابل مشاهده است.</p>
      {feedback && <ErpInlineState kind={feedback.kind} title={feedback.text} className="mb-4" />}
      <div className="mb-4 flex flex-wrap gap-2">
        {[['active', 'نشست‌های فعال'], ['history', 'تاریخچه نشست'], ['failed', 'ورودهای ناموفق']].map(([value, label]) => <ErpButton key={value} label={label} variant={authTab === value ? 'solid' : 'outline'} tone={authTab === value ? 'primary' : 'neutral'} onClick={() => setAuthTab(value)} />)}
        <ErpButton label="لغو همه نشست‌ها" tone="warning" variant="outline" onClick={() => setAccountAction({ kind: 'revoke-all' })} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{authRows.map((row) => <ErpCard key={row.id} className="p-4">
        {authTab === 'failed' ? <><p className="font-semibold">{row.attemptedIdentifier || 'شناسه نامشخص'}</p><p className="mt-2 text-xs" dir="ltr">{row.ipAddress || '—'} · {row.browser || ''} · {row.operatingSystem || ''}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{new Date(row.createdAt).toLocaleString('fa-IR')} · {row.safeCategory}</p></> : <>
          <p className="font-semibold"><FaDesktop className="ml-2 inline" />{row.browser || 'مرورگر نامشخص'} · {row.operatingSystem || ''}</p><p className="mt-2 text-xs" dir="ltr">{row.ipAddress || '—'} · {row.approximateLocation || 'مکان تقریبی نامشخص'}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">آخرین فعالیت: {new Date(row.lastActivityAt).toLocaleString('fa-IR')}</p>
          {!row.revokedAt && <div className="mt-3"><ErpButton label="قطع دسترسی" tone="danger" variant="outline" onClick={() => setAccountAction({ kind: 'revoke-session', sessionId: row.id })} /></div>}
        </>}
      </ErpCard>)}</div>
      <div className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-[var(--sds-border-default)] p-4 md:grid-cols-3">
        <ErpInput type="password" placeholder="رمز جدید" value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} />
        <ErpInput type="password" placeholder="رمز عبور مدیر" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
        <ErpButton label="بازنشانی رمز" icon={FaKey} tone="warning" variant="solid" onClick={resetPassword} />
        <ErpCheckbox className="md:col-span-3" label="الزام کاربر به تغییر این رمز در ورود بعدی" checked={requirePasswordChange} onChange={(event) => setRequirePasswordChange(event.target.checked)} />
      </div>
      <div className="mt-6 border-t border-[var(--sds-danger-border)] pt-4"><ErpButton label="حذف دائمی حساب با حفظ سوابق" icon={FaTrash} tone="danger" variant="outline" onClick={eraseAccount} /></div>
    </ErpSection>}
    <ErpSheet open={Boolean(accountAction)} onClose={closeAccountAction} title={accountAction?.kind === 'attribute-creator' ? 'ثبت ایجادکننده تاریخی' : accountAction?.kind === 'revoke-all' ? 'لغو همه نشست‌ها' : 'قطع دسترسی نشست'} presentation="modal" pending={actionBusy} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={closeAccountAction} disabled={actionBusy} /><ErpButton label="تأیید و ثبت" tone={accountAction?.kind === 'attribute-creator' ? 'primary' : 'danger'} variant="solid" onClick={() => void confirmAccountAction()} disabled={actionBusy || !actionReason.trim() || (accountAction?.kind === 'attribute-creator' && !actionCreatorId.trim())} /></div>}>
      <div className="space-y-4">
        {accountAction?.kind === 'attribute-creator' && <ErpField label="شناسه کاربر ایجادکننده" required><ErpInput value={actionCreatorId} onChange={(event) => setActionCreatorId(event.target.value)} /></ErpField>}
        <ErpField label={accountAction?.kind === 'attribute-creator' ? 'دلیل و منبع انتساب تاریخی' : 'دلیل اقدام امنیتی'} required><ErpTextarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></ErpField>
      </div>
    </ErpSheet>
    <ErpSheet open={Boolean(erasurePreview)} onClose={() => { if (erasureBusy) return; setErasurePreview(null); setErasureReason(''); setErasurePassword(''); setErasureFeedback(''); }} title={`حذف دائمی حساب ${erasurePreview?.displayName || ''}`} presentation="modal" size="wide" pending={erasureBusy} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" tone="neutral" variant="outline" disabled={erasureBusy} onClick={() => { setErasurePreview(null); setErasureReason(''); setErasurePassword(''); setErasureFeedback(''); }} /><ErpButton label="تایید حذف دائمی" tone="danger" variant="solid" disabled={erasureBusy || !erasureReason.trim() || !erasurePassword} onClick={() => void confirmErasure()} /></div>}>
      {erasurePreview && <div>
        {erasureFeedback && <ErpInlineState kind="error" title={erasureFeedback} className="mb-4" />}
        <p className="mt-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">اطلاعات ورود، نشست‌ها، پروفایل شخصی و دسترسی‌ها حذف می‌شوند؛ رکورد پرسنل و سوابق کسب‌وکار حفظ خواهند شد.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          {Object.entries(erasurePreview.references || {}).map(([key, value]) => <div key={key} className="rounded-lg border p-3"><span className="block text-[var(--sds-text-secondary)]">{key}</span><strong>{String(value)}</strong></div>)}
        </div>
        <div className="mt-4 space-y-3"><ErpField label="دلیل اجباری حذف" required><ErpTextarea value={erasureReason} onChange={(event) => setErasureReason(event.target.value)} /></ErpField><ErpField label="رمز عبور مدیر" required><ErpInput type="password" value={erasurePassword} onChange={(event) => setErasurePassword(event.target.value)} /></ErpField></div>
      </div>
      }
    </ErpSheet>
  </ErpPage>;
}
