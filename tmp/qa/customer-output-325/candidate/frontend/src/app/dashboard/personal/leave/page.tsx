'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaCalendarAlt, FaCheck, FaEdit, FaPlus, FaRedo, FaTimes, FaUserPlus } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { dashboardAPI, personalAPI } from '@/lib/api';
import { PersianCalendar } from '@/lib/persian-calendar';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpSkeleton,
  ErpTextarea,
  ErpWorkspacePage,
  erpFieldLabelClassName,
} from '@/components/erp';

type LeaveView = 'MINE' | 'REVIEW';
const leaveTypes = ['استحقاقی', 'استعلاجی', 'استعلاجی سازمانی', 'بدون حقوق'];
const emptyForm = { id: '', employeeId: '', leaveType: 'استحقاقی', startDate: PersianCalendar.now(), endDate: PersianCalendar.now(), reason: '', description: '' };
const statusLabels: Record<string, string> = { PENDING: 'در انتظار بررسی', APPROVED: 'تأییدشده', REJECTED: 'ردشده', CANCELLED: 'لغوشده', EXPIRED: 'منقضی' };
const statusTones: Record<string, any> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral', EXPIRED: 'neutral' };
const userName = (user: any) => `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || '—';
const toIso = (value: string) => PersianCalendar.toGregorian(value).toISOString();
const toJalali = (value: string) => value ? PersianCalendar.toPersian(value) : '';

export default function PersonalLeavePage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [view, setView] = useState<LeaveView>('MINE');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [formMode, setFormMode] = useState<'MINE' | 'MANAGER' | ''>('');
  const [reviewTarget, setReviewTarget] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const isManager = ['ADMIN', 'MANAGER'].includes(currentUser?.role);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const profileResponse = await dashboardAPI.getProfile();
      const profile = profileResponse.data.data;
      const [requestsResponse, usersResponse] = await Promise.all([
        personalAPI.getLeaveRequests(),
        ['ADMIN', 'MANAGER'].includes(profile.role) ? personalAPI.getLeaveUsers() : Promise.resolve({ data: { data: [] } }),
      ]);
      setCurrentUser(profile); setRequests(requestsResponse.data.data || []); setUsers(usersResponse.data.data || []);
      if (!['ADMIN', 'MANAGER'].includes(profile.role)) setView('MINE');
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'دریافت مرخصی‌ها انجام نشد.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => requests.filter((request) => {
    const inView = view === 'MINE' ? request.employeeId === currentUser?.id : request.employeeId !== currentUser?.id && request.status === 'PENDING';
    return inView && (!status || request.status === status);
  }), [currentUser?.id, requests, status, view]);

  const openNew = (mode: 'MINE' | 'MANAGER') => { setForm({ ...emptyForm }); setFormMode(mode); setError(''); };
  const openEdit = (request: any) => {
    setForm({ id: request.id, employeeId: request.employeeId, leaveType: request.leaveType, startDate: toJalali(request.startDate), endDate: toJalali(request.endDate || request.startDate), reason: request.reason || '', description: request.description || '' });
    setFormMode(request.employeeId === currentUser?.id ? 'MINE' : 'MANAGER');
  };

  const save = async () => {
    if (!form.leaveType || !form.startDate || !form.endDate || !form.reason.trim() || (formMode === 'MANAGER' && !form.employeeId)) { setError('نوع، بازه، دلیل و کاربر لازم است.'); return; }
    setBusy(true); setError('');
    try {
      const payload = { employeeId: formMode === 'MANAGER' ? form.employeeId : undefined, leaveType: form.leaveType, startDate: toIso(form.startDate), endDate: toIso(form.endDate), reason: form.reason.trim(), description: form.description.trim() || undefined };
      if (form.id) await personalAPI.updateLeaveRequest(form.id, payload);
      else await personalAPI.createLeaveRequest(payload);
      setFormMode(''); setMessage(formMode === 'MANAGER' && !form.id ? 'مرخصی کاربر ثبت و تأیید شد.' : 'درخواست مرخصی ذخیره شد.'); await load();
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'ذخیره مرخصی انجام نشد.'); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!reviewTarget) return; setBusy(true); setError('');
    try { await personalAPI.approveLeaveRequest(reviewTarget.id); setReviewTarget(null); setMessage('درخواست تأیید شد.'); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'تأیید درخواست انجام نشد.'); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    if (!reviewTarget || !rejectionReason.trim()) return; setBusy(true); setError('');
    try { await personalAPI.rejectLeaveRequest(reviewTarget.id, rejectionReason.trim()); setReviewTarget(null); setRejectionReason(''); setMessage('درخواست رد شد.'); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'رد درخواست انجام نشد.'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!cancelTarget) return;
    const needsReason = isManager && cancelTarget.status === 'APPROVED';
    if (needsReason && !cancelReason.trim()) return;
    setBusy(true); setError('');
    try { await personalAPI.cancelLeaveRequest(cancelTarget.id, cancelReason.trim() || undefined); setCancelTarget(null); setCancelReason(''); setMessage('درخواست لغو شد.'); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'لغو درخواست انجام نشد.'); }
    finally { setBusy(false); }
  };

  return (
    <ErpWorkspacePage title="مرخصی" primaryAction={{ label: 'درخواست مرخصی', icon: FaPlus, onClick: () => openNew('MINE') }} secondaryActions={[...(isManager ? [{ label: 'ثبت مرخصی برای کاربر', icon: FaUserPlus, onClick: () => openNew('MANAGER') }] : []), { label: 'به‌روزرسانی', icon: FaRedo, onClick: () => void load() }]} backHref="/dashboard/personal">
      <div className="space-y-4" dir="rtl">
        {message && <ErpInlineState kind="success" title={message} />}
        {error && <ErpInlineState kind={requests.length ? 'stale' : 'error'} title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
        {loading && !currentUser ? <ErpSkeleton lines={5} /> : (
          <>
            <ErpSection>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <ErpSegmentedControl value={view} onChange={setView} options={[{ value: 'MINE', label: 'درخواست‌های من' }, ...(isManager ? [{ value: 'REVIEW' as const, label: 'نیازمند بررسی' }] : [])]} />
                <ErpSelect aria-label="وضعیت" value={status} onChange={(event) => setStatus(event.target.value)} className="sm:max-w-56"><option value="">همه وضعیت‌ها</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect>
              </div>
            </ErpSection>
            <ErpSection>
              {visible.length === 0 ? <ErpEmptyState icon={FaCalendarAlt} title={view === 'REVIEW' ? 'درخواستی منتظر بررسی نیست' : 'درخواستی ثبت نشده است'} /> : <div className="space-y-3">{visible.map((request) => {
                const canEdit = request.status === 'PENDING' && (request.employeeId === currentUser?.id || isManager);
                const canCancel = (request.status === 'PENDING' && request.employeeId === currentUser?.id) || (isManager && ['PENDING', 'APPROVED'].includes(request.status));
                return <ErpCard key={request.id} className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-black sds-text-primary">{request.leaveType}</h2><ErpBadge tone={statusTones[request.status] || 'neutral'}>{statusLabels[request.status] || request.status}</ErpBadge></div><p className="mt-2 text-sm sds-text-muted">{userName(request.employee)} · {PersianCalendar.formatForDisplay(request.startDate)} تا {PersianCalendar.formatForDisplay(request.endDate || request.startDate)}</p><p className="mt-2 text-sm leading-6 sds-text-primary">{request.reason}</p>{request.rejectionReason && <p className="mt-2 text-sm text-[var(--sds-danger)]">دلیل رد: {request.rejectionReason}</p>}</div><div className="flex flex-wrap gap-2">{view === 'REVIEW' && <ErpButton label="بررسی" icon={FaCheck} onClick={() => { setReviewTarget(request); setRejectionReason(''); }} />}{canEdit && <ErpButton label="ویرایش" icon={FaEdit} variant="outline" onClick={() => openEdit(request)} />}{canCancel && <ErpButton label="لغو" icon={FaTimes} tone="danger" variant="ghost" onClick={() => { setCancelTarget(request); setCancelReason(''); }} />}</div></div></ErpCard>;
              })}</div>}
            </ErpSection>
          </>
        )}
      </div>

      <ErpSheet open={Boolean(formMode)} onClose={() => setFormMode('')} title={form.id ? 'ویرایش درخواست مرخصی' : formMode === 'MANAGER' ? 'ثبت مرخصی برای کاربر' : 'درخواست مرخصی'} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={() => setFormMode('')} /><ErpButton label={form.id ? 'ذخیره تغییرات' : 'ثبت درخواست'} onClick={() => void save()} disabled={busy} /></div>}>
        <div className="space-y-4" dir="rtl">
          {formMode === 'MANAGER' && <ErpInlineState kind="stale" title="این مرخصی مطابق رفتار فعلی بلافاصله تأیید می‌شود و می‌تواند پوشش شیفت گارد را نیازمند جایگزین کند." />}
          {formMode === 'MANAGER' && <label><span className={erpFieldLabelClassName}>کاربر</span><ErpSelect value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}><option value="">انتخاب کاربر</option>{users.map((user) => <option key={user.id} value={user.id}>{userName(user)}{user.department?.namePersian ? ` · ${user.department.namePersian}` : ''}</option>)}</ErpSelect></label>}
          <label><span className={erpFieldLabelClassName}>نوع مرخصی</span><ErpSelect value={form.leaveType} onChange={(event) => setForm({ ...form, leaveType: event.target.value })}>{leaveTypes.map((type) => <option key={type}>{type}</option>)}</ErpSelect></label>
          <div className="grid gap-3 sm:grid-cols-2"><label><span className={erpFieldLabelClassName}>از تاریخ</span><PersianCalendarComponent value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate, endDate: form.endDate || startDate })} disablePastDates /></label><label><span className={erpFieldLabelClassName}>تا تاریخ</span><PersianCalendarComponent value={form.endDate} onChange={(endDate) => setForm({ ...form, endDate })} disablePastDates /></label></div>
          <label><span className={erpFieldLabelClassName}>دلیل</span><ErpTextarea rows={4} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
          <label><span className={erpFieldLabelClassName}>توضیحات (اختیاری)</span><ErpTextarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        </div>
      </ErpSheet>

      <ErpSheet open={Boolean(reviewTarget)} onClose={() => setReviewTarget(null)} title="بررسی درخواست مرخصی" footer={<div className="flex justify-end gap-2"><ErpButton label="رد درخواست" icon={FaTimes} tone="danger" variant="outline" onClick={() => void reject()} disabled={busy || !rejectionReason.trim()} /><ErpButton label="تأیید درخواست" icon={FaCheck} tone="success" onClick={() => void approve()} disabled={busy} /></div>}>
        {reviewTarget && <div className="space-y-4" dir="rtl"><ErpCard className="p-4"><p className="font-black sds-text-primary">{userName(reviewTarget.employee)}</p><p className="mt-2 text-sm sds-text-muted">{reviewTarget.leaveType} · {PersianCalendar.formatForDisplay(reviewTarget.startDate)} تا {PersianCalendar.formatForDisplay(reviewTarget.endDate)}</p><p className="mt-3 text-sm leading-7 sds-text-primary">{reviewTarget.reason}</p></ErpCard><ErpInlineState kind="stale" title="تأیید می‌تواند شیفت‌های آینده گارد را نیازمند جایگزین کند." /><label><span className={erpFieldLabelClassName}>دلیل رد</span><ErpTextarea rows={3} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} /></label></div>}
      </ErpSheet>
      <ErpSheet open={Boolean(cancelTarget)} onClose={() => setCancelTarget(null)} title="لغو درخواست مرخصی" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={() => setCancelTarget(null)} /><ErpButton label="لغو درخواست" tone="danger" onClick={() => void cancel()} disabled={busy || Boolean(isManager && cancelTarget?.status === 'APPROVED' && !cancelReason.trim())} /></div>}><div className="space-y-3" dir="rtl"><p className="text-sm leading-7 sds-text-muted">وضعیت درخواست به لغوشده تغییر می‌کند؛ تاریخچه آن باقی می‌ماند.</p>{isManager && cancelTarget?.status === 'APPROVED' && <label><span className={erpFieldLabelClassName}>دلیل لغو</span><ErpTextarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>}</div></ErpSheet>
    </ErpWorkspacePage>
  );
}
