'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FaBan, FaCamera, FaCarSide, FaCheck, FaClipboardList, FaClock, FaEdit, FaPlus, FaRedo, FaSearch, FaTrash, FaTruck, FaUserShield } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpEmptyState, ErpInlineState, ErpInput, ErpPressable, ErpSection, ErpSegmentedControl, ErpSelect, ErpSkeleton, ErpWorkspacePage, erpFieldLabelClassName } from '@/components/erp';
import { crmAPI, securityAPI } from '@/lib/api';
import { askSecurityAction } from '@/components/SecurityNoticeHost';

const labelClass = erpFieldLabelClassName;

const emptyPair = {
  firstName: '',
  lastName: '',
  vehiclePlate: '',
  vehiclePlateKind: 'STANDARD',
  vehicleType: '',
  phone: '',
  nationalCode: '',
  homeAddress: '',
  relativePhone: '',
  notes: '',
};

const plateLetters = ['ب', 'ج', 'د', 'س', 'ص', 'ط', 'ق', 'ل', 'م', 'ن', 'و', 'ه', 'ی'];
const normalizeDigits = (value: string) => value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

function StoredPhotoThumbnail({ photo, onOpen, onDelete }: { photo: any; onOpen: (url: string) => void; onDelete: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let objectUrl = '';
    securityAPI.getVehiclePairPhoto(photo.id).then((response) => {
      objectUrl = URL.createObjectURL(response.data);
      setUrl(objectUrl);
    });
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.id]);
  return <div className="relative aspect-video overflow-hidden rounded-lg bg-[var(--sds-surface-subtle)]">{url ? <ErpPressable onClick={() => onOpen(url)} className="h-full w-full rounded-none p-0"><img src={url} alt={photo.originalName} className="h-full w-full object-cover" /></ErpPressable> : <span className="grid h-full place-items-center text-xs">در حال بارگذاری</span>}<ErpPressable onClick={onDelete} aria-label={`حذف ${photo.originalName}`} tone="danger" variant="solid" className="absolute left-1 top-1 h-11 w-11 p-1"><FaTrash /></ErpPressable></div>;
}

function LocalPhotoThumbnail({ file, onOpen, onDelete }: { file: File; onOpen: (url: string) => void; onDelete: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const objectUrl = URL.createObjectURL(file); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [file]);
  return <div className="relative aspect-video overflow-hidden rounded-lg bg-[var(--sds-surface-subtle)]">{url && <ErpPressable onClick={() => onOpen(url)} className="h-full w-full rounded-none p-0"><img src={url} alt={file.name} className="h-full w-full object-cover" /></ErpPressable>}<ErpPressable onClick={onDelete} aria-label={`حذف ${file.name}`} tone="danger" variant="solid" className="absolute left-1 top-1 h-11 w-11 p-1"><FaTrash /></ErpPressable></div>;
}

const photoCategories = [
  { field: 'driverLicensePhotos', category: 'DRIVER_LICENSE', label: 'عکس گواهینامه' },
  { field: 'vehicleCardPhotos', category: 'VEHICLE_CARD', label: 'عکس کارت ماشین' },
  { field: 'driverPhotos', category: 'DRIVER_PHOTO', label: 'عکس راننده' },
] as const;

const emptyInbound = {
  purpose: 'OUTSIDE_PURCHASE',
  vehiclePairId: '',
  customerId: '',
  notes: '',
  driverSnapshot: { ...emptyPair },
  documentSnapshot: {
    hasPurchaseInvoice: false,
    purchaseInvoiceNumber: '',
    hasWaybill: false,
    waybillNumber: '',
  },
  settlementSnapshot: {
    amount: '',
    accountOrCardNumber: '',
    ownerName: '',
  },
};

const purposeLabel: Record<string, string> = {
  OUTSIDE_PURCHASE: 'خرید بیرونی',
  SALES_RETURN: 'برگشت از فروش',
  CONSIGNMENT: 'امانی',
  SALES_EXIT: 'خروج کالا برای فروش',
  CUSTOMER_PERSONAL_CAR_EXIT: 'خروج با سواری شخصی مشتری',
};

