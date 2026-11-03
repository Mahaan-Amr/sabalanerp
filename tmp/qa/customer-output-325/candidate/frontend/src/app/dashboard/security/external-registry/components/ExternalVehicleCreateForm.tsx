'use client';

import { useState } from 'react';
import { FaPlus } from 'react-icons/fa';
import { ErpButton, ErpInput, ErpSection } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import { field, RunAction, today } from './types';

const initial = () => ({ vehicleType: '', plate: '', effectiveFrom: today(), reason: 'ثبت خودروی راننده متفرقه', notes: '' });

export default function ExternalVehicleCreateForm({ saving, run }: { saving: boolean; run: RunAction }) {
  const [form, setForm] = useState(initial);
  return <ErpSection title="ثبت خودروی متفرقه"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.createExternalVehicle(form), 'خودروی متفرقه ثبت شد.').then(() => setForm(initial())); }}>
    <label className={field}>نوع خودرو<ErpInput required value={form.vehicleType} onChange={(event) => setForm({ ...form, vehicleType: event.target.value })} /></label>
    <label className={field}>پلاک<ErpInput required value={form.plate} onChange={(event) => setForm({ ...form, plate: event.target.value })} /></label>
    <label className={field}>شروع اعتبار پلاک<ErpInput required type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} /></label>
    <label className={field}>دلیل<ErpInput required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
    <ErpButton type="submit" label="ثبت خودرو" icon={FaPlus} disabled={saving} className="sm:col-span-2" />
  </form></ErpSection>;
}
