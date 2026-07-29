'use client';
import { ErpTextarea } from '@/components/erp';
import { useEffect, useMemo, useState } from 'react';
import { FaCalendarAlt, FaCheck, FaDesktop, FaEdit, FaPlus, FaTimes, FaUser, FaUserClock } from 'react-icons/fa';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { authAPI, dashboardAPI, personalAPI } from '@/lib/api';
import { PersianCalendar } from '@/lib/persian-calendar';

const leaveTypes = ['استحقاقی', 'استعلاجی', 'استعلاجی سازمانی', 'بدون حقوق'];
const emptyForm = { id: '', employeeId: '', leaveType: 'استحقاقی', startDate: PersianCalendar.now(), endDate: PersianCalendar.now(), reason: '', description: '' };
const inputClass = 'min-h-12 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-4 py-3 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] dark:focus:bg-[var(--sds-surface-raised)]';
const labelClass = 'mb-2 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]';

const toIso = (value: string) => PersianCalendar.toGregorian(value).toISOString();
const toJalali = (value: string) => value ? PersianCalendar.toPersian(value) : '';
const userName = (user: any) => `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || '-';

const statusLabel: Record<string, string> = {
  PENDING: 'در انتظار بررسی',
  APPROVED: 'تایید شده',
  REJECTED: 'رد شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی'
};

const statusTone: Record<string, any> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral'
};

export default function PersonalPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);

  const isManager = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';
  const pendingCount = requests.filter((item) => item.status === 'PENDING').length;
  const approvedCount = requests.filter((item) => item.status === 'APPROVED').length;

  const userOptions = useMemo(() => users.map((user) => ({
    value: user.id,
    label: `${userName(user)}${user.department?.namePersian ? ` - ${user.department.namePersian}` : ''}`
  })), [users]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const profileResponse = await dashboardAPI.getProfile();
      const profile = profileResponse.data.data;
      setCurrentUser(profile);
      const [requestsResponse, usersResponse, sessionsResponse] = await Promise.all([
        personalAPI.getLeaveRequests(),
        ['ADMIN', 'MANAGER'].includes(profile.role) ? personalAPI.getLeaveUsers() : Promise.resolve({ data: { success: true, data: [] } }),
        authAPI.getSessions(),
      ]);
      if (requestsResponse.data.success) setRequests(requestsResponse.data.data || []);
      if (usersResponse.data.success) setUsers(usersResponse.data.data || []);
      if (sessionsResponse.data.success) setSessions(sessionsResponse.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت اطلاعات امور شخص ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => setForm({ ...emptyForm, employeeId: '' });

  const revokeSession = async (session: any) => {
    if (!window.confirm(`دسترسی ${session.browser || 'مرورگر'} · ${session.operatingSystem || ''} قطع شود؟`)) return;
    await authAPI.revokeSession(session.id);
    if (session.isCurrent) window.location.href = '/login';
    else await loadData();
  };

  const submit = async () => {
    if (!form.leaveType || !form.startDate || !form.endDate || !form.reason.trim()) {
      setError('نوع مرخصی، بازه تاریخ و دلیل الزامی است.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        employeeId: form.employeeId || undefined,
        leaveType: form.leaveType,
        startDate: toIso(form.startDate),
        endDate: toIso(form.endDate),
        reason: form.reason.trim(),
        description: form.description.trim() || undefined
      };
      if (form.id) {
        await personalAPI.updateLeaveRequest(form.id, payload);
        setMessage('درخواست مرخصی ویرایش شد.');
      } else {
        await personalAPI.createLeaveRequest(payload);
        setMessage(isManager && form.employeeId ? 'مرخصی کاربر ثبت و تایید شد.' : 'درخواست مرخصی ثبت شد.');
      }
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ذخیره درخواست مرخصی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const edit = (request: any) => {
    setForm({
      id: request.id,
      employeeId: request.employeeId,
      leaveType: request.leaveType || 'استحقاقی',
      startDate: toJalali(request.startDate),
      endDate: toJalali(request.endDate || request.startDate),
      reason: request.reason || '',
      description: request.description || ''
    });
  };

  const approve = async (request: any) => {
    setSaving(true);
    try {
      await personalAPI.approveLeaveRequest(request.id);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تایید درخواست ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const reject = async (request: any) => {
    const reason = window.prompt('دلیل رد درخواست را وارد کنید');
    if (!reason?.trim()) return;
    setSaving(true);
    try {
      await personalAPI.rejectLeaveRequest(request.id, reason.trim());
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'رد درخواست ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (request: any) => {
    const reason = isManager && request.status === 'APPROVED' ? window.prompt('دلیل لغو درخواست تاییدشده را وارد کنید') : 'لغو توسط کاربر';
    if (isManager && request.status === 'APPROVED' && !reason?.trim()) return;
    setSaving(true);
    try {
      await personalAPI.cancelLeaveRequest(request.id, reason || undefined);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'لغو درخواست ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="امور شخص"
      title="درخواست مرخصی"
      description="ثبت و پیگیری مرخصی‌های شخصی. مدیران سیستم می‌توانند برای کاربران دیگر هم مرخصی ثبت و درخواست‌ها را بررسی کنند."
      metrics={[
        { label: 'کل درخواست‌ها', value: requests.length.toLocaleString('fa-IR'), icon: FaCalendarAlt, tone: 'primary' },
        { label: 'در انتظار بررسی', value: pendingCount.toLocaleString('fa-IR'), icon: FaUserClock, tone: 'warning' },
        { label: 'تایید شده', value: approvedCount.toLocaleString('fa-IR'), icon: FaCheck, tone: 'success' },
      ]}
      actions={[{ label: 'به‌روزرسانی', onClick: loadData, icon: FaCalendarAlt, tone: 'neutral' }]}
    >
      {message && <div className="rounded-lg border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-3 text-sm font-semibold text-[var(--sds-success)]">{message}</div>}
      {error && <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-3 text-sm font-semibold text-[var(--sds-danger)]">{error}</div>}

      <ErpSection title="دستگاه‌ها و نشست‌های فعال" description="هر ردیف یک نشست مرورگر است؛ نام سخت‌افزار از مرورگر قابل تشخیص قطعی نیست.">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sessions.filter((item) => !item.revokedAt).map((session) => <ErpCard key={session.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold"><FaDesktop className="ml-2 inline" />{session.browser || 'مرورگر نامشخص'} · {session.operatingSystem || 'سیستم نامشخص'}</p>
                <p className="mt-2 text-xs text-[var(--sds-text-secondary)]" dir="ltr">{session.ipAddress || '—'} · {session.approximateLocation || 'مکان تقریبی نامشخص'}</p>
                <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">آخرین فعالیت: {new Date(session.lastActivityAt).toLocaleString('fa-IR')}</p>
                <div className="mt-2 flex gap-2">{session.isCurrent && <ErpBadge tone="success">نشست فعلی</ErpBadge>}{session.isNewBrowser && <ErpBadge tone="warning">مرورگر جدید</ErpBadge>}</div>
              </div>
              <ErpButton label={session.isCurrent ? 'خروج' : 'قطع دسترسی'} tone="danger" variant="outline" onClick={() => revokeSession(session)} />
            </div>
          </ErpCard>)}
        </div>
        {sessions.some((item) => !item.revokedAt && !item.isCurrent) && <div className="mt-4"><ErpButton label="قطع همه نشست‌های دیگر" tone="warning" variant="outline" onClick={async () => { await authAPI.revokeOtherSessions(); await loadData(); }} /></div>}
      </ErpSection>

      <ErpSection title={form.id ? 'ویرایش درخواست مرخصی' : 'ثبت درخواست مرخصی'}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {isManager && (
            <label className="block">
              <span className={labelClass}>کاربر</span>
              <EnhancedDropdown value={form.employeeId} onChange={(employeeId) => setForm((old) => ({ ...old, employeeId }))} options={userOptions} placeholder="خودم یا انتخاب کاربر" searchable clearable />
            </label>
          )}
          <label className="block">
            <span className={labelClass}>نوع مرخصی</span>
            <EnhancedDropdown value={form.leaveType} onChange={(leaveType) => setForm((old) => ({ ...old, leaveType }))} options={leaveTypes.map((type) => ({ value: type, label: type }))} searchable required />
          </label>
          <label className="block">
            <span className={labelClass}>از تاریخ</span>
            <PersianCalendarComponent value={form.startDate} onChange={(startDate) => setForm((old) => ({ ...old, startDate, endDate: old.endDate || startDate }))} disablePastDates />
          </label>
          <label className="block">
            <span className={labelClass}>تا تاریخ</span>
            <PersianCalendarComponent value={form.endDate} onChange={(endDate) => setForm((old) => ({ ...old, endDate }))} disablePastDates />
          </label>
          <label className="block lg:col-span-2">
            <span className={labelClass}>دلیل</span>
            <ErpTextarea className={`${inputClass} min-h-24`} value={form.reason} onChange={(event) => setForm((old) => ({ ...old, reason: event.target.value }))} />
          </label>
          <label className="block lg:col-span-2">
            <span className={labelClass}>توضیحات</span>
            <ErpTextarea className={`${inputClass} min-h-20`} value={form.description} onChange={(event) => setForm((old) => ({ ...old, description: event.target.value }))} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {form.id && <ErpButton label="انصراف از ویرایش" onClick={resetForm} variant="outline" tone="neutral" />}
          <ErpButton label={form.id ? 'ذخیره تغییرات' : 'ثبت درخواست'} icon={form.id ? FaEdit : FaPlus} onClick={submit} disabled={saving} variant="solid" />
        </div>
      </ErpSection>

      <ErpSection title={isManager ? 'درخواست‌های مرخصی کاربران' : 'درخواست‌های من'}>
        {requests.length === 0 ? (
          <ErpEmptyState icon={FaCalendarAlt} title="درخواستی ثبت نشده است" />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {requests.map((request) => {
              const canEdit = request.status === 'PENDING' && (request.employeeId === currentUser?.id || isManager);
              const canCancel = (request.status === 'PENDING' && request.employeeId === currentUser?.id) || (isManager && ['PENDING', 'APPROVED'].includes(request.status));
              return (
                <ErpCard key={request.id} className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{request.leaveType || 'مرخصی'}</span>
                        <ErpBadge tone={statusTone[request.status] || 'neutral'}>{statusLabel[request.status] || request.status}</ErpBadge>
                      </div>
                      <p className="mt-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                        <FaUser className="ml-1 inline h-3 w-3" />
                        {userName(request.employee)} | {PersianCalendar.formatForDisplay(request.startDate)} تا {PersianCalendar.formatForDisplay(request.endDate || request.startDate)}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{request.reason}</p>
                      {request.description && <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)]">{request.description}</p>}
                      {request.rejectionReason && <p className="mt-2 text-sm text-[var(--sds-danger)]">دلیل رد: {request.rejectionReason}</p>}
                      {request.cancellationReason && <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">دلیل لغو: {request.cancellationReason}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canEdit && <ErpButton label="ویرایش" icon={FaEdit} onClick={() => edit(request)} variant="outline" tone="neutral" disabled={saving} />}
                      {isManager && request.status === 'PENDING' && <ErpButton label="تایید" icon={FaCheck} onClick={() => approve(request)} variant="solid" tone="success" disabled={saving} />}
                      {isManager && request.status === 'PENDING' && <ErpButton label="رد" icon={FaTimes} onClick={() => reject(request)} variant="soft" tone="danger" disabled={saving} />}
                      {canCancel && <ErpButton label="لغو" icon={FaTimes} onClick={() => cancel(request)} variant="outline" tone="danger" disabled={saving} />}
                    </div>
                  </div>
                </ErpCard>
              );
            })}
          </div>
        )}
      </ErpSection>
    </ErpPage>
  );
}
