'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaArrowRight, FaCheck, FaClipboardList, FaPlus, FaSave, FaSearch, FaTruck, FaUserPlus, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { inputClass, labelClass, numberFa, unitLabels } from '../../logistics-ui';

type WizardStep = 'project' | 'remaining' | 'quantities' | 'driver' | 'review';
type QuantityMode = 'linear' | 'direct';
type DriverMode = 'saved' | 'temporary' | 'new';

type DraftLine = {
  key: string;
  source: any;
  mode: QuantityMode;
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

const steps: Array<{ id: WizardStep; label: string }> = [
  { id: 'project', label: 'پروژه' },
  { id: 'remaining', label: 'مانده' },
  { id: 'quantities', label: 'مقدار' },
  { id: 'driver', label: 'راننده' },
  { id: 'review', label: 'بازبینی' },
];

const driverFields = [
  ['firstName', 'نام'],
  ['lastName', 'نام خانوادگی'],
  ['vehiclePlate', 'شماره پلاک'],
  ['vehicleType', 'نوع ماشین'],
  ['phone', 'شماره تماس'],
  ['nationalCode', 'کد ملی'],
] as const;

const lineFromSource = (source: any, quantity = ''): DraftLine => ({
  key: `${source.contractItemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  source,
  mode: source.unit === 'meter' ? 'linear' : 'direct',
  quantity,
  khatRas: '',
  pieceCount: '',
  plus: '0',
  minus: '0',
  notes: '',
});

const lineFromLoadingLine = (line: any): DraftLine => {
  const sourceSnapshot = line.sourceSnapshot || {};
  const source = {
    contractId: line.sourceContractId,
    contractNumber: sourceSnapshot.contractNumber || line.sourceContract?.contractNumber || '',
    contractItemId: line.sourceContractItemId,
    contractedQuantity: sourceSnapshot.contractedQuantity || line.sourceContractItem?.quantity || 0,
    remainingQuantity: sourceSnapshot.remainingQuantity || line.quantity,
    unit: line.unit,
    unitLabel: unitLabels[line.unit] || line.unit,
    productSnapshot: line.productSnapshot,
  };

  return {
    key: line.id || `${line.sourceContractItemId}-${Date.now()}`,
    source,
    mode: line.khatRas || line.pieceCount ? 'linear' : 'direct',
    quantity: line.khatRas || line.pieceCount ? '' : String(line.quantity || ''),
    khatRas: line.khatRas ? String(line.khatRas) : '',
    pieceCount: line.pieceCount ? String(line.pieceCount) : '',
    plus: String(line.plus || 0),
    minus: String(line.minus || 0),
    notes: line.notes || '',
  };
};

export default function NewLoadingPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('project');
  const [projectSearch, setProjectSearch] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [remaining, setRemaining] = useState<any>(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driverMode, setDriverMode] = useState<DriverMode>('saved');
  const [driverId, setDriverId] = useState('');
  const [driverSnapshot, setDriverSnapshot] = useState<any>(emptyDriver);
  const [newDriverForm, setNewDriverForm] = useState<any>({ ...emptyDriver, notes: '' });
  const [newDriverStep, setNewDriverStep] = useState<'identity' | 'vehicle' | 'review'>('identity');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedDriver = useMemo(() => drivers.find((driver) => driver.id === driverId), [drivers, driverId]);
  const selectedGroup = useMemo(() => remaining?.groups?.find((group: any) => group.groupKey === selectedGroupKey), [remaining, selectedGroupKey]);

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

  useEffect(() => {
    if (driverMode !== 'saved') return;
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
  }, [selectedDriver, driverId, driverMode]);

  const loadRemaining = async (projectId: string) => {
    const response = await logisticsAPI.getRemaining(projectId);
    if (response.data.success) setRemaining(response.data.data);
  };

  const selectProject = async (projectId: string, forceNew = false) => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const response = await logisticsAPI.createOrResumeDraft(projectId, { forceNew });
      if (!response.data.success) return;
      const loadingDraft = response.data.data;
      setDraft(loadingDraft);
      setNotes(loadingDraft.notes || '');
      setDriverId(loadingDraft.driverId || '');
      setDriverSnapshot(loadingDraft.driverSnapshot || emptyDriver);
      setLines((loadingDraft.lines || []).map(lineFromLoadingLine));
      await loadRemaining(projectId);
      setMessage(response.data.resumed ? 'پیش‌نویس فعال این پروژه ادامه داده شد.' : 'پیش‌نویس بارگیری ساخته شد.');
      setStep('remaining');
    } catch (err: any) {
      setError(err.response?.data?.error || 'ساخت پیش‌نویس ناموفق بود.');
    } finally {
      setLoading(false);
    }
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

  const addSingleSource = (source: any) => {
    setLines((current) => [...current, lineFromSource(source)]);
    setMessage('ردیف به پیش‌نویس اضافه شد.');
  };

  const openGroupAllocation = (group: any) => {
    if (group.sources.length === 1) {
      addSingleSource(group.sources[0]);
      return;
    }
    setSelectedGroupKey(group.groupKey);
    setAllocations(Object.fromEntries(group.sources.map((source: any) => [source.contractItemId, ''])));
  };

  const addAllocatedSources = () => {
    if (!selectedGroup) return;
    const added = selectedGroup.sources
      .map((source: any) => ({ source, quantity: allocations[source.contractItemId] }))
      .filter((item: any) => Number(item.quantity || 0) > 0)
      .map((item: any) => lineFromSource(item.source, item.quantity));

    if (!added.length) {
      setError('برای حداقل یک قرارداد مقدار وارد کنید.');
      return;
    }

    setLines((current) => [...current, ...added]);
    setSelectedGroupKey('');
    setAllocations({});
    setError('');
    setMessage('تخصیص منبع به پیش‌نویس اضافه شد.');
  };

  const buildPayload = () => ({
    projectId: draft?.projectId,
    notes,
    driverId: driverMode === 'saved' && selectedDriver ? selectedDriver.id : null,
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
  });

  const saveDraft = async () => {
    if (!draft?.id) return false;
    setError('');
    setSaving(true);
    try {
      const response = await logisticsAPI.updateLoading(draft.id, buildPayload());
      if (response.data.success) {
        setDraft(response.data.data);
        setMessage('پیش‌نویس ذخیره شد.');
        return true;
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'ذخیره پیش‌نویس ناموفق بود.');
    } finally {
      setSaving(false);
    }
    return false;
  };

  const saveReusableDriver = async () => {
    setError('');
    try {
      const response = await logisticsAPI.createDriver(newDriverForm);
      if (response.data.success) {
        await loadDrivers();
        const driver = response.data.data;
        setDriverMode('saved');
        setDriverId(driver.id);
        setDriverSnapshot({
          driverId: driver.id,
          firstName: driver.firstName,
          lastName: driver.lastName,
          vehiclePlate: driver.vehiclePlate,
          vehicleType: driver.vehicleType,
          phone: driver.phone,
          nationalCode: driver.nationalCode,
        });
        setNewDriverForm({ ...emptyDriver, notes: '' });
        setNewDriverStep('identity');
        setMessage('راننده جدید ذخیره و برای بارگیری انتخاب شد.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت راننده ناموفق بود.');
    }
  };

  const blockers = useMemo(() => {
    const items: string[] = [];
    if (!draft?.projectId) items.push('پروژه انتخاب نشده است.');
    if (!lines.length) items.push('حداقل یک ردیف بارگیری لازم است.');
    if (lines.some((line) => calculateLineQuantity(line) <= 0)) items.push('مقدار همه ردیف‌ها باید بیشتر از صفر باشد.');
    const requiredDriverFields = ['firstName', 'lastName', 'vehiclePlate', 'vehicleType', 'phone', 'nationalCode'];
    if (requiredDriverFields.some((field) => !String(driverSnapshot?.[field] || '').trim())) {
      items.push('اطلاعات راننده و خودرو کامل نیست.');
    }
    return items;
  }, [draft, lines, driverSnapshot]);

  const hasValidLineQuantities = lines.length > 0 && lines.every((line) => calculateLineQuantity(line) > 0);

  const canEnterStep = (target: WizardStep) => {
    if (target === 'project') return true;
    if (!draft?.id) return false;
    if (target === 'remaining') return true;
    if (target === 'quantities') return lines.length > 0;
    if (target === 'driver') return hasValidLineQuantities;
    return true;
  };

  const finalize = async () => {
    if (blockers.length) {
      setError('موارد لازم برای نهایی‌سازی را تکمیل کنید.');
      return;
    }
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const response = await logisticsAPI.finalizeLoading(draft.id);
      if (response.data.success) router.push(`/dashboard/logistics/loadings/${draft.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'نهایی‌سازی ناموفق بود.');
    }
  };

  const goNext = async () => {
    if (step === 'project' && !draft?.id) {
      setError('ابتدا پروژه را انتخاب کنید.');
      return;
    }
    if (step === 'remaining' && lines.length === 0) {
      setError('حداقل یک مانده قابل بارگیری را اضافه کنید.');
      return;
    }
    if (step === 'quantities' && !hasValidLineQuantities) {
      setError('مقدار همه ردیف‌ها باید بیشتر از صفر باشد.');
      return;
    }
    setError('');
    if (step !== 'project') await saveDraft();
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.min(index + 1, steps.length - 1)].id);
  };

  const goBack = () => {
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.max(index - 1, 0)].id);
  };

  const renderStepNav = () => (
    <div className="grid grid-cols-5 gap-2">
      {steps.map((item, index) => {
        const active = item.id === step;
        const done = steps.findIndex((candidate) => candidate.id === step) > index;
        return (
          <button
            key={item.id}
            type="button"
            disabled={!canEnterStep(item.id)}
            onClick={() => setStep(item.id)}
            className={`min-h-12 rounded-lg border px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-[#074747] bg-[#074747] text-white'
                : done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );

  const renderProjectStep = () => (
    <ErpSection title="انتخاب پروژه" description="انتخاب پروژه اولین تعهد بارگیری است؛ اگر پیش‌نویس فعالی برای پروژه وجود داشته باشد همان ادامه داده می‌شود.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input className={inputClass} value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="جستجوی مشتری، شرکت، پروژه یا آدرس" />
        <ErpButton label="جستجو" icon={FaSearch} onClick={loadProjects} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {projects.map((project) => (
          <ErpCard key={project.id} interactive className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{project.projectName || project.address}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{project.companyName || project.customerName} · {project.city || 'بدون شهر'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ErpButton label="انتخاب" icon={FaTruck} onClick={() => selectProject(project.id)} variant="solid" />
                <ErpButton label="شروع پیش‌نویس جدید" onClick={() => selectProject(project.id, true)} tone="neutral" variant="outline" />
              </div>
            </div>
          </ErpCard>
        ))}
      </div>
    </ErpSection>
  );

  const renderRemainingStep = () => (
    <ErpSection title="انتخاب مانده قابل بارگیری" description="ابتدا مانده‌های فیزیکی را انتخاب کنید؛ اگر یک گروه چند منبع قراردادی داشته باشد تخصیص منبع جداگانه انجام می‌شود.">
      {!remaining ? (
        <ErpEmptyState icon={FaTruck} title="ابتدا پروژه را انتخاب کنید" />
      ) : remaining.groups.length === 0 ? (
        <ErpEmptyState icon={FaTruck} title="مانده قابل بارگیری وجود ندارد" />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {remaining.groups.map((group: any) => (
            <ErpCard key={group.groupKey} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{group.displayName}</p>
                  <p className="mt-1 text-xs text-slate-500">{group.productType || 'محصول'} · {group.unitLabel} · {group.sources.length.toLocaleString('fa-IR')} منبع</p>
                </div>
                <ErpBadge tone="success">مانده {numberFa(group.remainingTotal)} {group.unitLabel}</ErpBadge>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="text-xs text-slate-500">قراردادها: {group.sources.map((source: any) => source.contractNumber).join('، ')}</p>
                <ErpButton label={group.sources.length > 1 ? 'تخصیص منبع' : 'افزودن'} icon={FaPlus} onClick={() => openGroupAllocation(group)} />
              </div>
            </ErpCard>
          ))}
        </div>
      )}

      {selectedGroup && (
        <ErpCard className="mt-4 p-4" tone="info">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">تخصیص منبع: {selectedGroup.displayName}</h3>
              <p className="mt-1 text-sm text-slate-500">این مقدار از کدام قراردادها مصرف شود؟</p>
            </div>
            <ErpButton label="بستن" onClick={() => setSelectedGroupKey('')} tone="neutral" variant="ghost" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {selectedGroup.sources.map((source: any) => (
              <label key={source.contractItemId}>
                <span className={labelClass}>قرارداد {source.contractNumber} · مانده {numberFa(source.remainingQuantity)} {source.unitLabel}</span>
                <input className={inputClass} value={allocations[source.contractItemId] || ''} onChange={(event) => setAllocations((current) => ({ ...current, [source.contractItemId]: event.target.value }))} placeholder="مقدار مصرف از این قرارداد" />
              </label>
            ))}
          </div>
          <div className="mt-4">
            <ErpButton label="افزودن تخصیص‌ها" icon={FaPlus} onClick={addAllocatedSources} variant="solid" />
          </div>
        </ErpCard>
      )}
    </ErpSection>
  );

  const renderQuantitiesStep = () => (
    <ErpSection title="مقداردهی ردیف‌ها" description="برای ردیف‌های متر طول، خط راس پیش‌فرض است و مقدار مستقیم همچنان در دسترس می‌ماند.">
      {lines.length === 0 ? (
        <ErpEmptyState icon={FaClipboardList} title="هنوز ردیفی اضافه نشده است" action={{ label: 'رفتن به انتخاب مانده', onClick: () => setStep('remaining'), icon: FaPlus }} />
      ) : (
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
                  <div className="flex flex-wrap gap-2">
                    <ErpBadge tone={quantity > 0 ? 'success' : 'warning'}>{numberFa(quantity)} {unitLabels[line.source.unit] || line.source.unit}</ErpBadge>
                    <ErpButton label="حذف" onClick={() => removeLine(line.key)} tone="danger" variant="soft" />
                  </div>
                </div>
                {line.source.unit === 'meter' && (
                  <div className="mt-4">
                    <ErpSegmentedControl<QuantityMode>
                      value={line.mode}
                      onChange={(value) => updateLine(line.key, { mode: value })}
                      options={[
                        { value: 'linear', label: 'خط راس' },
                        { value: 'direct', label: 'مقدار مستقیم' },
                      ]}
                    />
                  </div>
                )}
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                  {line.mode === 'linear' ? (
                    <>
                      <label><span className={labelClass}>خط راس</span><input className={inputClass} value={line.khatRas} onChange={(event) => updateLine(line.key, { khatRas: event.target.value })} /></label>
                      <label><span className={labelClass}>تعداد</span><input className={inputClass} value={line.pieceCount} onChange={(event) => updateLine(line.key, { pieceCount: event.target.value })} /></label>
                      <label><span className={labelClass}>اضافه</span><input className={inputClass} value={line.plus} onChange={(event) => updateLine(line.key, { plus: event.target.value })} /></label>
                      <label><span className={labelClass}>کسر</span><input className={inputClass} value={line.minus} onChange={(event) => updateLine(line.key, { minus: event.target.value })} /></label>
                    </>
                  ) : (
                    <label><span className={labelClass}>مقدار مستقیم</span><input className={inputClass} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
                  )}
                </div>
              </ErpCard>
            );
          })}
        </div>
      )}
    </ErpSection>
  );

  const renderDriverForm = (value: any, onChange: (patch: any) => void) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {driverFields.map(([field, label]) => (
        <label key={field}>
          <span className={labelClass}>{label}</span>
          <input className={inputClass} value={value[field] || ''} onChange={(event) => onChange({ [field]: event.target.value })} />
        </label>
      ))}
    </div>
  );

  const renderNewDriverWizard = () => (
    <ErpCard className="p-4" tone="info">
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ['identity', 'هویت'],
          ['vehicle', 'خودرو'],
          ['review', 'بازبینی'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setNewDriverStep(id as any)}
            className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${newDriverStep === id ? 'border-[#074747] bg-[#074747] text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {newDriverStep === 'identity' && renderDriverForm(newDriverForm, (patch) => setNewDriverForm((current: any) => ({ ...current, ...patch })))}
      {newDriverStep === 'vehicle' && renderDriverForm(newDriverForm, (patch) => setNewDriverForm((current: any) => ({ ...current, ...patch })))}
      {newDriverStep === 'review' && (
        <div className="space-y-3">
          <p className="font-semibold text-slate-900 dark:text-white">{newDriverForm.firstName || 'نام'} {newDriverForm.lastName || 'نام خانوادگی'}</p>
          <p className="text-sm text-slate-500">{newDriverForm.vehicleType || 'نوع ماشین'} · {newDriverForm.vehiclePlate || 'پلاک'}</p>
          <ErpButton label="ذخیره و انتخاب برای بارگیری" icon={FaCheck} onClick={saveReusableDriver} variant="solid" />
        </div>
      )}
    </ErpCard>
  );

  const renderDriverStep = () => (
    <ErpSection title="راننده و خودرو" description="پیش‌نویس بدون راننده مجاز است؛ نهایی‌سازی به snapshot کامل راننده و خودرو نیاز دارد.">
      <ErpSegmentedControl<DriverMode>
        value={driverMode}
        onChange={(value) => {
          setDriverMode(value);
          if (value === 'temporary') {
            setDriverId('');
            setDriverSnapshot(emptyDriver);
          }
        }}
        options={[
          { value: 'saved', label: 'راننده ثابت', icon: FaUsers },
          { value: 'temporary', label: 'راننده موقت', icon: FaTruck },
          { value: 'new', label: 'راننده جدید', icon: FaUserPlus },
        ]}
      />

      <div className="mt-4 space-y-4">
        {driverMode === 'saved' && (
          <>
            <label>
              <span className={labelClass}>انتخاب راننده ثابت</span>
              <select className={inputClass} value={driverId} onChange={(event) => setDriverId(event.target.value)}>
                <option value="">بدون انتخاب</option>
                {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.firstName} {driver.lastName} · {driver.vehiclePlate}</option>)}
              </select>
            </label>
            {renderDriverForm(driverSnapshot, (patch) => setDriverSnapshot((current: any) => ({ ...current, ...patch })))}
          </>
        )}
        {driverMode === 'temporary' && renderDriverForm(driverSnapshot, (patch) => setDriverSnapshot((current: any) => ({ ...current, ...patch })))}
        {driverMode === 'new' && renderNewDriverWizard()}
      </div>
    </ErpSection>
  );

  const renderReviewStep = () => (
    <ErpSection title="بازبینی و نهایی‌سازی">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <ErpCard className="p-4">
            <p className="text-sm text-slate-500">پروژه</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{draft?.project?.projectName || draft?.project?.address || remaining?.project?.projectName || 'انتخاب نشده'}</p>
            <p className="mt-1 text-xs text-slate-500">{remaining?.project?.companyName || remaining?.project?.customerName || ''}</p>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="text-sm text-slate-500">راننده</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{driverSnapshot.firstName || 'بدون نام'} {driverSnapshot.lastName || ''}</p>
            <p className="mt-1 text-xs text-slate-500">{driverSnapshot.vehicleType || 'نوع ماشین'} · {driverSnapshot.vehiclePlate || 'پلاک'}</p>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">ردیف‌ها</p>
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.key} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <span>{line.source.productSnapshot?.name || 'محصول'} · قرارداد {line.source.contractNumber}</span>
                  <span className="font-semibold text-[#074747] dark:text-teal-200">{numberFa(calculateLineQuantity(line))} {unitLabels[line.source.unit] || line.source.unit}</span>
                </div>
              ))}
              {!lines.length && <p className="text-sm text-slate-500">ردیفی اضافه نشده است.</p>}
            </div>
          </ErpCard>
          <label>
            <span className={labelClass}>یادداشت</span>
            <textarea className={`${inputClass} min-h-28`} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
        <ErpCard className="p-4">
          <p className="font-semibold text-slate-900 dark:text-white">آمادگی نهایی‌سازی</p>
          <div className="mt-3 space-y-2">
            {blockers.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">همه موارد تکمیل است.</p>
            ) : blockers.map((blocker) => (
              <p key={blocker} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-100">{blocker}</p>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            <ErpButton label={saving ? 'در حال ذخیره...' : 'ذخیره پیش‌نویس'} icon={FaSave} onClick={saveDraft} disabled={saving || !draft?.id} tone="neutral" />
            <ErpButton label="ثبت نهایی بارگیری" icon={FaCheck} onClick={finalize} disabled={blockers.length > 0 || saving} tone="success" variant="solid" />
          </div>
        </ErpCard>
      </div>
    </ErpSection>
  );

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="لجستیک"
      title="بارگیری جدید"
      description="یک بارگیری از انتخاب پروژه شروع می‌شود، به‌صورت پیش‌نویس قابل ادامه است، و فقط در بازبینی نهایی کامل بودن ردیف‌ها و راننده را الزام می‌کند."
      backHref="/dashboard/logistics/loadings"
      actions={[
        { label: saving ? 'در حال ذخیره...' : 'ذخیره پیش‌نویس', icon: FaSave, onClick: saveDraft, disabled: saving || !draft?.id, tone: 'neutral' },
      ]}
    >
      {renderStepNav()}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{error}</div>}

      {step === 'project' && renderProjectStep()}
      {step === 'remaining' && renderRemainingStep()}
      {step === 'quantities' && renderQuantitiesStep()}
      {step === 'driver' && renderDriverStep()}
      {step === 'review' && renderReviewStep()}

      <div className="sticky bottom-3 z-10 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex items-center justify-between gap-3">
            <ErpButton label="قبلی" icon={FaArrowRight} onClick={goBack} disabled={step === 'project'} tone="neutral" variant="outline" />
          <div className="text-center text-xs text-slate-500">
            {draft?.loadingNumber ? <span>پیش‌نویس {draft.loadingNumber}</span> : <span>ابتدا پروژه را انتخاب کنید</span>}
          </div>
          {step === 'review' ? (
            <ErpButton label="نهایی‌سازی" icon={FaCheck} onClick={finalize} disabled={blockers.length > 0 || saving} tone="success" variant="solid" />
          ) : (
            <ErpButton label="بعدی" icon={FaArrowLeft} onClick={goNext} disabled={(step === 'project' && !draft?.id) || (step !== 'project' && !draft?.id)} variant="solid" />
          )}
        </div>
      </div>
    </ErpPage>
  );
}
