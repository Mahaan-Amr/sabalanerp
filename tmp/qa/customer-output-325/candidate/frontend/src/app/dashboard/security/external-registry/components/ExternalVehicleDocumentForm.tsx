'use client';

import { useState } from 'react';
import { FaPlus } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpInput, ErpSelect } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import { field, RunAction, today } from './types';

export default function ExternalVehicleDocumentForm({ vehicles, saving, run }: { vehicles: any[]; saving: boolean; run: RunAction }) {
  const [form, setForm] = useState({ subjectId: '', reference: '', expiresAt: today() });
  return <ErpCard className="mb-5 p-3"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.recordExternalVehicleDocument(form.subjectId, { documentType: 'VEHICLE_REGISTRATION', reference: form.reference, expiresAt: form.expiresAt }), 'مدرک خودرو ثبت شد.').then(() => setForm({ subjectId: '', reference: '', expiresAt: today() })); }}>
    <label className={field}>خودرو<ErpSelect required value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value })}><option value="">انتخاب کنید</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleType} · {vehicle.plates[0]?.plate || 'بدون پلاک'}</option>)}</ErpSelect></label>
    <label className={field}>شناسه مدرک<ErpInput required value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label>
    <label className={field}>تاریخ انقضا<ErpInput required type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></label>
    <ErpButton type="submit" label="ثبت مدرک خودرو" icon={FaPlus} disabled={saving || !form.subjectId} />
  </form></ErpCard>;
}
