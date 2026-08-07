'use client';

import { useState } from 'react';
import { FaCarSide } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInput } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import { field, RunAction } from './types';

export default function ExternalVehicleLifecycleList({ vehicles, canManage, saving, run }: { vehicles: any[]; canManage: boolean; saving: boolean; run: RunAction }) {
  const [reason, setReason] = useState('');
  return <>{canManage && <label className={`${field} mb-4 block`}>دلیل تغییر وضعیت<ErpInput value={reason} onChange={(event) => setReason(event.target.value)} /></label>}{!vehicles.length ? <ErpEmptyState title="خودروی متفرقه ثبت نشده است" icon={FaCarSide} /> : <div className="space-y-3">{vehicles.map((vehicle) => <ErpCard key={vehicle.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold sds-text-primary">{vehicle.vehicleType}</p><p className="mt-1 text-sm sds-text-muted">{vehicle.plates[0]?.plate || 'بدون پلاک'}</p><p className="mt-1 text-xs sds-text-muted">{vehicle.readiness.blockers.join(' · ') || 'آماده ورود به صف'}</p></div><div className="flex flex-wrap items-center gap-2"><ErpBadge tone={vehicle.readiness.status === 'READY' ? 'success' : 'warning'}>{vehicle.readiness.status}</ErpBadge><ErpBadge tone={vehicle.status === 'ACTIVE' ? 'success' : 'warning'}>{vehicle.status}</ErpBadge>{canManage && <ErpButton label={vehicle.status === 'DRAFT' ? 'فعال‌سازی' : vehicle.status === 'ACTIVE' ? 'محدودسازی' : vehicle.status === 'RESTRICTED' ? 'رفع محدودیت' : 'بازیابی پیش‌نویس'} tone={vehicle.status === 'ACTIVE' ? 'warning' : 'success'} variant="soft" disabled={saving || !reason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionExternalVehicleStatus(vehicle.id, { status: vehicle.status === 'DRAFT' ? 'ACTIVE' : vehicle.status === 'ACTIVE' ? 'RESTRICTED' : vehicle.status === 'RESTRICTED' ? 'ACTIVE' : 'DRAFT', effectiveFrom: new Date().toISOString(), reason: reason.trim() }), 'وضعیت خودرو ثبت شد.').then(() => setReason(''))} />}</div></div></ErpCard>)}</div>}</>;
}