const statusLabel: Record<string, string> = {
  ENTRY_RECORDED: 'ثبت ورود',
  INFO_COMPLETED: 'تکمیل اطلاعات',
  ENTRY_VOIDED: 'لغو ورود',
  READY_TO_EXIT: 'آماده خروج',
  EXITED: 'خارج شد',
  EXIT_VOIDED: 'لغو خروج',
};
const queueStatusLabel: Record<string, string> = { WAITING: 'در انتظار', ENTERED_LOADING_AREA: 'وارد محوطه بارگیری', RESERVED: 'رزرو شده', DISPATCHED: 'اعزام شده', OUT_OF_QUEUE: 'خارج از صف' };
const returnToQueueReasons = ['بارگیری آماده نبود', 'اشتباه در ورود', 'تغییر برنامه بارگیری', 'راننده موقتاً برگشت به صف'];

const statusTone = (status: string) => {
  if (status === 'EXITED' || status === 'INFO_COMPLETED') return 'success' as const;
  if (status.includes('VOIDED')) return 'danger' as const;
  if (status === 'ENTRY_RECORDED' || status === 'READY_TO_EXIT') return 'warning' as const;
  return 'neutral' as const;
};

type VehicleSection = 'registry' | 'queue' | 'movements' | 'inbound' | 'sales-exit';

