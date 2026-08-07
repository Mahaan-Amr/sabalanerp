'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FaCarSide, FaCheck, FaClipboardList, FaClock, FaPlus, FaRedo, FaSearch, FaTruck, FaUserShield } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpInput, ErpPressable, ErpSection, ErpSegmentedControl, ErpSelect, ErpSkeleton, ErpWorkspacePage, erpFieldLabelClassName } from '@/components/erp';
import { crmAPI, securityAPI } from '@/lib/api';

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
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [inboundForm, setInboundForm] = useState<any>(emptyInbound);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<VehicleSection>('queue');
  const [queryReady, setQueryReady] = useState(false);


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
    <ErpWorkspacePage className="guard-workspace" title="تردد خودروها" primaryAction={{ label: 'ثبت راننده یا خودرو', icon: FaPlus, href: '/dashboard/security/external-registry', variant: 'solid' }} secondaryActions={[{ label: 'ثبت متفرقه‌های جدید', icon: FaUserShield, href: '/dashboard/security/external-registry' }, { label: 'به‌روزرسانی', icon: FaRedo, onClick: loadData }]}>
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

      {activeSection === 'queue' && <ErpSection title="سوابق صف قدیمی" description="مدل ترکیبی قدیمی فقط برای مشاهده سابقه حفظ شده و هیچ عملیات یا پذیرش جدیدی از این صفحه انجام نمی‌شود.">
        <div className="space-y-3">{[...queueTurns, ...queueHistory].map((turn) => <ErpCard key={turn.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{turn.vehiclePair.firstName} {turn.vehiclePair.lastName} · {turn.vehiclePair.vehiclePlate}</p><p className="mt-1 text-xs sds-text-muted">ورود: {new Date(turn.enteredAt).toLocaleString('fa-IR')}{turn.loading ? ` · بارگیری ${turn.loading.loadingNumber}` : ''}</p></div><div className="flex flex-wrap gap-2"><ErpBadge tone="warning">فقط سابقه</ErpBadge><ErpBadge tone="neutral">{queueStatusLabel[turn.status] || turn.status}</ErpBadge></div></div></ErpCard>)}</div>
        {!queueTurns.length && !queueHistory.length && <ErpEmptyState icon={FaClock} title="سابقه‌ای وجود ندارد" />}
      </ErpSection>}
      {activeSection === 'registry' && <ErpSection title="سوابق ترکیبی قدیمی" description="این رکوردها و تصاویرشان فقط شواهد تاریخی هستند. برای عملیات جدید از رجیستر مستقل راننده و خودرو استفاده کنید.">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{pairs.map((pair) => <ErpCard key={pair.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold sds-text-primary">{pair.firstName} {pair.lastName}</p><p className="mt-1 text-sm sds-text-muted">{pair.vehicleType} · {pair.vehiclePlate}</p><p className="mt-1 text-xs sds-text-muted">{pair.phone} · {pair.nationalCode}</p></div><ErpBadge tone="warning">فقط سابقه</ErpBadge></div></ErpCard>)}</div>
        {!pairs.length && <ErpEmptyState icon={FaCarSide} title="سابقه ترکیبی وجود ندارد" />}
      </ErpSection>}
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
          <ErpCard className="p-3 text-sm sds-text-secondary">راننده و خودرو برای ورود جدید به‌صورت تصویر لحظه‌ای ثبت می‌شوند؛ رجیستر ترکیبی قدیمی قابل انتخاب نیست.</ErpCard>
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
