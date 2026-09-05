'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaPause, FaPlay, FaUserCheck } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpInput, ErpLoading, ErpSection, ErpWorkspacePage } from '@/components/erp';
import { dispatchConfirmationAPI, dispatchMasterDataAPI } from '@/lib/api';
import RoleAwareDispatchCases from '@/features/dispatch-case/RoleAwareDispatchCases';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import { fromIsoDate, toIsoDate } from '@/features/hr/hrUi';
import { biometricConnectorClient } from '@/lib/biometricConnector';

const today = () => new Date().toISOString().slice(0, 10);
const field = 'space-y-1.5 text-sm font-medium sds-text-secondary';

export default function PersonnelDriverEligibilityPage() {
  const personnelId = String(useParams<{ id: string }>().id);
  const [record, setRecord] = useState<any>(null);
  const [capabilities, setCapabilities] = useState({ canManageEligibility: false, canManageBiometricEnrollment: false });
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [confirmationPhone, setConfirmationPhone] = useState('');
  const [biometricAcknowledgement, setBiometricAcknowledgement] = useState('');
  const [biometricWithdrawalReason, setBiometricWithdrawalReason] = useState('');
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await dispatchMasterDataAPI.getPersonnelDriverEligibility(personnelId);
      setRecord(response.data.data);
      setCapabilities(response.data.capabilities || { canManageEligibility: false, canManageBiometricEnrollment: false });
      setEnrollmentId(response.data.data.activeBiometricEnrollment?.id || null);
    } catch (error: any) {
      setNotice({ kind: 'error', text: error?.response?.data?.error || 'دریافت صلاحیت رانندگی ممکن نشد.' });
    } finally { setLoading(false); }
  }, [personnelId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<any>, message: string) => {
    setSaving(true); setNotice(null);
    try { await action(); setNotice({ kind: 'success', text: message }); setReason(''); await load(); }
    catch (error: any) { setNotice({ kind: 'error', text: error?.response?.data?.error || error?.message || 'ثبت صلاحیت ممکن نشد.' }); }
    finally { setSaving(false); }
  };

  if (loading) return <ErpLoading />;
  if (!record) return <ErpInlineState kind="error" title={notice?.text || 'پرسنل پیدا نشد.'} />;
  const driver = record.driver;
  const eligible = driver?.currentEligibility?.status === 'ELIGIBLE';

  return <ErpWorkspacePage title="صلاحیت رانندگی پرسنل" context={`${record.personnel.firstName} ${record.personnel.lastName} · ${record.personnel.employeeNumber || 'بدون شماره پرسنلی'}`} backHref="/dashboard/hr/personnel" className="pb-24 lg:pb-4">
    {notice && <ErpInlineState kind={notice.kind} title={notice.text} />}
    <ErpSection title="وضعیت جاری">
      <ErpCard className="p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold sds-text-primary">{driver ? 'راننده داخلی تعریف شده' : 'هنوز راننده داخلی نیست'}</p><ErpBadge tone={eligible ? 'success' : 'warning'}>{driver?.currentEligibility?.status || 'بدون صلاحیت'}</ErpBadge></div>{driver?.currentEligibility && <p className="mt-2 text-sm sds-text-muted">از {new Date(driver.currentEligibility.effectiveFrom).toLocaleDateString('fa-IR')} · {driver.currentEligibility.reason}</p>}</ErpCard>
    </ErpSection>
    {capabilities.canManageEligibility && <ErpSection title={driver ? 'تغییر صلاحیت' : 'تعریف راننده داخلی'}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!reason.trim()) return; void run(() => driver ? dispatchMasterDataAPI.transitionInternalDriverEligibility(driver.id, { status: eligible ? 'SUSPENDED' : 'ELIGIBLE', effectiveFrom, reason }) : dispatchMasterDataAPI.createInternalDriver({ personnelId, effectiveFrom, reason }), driver ? 'وضعیت صلاحیت ثبت شد.' : 'راننده داخلی تعریف شد.'); }}>
        <label className={field}>تاریخ اثر<HrPersianCalendar value={fromIsoDate(effectiveFrom)} onChange={(value) => setEffectiveFrom(toIsoDate(value))} disablePastDates /></label>
        <label className={field}>دلیل<ErpInput required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <ErpButton type="submit" label={!driver ? 'تعریف راننده داخلی' : eligible ? 'تعلیق صلاحیت' : 'بازگردانی صلاحیت'} icon={!driver ? FaUserCheck : eligible ? FaPause : FaPlay} tone={eligible ? 'warning' : 'success'} disabled={dispatchTimelineStale || saving || !reason.trim()} className="sm:col-span-2" />
      </form>
    </ErpSection>}
    {driver && capabilities.canManageBiometricEnrollment && <ErpSection title="رضایت و ثبت بیومتریک راننده" description="ثبت فقط از اتصال‌گر تأییدشده انجام می‌شود؛ تصویر یا قالب خام در مرورگر دریافت نمی‌شود.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={field}>شماره تأیید راننده<ErpInput value={confirmationPhone} onChange={(event) => setConfirmationPhone(event.target.value)} /></label>
        <label className={field}>متن اقرار و رضایت<ErpInput value={biometricAcknowledgement} onChange={(event) => setBiometricAcknowledgement(event.target.value)} /></label>
        <ErpButton label="ثبت بیومتریک با اتصال‌گر" icon={FaUserCheck} disabled={Boolean(enrollmentId) || dispatchTimelineStale || saving || !confirmationPhone.trim() || !biometricAcknowledgement.trim()} onClick={() => void run(async () => {
          const status = await biometricConnectorClient.status();
          const captures = [];
          for (const finger of ['RIGHT_INDEX', 'LEFT_INDEX']) {
            const issued = await dispatchConfirmationAPI.createEnrollmentCommand(personnelId, { workstationId: status.workstationId, finger });
            const connectorResult = await biometricConnectorClient.execute(issued.data.data);
            captures.push({ challengeId: issued.data.data.command.commandId, signedResponse: { response: connectorResult.response, signature: connectorResult.signature }, transportEnvelope: connectorResult.transportEnvelope });
          }
          const response = await dispatchConfirmationAPI.enrollInternalDriver(personnelId, { acknowledgement: biometricAcknowledgement.trim(), confirmationPhone: confirmationPhone.trim(), captures });
          setEnrollmentId(response.data.data.id); return response;
        }, 'رضایت و ثبت بیومتریک ذخیره شد.')} />
        {enrollmentId && <><label className={field}>دلیل پس‌گرفتن رضایت<ErpInput value={biometricWithdrawalReason} onChange={(event) => setBiometricWithdrawalReason(event.target.value)} /></label><ErpButton label="پس‌گرفتن رضایت بیومتریک" icon={FaPause} tone="danger" variant="outline" disabled={dispatchTimelineStale || saving || !biometricWithdrawalReason.trim()} onClick={() => void run(() => dispatchConfirmationAPI.withdrawEnrollment(enrollmentId, biometricWithdrawalReason.trim()), 'رضایت بیومتریک پس گرفته شد.')} /></>}
      </div>
    </ErpSection>}
    <RoleAwareDispatchCases workspace="hr" subjectId={personnelId} onStaleChange={setDispatchTimelineStale} />
  </ErpWorkspacePage>;
}