export default function SecurityVehiclesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [pairs, setPairs] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [readyExit, setReadyExit] = useState<any[]>([]);
  const [queueTurns, setQueueTurns] = useState<any[]>([]);
  const [queueHistory, setQueueHistory] = useState<any[]>([]);
  const [showQueueHistory, setShowQueueHistory] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [pairForm, setPairForm] = useState(emptyPair);
  const [pairPhotos, setPairPhotos] = useState<Record<string, File[]>>({ driverLicensePhotos: [], vehicleCardPhotos: [], driverPhotos: [] });
  const [editingPairId, setEditingPairId] = useState<string | null>(null);
  const [plateParts, setPlateParts] = useState({ left: '', letter: 'ط', middle: '', iran: '' });
  const [previewUrl, setPreviewUrl] = useState('');
  const [inboundForm, setInboundForm] = useState<any>(emptyInbound);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<VehicleSection>('queue');
  const [queryReady, setQueryReady] = useState(false);

  const activePairs = useMemo(() => pairs.filter((pair) => pair.isActive), [pairs]);
  const queuedPairIds = useMemo(() => new Set(queueTurns.filter((turn) => ['WAITING', 'ENTERED_LOADING_AREA', 'RESERVED'].includes(turn.status)).map((turn) => turn.vehiclePairId)), [queueTurns]);
  const editingPair = useMemo(() => pairs.find((pair) => pair.id === editingPairId), [pairs, editingPairId]);
  const canSavePair = useMemo(() => {
    const fieldsComplete = Object.entries(pairForm).every(([field, value]) => field === 'notes' || value.trim().length > 0);
    const plateComplete = pairForm.vehiclePlateKind === 'SPECIAL' ? pairForm.vehiclePlate.trim().length > 0 : plateParts.left.length === 2 && plateParts.middle.length === 3 && plateParts.iran.length === 2;
    const photosComplete = photoCategories.every(({ field, category }) => pairPhotos[field].length > 0 || editingPair?.photos?.some((photo: any) => photo.category === category));
    return fieldsComplete && plateComplete && photosComplete;
  }, [editingPair, pairForm, pairPhotos, plateParts]);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled([
        securityAPI.getVehiclePairs({ includeInactive: true }),
        securityAPI.getVehicleMovements({ limit: 50 }),
        securityAPI.getReadyExitLoadings(),
        securityAPI.getDriverQueue(),
        securityAPI.getDriverQueue(true),
      ]);
      const setters = [setPairs, setMovements, setReadyExit, setQueueTurns, setQueueHistory];
      results.forEach((result, index) => { if (result.status === 'fulfilled' && result.value.data.success) setters[index](result.value.data.data); });
      if (results.some((result) => result.status === 'rejected')) setError('بخشی از اطلاعات خودرویی دریافت نشد؛ اطلاعات موفق نمایش داده می‌شود.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت اطلاعات خودرویی ناموفق بود.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeSection !== 'queue') return undefined;
    const timer = window.setInterval(() => { void loadData(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeSection]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const operation = params.get('operation') as VehicleSection | null;
    if (operation && ['registry', 'queue', 'movements', 'inbound', 'sales-exit'].includes(operation)) setActiveSection(operation);
    else if (params.get('view') === 'history') setActiveSection('movements');
    setQueryReady(true);
  }, []);

  useEffect(() => {
    if (!queryReady) return;
    const params = new URLSearchParams();
    if (activeSection === 'movements') params.set('view', 'history');
    else if (activeSection !== 'queue') params.set('operation', activeSection);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [activeSection, pathname, queryReady, router]);

  const searchCustomers = async () => {
    if (!customerSearch.trim()) return;
    const response = await crmAPI.getCustomers({ search: customerSearch, limit: 10 });
    if (response.data.success) setCustomers(response.data.data || []);
  };

  const savePair = async () => {
    setSaving(true);
    setError('');
    try {
      if (editingPairId) {
        const photoData = new FormData();
        Object.entries(pairPhotos).forEach(([field, files]) => files.forEach((file) => photoData.append(field, file)));
        if (Object.values(pairPhotos).some((files) => files.length > 0)) await securityAPI.addVehiclePairPhotos(editingPairId, photoData);
        await securityAPI.updateVehiclePair(editingPairId, pairForm);
      } else {
        const data = new FormData();
        Object.entries(pairForm).forEach(([field, value]) => data.append(field, value));
        Object.entries(pairPhotos).forEach(([field, files]) => files.forEach((file) => data.append(field, file)));
        await securityAPI.createVehiclePair(data);
      }
      setPairForm(emptyPair);
      setPairPhotos({ driverLicensePhotos: [], vehicleCardPhotos: [], driverPhotos: [] });
      setEditingPairId(null);
      setPlateParts({ left: '', letter: 'ط', middle: '', iran: '' });
      setMessage('راننده و خودرو در گارد ثبت شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت راننده و خودرو ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const editPair = (pair: any) => {
    setEditingPairId(pair.id);
    setPairForm(Object.fromEntries(Object.keys(emptyPair).map((key) => [key, pair[key] || ''])) as typeof emptyPair);
    setPairPhotos({ driverLicensePhotos: [], vehicleCardPhotos: [], driverPhotos: [] });
    const match = pair.vehiclePlateKind === 'STANDARD' ? String(pair.vehiclePlate).match(/^(\d{2}) ([آ-ی]) (\d{3}) ایران (\d{2})$/) : null;
    setPlateParts(match ? { left: match[1], letter: match[2], middle: match[3], iran: match[4] } : { left: '', letter: 'ط', middle: '', iran: '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const updatePlatePart = (field: 'left' | 'letter' | 'middle' | 'iran', value: string) => {
    const next = { ...plateParts, [field]: field === 'letter' ? value : normalizeDigits(value).replace(/\D/g, '').slice(0, field === 'middle' ? 3 : 2) };
    setPlateParts(next);
    setPairForm((current) => ({ ...current, vehiclePlate: `${next.left} ${next.letter} ${next.middle} ایران ${next.iran}`.trim() }));
  };

  const enqueueDriver = async (vehiclePairId: string) => {
    try { await securityAPI.enqueueDriver(vehiclePairId); setMessage('راننده در صف نوبت‌دهی قرار گرفت.'); await loadData(); }
    catch (err: any) { setError(err.response?.data?.error || 'ثبت نوبت ناموفق بود.'); }
  };

  const removeFromQueue = async (turn: any) => {
    const reason = await askSecurityAction({ title: 'خروج از صف', inputLabel: 'دلیل خروج راننده از صف' });
    if (!reason?.trim()) return;
    try { await securityAPI.removeDriverFromQueue(turn.id, reason.trim()); await loadData(); }
    catch (err: any) { setError(err.response?.data?.error || 'خروج از صف ناموفق بود.'); }
  };

  const enterLoadingArea = async (turn: any) => {
    try {
      await securityAPI.enterDriverLoadingArea(turn.id);
      setMessage('راننده وارد محوطه بارگیری شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ورود راننده برای بارگیری ناموفق بود.');
    }
  };

  const returnToWaiting = async (turn: any) => {
    const picked = await askSecurityAction({ title: 'بازگشت به صف', description: 'دلیل بازگشت را انتخاب کنید.', options: returnToQueueReasons });
    if (!picked?.trim()) return;
    try {
      await securityAPI.returnDriverToWaiting(turn.id, picked.trim());
      setMessage('راننده به ابتدای صف انتظار برگشت.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'بازگشت راننده به صف ناموفق بود.');
    }
  };

  const deletePair = async (pair: any) => {
    if (!await askSecurityAction({ title: 'حذف رکورد', description: 'این رکورد و تمام تصاویر آن حذف شود؟' })) return;
    try { await securityAPI.deleteVehiclePair(pair.id); await loadData(); }
    catch (err: any) { setError(err.response?.data?.error || 'حذف رکورد ناموفق بود.'); }
  };

  const deletePhoto = async (pair: any, photoId: string) => {
    try { await securityAPI.deleteVehiclePairPhoto(pair.id, photoId); await loadData(); }
    catch (err: any) { setError(err.response?.data?.error || 'حذف تصویر ناموفق بود.'); }
  };

  const togglePair = async (pair: any) => {
    await securityAPI.updateVehiclePair(pair.id, { ...pair, isActive: !pair.isActive });
    await loadData();
  };

  const selectInboundPair = (pairId: string) => {
    const pair = pairs.find((item) => item.id === pairId);
    setInboundForm((current: any) => ({
      ...current,
      vehiclePairId: pairId,
      driverSnapshot: pair ? { ...emptyPair, ...pair, vehiclePairId: pair.id } : { ...emptyPair },
    }));
  };

  const recordInbound = async () => {
    setSaving(true);
    setError('');
    try {
      await securityAPI.createInboundVehicleMovement({
        ...inboundForm,
        customerId: inboundForm.purpose === 'SALES_RETURN' ? inboundForm.customerId : null,
      });
      setInboundForm(emptyInbound);
      setMessage('ورود خودروی پر ثبت شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت ورود خودروی پر ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const completeMovement = async (movement: any) => {
    await securityAPI.completeVehicleMovement(movement.id, {
      documentSnapshot: movement.documentSnapshot || {},
      settlementSnapshot: movement.settlementSnapshot || {},
      notes: movement.notes,
    });
    await loadData();
  };

  const recordExit = async (loadingId: string, customerPersonalCar = false) => {
    setSaving(true);
    try {
      await securityAPI.recordVehicleExit({ loadingId, customerPersonalCar });
      setMessage(customerPersonalCar ? 'خروج با سواری شخصی مشتری ثبت شد.' : 'خروج فروش در گیت ثبت شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت خروج ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ErpWorkspacePage title="تردد خودروها" primaryAction={{ label: 'ثبت راننده و خودرو', icon: FaPlus, onClick: () => setActiveSection('registry'), variant: 'solid' }} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: loadData }]}>
      {loading && !pairs.length && !movements.length ? <ErpSkeleton lines={6} /> : <>
      {message && <ErpInlineState kind="success" title={message} />}
      {error && <ErpInlineState kind={pairs.length || movements.length ? 'stale' : 'error'} title={error} action={{ label: 'تلاش مجدد', onClick: loadData }} />}

      <ErpSegmentedControl<'current' | 'history'>
        value={activeSection === 'movements' ? 'history' : 'current'}
        onChange={(value) => setActiveSection(value === 'history' ? 'movements' : 'queue')}
        options={[
          { value: 'current', label: 'تردد جاری', icon: FaClock },
          { value: 'history', label: 'سوابق', icon: FaClipboardList },
        ]}
      />
      {activeSection !== 'movements' && <div className="flex flex-wrap gap-2"><ErpButton label="صف رانندگان" onClick={() => setActiveSection('queue')} variant={activeSection === 'queue' ? 'solid' : 'soft'} /><ErpButton label="آماده خروج" onClick={() => setActiveSection('sales-exit')} variant={activeSection === 'sales-exit' ? 'solid' : 'soft'} /><ErpButton label="ثبت ورود" onClick={() => setActiveSection('inbound')} variant={activeSection === 'inbound' ? 'solid' : 'soft'} /><ErpButton label="رانندگان و خودروها" onClick={() => setActiveSection('registry')} variant={activeSection === 'registry' ? 'solid' : 'soft'} /></div>}

      {activeSection === 'queue' && (
        <ErpSection title="صف رانندگان">
          <div className="mb-4"><ErpButton label={showQueueHistory ? 'نمایش صف جاری' : 'تاریخچه نوبت‌ها'} icon={FaClipboardList} variant="soft" onClick={() => setShowQueueHistory((value) => !value)} /></div>
          {!showQueueHistory && <div className="mb-4 flex justify-end"><ErpButton label="به‌روزرسانی" icon={FaRedo} variant="soft" onClick={() => { void loadData(); }} /></div>}
          {!showQueueHistory && <>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {activePairs.filter((pair) => pair.informationComplete && !queuedPairIds.has(pair.id)).map((pair) => (
              <ErpPressable key={pair.id} onClick={() => enqueueDriver(pair.id)} variant="outline" className="h-auto p-3 text-right">
                <span className="font-semibold">{pair.firstName} {pair.lastName}</span><span className="block text-xs sds-text-muted">{pair.vehiclePlate} · {pair.vehicleType}</span><span className="mt-2 block text-xs font-semibold text-[var(--sds-accent)]">افزودن به صف</span>
              </ErpPressable>
            ))}
          </div>
          <div className="mt-5 space-y-3">
            {queueTurns.map((turn, index) => (
              <ErpCard key={turn.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">نوبت {(index + 1).toLocaleString('fa-IR')} · {turn.vehiclePair.firstName} {turn.vehiclePair.lastName}</p><p className="mt-1 text-sm sds-text-muted">{turn.vehiclePair.vehiclePlate} · {turn.vehiclePair.vehicleType}</p><p className="mt-1 text-xs sds-text-muted">ورود: {new Date(turn.enteredAt).toLocaleString('fa-IR')} · انتظار: {Math.max(0, Math.floor((now - new Date(turn.enteredAt).getTime()) / 60000)).toLocaleString('fa-IR')} دقیقه{turn.loadingAreaEnteredAt ? ` · ورود برای بارگیری: ${new Date(turn.loadingAreaEnteredAt).toLocaleString('fa-IR')}` : ''}{turn.returnToQueueReason ? ` · بازگشت: ${turn.returnToQueueReason}` : ''}</p></div><div className="flex flex-wrap gap-2"><ErpBadge tone={turn.status === 'WAITING' ? 'success' : turn.status === 'ENTERED_LOADING_AREA' ? 'info' : 'warning'}>{queueStatusLabel[turn.status] || turn.status}</ErpBadge>{turn.status === 'WAITING' && <ErpButton label="ورود برای بارگیری" icon={FaTruck} tone="success" variant="soft" onClick={() => enterLoadingArea(turn)} />}{turn.status === 'ENTERED_LOADING_AREA' && <ErpButton label="بازگشت به صف" icon={FaRedo} tone="neutral" variant="soft" onClick={() => returnToWaiting(turn)} />}{turn.status !== 'RESERVED' && <ErpButton label="خارج از صف" icon={FaBan} tone="danger" variant="soft" onClick={() => removeFromQueue(turn)} />}</div></div>
              </ErpCard>
            ))}
            {!queueTurns.length && <ErpEmptyState icon={FaClock} title="راننده‌ای در صف نیست" />}
          </div>
          </>}
          {showQueueHistory && <div className="space-y-3">{queueHistory.map((turn) => <ErpCard key={turn.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{turn.vehiclePair.firstName} {turn.vehiclePair.lastName} · {turn.vehiclePair.vehiclePlate}</p><p className="mt-1 text-xs sds-text-muted">ورود: {new Date(turn.enteredAt).toLocaleString('fa-IR')}{turn.reservedPosition ? ` · جایگاه هنگام انتخاب ${turn.reservedPosition.toLocaleString('fa-IR')}` : ''}{turn.loading ? ` · بارگیری ${turn.loading.loadingNumber}` : ''}{turn.removedAt ? ` · خروج ${new Date(turn.removedAt).toLocaleString('fa-IR')}` : ''}{turn.removalReason ? ` · ${turn.removalReason}` : ''}</p></div><ErpBadge tone={turn.status === 'DISPATCHED' ? 'success' : turn.status === 'OUT_OF_QUEUE' ? 'danger' : 'warning'}>{queueStatusLabel[turn.status] || turn.status}</ErpBadge></div></ErpCard>)}</div>}
        </ErpSection>
      )}

      {activeSection === 'registry' && (
      <ErpSection title="ثبت راننده و خودرو">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Object.entries({ firstName: 'نام', lastName: 'نام خانوادگی', vehicleType: 'نوع خودرو', phone: 'شماره موبایل', nationalCode: 'کد ملی', homeAddress: 'آدرس منزل', relativePhone: 'شماره موبایل بستگان' }).map(([field, label]) => (
            <label key={field}>
              <span className={labelClass}>{label}</span>
              <ErpInput value={(pairForm as any)[field]} onChange={(event) => setPairForm((current) => ({ ...current, [field]: event.target.value }))} />
            </label>
          ))}
          <div className="md:col-span-3"><div className="mb-2 flex items-center justify-between"><span className={labelClass}>پلاک خودرو</span><ErpCheckbox label="پلاک ویژه" checked={pairForm.vehiclePlateKind === 'SPECIAL'} onChange={(event) => { const special = event.target.checked; setPairForm((current) => ({ ...current, vehiclePlateKind: special ? 'SPECIAL' : 'STANDARD', vehiclePlate: '' })); setPlateParts({ left: '', letter: 'ط', middle: '', iran: '' }); }} /></div>{pairForm.vehiclePlateKind === 'SPECIAL' ? <ErpInput value={pairForm.vehiclePlate} onChange={(event) => setPairForm((current) => ({ ...current, vehiclePlate: event.target.value }))} placeholder="پلاک ویژه" /> : <div dir="ltr" className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto_1fr]"><ErpInput inputMode="numeric" value={plateParts.left} onChange={(event) => updatePlatePart('left', event.target.value)} placeholder="17" /><ErpSelect value={plateParts.letter} onChange={(event) => updatePlatePart('letter', event.target.value)}>{plateLetters.map((letter) => <option key={letter}>{letter}</option>)}</ErpSelect><ErpInput inputMode="numeric" value={plateParts.middle} onChange={(event) => updatePlatePart('middle', event.target.value)} placeholder="574" /><span className="grid min-h-12 place-items-center rounded-lg border border-[var(--sds-border-default)] px-3">ایران</span><ErpInput inputMode="numeric" value={plateParts.iran} onChange={(event) => updatePlatePart('iran', event.target.value)} placeholder="63" /></div>}</div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {photoCategories.map(({ field, label }) => (
            <label key={field} className="sds-divider rounded-lg border border-dashed p-4">
              <span className={labelClass}>{label} *</span>
              <span className="mb-2 block text-xs sds-text-muted">JPEG، PNG یا WebP؛ حداکثر ۱۰ مگابایت برای هر تصویر</span>
              <span className="flex flex-col gap-2"><span>انتخاب فایل</span><ErpInput type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setPairPhotos((current) => ({ ...current, [field]: [...current[field], ...Array.from(event.target.files || [])] }))} /><span className="flex items-center gap-2"><FaCamera /> ثبت با دوربین</span><ErpInput type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setPairPhotos((current) => ({ ...current, [field]: [...current[field], ...Array.from(event.target.files || [])] }))} /></span>
              <span className="mt-2 block text-xs font-semibold text-[var(--sds-accent)]">{pairPhotos[field].length.toLocaleString('fa-IR')} تصویر جدید</span>
              <div className="mt-2 grid grid-cols-2 gap-2">{pairPhotos[field].map((file, index) => <LocalPhotoThumbnail key={`${file.name}-${index}`} file={file} onOpen={setPreviewUrl} onDelete={() => setPairPhotos((current) => ({ ...current, [field]: current[field].filter((_, itemIndex) => itemIndex !== index) }))} />)}</div>
            </label>
          ))}
        </div>
        <div className="mt-3">
          <ErpButton label={editingPairId ? 'ذخیره تغییرات' : 'ثبت راننده و خودرو'} icon={editingPairId ? FaEdit : FaPlus} onClick={savePair} disabled={saving || !canSavePair} variant="solid" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pairs.map((pair) => (
            <ErpCard key={pair.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold sds-text-primary">{pair.firstName} {pair.lastName}</p>
                  <p className="mt-1 text-sm sds-text-muted">{pair.vehicleType} · {pair.vehiclePlate}</p>
                  <p className="mt-1 text-xs sds-text-muted">{pair.phone} · {pair.nationalCode}</p>
                  <p className="mt-1 text-xs sds-text-muted">{pair.homeAddress || 'آدرس تکمیل نشده'} · {pair.relativePhone || 'موبایل بستگان تکمیل نشده'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ErpBadge tone={pair.isActive ? 'success' : 'neutral'}>{pair.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                  {!pair.informationComplete && <ErpBadge tone="warning">نیازمند تکمیل اطلاعات</ErpBadge>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {photoCategories.map(({ category, label }) => (
                  <div key={category} className="rounded-lg bg-[var(--sds-surface-subtle)] p-2 text-xs">
                    <p className="font-semibold">{label}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">{(pair.photos || []).filter((photo: any) => photo.category === category).map((photo: any) => <StoredPhotoThumbnail key={photo.id} photo={photo} onOpen={setPreviewUrl} onDelete={() => deletePhoto(pair, photo.id)} />)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ErpButton label="ویرایش" icon={FaEdit} onClick={() => editPair(pair)} variant="soft" />
                <ErpButton label={pair.isActive ? 'غیرفعال کردن' : 'فعال کردن'} icon={pair.isActive ? FaBan : FaCheck} onClick={() => togglePair(pair)} tone={pair.isActive ? 'danger' : 'success'} variant="soft" />
                {pair.canDelete && <ErpButton label="حذف" icon={FaTrash} onClick={() => deletePair(pair)} tone="danger" variant="soft" />}
              </div>
            </ErpCard>
          ))}
        </div>
      </ErpSection>
      )}

      {activeSection === 'inbound' && (
      <ErpSection title="تراکنش ورودی">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label>
            <span className={labelClass}>نوع ورود</span>
            <ErpSelect value={inboundForm.purpose} onChange={(event) => setInboundForm((current: any) => ({ ...current, purpose: event.target.value }))}>
              <option value="OUTSIDE_PURCHASE">خرید بیرونی</option>
              <option value="SALES_RETURN">برگشت از فروش</option>
              <option value="CONSIGNMENT" disabled>امانی - در دست تعریف</option>
            </ErpSelect>
          </label>
          <label>
            <span className={labelClass}>ثبت راننده و خودرو</span>
            <ErpSelect value={inboundForm.vehiclePairId} onChange={(event) => selectInboundPair(event.target.value)}>
              <option value="">تردد متفرقه</option>
              {activePairs.map((pair) => <option key={pair.id} value={pair.id}>{pair.firstName} {pair.lastName} · {pair.vehiclePlate}</option>)}
            </ErpSelect>
          </label>
          {inboundForm.purpose === 'SALES_RETURN' && (
            <label>
              <span className={labelClass}>مشتری برگشت از فروش</span>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <ErpInput value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
                <ErpButton label="جستجو" icon={FaSearch} onClick={searchCustomers} />
              </div>
            </label>
          )}
        </div>

        {inboundForm.purpose === 'SALES_RETURN' && customers.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {customers.map((customer) => (
              <ErpPressable key={customer.id} onClick={() => setInboundForm((current: any) => ({ ...current, customerId: customer.id }))} variant={inboundForm.customerId === customer.id ? 'soft' : 'outline'} tone="primary" className="h-auto p-3 text-right text-sm">
                <span className="font-semibold">{customer.firstName} {customer.lastName}</span>
                <span className="block text-xs sds-text-muted">{customer.companyName || 'بدون شرکت'}</span>
              </ErpPressable>
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {!inboundForm.vehiclePairId && Object.entries({ firstName: 'نام راننده', lastName: 'نام خانوادگی', vehiclePlate: 'پلاک', vehicleType: 'نوع خودرو', phone: 'موبایل', nationalCode: 'کد ملی' }).map(([field, label]) => (
            <label key={field}>
              <span className={labelClass}>{label}</span>
              <ErpInput value={inboundForm.driverSnapshot[field] || ''} onChange={(event) => setInboundForm((current: any) => ({ ...current, driverSnapshot: { ...current.driverSnapshot, [field]: event.target.value } }))} />
            </label>
          ))}
          <label><span className={labelClass}>شماره فاکتور خرید</span><ErpInput value={inboundForm.documentSnapshot.purchaseInvoiceNumber} disabled={inboundForm.purpose === 'SALES_RETURN'} onChange={(event) => setInboundForm((current: any) => ({ ...current, documentSnapshot: { ...current.documentSnapshot, hasPurchaseInvoice: Boolean(event.target.value), purchaseInvoiceNumber: event.target.value } }))} /></label>
          <label><span className={labelClass}>شماره بارنامه</span><ErpInput value={inboundForm.documentSnapshot.waybillNumber} onChange={(event) => setInboundForm((current: any) => ({ ...current, documentSnapshot: { ...current.documentSnapshot, hasWaybill: Boolean(event.target.value), waybillNumber: event.target.value } }))} /></label>
          <label><span className={labelClass}>مبلغ تسویه بارنامه</span><ErpInput value={inboundForm.settlementSnapshot.amount} onChange={(event) => setInboundForm((current: any) => ({ ...current, settlementSnapshot: { ...current.settlementSnapshot, amount: event.target.value } }))} /></label>
        </div>
        <div className="mt-3">
          <ErpButton label="ثبت ورود" icon={FaTruck} onClick={recordInbound} disabled={saving || (inboundForm.purpose === 'SALES_RETURN' && !inboundForm.customerId)} variant="solid" />
        </div>
      </ErpSection>
      )}

      {activeSection === 'sales-exit' && (
      <ErpSection title="آماده خروج">
        {readyExit.length === 0 ? (
          <ErpEmptyState icon={FaCarSide} title="بارگیری آماده خروج وجود ندارد" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {readyExit.map((loading) => (
              <ErpCard key={loading.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold sds-text-primary">{loading.loadingNumber}</p>
                    <p className="mt-1 text-sm sds-text-muted">{loading.customer?.firstName} {loading.customer?.lastName} · {loading.project?.projectName || loading.project?.address}</p>
                    <p className="mt-1 text-xs sds-text-muted">{loading.driverSnapshot?.firstName || 'بدون راننده'} {loading.driverSnapshot?.lastName || ''} · {loading.driverSnapshot?.vehiclePlate || 'بدون پلاک'}</p>
                  </div>
                  <ErpBadge tone="warning">آماده خروج</ErpBadge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ErpButton label="ثبت خروج" icon={FaCheck} onClick={() => recordExit(loading.id)} disabled={saving} variant="solid" />
                  <ErpButton label="سواری شخصی مشتری" icon={FaCarSide} onClick={() => recordExit(loading.id, true)} disabled={saving} tone="neutral" />
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>
      )}

      {activeSection === 'movements' && (
      <ErpSection title="سوابق تردد">
        <div className="space-y-3">
          {movements.map((movement) => (
            <ErpCard key={movement.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold sds-text-primary">{movement.movementNumber} · {purposeLabel[movement.purpose] || movement.purpose}</p>
                  <p className="mt-1 text-sm sds-text-muted">{movement.vehiclePair ? `${movement.vehiclePair.firstName} ${movement.vehiclePair.lastName} · ${movement.vehiclePair.vehiclePlate}` : movement.customer ? `${movement.customer.firstName} ${movement.customer.lastName}` : 'تردد متفرقه'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ErpBadge tone={movement.direction === 'INBOUND' ? 'info' : 'purple'}>{movement.direction === 'INBOUND' ? 'ورود' : 'خروج'}</ErpBadge>
                  <ErpBadge tone={statusTone(movement.status)}>{statusLabel[movement.status] || movement.status}</ErpBadge>
                </div>
              </div>
              {movement.direction === 'INBOUND' && movement.status === 'ENTRY_RECORDED' && (
                <div className="mt-3">
                  <ErpButton label="تکمیل اطلاعات" icon={FaCheck} onClick={() => completeMovement(movement)} tone="success" variant="soft" />
                </div>
              )}
            </ErpCard>
          ))}
        </div>
      </ErpSection>
      )}
      {previewUrl && <div role="dialog" aria-modal="true" aria-label="پیش‌نمایش تصویر" className="fixed inset-0 z-[100] grid place-items-center bg-[var(--sds-surface-overlay)] p-4"><ErpPressable aria-label="بستن پیش‌نمایش" onClick={() => setPreviewUrl('')} className="absolute inset-0 h-full w-full cursor-default rounded-none bg-transparent" /><div className="relative z-10 max-h-full max-w-5xl"><img src={previewUrl} alt="پیش‌نمایش تصویر" className="max-h-[90vh] max-w-full rounded-xl object-contain" /><ErpPressable onClick={() => setPreviewUrl('')} tone="primary" variant="solid" className="absolute left-2 top-2 px-3 py-2 font-semibold">بستن</ErpPressable></div></div>}
      </>}
    </ErpWorkspacePage>
  );
}
