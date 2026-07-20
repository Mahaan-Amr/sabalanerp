'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaCheck, FaEdit, FaPlane, FaPlus, FaTimes, FaTrash } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import ExceptionRequestForm from '@/components/ExceptionRequestForm';
import MissionAssignmentForm from '@/components/MissionAssignmentForm';
import { askSecurityAction, notifySecurity } from '@/components/SecurityNoticeHost';
import PersianCalendar from '@/lib/persian-calendar';
import { securityAPI } from '@/lib/api';

type Kind = 'exception' | 'mission';

const statusLabel: Record<string, string> = { PENDING: 'در انتظار', APPROVED: 'تأییدشده', REJECTED: 'ردشده', CANCELLED: 'لغوشده' };
const statusTone = (status: string) => status === 'APPROVED' ? 'success' : status === 'REJECTED' || status === 'CANCELLED' ? 'danger' : 'warning';
const personName = (item: any) => `${item.personnel?.firstName || item.employee?.firstName || ''} ${item.personnel?.lastName || item.employee?.lastName || ''}`.trim() || '-';
const initialFormData = (item: any) => ({
  ...item,
  personnelId: item.personnelId || item.employee?.personnelId || '',
  startDate: item.startDate ? PersianCalendar.toPersian(item.startDate) : '',
  endDate: item.endDate ? PersianCalendar.toPersian(item.endDate) : ''
});

