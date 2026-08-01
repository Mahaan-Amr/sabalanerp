'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FaCheck, FaEdit, FaPlane, FaPlus, FaRedo, FaTimes, FaTrash } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpSection, ErpSegmentedControl, ErpSheet, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { ErpPressable } from '@/components/erp';
import ExceptionRequestForm from '@/components/ExceptionRequestForm';
import MissionAssignmentForm from '@/components/MissionAssignmentForm';
import { askSecurityAction, notifySecurity } from '@/components/SecurityNoticeHost';
import PersianCalendar from '@/lib/persian-calendar';
import { securityAPI } from '@/lib/api';
import { WORKSPACES, WORKSPACE_PERMISSIONS, useWorkspace } from '@/contexts/WorkspaceContext';

type Kind = 'exception' | 'mission';
type ReviewView = 'pending' | 'all';

const statusLabel: Record<string, string> = { PENDING: 'در انتظار بررسی', APPROVED: 'تأییدشده', REJECTED: 'ردشده', CANCELLED: 'لغوشده' };
const statusTone = (status: string) => status === 'APPROVED' ? 'success' : status === 'PENDING' ? 'warning' : 'neutral';
const personName = (item: any) => `${item.personnel?.firstName || item.employee?.firstName || ''} ${item.personnel?.lastName || item.employee?.lastName || ''}`.trim() || '—';
const initialFormData = (item: any) => ({ ...item, personnelId: item.personnelId || item.employee?.personnelId || '', startDate: item.startDate ? PersianCalendar.toPersian(item.startDate) : '', endDate: item.endDate ? PersianCalendar.toPersian(item.endDate) : '' });

