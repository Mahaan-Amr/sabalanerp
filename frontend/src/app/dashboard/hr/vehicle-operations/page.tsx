'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaLink, FaPause, FaPlus, FaSync, FaTruck, FaUserCheck } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpWorkspacePage,
} from '@/components/erp';
import { dispatchMasterDataAPI, hrAPI } from '@/lib/api';
import { WORKSPACES, WORKSPACE_PERMISSIONS, useWorkspace } from '@/contexts/WorkspaceContext';

const today = () => new Date().toISOString().slice(0, 10);
const driverInitial = { personnelId: '', effectiveFrom: today(), reason: 'تأیید صلاحیت رانندگی داخلی' };
const vehicleInitial = { fleetCode: '', vehicleType: '', make: '', model: '', vin: '', plate: '', effectiveFrom: today(), reason: 'ثبت خودروی ناوگان' };
const assignmentInitial = { driverId: '', vehicleId: '', effectiveFrom: today(), reason: 'تخصیص عملیاتی خودرو' };
const plateInitial = { vehicleId: '', plate: '', effectiveFrom: today(), reason: 'تغییر پلاک خودرو' };
const profileInitial = { driverId: '', licenceNumber: '', licenceClass: '', licenceExpiresAt: '', notes: '', reason: 'به‌روزرسانی مشخصات رانندگی' };

const field = 'space-y-1.5 text-sm font-medium sds-text-secondary';
const errorText = (error: any) => error?.response?.data?.error || 'انجام عملیات ممکن نشد.';

