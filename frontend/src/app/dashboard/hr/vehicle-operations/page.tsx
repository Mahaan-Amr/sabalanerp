'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaArchive, FaLink, FaPlus, FaSync, FaTruck, FaUserCheck } from 'react-icons/fa';
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
import { dispatchMasterDataAPI } from '@/lib/api';
import RoleAwareDispatchCases from '@/features/dispatch-case/RoleAwareDispatchCases';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import { fromIsoDate, toIsoDate } from '@/features/hr/hrUi';

const today = () => new Date().toISOString().slice(0, 10);
const vehicleInitial = { fleetCode: '', vehicleType: '', make: '', model: '', vin: '', plate: '', effectiveFrom: today(), reason: 'ثبت خودروی ناوگان' };
const assignmentInitial = { driverId: '', vehicleId: '', effectiveFrom: today(), reason: 'تخصیص عملیاتی خودرو' };
const plateInitial = { vehicleId: '', plate: '', effectiveFrom: today(), reason: 'تغییر پلاک خودرو' };
const profileInitial = { driverId: '', licenceNumber: '', licenceClass: '', licenceExpiresAt: '', notes: '', reason: 'به‌روزرسانی مشخصات رانندگی' };

const field = 'space-y-1.5 text-sm font-medium sds-text-secondary';
const errorText = (error: any) => error?.response?.data?.error || 'انجام عملیات ممکن نشد.';

