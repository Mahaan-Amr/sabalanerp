'use client';

import { useState } from 'react';
import { FaPlus } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpInput, ErpSection, ErpSelect } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import ExternalVehicleDocumentForm from './ExternalVehicleDocumentForm';
import ExternalVehicleLifecycleList from './ExternalVehicleLifecycleList';
import { field, RunAction, today } from './types';

export default function ExternalVehiclePanel({ vehicles, canManage, saving, run }: { vehicles: any[]; canManage: boolean; saving: boolean; run: RunAction }) {
  const [plate, setPlate] = useState({ vehicleId: '', plate: '', effectiveFrom: today(), reason: 'تغییر پلاک خودروی متفرقه' });
  return <ErpSection title="خودروهای متفرقه">
    {canManage && <><ExternalVehicleDocumentForm vehicles={vehicles} saving={saving} run={run} /><ErpCard className="mb-5 p-3"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.changeExternalVehiclePlate(plate.vehicleId, plate), 'پلاک متفرقه تغییر کرد.').then(() => setPlate({ vehicleId: '', plate: '', effectiveFrom: today(), reason: 'تغییر پلاک خودروی متفرقه' })); }}>
      <label className={field}>خودرو<ErpSelect required value={plate.vehicleId} onChange={(event) => setPlate({ ...plate, vehicleId: event.target.value })}><option value="">انتخاب کنید</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleType} · {vehicle.plates[0]?.plate || 'بدون پلاک'}</option>)}</ErpSelect></label>
      <label className={field}>پلاک جدید<ErpInput required value={plate.plate} onChange={(event) => setPlate({ ...plate, plate: event.target.value })} /></label>
      <label className={field}>شروع اعتبار<ErpInput required type="date" value={plate.effectiveFrom} onChange={(event) => setPlate({ ...plate, effectiveFrom: event.target.value })} /></label>
      <label className={field}>دلیل<ErpInput required value={plate.reason} onChange={(event) => setPlate({ ...plate, reason: event.target.value })} /></label>
      <ErpButton type="submit" label="ثبت پلاک جدید" icon={FaPlus} disabled={saving || !plate.vehicleId} className="sm:col-span-2" />
    </form></ErpCard></>}
    <ExternalVehicleLifecycleList vehicles={vehicles} canManage={canManage} saving={saving} run={run} />
  </ErpSection>;
}
