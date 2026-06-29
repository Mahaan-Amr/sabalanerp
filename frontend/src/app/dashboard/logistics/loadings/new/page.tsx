'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaChevronDown, FaChevronUp, FaPlus, FaSave, FaSearch, FaTruck } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpTwoColumn } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { inputClass, labelClass, numberFa, unitLabels } from '../../logistics-ui';

type DraftLine = {
  key: string;
  source: any;
  mode: 'direct' | 'linear';
  quantity: string;
  khatRas: string;
  pieceCount: string;
  plus: string;
  minus: string;
  notes: string;
};

const emptyDriver = {
  firstName: '',
  lastName: '',
  vehiclePlate: '',
  vehicleType: '',
  phone: '',
  nationalCode: '',
};

export default function NewLoadingPage() {
  const router = useRouter();
  const [projectSearch, setProjectSearch] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState('');
  const [remaining, setRemaining] = useState<any>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driverId, setDriverId] = useState('');
  const [driverSnapshot, setDriverSnapshot] = useState<any>(emptyDriver);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadProjects = async () => {
    const response = await logisticsAPI.getProjects(projectSearch ? { search: projectSearch } : undefined);
    if (response.data.success) setProjects(response.data.data);
  };

  const loadDrivers = async () => {
    const response = await logisticsAPI.getDrivers();
    if (response.data.success) setDrivers(response.data.data);
  };

  useEffect(() => {
    loadProjects();
    loadDrivers();
  }, []);

  const loadRemaining = async (nextProjectId: string) => {
    setProjectId(nextProjectId);
    setLines([]);
    if (!nextProjectId) {
      setRemaining(null);
      return;
    }
    setLoading(true);
    try {
      const response = await logisticsAPI.getRemaining(nextProjectId);
      if (response.data.success) setRemaining(response.data.data);
    } finally {
      setLoading(false);
    }
  };

  const selectedDriver = useMemo(() => drivers.find((driver) => driver.id === driverId), [drivers, driverId]);

  useEffect(() => {
    if (selectedDriver) {
      setDriverSnapshot({
        driverId: selectedDriver.id,
        firstName: selectedDriver.firstName,
        lastName: selectedDriver.lastName,
        vehiclePlate: selectedDriver.vehiclePlate,
        vehicleType: selectedDriver.vehicleType,
        phone: selectedDriver.phone,
        nationalCode: selectedDriver.nationalCode,
      });
    } else if (!driverId) {
      setDriverSnapshot(emptyDriver);
    }
  }, [selectedDriver, driverId]);

  const addSource = (source: any) => {
    setLines((current) => [
      ...current,
      {
        key: `${source.contractItemId}-${Date.now()}`,
        source,
        mode: source.unit === 'meter' ? 'linear' : 'direct',
        quantity: '',
        khatRas: '',
        pieceCount: '',
        plus: '0',
        minus: '0',
        notes: '',
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const calculateLineQuantity = (line: DraftLine) => {
    if (line.mode === 'linear') {
      const khatRas = Number(line.khatRas || 0);
      const pieceCount = Number(line.pieceCount || 0);
      const plus = Number(line.plus || 0);
      const minus = Number(line.minus || 0);
      return Math.max(0, khatRas * pieceCount + plus - minus);
    }
    return Number(line.quantity || 0);
  };

  const saveDraft = async () => {
    setError('');
    if (!projectId) {
      setError('ابتدا پروژه را انتخاب کنید.');
      return;
    }
    if (lines.length === 0) {
      setError('حداقل یک ردیف بارگیری اضافه کنید.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        projectId,
        notes,
        driverId: selectedDriver?.id || null,
        driverSnapshot,
        lines: lines.map((line) => ({
          sourceContractItemId: line.source.contractItemId,
          unit: line.source.unit,
          quantity: calculateLineQuantity(line),
          khatRas: line.mode === 'linear' ? line.khatRas : null,
          pieceCount: line.mode === 'linear' ? line.pieceCount : null,
          plus: line.mode === 'linear' ? line.plus : 0,
          minus: line.mode === 'linear' ? line.minus : 0,
          productSnapshot: line.source.productSnapshot,
          sourceSnapshot: {
            contractId: line.source.contractId,
            contractNumber: line.source.contractNumber,
            contractItemId: line.source.contractItemId,
            contractedQuantity: line.source.contractedQuantity,
            remainingQuantity: line.source.remainingQuantity,
          },
          notes: line.notes,
        })),
      };
      const response = await logisticsAPI.createLoading(payload);
      if (response.data.success) router.push(`/dashboard/logistics/loadings/${response.data.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت پیش‌نویس ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ErpPage
      eyebrow="لجستیک"
      title="بارگیری جدید"
      description="یک پروژه را انتخاب کنید، سپس از مانده‌های قراردادها به‌صورت دستی ردیف بارگیری بسازید."
      backHref="/dashboard/logistics/loadings"
      actions={[{ label: saving ? 'در حال ثبت...' : 'ثبت پیش‌نویس', icon: FaSave, onClick: saveDraft, disabled: saving, variant: 'solid' }]}
    >
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{error}</div>}

      <ErpTwoColumn
        main={
          <>
            <ErpSection title="انتخاب پروژه" description="هر بارگیری فقط به یک مشتری و یک پروژه تعلق دارد.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <input className={inputClass} value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="جستجوی مشتری، شرکت، پروژه یا آدرس" />
                <ErpButton label="جستجو" icon={FaSearch} onClick={loadProjects} />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => loadRemaining(project.id)}
                    className={`rounded-lg border p-3 text-right transition ${projectId === project.id ? 'border-[#074747] bg-[#074747]/10' : 'border-slate-200 bg-white hover:border-[#074747]/40 dark:border-slate-700 dark:bg-slate-900'}`}
                  >
                    <p className="font-semibold text-slate-900 dark:text-white">{project.projectName || project.address}</p>
                    <p className="mt-1 text-xs text-slate-500">{project.companyName || project.customerName} · {project.city || '—'}</p>
                  </button>
                ))}
              </div>
            </ErpSection>

            <ErpSection title="مانده قابل بارگیری" description="گروه‌ها برای پیدا کردن سریع محصول هستند؛ مصرف هر قرارداد را دستی انتخاب کنید.">
              {loading ? <ErpLoading /> : !remaining ? (
                <ErpEmptyState icon={FaTruck} title="پروژه‌ای انتخاب نشده است" description="بعد از انتخاب پروژه، مانده قراردادهای همان پروژه نمایش داده می‌شود." />
              ) : remaining.groups.length === 0 ? (
                <ErpEmptyState icon={FaTruck} title="مانده قابل بارگیری وجود ندارد" />
              ) : (
                <div className="space-y-3">
                  {remaining.groups.map((group: any) => {
                    const isOpen = expanded[group.groupKey];
                    return (
                      <ErpCard key={group.groupKey} className="p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{group.displayName}</p>
                            <p className="mt-1 text-xs text-slate-500">{group.productType || 'محصول'} · {group.unitLabel}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
                              مانده {numberFa(group.remainingTotal)} {group.unitLabel}
                            </span>
                            <button type="button" onClick={() => setExpanded((current) => ({ ...current, [group.groupKey]: !isOpen }))} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700">
                              {isOpen ? <FaChevronUp /> : <FaChevronDown />}
                            </button>
                          </div>
                        </div>
                        {isOpen && (
                          <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                            {group.sources.map((source: any) => (
                              <div key={source.contractItemId} className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                <div>
                                  <p className="font-semibold text-slate-800 dark:text-slate-100">قرارداد {source.contractNumber}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    مقدار قرارداد: {numberFa(source.contractedQuantity)} · بارگیری نهایی: {numberFa(source.finalizedLoadedQuantity)} · مانده: {numberFa(source.remainingQuantity)} {source.unitLabel}
                                  </p>
                                </div>
                                <ErpButton label="افزودن" icon={FaPlus} onClick={() => addSource(source)} tone="primary" />
                              </div>
                            ))}
                          </div>
                        )}
                      </ErpCard>
                    );
                  })}
                </div>
              )}
            </ErpSection>

            <ErpSection title="ردیف‌های پیش‌نویس" description="برای گروه‌های چند قراردادی، هر ردیف باید منبع قرارداد خودش را داشته باشد.">
              {lines.length === 0 ? <p className="text-sm text-slate-500">هنوز ردیفی اضافه نشده است.</p> : (
                <div className="space-y-3">
                  {lines.map((line) => {
                    const quantity = calculateLineQuantity(line);
                    return (
                      <ErpCard key={line.key} className="p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{line.source.productSnapshot?.name || 'محصول'}</p>
                            <p className="mt-1 text-xs text-slate-500">قرارداد {line.source.contractNumber} · مانده {numberFa(line.source.remainingQuantity)} {line.source.unitLabel}</p>
                          </div>
                          <ErpButton label="حذف" onClick={() => removeLine(line.key)} tone="danger" variant="soft" />
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                          {line.source.unit === 'meter' && (
                            <label>
                              <span className={labelClass}>روش</span>
                              <select className={inputClass} value={line.mode} onChange={(event) => updateLine(line.key, { mode: event.target.value as any })}>
                                <option value="linear">خط راس</option>
                                <option value="direct">مقدار مستقیم</option>
                              </select>
                            </label>
                          )}
                          {line.mode === 'linear' ? (
                            <>
                              <label><span className={labelClass}>خط راس</span><input className={inputClass} value={line.khatRas} onChange={(event) => updateLine(line.key, { khatRas: event.target.value })} /></label>
                              <label><span className={labelClass}>تعداد</span><input className={inputClass} value={line.pieceCount} onChange={(event) => updateLine(line.key, { pieceCount: event.target.value })} /></label>
                              <label><span className={labelClass}>اضافه</span><input className={inputClass} value={line.plus} onChange={(event) => updateLine(line.key, { plus: event.target.value })} /></label>
                              <label><span className={labelClass}>کسر</span><input className={inputClass} value={line.minus} onChange={(event) => updateLine(line.key, { minus: event.target.value })} /></label>
                            </>
                          ) : (
                            <label><span className={labelClass}>مقدار</span><input className={inputClass} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
                          )}
                        </div>
                        <p className="mt-3 text-sm font-semibold text-[#074747] dark:text-teal-200">مقدار بارگیری: {numberFa(quantity)} {unitLabels[line.source.unit] || line.source.unit}</p>
                      </ErpCard>
                    );
                  })}
                </div>
              )}
            </ErpSection>
          </>
        }
        aside={
          <>
            <ErpSection title="راننده و خودرو" description="پیش‌نویس بدون راننده مجاز است؛ نهایی‌سازی نیاز به اطلاعات کامل دارد.">
              <div className="space-y-3">
                <label>
                  <span className={labelClass}>راننده ثابت</span>
                  <select className={inputClass} value={driverId} onChange={(event) => setDriverId(event.target.value)}>
                    <option value="">راننده موقت / بدون انتخاب</option>
                    {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.firstName} {driver.lastName} · {driver.vehiclePlate}</option>)}
                  </select>
                </label>
                {(['firstName', 'lastName', 'vehiclePlate', 'vehicleType', 'phone', 'nationalCode'] as const).map((field) => (
                  <label key={field}>
                    <span className={labelClass}>{field === 'firstName' ? 'نام' : field === 'lastName' ? 'نام خانوادگی' : field === 'vehiclePlate' ? 'شماره پلاک' : field === 'vehicleType' ? 'نوع ماشین' : field === 'phone' ? 'شماره تماس' : 'کد ملی'}</span>
                    <input className={inputClass} value={driverSnapshot[field] || ''} onChange={(event) => setDriverSnapshot((current: any) => ({ ...current, [field]: event.target.value }))} />
                  </label>
                ))}
              </div>
            </ErpSection>
            <ErpSection title="یادداشت">
              <textarea className={`${inputClass} min-h-28`} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </ErpSection>
          </>
        }
      />
    </ErpPage>
  );
}