export default function SecurityExceptionsPage() {
  const [kind, setKind] = useState<Kind>('exception');
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [missions, setMissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ kind: Kind; item?: any; correction?: boolean } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [exceptionResult, missionResult] = await Promise.all([
        securityAPI.getExceptionRequests({ limit: 250 }),
        securityAPI.getMissionAssignments({ limit: 250 })
      ]);
      setExceptions(exceptionResult.data.data || []);
      setMissions(missionResult.data.data || []);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت استثناها و ماموریت‌ها ناموفق بود.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const items = useMemo(() => kind === 'exception' ? exceptions : missions, [kind, exceptions, missions]);

  const submitEditor = async (data: any) => {
    if (!editor) return;
    setSaving(true); setError('');
    try {
      let result: any;
      if (!editor.item) {
        if (editor.kind === 'exception') result = await securityAPI.createExceptionRequest(data);
        else result = await securityAPI.createMissionAssignment(data);
      } else if (editor.correction) {
        const correctionReason = await askSecurityAction({ title: 'اصلاح حسابرسی‌شده', inputLabel: 'دلیل اصلاح' });
        if (!correctionReason?.trim()) return;
        if (editor.kind === 'exception') result = await securityAPI.correctException(editor.item.id, { ...data, correctionReason: correctionReason.trim() });
        else result = await securityAPI.correctMissionAssignment(editor.item.id, { ...data, correctionReason: correctionReason.trim() });
      } else if (editor.kind === 'exception') result = await securityAPI.updateException(editor.item.id, data);
      else result = await securityAPI.updateMissionAssignment(editor.item.id, data);
      notifySecurity(result?.data?.warning || 'اطلاعات با موفقیت ذخیره شد.');
      setEditor(null); await load();
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'ذخیره اطلاعات ناموفق بود.'); }
    finally { setSaving(false); }
  };

  const approve = async (item: any) => {
    try { kind === 'exception' ? await securityAPI.approveExceptionRequest(item.id) : await securityAPI.approveMissionAssignment(item.id); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'تأیید ناموفق بود.'); }
  };
  const reject = async (item: any) => {
    const reason = await askSecurityAction({ title: 'رد مورد', inputLabel: 'دلیل رد' }); if (!reason?.trim()) return;
    try { kind === 'exception' ? await securityAPI.rejectExceptionRequest(item.id, reason.trim()) : await securityAPI.rejectMissionAssignment(item.id, reason.trim()); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'رد مورد ناموفق بود.'); }
  };
  const cancel = async (item: any) => {
    const reason = await askSecurityAction({ title: 'لغو مورد تأییدشده', inputLabel: 'دلیل لغو' }); if (!reason?.trim()) return;
    try { kind === 'exception' ? await securityAPI.cancelException(item.id, reason.trim()) : await securityAPI.cancelMissionAssignment(item.id, reason.trim()); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'لغو ناموفق بود.'); }
  };
  const remove = async (item: any) => {
    const accepted = await askSecurityAction({ title: 'حذف مورد در انتظار', description: 'این مورد هنوز اثری بر حضور و غیاب ندارد و حذف می‌شود.' }); if (!accepted) return;
    try { kind === 'exception' ? await securityAPI.deleteException(item.id) : await securityAPI.deleteMissionAssignment(item.id); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'حذف ناموفق بود.'); }
  };

  if (loading) return <ErpLoading />;
  return <ErpPage eyebrow="حراست" title="استثناهای حضور و غیاب و ماموریت‌ها" description="ثبت، بررسی، تأیید و حسابرسی بازه‌های مجاز؛ تردد واقعی مستقل باقی می‌ماند.">
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="flex flex-wrap gap-2">
      <ErpButton label={`استثناها (${exceptions.length.toLocaleString('fa-IR')})`} onClick={() => setKind('exception')} variant={kind === 'exception' ? 'solid' : 'soft'} />
      <ErpButton label={`ماموریت‌ها (${missions.length.toLocaleString('fa-IR')})`} icon={FaPlane} onClick={() => setKind('mission')} variant={kind === 'mission' ? 'solid' : 'soft'} />
      <ErpButton label={kind === 'exception' ? 'استثنای جدید' : 'ماموریت جدید'} icon={FaPlus} onClick={() => setEditor({ kind })} tone="success" />
    </div>
    <ErpSection title={kind === 'exception' ? 'استثناهای حضور و غیاب' : 'ماموریت‌ها'}>
      {!items.length ? <ErpEmptyState icon={kind === 'exception' ? FaCheck : FaPlane} title="موردی ثبت نشده است" /> : <div className="space-y-3">{items.map((item) => <ErpCard key={item.id} className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{personName(item)}</p><ErpBadge tone={statusTone(item.status)}>{statusLabel[item.status] || item.status}</ErpBadge></div>
            <p className="mt-2 text-sm text-slate-600">{kind === 'exception' ? item.exceptionType : `${item.missionType} · ${item.missionLocation}`}</p>
            <p className="mt-1 text-sm">{new Date(item.startDate).toLocaleDateString('fa-IR')} {item.startTime || ''} تا {item.endDate ? new Date(item.endDate).toLocaleDateString('fa-IR') : ''} {item.endTime || ''}</p>
            <p className="mt-2 text-sm text-slate-500">{kind === 'exception' ? item.reason : item.missionPurpose}</p>
            {item.auditEvents?.length ? <p className="mt-2 text-xs text-slate-400">{item.auditEvents.length.toLocaleString('fa-IR')} رویداد حسابرسی</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {item.status === 'PENDING' && <><ErpButton label="ویرایش" icon={FaEdit} onClick={() => setEditor({ kind, item })} variant="soft" /><ErpButton label="تأیید" icon={FaCheck} onClick={() => approve(item)} tone="success" /><ErpButton label="رد" icon={FaTimes} onClick={() => reject(item)} tone="warning" /><ErpButton label="حذف" icon={FaTrash} onClick={() => remove(item)} tone="danger" variant="soft" /></>}
            {item.status === 'APPROVED' && <><ErpButton label="اصلاح حسابرسی‌شده" icon={FaEdit} onClick={() => setEditor({ kind, item, correction: true })} variant="soft" /><ErpButton label="لغو" icon={FaTimes} onClick={() => cancel(item)} tone="danger" variant="soft" /></>}
          </div>
        </div>
      </ErpCard>)}</div>}
    </ErpSection>
    {editor && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4"><div className="mx-auto my-8 max-w-3xl rounded-xl bg-white p-2 shadow-2xl dark:bg-slate-900">{editor.kind === 'exception'
      ? <ExceptionRequestForm key={`${editor.item?.id || 'new'}-${editor.correction || false}`} initialData={editor.item ? initialFormData(editor.item) : undefined} onSubmit={submitEditor} onCancel={() => setEditor(null)} loading={saving} />
      : <MissionAssignmentForm key={`${editor.item?.id || 'new'}-${editor.correction || false}`} initialData={editor.item ? initialFormData(editor.item) : undefined} onSubmit={submitEditor} onCancel={() => setEditor(null)} loading={saving} />}</div></div>}
  </ErpPage>;
}
