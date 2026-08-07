'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaArchive, FaSync } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpLoading, ErpSection, ErpWorkspacePage } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import ExternalDriverCreateForm from './components/ExternalDriverCreateForm';
import ExternalDriverPanel from './components/ExternalDriverPanel';
import ExternalVehicleCreateForm from './components/ExternalVehicleCreateForm';
import ExternalVehiclePanel from './components/ExternalVehiclePanel';

export default function ExternalRegistryPage() {
  const [registry, setRegistry] = useState<any>({ drivers: [], vehicles: [], legacyPairs: [], capabilities: { canManage: false } });
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await dispatchMasterDataAPI.getExternalRegistry({ archived: showArchived ? 'include' : 'exclude' });
      setRegistry(response.data.data);
    } catch (error: any) {
      setNotice({ tone: 'danger', text: error?.response?.data?.error || 'دریافت ثبت متفرقه‌ها ممکن نشد.' });
    } finally { setLoading(false); }
  }, [showArchived]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<any>, message: string) => {
    setSaving(true); setNotice(null);
    try { await action(); setNotice({ tone: 'success', text: message }); await load(); }
    catch (error: any) { setNotice({ tone: 'danger', text: error?.response?.data?.error || 'ثبت اطلاعات ممکن نشد.' }); }
    finally { setSaving(false); }
  };

  if (loading) return <ErpLoading />;
  const canManage = Boolean(registry.capabilities?.canManage);
  return <ErpWorkspacePage title="رانندگان و خودروهای متفرقه" context="گارد هویت راننده و خودرو را جدا ثبت می‌کند؛ سوابق قدیمی فقط برای مشاهده حفظ شده‌اند." backHref="/dashboard/security/vehicles" secondaryActions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load }]} className="guard-workspace pb-24 lg:pb-4">
    {notice && <ErpInlineState kind={notice.tone === 'success' ? 'success' : 'error'} title={notice.text} />}
    <div className="mb-5 flex justify-end"><ErpButton label={showArchived ? 'پنهان کردن بایگانی' : 'نمایش بایگانی'} icon={FaArchive} variant="soft" onClick={() => setShowArchived((value) => !value)} /></div>
    {canManage && <div className="grid grid-cols-1 gap-5 xl:grid-cols-2"><ExternalDriverCreateForm saving={saving} run={run} /><ExternalVehicleCreateForm saving={saving} run={run} /></div>}
    <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2"><ExternalDriverPanel drivers={registry.drivers} canManage={canManage} saving={saving} run={run} /><ExternalVehiclePanel vehicles={registry.vehicles} canManage={canManage} saving={saving} run={run} /></div>
    {registry.legacyPairs.length > 0 && <ErpSection title="سوابق ترکیبی قدیمی" description="این موارد قابل انتخاب برای عملیات جدید نیستند."><div className="space-y-2">{registry.legacyPairs.map((pair: any) => <ErpCard key={pair.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm sds-text-secondary">{pair.firstName} {pair.lastName} · {pair.vehiclePlate}</span><ErpBadge tone="warning">فقط سابقه</ErpBadge></div></ErpCard>)}</div></ErpSection>}
  </ErpWorkspacePage>;
}
