'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { FaPause, FaPlay, FaUserCheck } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpInput, ErpLoading, ErpSection, ErpWorkspacePage } from '@/components/erp';
import { dispatchConfirmationAPI, dispatchMasterDataAPI } from '@/lib/api';
import RoleAwareDispatchCases from '@/features/dispatch-case/RoleAwareDispatchCases';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import { fromIsoDate, toIsoDate } from '@/features/hr/hrUi';
import { biometricConnectorClient } from '@/lib/biometricConnector';
import { captureEnrollmentFingers, EnrollmentCaptureEvidence, EnrollmentFinger } from '@/features/biometric/driverEnrollmentWorkflow';

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
  const [biometricDeactivationReason, setBiometricDeactivationReason] = useState('');
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [pendingFinger, setPendingFinger] = useState<EnrollmentFinger | null>(null);
  const [captureEvidence, setCaptureEvidence] = useState<EnrollmentCaptureEvidence[]>([]);
  const [enrollmentImages, setEnrollmentImages] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const placementResolver = useRef<{ finger: EnrollmentFinger; resolve: () => void } | null>(null);

  const requestFingerPlacement = useCallback((finger: EnrollmentFinger) => new Promise<void>((resolve) => {
    placementResolver.current = { finger, resolve };
    setPendingFinger(finger);
  }), []);

  const confirmFingerPlacement = () => {
    const pending = placementResolver.current;
    if (!pending) return;
    placementResolver.current = null;
    setPendingFinger(null);
    pending.resolve();
  };

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

  useEffect(() => {
    const enrollment = record?.activeBiometricEnrollment;
    const templates = Array.isArray(enrollment?.templates) ? enrollment.templates.filter((item: any) => item.imageMimeType === 'image/png') : [];
    let disposed = false;
    const urls: string[] = [];
    setEnrollmentImages({});
    if (enrollment?.id && templates.length) void Promise.all(templates.map(async (item: any) => {
      const response = await dispatchConfirmationAPI.getEnrollmentImage(enrollment.id, item.finger);
      const url = URL.createObjectURL(response.data);
      urls.push(url);
      return [item.finger, url] as const;
    })).then((entries) => { if (!disposed) setEnrollmentImages(Object.fromEntries(entries)); })
      .catch(() => { if (!disposed) setNotice({ kind: 'error', text: 'دریافت تصویر اثر انگشت ممکن نشد.' }); });
    return () => { disposed = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [record?.activeBiometricEnrollment]);

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
    {driver && capabilities.canManageBiometricEnrollment && <ErpSection title="ثبت بیومتریک راننده" description="ثبت از اتصال‌گر تأییدشده انجام می‌شود.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={field}>شماره تأیید راننده<ErpInput value={confirmationPhone} onChange={(event) => setConfirmationPhone(event.target.value)} /></label>
        <ErpButton label="ثبت بیومتریک با اتصال‌گر" icon={FaUserCheck} disabled={Boolean(enrollmentId) || dispatchTimelineStale || saving || !confirmationPhone.trim()} onClick={() => void run(async () => {
          setCaptureEvidence([]);
          const captures = await captureEnrollmentFingers({
            personnelId,
            getConnectorStatus: biometricConnectorClient.status,
            createEnrollmentCommand: dispatchConfirmationAPI.createEnrollmentCommand,
            executeConnectorCommand: biometricConnectorClient.execute,
            requestFingerPlacement,
            onCaptureComplete: (evidence) => setCaptureEvidence((current) => [...current, evidence]),
          });
          const response = await dispatchConfirmationAPI.enrollInternalDriver(personnelId, { confirmationPhone: confirmationPhone.trim(), captures });
          setEnrollmentId(response.data.data.id); return response;
        }, 'ثبت بیومتریک ذخیره شد.')} />
        {pendingFinger && <ErpCard className="space-y-3 p-4 sm:col-span-2">
          <ErpInlineState
            kind="stale"
            title={pendingFinger === 'RIGHT_INDEX'
              ? 'انگشت اشاره راست را روی حسگر قرار دهید؛ سپس دکمه اسکن را بزنید.'
              : 'انگشت راست را کاملاً بردارید، انگشت اشاره چپ را روی حسگر قرار دهید؛ سپس دکمه اسکن را بزنید.'}
          />
          <ErpButton
            label={pendingFinger === 'RIGHT_INDEX' ? 'اسکن انگشت اشاره راست' : 'اسکن انگشت اشاره چپ'}
            icon={FaUserCheck}
            onClick={confirmFingerPlacement}
          />
        </ErpCard>}
        {captureEvidence.length > 0 && <ErpCard className="space-y-2 p-4 sm:col-span-2">
          {captureEvidence.map((evidence) => <div key={evidence.finger} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium sds-text-primary">{evidence.finger === 'RIGHT_INDEX' ? 'انگشت اشاره راست' : 'انگشت اشاره چپ'}</span>
            <ErpBadge tone="success">کیفیت {evidence.qualityScore ?? evidence.qualityState}</ErpBadge>
            <ErpBadge tone="success">زنده‌بودن {evidence.livenessState === 'LIVE' ? 'تأیید شد' : evidence.livenessState}</ErpBadge>
          </div>)}
        </ErpCard>}
        {record.activeBiometricEnrollment?.templates?.some((item: any) => item.imageMimeType === 'image/png') && <ErpCard className="space-y-3 p-4 sm:col-span-2">
          <p className="font-semibold sds-text-primary">تصاویر ثبت‌شدهٔ اثر انگشت</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {record.activeBiometricEnrollment.templates.filter((item: any) => item.imageMimeType === 'image/png').map((item: any) => <div key={item.finger} className="space-y-2">
              <p className="text-sm font-medium sds-text-secondary">{item.finger === 'RIGHT_INDEX' ? 'انگشت اشاره راست' : item.finger === 'LEFT_INDEX' ? 'انگشت اشاره چپ' : item.finger}</p>
              {item.captureQuality && item.liveness && <div className="flex flex-wrap gap-2">
                <ErpBadge tone={item.captureQuality.state === 'ACCEPTED' ? 'success' : 'warning'}>کیفیت {item.captureQuality.score}</ErpBadge>
                <ErpBadge tone={item.liveness.state === 'LIVE' ? 'success' : 'warning'}>زنده‌بودن {item.liveness.state === 'LIVE' ? 'تأیید شد' : item.liveness.state}</ErpBadge>
              </div>}
              {enrollmentImages[item.finger]
                ? <Image unoptimized src={enrollmentImages[item.finger]} alt={`اثر انگشت ${item.finger === 'RIGHT_INDEX' ? 'اشاره راست' : 'اشاره چپ'}`} width={item.imageWidth} height={item.imageHeight} className="mx-auto max-h-80 w-auto rounded-lg object-contain" />
                : <ErpLoading />}
              <p className="text-xs sds-text-muted">{item.imageWidth}×{item.imageHeight} پیکسل</p>
            </div>)}
          </div>
        </ErpCard>}
        {enrollmentId && <><label className={field}>دلیل غیرفعال‌سازی<ErpInput value={biometricDeactivationReason} onChange={(event) => setBiometricDeactivationReason(event.target.value)} /></label><ErpButton label="غیرفعال‌سازی ثبت بیومتریک" icon={FaPause} tone="danger" variant="outline" disabled={dispatchTimelineStale || saving || !biometricDeactivationReason.trim()} onClick={() => void run(() => dispatchConfirmationAPI.deactivateEnrollment(enrollmentId, biometricDeactivationReason.trim()), 'ثبت بیومتریک غیرفعال شد.')} /></>}
      </div>
    </ErpSection>}
    <RoleAwareDispatchCases workspace="hr" subjectId={personnelId} onStaleChange={setDispatchTimelineStale} />
  </ErpWorkspacePage>;
}