export default function VehicleOperationsPage() {
  const { hasPermission } = useWorkspace();
  const canManage = hasPermission(WORKSPACES.HR, WORKSPACE_PERMISSIONS.EDIT);
  const [section, setSection] = useState<'drivers' | 'vehicles' | 'assignments'>('drivers');
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [driverForm, setDriverForm] = useState(driverInitial);
  const [vehicleForm, setVehicleForm] = useState(vehicleInitial);
  const [assignmentForm, setAssignmentForm] = useState(assignmentInitial);
  const [plateForm, setPlateForm] = useState(plateInitial);
  const [profileForm, setProfileForm] = useState(profileInitial);
  const [changeReason, setChangeReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [driverResponse, vehicleResponse, personnelResponse] = await Promise.all([
        dispatchMasterDataAPI.getVehicleOperationsDrivers(),
        dispatchMasterDataAPI.getCompanyVehicles(),
        hrAPI.getPersonnel({ includeArchived: false }),
      ]);
      setDrivers(driverResponse.data.data || []);
      setVehicles(vehicleResponse.data.data || []);
      setPersonnel(personnelResponse.data.data || []);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const availablePersonnel = useMemo(() => {
    const designated = new Set(drivers.map((driver) => driver.personnelId));
    return personnel.filter((person) => person.isActive && !person.archivedAt && !designated.has(person.id));
  }, [drivers, personnel]);

  const run = async (action: () => Promise<any>, success: string) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpWorkspacePage
      title="عملیات رانندگان و خودروها"
      context="هویت راننده از پرسنل و هویت خودرو از ناوگان مستقل می‌ماند؛ سوابق تغییر نمی‌کنند."
      backHref="/dashboard/hr"
      secondaryActions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load }]}
      className="pb-24 lg:pb-4"
    >
      {error && <ErpInlineState kind="error" title={`عملیات انجام نشد: ${error}`} />}
      {message && <ErpInlineState kind="success" title={message} />}

      <ErpSegmentedControl
        value={section}
        onChange={setSection}
        options={[
          { value: 'drivers', label: 'رانندگان داخلی' },
          { value: 'vehicles', label: 'خودروهای شرکت' },
          { value: 'assignments', label: 'تخصیص خودرو' },
        ]}
      />

      {section === 'drivers' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          {canManage && <ErpSection title="تعریف راننده داخلی" description="فقط پرسنل فعال انتخاب می‌شوند.">
            <form className="space-y-4" onSubmit={(event) => {
              event.preventDefault();
              void run(() => dispatchMasterDataAPI.createInternalDriver(driverForm), 'راننده داخلی ثبت شد.').then(() => setDriverForm(driverInitial));
            }}>
              <label className={field}>پرسنل<ErpSelect required value={driverForm.personnelId} onChange={(event) => setDriverForm({ ...driverForm, personnelId: event.target.value })}><option value="">انتخاب کنید</option>{availablePersonnel.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName} · {person.employeeNumber || 'بدون شماره'}</option>)}</ErpSelect></label>
              <label className={field}>شروع صلاحیت<ErpInput required type="date" value={driverForm.effectiveFrom} onChange={(event) => setDriverForm({ ...driverForm, effectiveFrom: event.target.value })} /></label>
              <label className={field}>دلیل<ErpInput required value={driverForm.reason} onChange={(event) => setDriverForm({ ...driverForm, reason: event.target.value })} /></label>
              <ErpButton label="ثبت راننده" icon={FaPlus} disabled={saving || !driverForm.personnelId} className="w-full" onClick={() => void run(() => dispatchMasterDataAPI.createInternalDriver(driverForm), 'راننده داخلی ثبت شد.').then(() => setDriverForm(driverInitial))} />
            </form>
          </ErpSection>}

          <ErpSection title="رانندگان داخلی">
            {canManage && <ErpCard className="mb-5 p-3"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.updateInternalDrivingProfile(profileForm.driverId, profileForm), 'مشخصات رانندگی به‌روزرسانی شد.').then(() => setProfileForm(profileInitial)); }}>
              <label className={field}>راننده<ErpSelect required value={profileForm.driverId} onChange={(event) => { const selected = drivers.find((driver) => driver.id === event.target.value); setProfileForm({ ...profileInitial, driverId: event.target.value, licenceNumber: selected?.licenceNumber || '', licenceClass: selected?.licenceClass || '', licenceExpiresAt: selected?.licenceExpiresAt?.slice(0, 10) || '', notes: selected?.notes || '' }); }}><option value="">انتخاب برای ویرایش</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.personnel.firstName} {driver.personnel.lastName}</option>)}</ErpSelect></label>
              <label className={field}>شماره گواهینامه<ErpInput required value={profileForm.licenceNumber} onChange={(event) => setProfileForm({ ...profileForm, licenceNumber: event.target.value })} /></label>
              <label className={field}>پایه گواهینامه<ErpInput required value={profileForm.licenceClass} onChange={(event) => setProfileForm({ ...profileForm, licenceClass: event.target.value })} /></label>
              <label className={field}>اعتبار گواهینامه<ErpInput type="date" value={profileForm.licenceExpiresAt} onChange={(event) => setProfileForm({ ...profileForm, licenceExpiresAt: event.target.value })} /></label>
              <label className={`${field} sm:col-span-2`}>دلیل ویرایش<ErpInput required value={profileForm.reason} onChange={(event) => setProfileForm({ ...profileForm, reason: event.target.value })} /></label>
              <ErpButton label="ذخیره مشخصات رانندگی" icon={FaSync} disabled={saving || !profileForm.driverId} className="sm:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.updateInternalDrivingProfile(profileForm.driverId, profileForm), 'مشخصات رانندگی به‌روزرسانی شد.').then(() => setProfileForm(profileInitial))} />
            </form></ErpCard>}
            {canManage && <label className={`${field} mb-4 block`}>دلیل تغییر وضعیت<ErpInput value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="پیش از تعلیق یا بازگردانی وارد کنید" /></label>}
            {!drivers.length ? <ErpEmptyState title="راننده داخلی ثبت نشده است" icon={FaUserCheck} /> : <div className="space-y-3">{drivers.map((driver) => {
              const eligible = driver.currentEligibility?.status === 'ELIGIBLE';
              return <ErpCard key={driver.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold sds-text-primary">{driver.personnel.firstName} {driver.personnel.lastName}</p><ErpBadge tone={driver.readiness.status === 'READY' ? 'success' : 'warning'}>{driver.readiness.status === 'READY' ? 'آماده' : 'نیازمند اقدام'}</ErpBadge><ErpBadge tone="info">{driver.status}</ErpBadge></div><p className="mt-1 text-sm sds-text-muted">گواهینامه {driver.licenceNumber || 'ثبت نشده'}{driver.currentAssignment ? ` · ${driver.currentAssignment.vehicle.plates[0]?.plate || driver.currentAssignment.vehicle.fleetCode}` : ' · بدون خودروی فعال'}</p>{driver.readiness.blockers.length > 0 && <p className="mt-2 text-xs sds-text-muted">موارد باز: {driver.readiness.blockers.join('، ')}</p>}</div>{canManage && <div className="flex flex-wrap gap-2"><ErpButton label={eligible ? 'تعلیق صلاحیت' : 'بازگردانی صلاحیت'} icon={eligible ? FaPause : FaUserCheck} tone={eligible ? 'warning' : 'success'} variant="soft" disabled={saving || !changeReason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionInternalDriverEligibility(driver.id, { status: eligible ? 'SUSPENDED' : 'ELIGIBLE', effectiveFrom: new Date().toISOString(), reason: changeReason.trim() }), 'وضعیت صلاحیت ثبت شد.').then(() => setChangeReason(''))} /><ErpButton label={driver.status === 'DRAFT' ? 'فعال‌سازی پروفایل' : driver.status === 'ACTIVE' ? 'بایگانی پروفایل' : 'بازیابی پیش‌نویس'} variant="ghost" disabled={saving || !changeReason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionInternalDrivingProfile(driver.id, { status: driver.status === 'DRAFT' ? 'ACTIVE' : driver.status === 'ACTIVE' ? 'ARCHIVED' : 'DRAFT', reason: changeReason.trim() }), 'وضعیت پروفایل ثبت شد.').then(() => setChangeReason(''))} /></div>}</div></ErpCard>;
            })}</div>}
          </ErpSection>
        </div>
      )}

      {section === 'vehicles' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          {canManage && <ErpSection title="ثبت خودروی شرکت">
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.createCompanyVehicle(vehicleForm), 'خودروی شرکت ثبت شد.').then(() => setVehicleForm(vehicleInitial)); }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={field}>کد ناوگان<ErpInput required value={vehicleForm.fleetCode} onChange={(event) => setVehicleForm({ ...vehicleForm, fleetCode: event.target.value })} /></label><label className={field}>نوع خودرو<ErpInput required value={vehicleForm.vehicleType} onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })} /></label></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={field}>سازنده<ErpInput value={vehicleForm.make} onChange={(event) => setVehicleForm({ ...vehicleForm, make: event.target.value })} /></label><label className={field}>مدل<ErpInput value={vehicleForm.model} onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.target.value })} /></label></div>
              <label className={field}>شماره شاسی<ErpInput value={vehicleForm.vin} onChange={(event) => setVehicleForm({ ...vehicleForm, vin: event.target.value })} /></label>
              <label className={field}>پلاک<ErpInput required value={vehicleForm.plate} onChange={(event) => setVehicleForm({ ...vehicleForm, plate: event.target.value })} /></label>
              <label className={field}>تاریخ شروع پلاک<ErpInput required type="date" value={vehicleForm.effectiveFrom} onChange={(event) => setVehicleForm({ ...vehicleForm, effectiveFrom: event.target.value })} /></label>
              <label className={field}>دلیل<ErpInput required value={vehicleForm.reason} onChange={(event) => setVehicleForm({ ...vehicleForm, reason: event.target.value })} /></label>
              <ErpButton label="ثبت خودرو" icon={FaTruck} disabled={saving} className="w-full" onClick={() => void run(() => dispatchMasterDataAPI.createCompanyVehicle(vehicleForm), 'خودروی شرکت ثبت شد.').then(() => setVehicleForm(vehicleInitial))} />
            </form>
          </ErpSection>}
          <ErpSection title="ناوگان شرکت">
            {canManage && <ErpCard className="mb-5 p-3"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.changeCompanyVehiclePlate(plateForm.vehicleId, plateForm), 'پلاک جدید ثبت شد.').then(() => setPlateForm(plateInitial)); }}>
              <label className={field}>خودرو<ErpSelect required value={plateForm.vehicleId} onChange={(event) => setPlateForm({ ...plateForm, vehicleId: event.target.value })}><option value="">انتخاب خودرو</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.fleetCode} · {vehicle.vehicleType}</option>)}</ErpSelect></label>
              <label className={field}>پلاک جدید<ErpInput required value={plateForm.plate} onChange={(event) => setPlateForm({ ...plateForm, plate: event.target.value })} /></label>
              <label className={field}>شروع اعتبار<ErpInput required type="date" value={plateForm.effectiveFrom} onChange={(event) => setPlateForm({ ...plateForm, effectiveFrom: event.target.value })} /></label>
              <label className={field}>دلیل<ErpInput required value={plateForm.reason} onChange={(event) => setPlateForm({ ...plateForm, reason: event.target.value })} /></label>
              <ErpButton label="ثبت پلاک جدید" icon={FaPlus} disabled={saving || !plateForm.vehicleId} className="sm:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.changeCompanyVehiclePlate(plateForm.vehicleId, plateForm), 'پلاک جدید ثبت شد.').then(() => setPlateForm(plateInitial))} />
            </form></ErpCard>}
            {canManage && <label className={`${field} mb-4 block`}>دلیل تغییر وضعیت<ErpInput value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="پیش از خروج یا بازگشت به سرویس وارد کنید" /></label>}
            {!vehicles.length ? <ErpEmptyState title="خودروی شرکت ثبت نشده است" icon={FaTruck} /> : <div className="space-y-3">{vehicles.map((vehicle) => <ErpCard key={vehicle.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold sds-text-primary">{vehicle.fleetCode} · {vehicle.vehicleType}</p><ErpBadge tone={vehicle.status === 'ACTIVE' ? 'success' : 'warning'}>{vehicle.status}</ErpBadge><ErpBadge tone="info">ناوگان شرکت</ErpBadge></div><p className="mt-1 text-sm sds-text-muted">{vehicle.plates[0]?.plate || 'بدون پلاک'}{vehicle.make ? ` · ${vehicle.make} ${vehicle.model || ''}` : ''}</p></div>{canManage && <ErpButton label={vehicle.status === 'DRAFT' ? 'فعال‌سازی' : vehicle.status === 'ACTIVE' ? 'خارج از سرویس' : vehicle.status === 'OUT_OF_SERVICE' ? 'بازگشت به سرویس' : 'بازیابی پیش‌نویس'} icon={FaSync} tone={vehicle.status === 'ACTIVE' ? 'warning' : 'success'} variant="soft" disabled={saving || !changeReason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionCompanyVehicleStatus(vehicle.id, { status: vehicle.status === 'DRAFT' ? 'ACTIVE' : vehicle.status === 'ACTIVE' ? 'OUT_OF_SERVICE' : vehicle.status === 'OUT_OF_SERVICE' ? 'ACTIVE' : 'DRAFT', effectiveFrom: new Date().toISOString(), reason: changeReason.trim() }), 'وضعیت خودرو ثبت شد.').then(() => setChangeReason(''))} />}</div></ErpCard>)}</div>}
          </ErpSection>
        </div>
      )}

      {section === 'assignments' && canManage && (
        <ErpSection title="تخصیص فعال راننده و خودرو" description="تخصیص جدید، تخصیص فعال قبلی هر دو طرف را در همان زمان می‌بندد و سابقه را نگه می‌دارد.">
          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.assignCompanyVehicle(assignmentForm), 'تخصیص خودرو ثبت شد.').then(() => setAssignmentForm(assignmentInitial)); }}>
            <label className={field}>راننده<ErpSelect required value={assignmentForm.driverId} onChange={(event) => setAssignmentForm({ ...assignmentForm, driverId: event.target.value })}><option value="">انتخاب کنید</option>{drivers.filter((driver) => driver.currentEligibility?.status === 'ELIGIBLE').map((driver) => <option key={driver.id} value={driver.id}>{driver.personnel.firstName} {driver.personnel.lastName}</option>)}</ErpSelect></label>
            <label className={field}>خودرو<ErpSelect required value={assignmentForm.vehicleId} onChange={(event) => setAssignmentForm({ ...assignmentForm, vehicleId: event.target.value })}><option value="">انتخاب کنید</option>{vehicles.filter((vehicle) => vehicle.status === 'ACTIVE').map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.fleetCode} · {vehicle.plates[0]?.plate || vehicle.vehicleType}</option>)}</ErpSelect></label>
            <label className={field}>شروع تخصیص<ErpInput required type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm({ ...assignmentForm, effectiveFrom: event.target.value })} /></label>
            <label className={field}>دلیل<ErpInput required value={assignmentForm.reason} onChange={(event) => setAssignmentForm({ ...assignmentForm, reason: event.target.value })} /></label>
            <ErpButton label="ثبت تخصیص" icon={FaLink} disabled={saving || !assignmentForm.driverId || !assignmentForm.vehicleId} className="md:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.assignCompanyVehicle(assignmentForm), 'تخصیص خودرو ثبت شد.').then(() => setAssignmentForm(assignmentInitial))} />
          </form>
        </ErpSection>
      )}
    </ErpWorkspacePage>
  );
}