export default function VehicleOperationsPage() {
  const [section, setSection] = useState<'drivers' | 'vehicles' | 'assignments'>('drivers');
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState({ canManageProfiles: false, canManageCompanyVehicles: false, canManagePlates: false, canManageAssignments: false });
  const [showArchivedVehicles, setShowArchivedVehicles] = useState(false);
  const [vehicleForm, setVehicleForm] = useState(vehicleInitial);
  const [assignmentForm, setAssignmentForm] = useState(assignmentInitial);
  const [plateForm, setPlateForm] = useState(plateInitial);
  const [profileForm, setProfileForm] = useState(profileInitial);
  const [changeReason, setChangeReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [driverResponse, vehicleResponse] = await Promise.all([
        dispatchMasterDataAPI.getVehicleOperationsDrivers(),
        dispatchMasterDataAPI.getCompanyVehicles({ archived: showArchivedVehicles ? 'include' : 'exclude' }),
      ]);
      setDrivers(driverResponse.data.data || []);
      setVehicles(vehicleResponse.data.data || []);
      setCapabilities(driverResponse.data.capabilities || vehicleResponse.data.capabilities || { canManageProfiles: false, canManageCompanyVehicles: false, canManagePlates: false, canManageAssignments: false });
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [showArchivedVehicles]);

  useEffect(() => { void load(); }, [load]);

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
        <div className="grid grid-cols-1 gap-5">
          <ErpSection title="رانندگان داخلی">
            {capabilities.canManageProfiles && <ErpCard className="mb-5 p-3"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.updateInternalDrivingProfile(profileForm.driverId, profileForm), 'مشخصات رانندگی به‌روزرسانی شد.').then(() => setProfileForm(profileInitial)); }}>
              <label className={field}>راننده<ErpSelect required value={profileForm.driverId} onChange={(event) => { const selected = drivers.find((driver) => driver.id === event.target.value); setProfileForm({ ...profileInitial, driverId: event.target.value, licenceNumber: selected?.licenceNumber || '', licenceClass: selected?.licenceClass || '', licenceExpiresAt: selected?.licenceExpiresAt?.slice(0, 10) || '', notes: selected?.notes || '' }); }}><option value="">انتخاب برای ویرایش</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.personnel.firstName} {driver.personnel.lastName}</option>)}</ErpSelect></label>
              <label className={field}>شماره گواهینامه<ErpInput required value={profileForm.licenceNumber} onChange={(event) => setProfileForm({ ...profileForm, licenceNumber: event.target.value })} /></label>
              <label className={field}>پایه گواهینامه<ErpInput required value={profileForm.licenceClass} onChange={(event) => setProfileForm({ ...profileForm, licenceClass: event.target.value })} /></label>
              <label className={field}>اعتبار گواهینامه<HrPersianCalendar value={fromIsoDate(profileForm.licenceExpiresAt)} onChange={(value) => setProfileForm({ ...profileForm, licenceExpiresAt: toIsoDate(value) })} clearable /></label>
              <label className={`${field} sm:col-span-2`}>دلیل ویرایش<ErpInput required value={profileForm.reason} onChange={(event) => setProfileForm({ ...profileForm, reason: event.target.value })} /></label>
              <ErpButton label="ذخیره مشخصات رانندگی" icon={FaSync} disabled={dispatchTimelineStale || saving || !profileForm.driverId} className="sm:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.updateInternalDrivingProfile(profileForm.driverId, profileForm), 'مشخصات رانندگی به‌روزرسانی شد.').then(() => setProfileForm(profileInitial))} />
            </form></ErpCard>}
            {capabilities.canManageProfiles && <label className={`${field} mb-4 block`}>دلیل تغییر وضعیت پروفایل<ErpInput value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></label>}
            {!drivers.length ? <ErpEmptyState title="راننده داخلی ثبت نشده است" icon={FaUserCheck} /> : <div className="space-y-3">{drivers.map((driver) => {
              return <ErpCard key={driver.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold sds-text-primary">{driver.personnel.firstName} {driver.personnel.lastName}</p><ErpBadge tone={driver.readiness.status === 'READY' ? 'success' : 'warning'}>{driver.readiness.status === 'READY' ? 'آماده' : 'نیازمند اقدام'}</ErpBadge><ErpBadge tone="info">{driver.status}</ErpBadge><ErpBadge tone={driver.currentEligibility?.status === 'ELIGIBLE' ? 'success' : 'warning'}>{driver.currentEligibility?.status || 'بدون صلاحیت فعال'}</ErpBadge></div><p className="mt-1 text-sm sds-text-muted">گواهینامه {driver.licenceNumber || 'ثبت نشده'}{driver.currentAssignment ? ` · ${driver.currentAssignment.vehicle.plates[0]?.plate || driver.currentAssignment.vehicle.fleetCode}` : ' · بدون خودروی فعال'}</p>{driver.readiness.blockers.length > 0 && <p className="mt-2 text-xs sds-text-muted">موارد باز: {driver.readiness.blockers.join('، ')}</p>}</div>{capabilities.canManageProfiles && <ErpButton label={driver.status === 'DRAFT' ? 'فعال‌سازی پروفایل' : driver.status === 'ACTIVE' ? 'بایگانی پروفایل' : 'بازیابی پیش‌نویس'} variant="ghost" disabled={dispatchTimelineStale || saving || !changeReason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionInternalDrivingProfile(driver.id, { status: driver.status === 'DRAFT' ? 'ACTIVE' : driver.status === 'ACTIVE' ? 'ARCHIVED' : 'DRAFT', reason: changeReason.trim() }), 'وضعیت پروفایل ثبت شد.').then(() => setChangeReason(''))} />}</div></ErpCard>;
            })}</div>}
          </ErpSection>
        </div>
      )}

      {section === 'vehicles' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          {capabilities.canManageCompanyVehicles && <ErpSection title="ثبت خودروی شرکت">
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.createCompanyVehicle(vehicleForm), 'خودروی شرکت ثبت شد.').then(() => setVehicleForm(vehicleInitial)); }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={field}>کد ناوگان<ErpInput required value={vehicleForm.fleetCode} onChange={(event) => setVehicleForm({ ...vehicleForm, fleetCode: event.target.value })} /></label><label className={field}>نوع خودرو<ErpInput required value={vehicleForm.vehicleType} onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })} /></label></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={field}>سازنده<ErpInput value={vehicleForm.make} onChange={(event) => setVehicleForm({ ...vehicleForm, make: event.target.value })} /></label><label className={field}>مدل<ErpInput value={vehicleForm.model} onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.target.value })} /></label></div>
              <label className={field}>شماره شاسی<ErpInput value={vehicleForm.vin} onChange={(event) => setVehicleForm({ ...vehicleForm, vin: event.target.value })} /></label>
              <label className={field}>پلاک<ErpInput required value={vehicleForm.plate} onChange={(event) => setVehicleForm({ ...vehicleForm, plate: event.target.value })} /></label>
              <label className={field}>تاریخ شروع پلاک<HrPersianCalendar value={fromIsoDate(vehicleForm.effectiveFrom)} onChange={(value) => setVehicleForm({ ...vehicleForm, effectiveFrom: toIsoDate(value) })} /></label>
              <label className={field}>دلیل<ErpInput required value={vehicleForm.reason} onChange={(event) => setVehicleForm({ ...vehicleForm, reason: event.target.value })} /></label>
              <ErpButton label="ثبت خودرو" icon={FaTruck} disabled={dispatchTimelineStale || saving} className="w-full" onClick={() => void run(() => dispatchMasterDataAPI.createCompanyVehicle(vehicleForm), 'خودروی شرکت ثبت شد.').then(() => setVehicleForm(vehicleInitial))} />
            </form>
          </ErpSection>}
          <ErpSection title="ناوگان شرکت">
            {capabilities.canManagePlates && <ErpCard className="mb-5 p-3"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.changeCompanyVehiclePlate(plateForm.vehicleId, plateForm), 'پلاک جدید ثبت شد.').then(() => setPlateForm(plateInitial)); }}>
              <label className={field}>خودرو<ErpSelect required value={plateForm.vehicleId} onChange={(event) => setPlateForm({ ...plateForm, vehicleId: event.target.value })}><option value="">انتخاب خودرو</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.fleetCode} · {vehicle.vehicleType}</option>)}</ErpSelect></label>
              <label className={field}>پلاک جدید<ErpInput required value={plateForm.plate} onChange={(event) => setPlateForm({ ...plateForm, plate: event.target.value })} /></label>
              <label className={field}>شروع اعتبار<HrPersianCalendar value={fromIsoDate(plateForm.effectiveFrom)} onChange={(value) => setPlateForm({ ...plateForm, effectiveFrom: toIsoDate(value) })} /></label>
              <label className={field}>دلیل<ErpInput required value={plateForm.reason} onChange={(event) => setPlateForm({ ...plateForm, reason: event.target.value })} /></label>
              <ErpButton label="ثبت پلاک جدید" icon={FaPlus} disabled={dispatchTimelineStale || saving || !plateForm.vehicleId} className="sm:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.changeCompanyVehiclePlate(plateForm.vehicleId, plateForm), 'پلاک جدید ثبت شد.').then(() => setPlateForm(plateInitial))} />
            </form></ErpCard>}
            <div className="mb-4 flex flex-wrap items-end gap-3">{capabilities.canManageCompanyVehicles && <label className={`${field} min-w-64 flex-1`}>دلیل تغییر وضعیت<ErpInput value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></label>}<ErpButton label={showArchivedVehicles ? 'پنهان کردن بایگانی' : 'نمایش بایگانی'} icon={FaArchive} variant="soft" onClick={() => setShowArchivedVehicles((value) => !value)} /></div>
            {!vehicles.length ? <ErpEmptyState title="خودروی شرکت ثبت نشده است" icon={FaTruck} /> : <div className="space-y-3">{vehicles.map((vehicle) => <ErpCard key={vehicle.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold sds-text-primary">{vehicle.fleetCode} · {vehicle.vehicleType}</p><ErpBadge tone={vehicle.status === 'ACTIVE' ? 'success' : 'warning'}>{vehicle.status}</ErpBadge><ErpBadge tone="info">ناوگان شرکت</ErpBadge></div><p className="mt-1 text-sm sds-text-muted">{vehicle.plates[0]?.plate || 'بدون پلاک'}{vehicle.make ? ` · ${vehicle.make} ${vehicle.model || ''}` : ''}</p></div>{capabilities.canManageCompanyVehicles && <ErpButton label={vehicle.status === 'DRAFT' ? 'فعال‌سازی' : vehicle.status === 'ACTIVE' ? 'خارج از سرویس' : vehicle.status === 'OUT_OF_SERVICE' ? 'بازگشت به سرویس' : 'بازیابی پیش‌نویس'} icon={FaSync} tone={vehicle.status === 'ACTIVE' ? 'warning' : 'success'} variant="soft" disabled={dispatchTimelineStale || saving || !changeReason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionCompanyVehicleStatus(vehicle.id, { status: vehicle.status === 'DRAFT' ? 'ACTIVE' : vehicle.status === 'ACTIVE' ? 'OUT_OF_SERVICE' : vehicle.status === 'OUT_OF_SERVICE' ? 'ACTIVE' : 'DRAFT', effectiveFrom: new Date().toISOString(), reason: changeReason.trim() }), 'وضعیت خودرو ثبت شد.').then(() => setChangeReason(''))} />}</div></ErpCard>)}</div>}
          </ErpSection>
        </div>
      )}

      {section === 'assignments' && capabilities.canManageAssignments && (
        <ErpSection title="تخصیص فعال راننده و خودرو" description="تخصیص جدید، تخصیص فعال قبلی هر دو طرف را در همان زمان می‌بندد و سابقه را نگه می‌دارد.">
          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.assignCompanyVehicle(assignmentForm), 'تخصیص خودرو ثبت شد.').then(() => setAssignmentForm(assignmentInitial)); }}>
            <label className={field}>راننده<ErpSelect required value={assignmentForm.driverId} onChange={(event) => setAssignmentForm({ ...assignmentForm, driverId: event.target.value })}><option value="">انتخاب کنید</option>{drivers.filter((driver) => driver.currentEligibility?.status === 'ELIGIBLE').map((driver) => <option key={driver.id} value={driver.id}>{driver.personnel.firstName} {driver.personnel.lastName}</option>)}</ErpSelect></label>
            <label className={field}>خودرو<ErpSelect required value={assignmentForm.vehicleId} onChange={(event) => setAssignmentForm({ ...assignmentForm, vehicleId: event.target.value })}><option value="">انتخاب کنید</option>{vehicles.filter((vehicle) => vehicle.status === 'ACTIVE').map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.fleetCode} · {vehicle.plates[0]?.plate || vehicle.vehicleType}</option>)}</ErpSelect></label>
            <label className={field}>شروع تخصیص<HrPersianCalendar value={fromIsoDate(assignmentForm.effectiveFrom)} onChange={(value) => setAssignmentForm({ ...assignmentForm, effectiveFrom: toIsoDate(value) })} /></label>
            <label className={field}>دلیل<ErpInput required value={assignmentForm.reason} onChange={(event) => setAssignmentForm({ ...assignmentForm, reason: event.target.value })} /></label>
            <ErpButton label="ثبت تخصیص" icon={FaLink} disabled={dispatchTimelineStale || saving || !assignmentForm.driverId || !assignmentForm.vehicleId} className="md:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.assignCompanyVehicle(assignmentForm), 'تخصیص خودرو ثبت شد.').then(() => setAssignmentForm(assignmentInitial))} />
          </form>
        </ErpSection>
      )}
      <RoleAwareDispatchCases workspace="vehicle-operations" onStaleChange={setDispatchTimelineStale} />
    </ErpWorkspacePage>
  );
}