export default function SecurityExceptionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { hasPermission } = useWorkspace();
  const reviewer = hasPermission(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN);
  const [view, setView] = useState<ReviewView>(reviewer ? 'pending' : 'all');
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [missions, setMissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ kind: Kind; item?: any; correction?: boolean } | null>(null);
  const [createPickerOpen, setCreatePickerOpen] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [exceptionResult, missionResult] = await Promise.allSettled([securityAPI.getExceptionRequests({ limit: 250 }), securityAPI.getMissionAssignments({ limit: 250 })]);
      if (exceptionResult.status === 'fulfilled') setExceptions(exceptionResult.value.data.data || []);
      if (missionResult.status === 'fulfilled') setMissions(missionResult.value.data.data || []);
      if (exceptionResult.status === 'rejected' || missionResult.status === 'rejected') setError('بخشی از موارد دریافت نشد؛ اطلاعات موفق نمایش داده می‌شود.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'all' || params.get('view') === 'pending') setView(params.get('view') as ReviewView);
    if (params.get('type') === 'exception' || params.get('type') === 'mission') setKind(params.get('type') as Kind);
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== (reviewer ? 'pending' : 'all')) params.set('view', view);
    if (kind !== 'all') params.set('type', kind);
    const query = params.toString(); router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [kind, pathname, reviewer, router, view]);

  const items = useMemo(() => [
    ...exceptions.map((item) => ({ ...item, recordKind: 'exception' as Kind })),
    ...missions.map((item) => ({ ...item, recordKind: 'mission' as Kind })),
  ].filter((item) => (kind === 'all' || item.recordKind === kind) && (view === 'all' || item.status === 'PENDING')).sort((left, right) => new Date(right.createdAt || right.startDate).getTime() - new Date(left.createdAt || left.startDate).getTime()), [exceptions, kind, missions, view]);

  const submitEditor = async (data: any) => {
    if (!editor) return; setSaving(true); setError('');
    try {
      let result: any;
      if (!editor.item) result = editor.kind === 'exception' ? await securityAPI.createExceptionRequest(data) : await securityAPI.createMissionAssignment(data);
      else if (editor.correction) {
        const correctionReason = await askSecurityAction({ title: 'اصلاح حسابرسی‌شده', inputLabel: 'دلیل اصلاح' });
        if (!correctionReason?.trim()) return;
        result = editor.kind === 'exception' ? await securityAPI.correctException(editor.item.id, { ...data, correctionReason: correctionReason.trim() }) : await securityAPI.correctMissionAssignment(editor.item.id, { ...data, correctionReason: correctionReason.trim() });
      } else result = editor.kind === 'exception' ? await securityAPI.updateException(editor.item.id, data) : await securityAPI.updateMissionAssignment(editor.item.id, data);
      notifySecurity(result?.data?.warning || 'اطلاعات ذخیره شد.'); setEditor(null); await load();
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'ذخیره اطلاعات ناموفق بود.'); }
    finally { setSaving(false); }
  };

  const approve = async (item: any) => { const accepted = await askSecurityAction({ title: item.recordKind === 'mission' ? 'تأیید مأموریت' : 'تأیید استثنا', description: 'این تصمیم بر محاسبه حضور و غیاب بازه انتخاب‌شده اثر می‌گذارد.' }); if (!accepted) return; try { item.recordKind === 'exception' ? await securityAPI.approveExceptionRequest(item.id) : await securityAPI.approveMissionAssignment(item.id); await load(); } catch (requestError: any) { setError(requestError.response?.data?.error || 'تأیید ناموفق بود.'); } };
  const reject = async (item: any) => { const reason = await askSecurityAction({ title: 'رد مورد', inputLabel: 'دلیل رد' }); if (!reason?.trim()) return; try { item.recordKind === 'exception' ? await securityAPI.rejectExceptionRequest(item.id, reason.trim()) : await securityAPI.rejectMissionAssignment(item.id, reason.trim()); await load(); } catch (requestError: any) { setError(requestError.response?.data?.error || 'رد مورد ناموفق بود.'); } };
  const cancel = async (item: any) => { const reason = await askSecurityAction({ title: 'لغو مورد تأییدشده', inputLabel: 'دلیل لغو' }); if (!reason?.trim()) return; try { item.recordKind === 'exception' ? await securityAPI.cancelException(item.id, reason.trim()) : await securityAPI.cancelMissionAssignment(item.id, reason.trim()); await load(); } catch (requestError: any) { setError(requestError.response?.data?.error || 'لغو ناموفق بود.'); } };
  const remove = async (item: any) => { const accepted = await askSecurityAction({ title: 'حذف مورد در انتظار', description: 'این مورد هنوز اثری بر حضور و غیاب ندارد و حذف می‌شود.' }); if (!accepted) return; try { item.recordKind === 'exception' ? await securityAPI.deleteException(item.id) : await securityAPI.deleteMissionAssignment(item.id); await load(); } catch (requestError: any) { setError(requestError.response?.data?.error || 'حذف ناموفق بود.'); } };

  return (
    <ErpWorkspacePage className="guard-workspace" title="استثناها و مأموریت‌ها" primaryAction={{ label: 'ثبت مورد', icon: FaPlus, onClick: () => setCreatePickerOpen(true), variant: 'solid' }} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}>
      {loading && !exceptions.length && !missions.length ? <ErpSkeleton lines={5} /> : error && !exceptions.length && !missions.length ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: load }} /> : <>
        {error && <ErpInlineState kind="stale" title="آخرین به‌روزرسانی ناموفق بود؛ اطلاعات قبلی نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><ErpSegmentedControl value={view} onChange={setView} options={[{ value: 'pending', label: 'نیازمند بررسی' }, { value: 'all', label: 'همه موارد' }]} /><div className="flex gap-2"><ErpButton label="همه" onClick={() => setKind('all')} variant={kind === 'all' ? 'solid' : 'soft'} /><ErpButton label="استثنا" onClick={() => setKind('exception')} variant={kind === 'exception' ? 'solid' : 'soft'} /><ErpButton label="مأموریت" icon={FaPlane} onClick={() => setKind('mission')} variant={kind === 'mission' ? 'solid' : 'soft'} /></div></div>
        <ErpSection title={view === 'pending' ? 'نیازمند بررسی' : 'همه موارد'}>
          {!items.length ? <ErpEmptyState icon={FaCheck} title={view === 'pending' ? 'موردی نیازمند بررسی نیست' : 'موردی با این فیلترها ثبت نشده است'} /> : <div className="divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">{items.map((item) => <article key={`${item.recordKind}-${item.id}`} className="py-4 first:pt-0 last:pb-0"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold sds-text-primary ">{personName(item)}</h2><ErpStatus label={item.recordKind === 'exception' ? 'استثنا' : 'مأموریت'} tone={item.recordKind === 'mission' ? 'info' : 'purple'} /><ErpStatus label={statusLabel[item.status] || item.status} tone={statusTone(item.status)} /></div><p className="mt-2 text-sm font-semibold sds-text-secondary ">{item.recordKind === 'exception' ? item.exceptionType : `${item.missionType}${item.missionLocation ? ` · ${item.missionLocation}` : ''}`}</p><p className="mt-1 text-sm sds-text-muted">{new Date(item.startDate).toLocaleDateString('fa-IR')} {item.startTime || ''} تا {item.endDate ? new Date(item.endDate).toLocaleDateString('fa-IR') : ''} {item.endTime || ''}</p>{(item.reason || item.missionPurpose) && <p className="mt-2 text-sm sds-text-secondary ">{item.reason || item.missionPurpose}</p>}{item.auditEvents?.length ? <p className="mt-2 text-xs sds-text-muted">{item.auditEvents.length.toLocaleString('fa-IR')} رویداد حسابرسی</p> : null}</div><div className="flex flex-wrap gap-2">{item.status === 'PENDING' && <><ErpButton label="تأیید" icon={FaCheck} onClick={() => approve(item)} tone="success" /><ErpButton label="ویرایش" icon={FaEdit} onClick={() => setEditor({ kind: item.recordKind, item })} variant="ghost" /><ErpButton label="رد" icon={FaTimes} onClick={() => reject(item)} tone="warning" variant="ghost" /><ErpButton label="حذف" icon={FaTrash} onClick={() => remove(item)} tone="danger" variant="ghost" /></>}{item.status === 'APPROVED' && <><ErpButton label="اصلاح" icon={FaEdit} onClick={() => setEditor({ kind: item.recordKind, item, correction: true })} variant="ghost" /><ErpButton label="لغو" icon={FaTimes} onClick={() => cancel(item)} tone="neutral" variant="ghost" /></>}</div></div></article>)}</div>}
        </ErpSection>
      </>}

      <ErpSheet open={createPickerOpen} onClose={() => setCreatePickerOpen(false)} title="نوع مورد جدید"><div className="grid gap-3"><ErpPressable type="button" onClick={() => { setCreatePickerOpen(false); setEditor({ kind: 'exception' }); }} className="min-h-16 rounded-xl border border-[var(--sds-border-subtle)] p-4 text-right font-bold outline-none transition hover:border-[var(--sds-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)]">استثنای حضور و غیاب</ErpPressable><ErpPressable type="button" onClick={() => { setCreatePickerOpen(false); setEditor({ kind: 'mission' }); }} className="min-h-16 rounded-xl border border-[var(--sds-border-subtle)] p-4 text-right font-bold outline-none transition hover:border-[var(--sds-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)]">مأموریت</ErpPressable></div></ErpSheet>
      {editor && <ErpSheet open onClose={() => setEditor(null)} title={editor.item ? editor.correction ? 'اصلاح حسابرسی‌شده' : 'ویرایش مورد' : editor.kind === 'exception' ? 'ثبت استثنا' : 'ثبت مأموریت'}>{editor.kind === 'exception' ? <ExceptionRequestForm key={`${editor.item?.id || 'new'}-${editor.correction || false}`} initialData={editor.item ? initialFormData(editor.item) : undefined} onSubmit={submitEditor} onCancel={() => setEditor(null)} loading={saving} /> : <MissionAssignmentForm key={`${editor.item?.id || 'new'}-${editor.correction || false}`} initialData={editor.item ? initialFormData(editor.item) : undefined} onSubmit={submitEditor} onCancel={() => setEditor(null)} loading={saving} />}</ErpSheet>}
    </ErpWorkspacePage>
  );
}
