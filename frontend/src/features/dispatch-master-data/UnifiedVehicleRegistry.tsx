'use client';
import { useEffect, useState } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpInput, ErpLoading, ErpSegmentedControl, ErpWorkspacePage } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import { hrOperationsError } from './hrOperationsError';
import { currentEffectivePlate } from './vehicleAssignmentOptions';
export type RegistrySource = 'ALL' | 'INTERNAL' | 'EXTERNAL';
export default function UnifiedVehicleRegistry({ workspace, onSourceChange }: {workspace: 'hr' | 'security'; onSourceChange: (source: RegistrySource) => void}) {
 const [drivers, setDrivers] = useState<any[]>([]); const [vehicles, setVehicles] = useState<any[]>([]);
 const [section, setSection] = useState<'drivers' | 'vehicles'>('drivers'); const [search, setSearch] = useState('');
 const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
 useEffect(() => { let disposed = false; void Promise.all([dispatchMasterDataAPI.getVehicleOperationsDrivers(), dispatchMasterDataAPI.getCompanyVehicles(), dispatchMasterDataAPI.getExternalRegistry()])
 .then(([a,b,c]) => { if (disposed) return;
   setDrivers([...(a.data.data || []).map((d: any) => ({...d, registrySource: 'INTERNAL'})), ...(c.data.data.drivers || []).map((d: any) => ({...d, registrySource: 'EXTERNAL'}))]);
   setVehicles([...(b.data.data || []).map((v: any) => ({...v, registrySource: 'INTERNAL'})), ...(c.data.data.vehicles || []).map((v: any) => ({...v, registrySource: 'EXTERNAL'}))]);
 }).catch(e => {if (!disposed) setError(hrOperationsError(e, {failedAction: 'دریافت فهرست مشترک', nextStep: 'صفحه را به‌روزرسانی کنید'}));}).finally(() => {if (!disposed) setLoading(false);});
 return () => { disposed = true; }; }, []);
 const name = (r: any) => section === 'drivers' ? `${(r.personnel || r).firstName} ${(r.personnel || r).lastName}` : currentEffectivePlate({...r, plates: r.plates || []}, new Date().toISOString())?.plate || r.fleetCode || r.vehicleType;
 const rows = (section === 'drivers' ? drivers : vehicles).filter(r => r.status !== 'ARCHIVED' && `${name(r)} ${r.vehicleType || ''} ${r.fleetCode || ''}`.includes(search.trim()));
 return <ErpWorkspacePage title="رانندگان و خودروها" backHref={`/dashboard/${workspace}`}>
  <ErpSegmentedControl value="ALL" onChange={onSourceChange} options={[{value:'ALL',label:'همه'},{value:'INTERNAL',label:'داخلی / شرکتی'},{value:'EXTERNAL',label:'بیرونی'}]} />
  <ErpSegmentedControl value={section} onChange={setSection} options={[{value:'drivers',label:'رانندگان'},{value:'vehicles',label:'خودروها'}]} />
  <label className="block space-y-2 text-sm sds-text-secondary">جست‌وجو<ErpInput value={search} onChange={e => setSearch(e.target.value)} /></label>
  {error && <ErpInlineState kind="error" title={error} />}
  {loading ? <ErpLoading /> : <div className="space-y-3">{!rows.length && <ErpEmptyState title="موردی پیدا نشد" />}{rows.map(r => <ErpCard key={`${r.registrySource}:${r.id}`} className="p-4">
   <div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2">
    {section === 'drivers' ? <ErpButton label={name(r)} variant="ghost" href={r.registrySource === 'EXTERNAL' ? `/dashboard/${workspace}/external-drivers/${r.id}` : `/dashboard/hr/personnel/${r.personnelId}/driver-eligibility`} /> : <bdi dir="ltr">{name(r)}</bdi>}
    <ErpBadge tone="info">{r.registrySource === 'EXTERNAL' ? 'بیرونی' : section === 'drivers' ? 'داخلی' : 'شرکتی'}</ErpBadge>
   </div><ErpButton label={r.registrySource === 'EXTERNAL' ? 'مدیریت بیرونی‌ها' : 'مدیریت داخلی‌ها'} variant="soft" onClick={() => onSourceChange(r.registrySource)} /></div>
  </ErpCard>)}</div>}
 </ErpWorkspacePage>;
}
