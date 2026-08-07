'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaCarSide, FaPlus, FaSync, FaUserShield } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpInput, ErpLoading, ErpSection, ErpSelect, ErpWorkspacePage } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import { WORKSPACES, WORKSPACE_PERMISSIONS, useWorkspace } from '@/contexts/WorkspaceContext';

const today = () => new Date().toISOString().slice(0, 10);
const driverInitial = { firstName: '', lastName: '', nationalCode: '', phone: '', notes: '' };
const vehicleInitial = { vehicleType: '', plate: '', effectiveFrom: today(), reason: 'ثبت خودروی راننده متفرقه', notes: '' };
const plateInitial = { vehicleId: '', plate: '', effectiveFrom: today(), reason: 'تغییر پلاک خودروی متفرقه' };
const field = 'space-y-1.5 text-sm font-medium sds-text-secondary';

export default function ExternalRegistryPage() {
  const { hasPermission } = useWorkspace();
  const canManage = hasPermission(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT);
  const [registry, setRegistry] = useState<any>({ drivers: [], vehicles: [], legacyPairs: [] });
  const [driverForm, setDriverForm] = useState(driverInitial);
  const [vehicleForm, setVehicleForm] = useState(vehicleInitial);
  const [plateForm, setPlateForm] = useState(plateInitial);
  const [changeReason, setChangeReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await dispatchMasterDataAPI.getExternalRegistry(); setRegistry(response.data.data); }
    catch (error: any) { setNotice({ tone: 'danger', text: error?.response?.data?.error || 'دریافت ثبت متفرقه‌ها ممکن نشد.' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<any>, message: string) => {
    setSaving(true); setNotice(null);
    try { await action(); setNotice({ tone: 'success', text: message }); await load(); }
    catch (error: any) { setNotice({ tone: 'danger', text: error?.response?.data?.error || 'ثبت اطلاعات ممکن نشد.' }); }
    finally { setSaving(false); }
  };

  if (loading) return <ErpLoading />;
  return <ErpWorkspacePage title="رانندگان و خودروهای متفرقه" context="گارد هویت راننده و خودرو را جدا ثبت می‌کند؛ سوابق قدیمی فقط برای مشاهده حفظ شده‌اند." backHref="/dashboard/security/vehicles" secondaryActions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load }]} className="guard-workspace pb-24 lg:pb-4">
    {notice && <ErpInlineState kind={notice.tone === 'success' ? 'success' : 'error'} title={notice.text} />}
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {canManage && <ErpSection title="ثبت راننده متفرقه">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.createExternalDriver(driverForm), 'راننده متفرقه ثبت شد.').then(() => setDriverForm(driverInitial)); }}>
          <label className={field}>نام<ErpInput required value={driverForm.firstName} onChange={(event) => setDriverForm({ ...driverForm, firstName: event.target.value })} /></label>
          <label className={field}>نام خانوادگی<ErpInput required value={driverForm.lastName} onChange={(event) => setDriverForm({ ...driverForm, lastName: event.target.value })} /></label>
          <label className={field}>کد ملی<ErpInput required inputMode="numeric" value={driverForm.nationalCode} onChange={(event) => setDriverForm({ ...driverForm, nationalCode: event.target.value })} /></label>
          <label className={field}>موبایل<ErpInput required inputMode="tel" value={driverForm.phone} onChange={(event) => setDriverForm({ ...driverForm, phone: event.target.value })} /></label>
          <ErpButton label="ثبت راننده" icon={FaPlus} disabled={saving} className="sm:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.createExternalDriver(driverForm), 'راننده متفرقه ثبت شد.').then(() => setDriverForm(driverInitial))} />
        </form>
      </ErpSection>}
      {canManage && <ErpSection title="ثبت خودروی متفرقه">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.createExternalVehicle(vehicleForm), 'خودروی متفرقه ثبت شد.').then(() => setVehicleForm(vehicleInitial)); }}>
          <label className={field}>نوع خودرو<ErpInput required value={vehicleForm.vehicleType} onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })} /></label>
          <label className={field}>پلاک<ErpInput required value={vehicleForm.plate} onChange={(event) => setVehicleForm({ ...vehicleForm, plate: event.target.value })} /></label>
          <label className={field}>شروع اعتبار پلاک<ErpInput required type="date" value={vehicleForm.effectiveFrom} onChange={(event) => setVehicleForm({ ...vehicleForm, effectiveFrom: event.target.value })} /></label>
          <label className={field}>دلیل<ErpInput required value={vehicleForm.reason} onChange={(event) => setVehicleForm({ ...vehicleForm, reason: event.target.value })} /></label>
          <ErpButton label="ثبت خودرو" icon={FaPlus} disabled={saving} className="sm:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.createExternalVehicle(vehicleForm), 'خودروی متفرقه ثبت شد.').then(() => setVehicleForm(vehicleInitial))} />
        </form>
      </ErpSection>}
      <ErpSection title="رانندگان متفرقه">
        {canManage && <label className={`${field} mb-4 block`}>دلیل تغییر وضعیت<ErpInput value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></label>}
        {!registry.drivers.length ? <ErpEmptyState title="راننده متفرقه ثبت نشده است" icon={FaUserShield} /> : <div className="space-y-3">{registry.drivers.map((driver: any) => <ErpCard key={driver.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold sds-text-primary">{driver.firstName} {driver.lastName}</p><p className="mt-1 text-sm sds-text-muted">{driver.phone} · {driver.nationalCode}</p></div><div className="flex flex-wrap items-center gap-2"><ErpBadge tone={driver.status === 'ACTIVE' ? 'success' : 'warning'}>{driver.status === 'ACTIVE' ? 'فعال' : 'تعلیق'}</ErpBadge>{canManage && <ErpButton label={driver.status === 'ACTIVE' ? 'تعلیق' : 'فعال‌سازی'} tone={driver.status === 'ACTIVE' ? 'warning' : 'success'} variant="soft" disabled={saving || !changeReason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionExternalDriverStatus(driver.id, { status: driver.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason: changeReason.trim() }), 'وضعیت راننده ثبت شد.').then(() => setChangeReason(''))} />}</div></div></ErpCard>)}</div>}
      </ErpSection>
      <ErpSection title="خودروهای متفرقه">
        {canManage && <form className="mb-5 grid grid-cols-1 gap-3 rounded-xl border border-[var(--sds-border-subtle)] p-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.changeExternalVehiclePlate(plateForm.vehicleId, plateForm), 'پلاک متفرقه تغییر کرد.').then(() => setPlateForm(plateInitial)); }}><label className={field}>خودرو<ErpSelect required value={plateForm.vehicleId} onChange={(event) => setPlateForm({ ...plateForm, vehicleId: event.target.value })}><option value="">انتخاب کنید</option>{registry.vehicles.map((vehicle: any) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleType} · {vehicle.plates[0]?.plate || 'بدون پلاک'}</option>)}</ErpSelect></label><label className={field}>پلاک جدید<ErpInput required value={plateForm.plate} onChange={(event) => setPlateForm({ ...plateForm, plate: event.target.value })} /></label><label className={field}>شروع اعتبار<ErpInput required type="date" value={plateForm.effectiveFrom} onChange={(event) => setPlateForm({ ...plateForm, effectiveFrom: event.target.value })} /></label><label className={field}>دلیل<ErpInput required value={plateForm.reason} onChange={(event) => setPlateForm({ ...plateForm, reason: event.target.value })} /></label><ErpButton label="ثبت پلاک جدید" icon={FaPlus} disabled={saving || !plateForm.vehicleId} className="sm:col-span-2" onClick={() => void run(() => dispatchMasterDataAPI.changeExternalVehiclePlate(plateForm.vehicleId, plateForm), 'پلاک متفرقه تغییر کرد.').then(() => setPlateForm(plateInitial))} /></form>}
        {!registry.vehicles.length ? <ErpEmptyState title="خودروی متفرقه ثبت نشده است" icon={FaCarSide} /> : <div className="space-y-3">{registry.vehicles.map((vehicle: any) => <ErpCard key={vehicle.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold sds-text-primary">{vehicle.vehicleType}</p><p className="mt-1 text-sm sds-text-muted">{vehicle.plates[0]?.plate || 'بدون پلاک'}</p></div><div className="flex flex-wrap items-center gap-2"><ErpBadge tone={vehicle.status === 'IN_SERVICE' ? 'success' : 'warning'}>{vehicle.status === 'IN_SERVICE' ? 'در سرویس' : 'خارج از سرویس'}</ErpBadge>{canManage && <ErpButton label={vehicle.status === 'IN_SERVICE' ? 'خارج از سرویس' : 'بازگشت به سرویس'} tone={vehicle.status === 'IN_SERVICE' ? 'warning' : 'success'} variant="soft" disabled={saving || !changeReason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionExternalVehicleStatus(vehicle.id, { status: vehicle.status === 'IN_SERVICE' ? 'OUT_OF_SERVICE' : 'IN_SERVICE', reason: changeReason.trim() }), 'وضعیت خودرو ثبت شد.').then(() => setChangeReason(''))} />}</div></div></ErpCard>)}</div>}
      </ErpSection>
    </div>
    {registry.legacyPairs.length > 0 && <ErpSection title="سوابق ترکیبی قدیمی" description="این موارد قابل انتخاب برای عملیات جدید نیستند."><div className="space-y-2">{registry.legacyPairs.map((pair: any) => <ErpCard key={pair.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm sds-text-secondary">{pair.firstName} {pair.lastName} · {pair.vehiclePlate}</span><ErpBadge tone="warning">فقط سابقه</ErpBadge></div></ErpCard>)}</div></ErpSection>}
  </ErpWorkspacePage>;
}
