'use client';
import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaChevronDown,
  FaChevronUp,
  FaClipboardList,
  FaEye,
  FaPlus,
  FaSave,
  FaSearch,
  FaTrash,
  FaTruck,
  FaUser,
  FaUsers,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
} from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { inputClass, labelClass, numberFa, unitLabels } from '../../logistics-ui';

type WizardStep = 'customer' | 'project' | 'contracts' | 'driver' | 'quantities' | 'review';
type QuantityMode = 'linear' | 'direct';

type DraftLine = {
  key: string;
  source: any;
  groupKey: string;
  groupDisplayName: string;
  groupSnapshot: any;
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
  { id: 'customer', label: 'مشتری' },
  { id: 'project', label: 'پروژه' },
  { id: 'contracts', label: 'قراردادها' },
  { id: 'driver', label: 'راننده' },
  { id: 'quantities', label: 'مقدار' },
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

const compactValue = (value: any) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return numberFa(value);
  return String(value);
};

const productIdentityParts = (snapshot: any = {}) => [
  snapshot.productType,
  snapshot.width ? `عرض ${compactValue(snapshot.width)}` : '',
  snapshot.thickness ? `ضخامت ${compactValue(snapshot.thickness)}` : '',
  snapshot.length ? `طول ${compactValue(snapshot.length)}${snapshot.lengthUnit || ''}` : '',
  snapshot.squareMeters ? `${compactValue(snapshot.squareMeters)} متر مربع` : '',
  snapshot.quantity ? `مقدار قراردادی ${compactValue(snapshot.quantity)}` : '',
  snapshot.preparedUnit ? `واحد ${snapshot.preparedUnit}` : '',
].filter(Boolean);

const detailNames = (value: any, fallback: string) => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => item?.namePersian || item?.name || item?.title || item?.serviceName || item?.toolName || fallback)
    .filter(Boolean);
};

const productDetailBadges = (snapshot: any = {}) => [
  ...detailNames(snapshot.tools, 'ابزار').map((name) => `ابزار: ${name}`),
  ...detailNames(snapshot.services, 'خدمات').map((name) => `خدمات: ${name}`),
  snapshot.finishing ? `پرداخت: ${snapshot.finishing?.namePersian || snapshot.finishing?.name || snapshot.finishingName || 'انتخاب شده'}` : '',
  snapshot.description ? `توضیح: ${snapshot.description}` : '',
].filter(Boolean);

const sourceWithGroup = (source: any, group: any) => ({
  ...source,
  groupKey: group.groupKey,
  groupDisplayName: group.displayName,
  groupSnapshot: group.productSnapshot,
});

const lineFromSource = (source: any): DraftLine => ({
  key: `${source.contractItemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  source,
  groupKey: source.groupKey || `${source.productId}-${source.contractItemId}`,
  groupDisplayName: source.groupDisplayName || source.productSnapshot?.name || 'محصول',
  groupSnapshot: source.groupSnapshot || source.productSnapshot,
  mode: source.unit === 'meter' ? 'linear' : 'direct',
  quantity: '',
  khatRas: '',
  pieceCount: '',
  plus: '0',
  minus: '0',
  notes: '',
});

const lineFromLoadingLine = (line: any): DraftLine => {
  const sourceSnapshot = line.sourceSnapshot || {};
  const productSnapshot = line.productSnapshot || {};
  const source = {
    contractId: line.sourceContractId,
    contractNumber: sourceSnapshot.contractNumber || line.sourceContract?.contractNumber || '',
    contractItemId: line.sourceContractItemId,
    contractedQuantity: sourceSnapshot.contractedQuantity || line.sourceContractItem?.quantity || 0,
    remainingQuantity: sourceSnapshot.remainingQuantity || line.quantity,
    unit: line.unit,
    unitLabel: unitLabels[line.unit] || line.unit,
    productSnapshot,
    groupKey: sourceSnapshot.groupKey || `${line.productId}-${line.sourceContractItemId}`,
    groupDisplayName: productSnapshot.name || 'محصول',
    groupSnapshot: productSnapshot,
  };

  return {
    key: line.id || `${line.sourceContractItemId}-${Date.now()}`,
    source,
    groupKey: source.groupKey,
    groupDisplayName: source.groupDisplayName,
    groupSnapshot: productSnapshot,
    mode: line.khatRas || line.pieceCount ? 'linear' : 'direct',
    quantity: line.khatRas || line.pieceCount ? '' : String(line.quantity || ''),
    khatRas: line.khatRas ? String(line.khatRas) : '',
    pieceCount: line.pieceCount ? String(line.pieceCount) : '',
    plus: String(line.plus || 0),
    minus: String(line.minus || 0),
    notes: line.notes || '',
  };
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();

export default function NewLoadingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('draftId');

  const [step, setStep] = useState<WizardStep>('customer');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [remaining, setRemaining] = useState<any>(null);
  const [expandedContracts, setExpandedContracts] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driverSearch, setDriverSearch] = useState('');
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);
  const [driverLineInputs, setDriverLineInputs] = useState<Record<string, Record<string, Partial<DraftLine>>>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectingProjectId, setSelectingProjectId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedSourceIds = useMemo(() => new Set(lines.map((line) => line.source.contractItemId)), [lines]);
  const selectedDrivers = useMemo(() => selectedDriverIds.map((id) => drivers.find((driver) => driver.id === id)).filter(Boolean), [drivers, selectedDriverIds]);

  const contracts = useMemo(() => {
    const byContract = new Map<string, any>();
    for (const group of remaining?.groups || []) {
      for (const rawSource of group.sources || []) {
        if (Number(rawSource.remainingQuantity || 0) <= 0) continue;
        const source = sourceWithGroup(rawSource, group);
        if (!byContract.has(source.contractId)) {
          byContract.set(source.contractId, {
            id: source.contractId,
            contractNumber: source.contractNumber,
            contractStatus: source.contractStatus,
            rows: [],
          });
        }
        byContract.get(source.contractId).rows.push(source);
      }
    }
    return Array.from(byContract.values()).sort((a, b) => String(a.contractNumber).localeCompare(String(b.contractNumber)));
  }, [remaining]);

  const groupedLines = useMemo(() => {
    const groups = new Map<string, { key: string; displayName: string; snapshot: any; unit: string; unitLabel: string; lines: DraftLine[] }>();
    for (const line of lines) {
      if (!groups.has(line.groupKey)) {
        groups.set(line.groupKey, {
          key: line.groupKey,
          displayName: line.groupDisplayName,
          snapshot: line.groupSnapshot,
          unit: line.source.unit,
          unitLabel: unitLabels[line.source.unit] || line.source.unit,
          lines: [],
        });
      }
      groups.get(line.groupKey)!.lines.push(line);
    }
    return Array.from(groups.values());
  }, [lines]);

  const filteredDrivers = useMemo(() => {
    const search = normalizeSearch(driverSearch);
    const visible = drivers.filter((driver) => driver.queueStatus === 'ENTERED_LOADING_AREA' || driver.queueStatus === 'RESERVED' || selectedDriverIds.includes(driver.id));
    if (!search) return visible;
    return visible.filter((driver) => [
      driver.firstName,
      driver.lastName,
      driver.phone,
      driver.nationalCode,
      driver.vehiclePlate,
      driver.vehicleType,
      driver.reservedLoading?.loadingNumber,
    ].some((value) => String(value || '').toLowerCase().includes(search)));
  }, [drivers, driverSearch, selectedDriverIds]);

  const loadCustomers = async () => {
    setError('');
    try {
      const response = await logisticsAPI.getLoadableCustomers(customerSearch ? { search: customerSearch } : undefined);
      if (response.data.success) setCustomers(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت مشتری‌های قابل بارگیری ناموفق بود.');
    }
  };

  const loadCustomerProjects = async (customer: any) => {
    setError('');
    setSelectedCustomer(customer);
    setProjects([]);
    setDraft(null);
    setRemaining(null);
    setLines([]);
    try {
      const response = await logisticsAPI.getCustomerProjects(customer.id);
      if (response.data.success) setProjects(response.data.data);
      setStep('project');
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت پروژه‌های قابل بارگیری ناموفق بود.');
    }
  };

  const loadRemaining = async (projectId: string) => {
    const response = await logisticsAPI.getRemaining(projectId);
    if (response.data.success) setRemaining(response.data.data);
  };

  const loadDrivers = async () => {
    const response = await logisticsAPI.getDrivers();
    if (response.data.success) setDrivers(response.data.data);
  };

  const syncDriverState = (loadingDraft: any) => {
    const assignmentIds = (loadingDraft?.driverAssignments || []).map((assignment: any) => assignment.queueTurnId).filter(Boolean);
    setSelectedDriverIds(assignmentIds);
  };

  useEffect(() => {
    loadCustomers();
    loadDrivers();
  }, []);

  useEffect(() => {
    if (!draft?.id || step !== 'driver') return undefined;
    void loadDrivers();
    const handle = window.setInterval(() => { void loadDrivers(); }, 5000);
    return () => window.clearInterval(handle);
  }, [draft?.id, step]);

  useEffect(() => {
    if (!draftId) return;
    const loadDraft = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await logisticsAPI.getLoading(draftId);
        if (!response.data.success) return;
        const loadingDraft = response.data.data;
        setDraft(loadingDraft);
        setSelectedCustomer({
          id: loadingDraft.customerId,
          customerName: `${loadingDraft.customer?.firstName || ''} ${loadingDraft.customer?.lastName || ''}`.trim(),
          companyName: loadingDraft.customer?.companyName,
        });
        setProjects([{
          id: loadingDraft.projectId,
          projectName: loadingDraft.project?.projectName,
          address: loadingDraft.project?.address,
          city: loadingDraft.project?.city,
          customerId: loadingDraft.customerId,
        }]);
        setNotes(loadingDraft.notes || '');
        syncDriverState(loadingDraft);
        setLines((loadingDraft.lines || []).map(lineFromLoadingLine));
        await loadRemaining(loadingDraft.projectId);
        setMessage('پیش‌نویس بارگیری برای ویرایش باز شد.');
        setStep((loadingDraft.lines || []).length ? (loadingDraft.vehiclePairId ? 'quantities' : 'driver') : 'contracts');
      } catch (err: any) {
        setError(err.response?.data?.error || 'دریافت پیش‌نویس ناموفق بود.');
      } finally {
        setLoading(false);
      }
    };
    loadDraft();
  }, [draftId]);

  const selectProject = async (projectId: string, forceNew = false) => {
    setError('');
    setMessage('');
    setSelectingProjectId(projectId);
    try {
      const response = await logisticsAPI.createOrResumeDraft(projectId, { forceNew });
      if (!response.data.success) return;
      const loadingDraft = response.data.data;
      setDraft(loadingDraft);
      setNotes(loadingDraft.notes || '');
      syncDriverState(loadingDraft);
      setLines((loadingDraft.lines || []).map(lineFromLoadingLine));
      await loadRemaining(projectId);
      setMessage(response.data.resumed ? 'پیش‌نویس فعال این پروژه ادامه داده شد.' : 'پیش‌نویس بارگیری ساخته شد.');
      setStep('contracts');
    } catch (err: any) {
      setError(err.response?.data?.error || 'ساخت پیش‌نویس ناموفق بود.');
    } finally {
      setSelectingProjectId('');
    }
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const toggleSource = (source: any) => {
    if (selectedSourceIds.has(source.contractItemId)) {
      setLines((current) => current.filter((line) => line.source.contractItemId !== source.contractItemId));
      return;
    }
    setLines((current) => [...current, lineFromSource(source)]);
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

  const lineWithDriverInput = (driverIdValue: string, line: DraftLine): DraftLine => ({
    ...line,
    ...(driverLineInputs[driverIdValue]?.[line.key] || {}),
  });

  const calculateDriverLineQuantity = (driverIdValue: string, line: DraftLine) => calculateLineQuantity(lineWithDriverInput(driverIdValue, line));

  const calculateTotalLineQuantity = (line: DraftLine) => selectedDriverIds.reduce((sum, id) => sum + calculateDriverLineQuantity(id, line), 0);

  const driverCarriesAny = (driverIdValue: string) => lines.some((line) => calculateDriverLineQuantity(driverIdValue, line) > 0);

  const updateDriverLineInput = (driverIdValue: string, lineKey: string, patch: Partial<DraftLine>) => {
    setDriverLineInputs((current) => ({
      ...current,
      [driverIdValue]: {
        ...(current[driverIdValue] || {}),
        [lineKey]: { ...(current[driverIdValue]?.[lineKey] || {}), ...patch },
      },
    }));
  };

  const fillLineWithRemaining = (line: DraftLine) => {
    updateLine(line.key, {
      mode: 'direct',
      quantity: String(line.source.remainingQuantity || ''),
      khatRas: '',
      pieceCount: '',
      plus: '0',
      minus: '0',
    });
  };

  const buildPayload = () => ({
    projectId: draft?.projectId,
    notes,
    driverTurnIds: selectedDriverIds,
    driverAllocations: selectedDriverIds.map((queueTurnId) => ({
      queueTurnId,
      lines: lines.map((line) => {
        const driverLine = lineWithDriverInput(queueTurnId, line);
        return {
          sourceContractItemId: line.source.contractItemId,
          unit: line.source.unit,
          quantity: calculateLineQuantity(driverLine),
          khatRas: driverLine.mode === 'linear' ? driverLine.khatRas : null,
          pieceCount: driverLine.mode === 'linear' ? driverLine.pieceCount : null,
          plus: driverLine.mode === 'linear' ? driverLine.plus : 0,
          minus: driverLine.mode === 'linear' ? driverLine.minus : 0,
          productSnapshot: line.source.productSnapshot,
          sourceSnapshot: {
            contractId: line.source.contractId,
            contractNumber: line.source.contractNumber,
            contractItemId: line.source.contractItemId,
            contractedQuantity: line.source.contractedQuantity,
            remainingQuantity: line.source.remainingQuantity,
            groupKey: line.groupKey,
          },
          notes: driverLine.notes,
        };
      }),
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

  const toggleSelectedDriver = (driver: any) => {
    const selected = selectedDriverIds.includes(driver.id);
    if (!selected && driver.queueStatus === 'RESERVED' && driver.reservedLoading?.id !== draft?.id) return;
    setSelectedDriverIds((current) => selected ? current.filter((id) => id !== driver.id) : [...current, driver.id]);
    if (selected) {
      setDriverLineInputs((current) => {
        const next = { ...current };
        delete next[driver.id];
        return next;
      });
    }
  };

  const hasValidLineQuantities = lines.length > 0 && selectedDriverIds.length > 0 && lines.every((line) => calculateTotalLineQuantity(line) > 0) && selectedDriverIds.every((id) => driverCarriesAny(id));
  const blockers = useMemo(() => {
    const items: string[] = [];
    if (!draft?.projectId) items.push('پروژه انتخاب نشده است.');
    if (!lines.length) items.push('حداقل یک ردیف بارگیری لازم است.');
    if (!selectedDriverIds.length) items.push('حداقل یک راننده وارد محوطه بارگیری باید انتخاب شود.');
    if (selectedDriverIds.length && lines.some((line) => calculateTotalLineQuantity(line) <= 0)) items.push('جمع مقدار هر ردیف بین رانندگان باید بیشتر از صفر باشد.');
    if (selectedDriverIds.some((id) => !driverCarriesAny(id))) items.push('هر راننده انتخاب‌شده باید حداقل یک مقدار مثبت حمل کند.');
    return items;
  }, [draft, lines, selectedDriverIds, driverLineInputs]);

  const canEnterStep = (target: WizardStep) => {
    if (target === 'customer') return true;
    if (target === 'project') return Boolean(selectedCustomer);
    if (target === 'contracts') return Boolean(draft?.id);
    if (target === 'driver') return Boolean(draft?.id && lines.length);
    if (target === 'quantities') return Boolean(draft?.id && lines.length && selectedDriverIds.length);
    return Boolean(draft?.id);
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
    if (step === 'customer' && !selectedCustomer) {
      setError('ابتدا مشتری دارای مانده بارگیری را انتخاب کنید.');
      return;
    }
    if (step === 'project' && !draft?.id) {
      setError('ابتدا پروژه را انتخاب کنید.');
      return;
    }
    if (step === 'contracts' && !lines.length) {
      setError('حداقل یک ردیف از قراردادها را انتخاب کنید.');
      return;
    }
    if (step === 'quantities' && !hasValidLineQuantities) {
      setError('مقدار همه ردیف‌ها باید بیشتر از صفر باشد.');
      return;
    }
    if (step === 'driver' && !selectedDriverIds.length) {
      setError('حداقل یک راننده وارد محوطه بارگیری را انتخاب کنید.');
      return;
    }
    setError('');
    if (draft?.id && step !== 'customer' && step !== 'project') {
      const saved = await saveDraft();
      if (!saved) return;
    }
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.min(index + 1, steps.length - 1)].id);
  };

  const navigateToStep = async (target: WizardStep) => {
    if (target === step || !canEnterStep(target)) return;
    if (draft?.id && step !== 'customer' && step !== 'project') {
      const saved = await saveDraft();
      if (!saved) return;
    }
    setStep(target);
  };

  const goBack = async () => {
    if (draft?.id && step !== 'customer' && step !== 'project') {
      await saveDraft();
    }
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.max(index - 1, 0)].id);
  };

  const renderStepNav = () => (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {steps.map((item, index) => {
        const active = item.id === step;
        const done = steps.findIndex((candidate) => candidate.id === step) > index;
        return (
          <ErpPressable
            key={item.id}
            type="button"
            disabled={!canEnterStep(item.id)}
            onClick={() => { void navigateToStep(item.id); }}
            className={`min-h-12 rounded-lg border px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-[var(--sds-accent)] bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]'
                : done
                  ? 'border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] text-[var(--sds-success)] dark:border-[var(--sds-success-border)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]'
                  : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-muted)]'
            }`}
          >
            {item.label}
          </ErpPressable>
        );
      })}
    </div>
  );

  const renderCustomerStep = () => (
    <ErpSection title="انتخاب مشتری" description="فقط مشتری‌هایی نمایش داده می‌شوند که حداقل یک پروژه با مانده مثبت بارگیری دارند.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <ErpInput
          className={inputClass}
          value={customerSearch}
          onChange={(event) => setCustomerSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') loadCustomers(); }}
          placeholder="جستجوی نام، شرکت، تلفن، کد ملی، مدیر پروژه یا پروژه"
        />
        <ErpButton label="جستجو" icon={FaSearch} onClick={loadCustomers} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {customers.map((customer) => (
          <ErpPressable
            key={customer.id}
            type="button"
            onClick={() => loadCustomerProjects(customer)}
            className={`rounded-lg border bg-[var(--sds-surface-raised)] p-4 text-right shadow-sm transition hover:border-[var(--sds-accent)]/40 dark:bg-[var(--sds-surface-raised)] ${
              selectedCustomer?.id === customer.id ? 'border-[var(--sds-accent)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{customer.customerName}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)]">
                  {[customer.companyName, customer.brandName, customer.primaryPhone].filter(Boolean).join(' · ') || 'بدون اطلاعات تکمیلی'}
                </p>
                {customer.projectManagerName && (
                  <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">مدیر پروژه: {customer.projectManagerName} {customer.projectManagerNumber ? `· ${customer.projectManagerNumber}` : ''}</p>
                )}
              </div>
              <ErpBadge tone="success">{numberFa(customer.loadableProjectCount, 0)} پروژه قابل بارگیری</ErpBadge>
            </div>
          </ErpPressable>
        ))}
        {!customers.length && <ErpEmptyState icon={FaUser} title="مشتری قابل بارگیری پیدا نشد" />}
      </div>
    </ErpSection>
  );

  const renderProjectStep = () => (
    <ErpSection title="انتخاب پروژه" description="فقط پروژه‌هایی که مانده مثبت بارگیری دارند قابل انتخاب هستند.">
      {selectedCustomer && (
        <div className="mb-4 rounded-lg border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-3 text-sm font-semibold text-[var(--sds-success)] dark:border-[var(--sds-success-border)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">
          مشتری انتخاب‌شده: {selectedCustomer.customerName || selectedCustomer.companyName}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {projects.map((project) => (
          <ErpCard key={project.id} interactive className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{project.projectName || project.address}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)]">{[project.city, project.address].filter(Boolean).join(' · ')}</p>
                {(project.projectManagerName || project.projectManagerNumber) && (
                  <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">مدیر پروژه: {[project.projectManagerName, project.projectManagerNumber].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <ErpBadge tone="success">{numberFa(project.remainingCount, 0)} گروه مانده</ErpBadge>
                <ErpButton
                  label={selectingProjectId === project.id ? 'در حال انتخاب...' : 'انتخاب'}
                  icon={FaTruck}
                  onClick={() => selectProject(project.id)}
                  disabled={Boolean(selectingProjectId)}
                  variant="solid"
                />
              </div>
            </div>
          </ErpCard>
        ))}
        {!projects.length && <ErpEmptyState icon={FaTruck} title="این مشتری پروژه قابل بارگیری ندارد" />}
      </div>
    </ErpSection>
  );

  const renderContractsStep = () => (
    <ErpSection title="انتخاب ردیف‌های قرارداد" description="قرارداد را باز کنید، جزئیات محصول را ببینید، و فقط ردیف‌های کاندید بارگیری را انتخاب کنید. مقداردهی در مرحله بعد انجام می‌شود.">
      {!remaining ? (
        <ErpEmptyState icon={FaClipboardList} title="ابتدا پروژه را انتخاب کنید" />
      ) : contracts.length === 0 ? (
        <ErpEmptyState icon={FaClipboardList} title="قرارداد قابل بارگیری برای این پروژه وجود ندارد" />
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const isOpen = expandedContracts[contract.id] ?? true;
            const selectedCount = contract.rows.filter((row: any) => selectedSourceIds.has(row.contractItemId)).length;
            return (
              <ErpCard key={contract.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">قرارداد {contract.contractNumber}</p>
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{numberFa(contract.rows.length, 0)} ردیف قابل بارگیری · {numberFa(selectedCount, 0)} انتخاب‌شده</p>
                  </div>
                  <ErpButton
                    label={isOpen ? 'بستن جزئیات' : 'مشاهده محصولات'}
                    icon={isOpen ? FaChevronUp : FaEye}
                    onClick={() => setExpandedContracts((current) => ({ ...current, [contract.id]: !isOpen }))}
                    tone="neutral"
                  />
                </div>
                {isOpen && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead>
                        <tr className="border-b border-[var(--sds-border-default)] text-xs text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)]">
                          <th className="px-3 py-3 text-right">محصول</th>
                          <th className="px-3 py-3 text-right">مشخصات</th>
                          <th className="px-3 py-3 text-right">جزئیات</th>
                          <th className="px-3 py-3 text-center">مانده</th>
                          <th className="px-3 py-3 text-left">انتخاب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contract.rows.map((source: any) => {
                          const selected = selectedSourceIds.has(source.contractItemId);
                          const details = productDetailBadges(source.productSnapshot);
                          return (
                            <tr key={source.contractItemId} className="border-b border-[var(--sds-border-default)] align-top dark:border-[var(--sds-border-strong)]">
                              <td className="px-3 py-4 font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{source.productSnapshot?.name || source.groupDisplayName}</td>
                              <td className="px-3 py-4 text-xs leading-6 text-[var(--sds-text-secondary)]">{productIdentityParts(source.productSnapshot).join(' · ') || 'بدون مشخصات'}</td>
                              <td className="px-3 py-4">
                                <div className="flex max-w-md flex-wrap gap-1">
                                  {details.length ? details.slice(0, 5).map((detail) => <ErpBadge key={detail} tone="info">{detail}</ErpBadge>) : <span className="text-xs text-[var(--sds-text-muted)]">بدون جزئیات افزوده</span>}
                                </div>
                              </td>
                              <td className="px-3 py-4 text-center">
                                <ErpBadge tone="success">{numberFa(source.remainingQuantity)} {source.unitLabel}</ErpBadge>
                              </td>
                              <td className="px-3 py-4 text-left">
                                <ErpButton
                                  label={selected ? 'حذف از انتخاب' : 'انتخاب'}
                                  icon={selected ? FaTrash : FaPlus}
                                  onClick={() => toggleSource(source)}
                                  tone={selected ? 'danger' : 'primary'}
                                  variant={selected ? 'soft' : 'solid'}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </ErpCard>
            );
          })}
        </div>
      )}
    </ErpSection>
  );

  const renderLineQuantityInputs = (line: DraftLine) => (
    <div className="mt-3 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">قرارداد {line.source.contractNumber}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">مانده قابل بارگیری: {numberFa(line.source.remainingQuantity)} {line.source.unitLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ErpButton label="پر کردن با کل مانده" onClick={() => fillLineWithRemaining(line)} tone="neutral" variant="soft" />
          <ErpButton label="حذف" icon={FaTrash} onClick={() => removeLine(line.key)} tone="danger" variant="soft" />
        </div>
      </div>
      {line.source.unit === 'meter' && (
        <div className="mt-3">
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
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        {line.mode === 'linear' ? (
          <>
            <label><span className={labelClass}>خط راس</span><ErpInput className={inputClass} value={line.khatRas} onChange={(event) => updateLine(line.key, { khatRas: event.target.value })} /></label>
            <label><span className={labelClass}>تعداد</span><ErpInput className={inputClass} value={line.pieceCount} onChange={(event) => updateLine(line.key, { pieceCount: event.target.value })} /></label>
            <label><span className={labelClass}>اضافه</span><ErpInput className={inputClass} value={line.plus} onChange={(event) => updateLine(line.key, { plus: event.target.value })} /></label>
            <label><span className={labelClass}>کسر</span><ErpInput className={inputClass} value={line.minus} onChange={(event) => updateLine(line.key, { minus: event.target.value })} /></label>
          </>
        ) : (
          <label><span className={labelClass}>مقدار مستقیم</span><ErpInput className={inputClass} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
        )}
      </div>
      <p className="mt-2 text-xs font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
        مقدار محاسبه‌شده: {numberFa(calculateLineQuantity(line))} {unitLabels[line.source.unit] || line.source.unit}
      </p>
    </div>
  );

  const renderDriverLineQuantityInputs = (driver: any, line: DraftLine) => {
    const driverLine = lineWithDriverInput(driver.id, line);
    const update = (patch: Partial<DraftLine>) => updateDriverLineInput(driver.id, line.key, patch);
    return (
      <div className="mt-3 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">قرارداد {line.source.contractNumber}</p>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">مانده قابل بارگیری: {numberFa(line.source.remainingQuantity)} {line.source.unitLabel}</p>
          </div>
          <ErpBadge tone={calculateDriverLineQuantity(driver.id, line) > 0 ? 'success' : 'neutral'}>
            مقدار این راننده: {numberFa(calculateDriverLineQuantity(driver.id, line))} {unitLabels[line.source.unit] || line.source.unit}
          </ErpBadge>
        </div>
        {line.source.unit === 'meter' && (
          <div className="mt-3">
            <ErpSegmentedControl<QuantityMode>
              value={driverLine.mode}
              onChange={(value) => update({ mode: value })}
              options={[
                { value: 'linear', label: 'خط راس' },
                { value: 'direct', label: 'مقدار مستقیم' },
              ]}
            />
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          {driverLine.mode === 'linear' ? (
            <>
              <label><span className={labelClass}>خط راس</span><ErpInput className={inputClass} value={driverLine.khatRas} onChange={(event) => update({ khatRas: event.target.value })} /></label>
              <label><span className={labelClass}>تعداد</span><ErpInput className={inputClass} value={driverLine.pieceCount} onChange={(event) => update({ pieceCount: event.target.value })} /></label>
              <label><span className={labelClass}>اضافه</span><ErpInput className={inputClass} value={driverLine.plus} onChange={(event) => update({ plus: event.target.value })} /></label>
              <label><span className={labelClass}>کسر</span><ErpInput className={inputClass} value={driverLine.minus} onChange={(event) => update({ minus: event.target.value })} /></label>
            </>
          ) : (
            <label><span className={labelClass}>مقدار مستقیم</span><ErpInput className={inputClass} value={driverLine.quantity} onChange={(event) => update({ quantity: event.target.value })} /></label>
          )}
        </div>
      </div>
    );
  };

  const renderQuantitiesStep = () => (
    <ErpSection title="مقداردهی بر اساس راننده" description="برای هر راننده مشخص کنید چه مقدار از هر ردیف را حمل می‌کند. خالی یا صفر یعنی آن راننده آن ردیف را حمل نمی‌کند.">
      {groupedLines.length === 0 ? (
        <ErpEmptyState icon={FaClipboardList} title="هنوز ردیفی انتخاب نشده است" action={{ label: 'رفتن به قراردادها', onClick: () => setStep('contracts'), icon: FaPlus }} />
      ) : selectedDrivers.length === 0 ? (
        <ErpEmptyState icon={FaTruck} title="راننده‌ای انتخاب نشده است" action={{ label: 'رفتن به راننده', onClick: () => setStep('driver'), icon: FaTruck }} />
      ) : (
        <div className="space-y-4">
          {selectedDrivers.map((driver) => (
            <ErpCard key={driver.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{driver.firstName} {driver.lastName}</p>
                  <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{driver.vehiclePlate} · {driver.vehicleType}</p>
                </div>
                <ErpBadge tone={driverCarriesAny(driver.id) ? 'success' : 'warning'}>{driverCarriesAny(driver.id) ? 'دارای مقدار' : 'بدون مقدار'}</ErpBadge>
              </div>
              <div className="mt-3 space-y-3">
                {groupedLines.map((group) => (
                  <div key={`${driver.id}-${group.key}`} className="rounded-xl border border-[var(--sds-border-default)] p-3 dark:border-[var(--sds-border-strong)]">
                    <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{group.displayName}</p>
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{productIdentityParts(group.snapshot).join(' · ') || 'بدون مشخصات'}</p>
                    {group.lines.map((line) => <div key={`${driver.id}-${line.key}`}>{renderDriverLineQuantityInputs(driver, line)}</div>)}
                  </div>
                ))}
              </div>
            </ErpCard>
          ))}
          <ErpCard className="p-4" tone="info">
            <p className="mb-3 font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">جمع ردیف‌ها</p>
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--sds-surface-raised)] p-3 text-sm dark:bg-[var(--sds-surface-raised)]">
                  <span>قرارداد {line.source.contractNumber} · {line.groupDisplayName}</span>
                  <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{numberFa(calculateTotalLineQuantity(line))} {unitLabels[line.source.unit] || line.source.unit}</span>
                </div>
              ))}
            </div>
          </ErpCard>
        </div>
      )}
    </ErpSection>
  );

  const renderDriverStep = () => (
    <ErpSection title="انتخاب رانندگان آماده بارگیری" description="فقط رانندگانی نمایش داده می‌شوند که گارد با «ورود برای بارگیری» وارد محوطه بارگیری کرده است. می‌توانید چند راننده انتخاب کنید.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <ErpInput
          className={inputClass}
          value={driverSearch}
          onChange={(event) => setDriverSearch(event.target.value)}
          placeholder="جستجوی راننده، موبایل، کد ملی، پلاک یا نوع خودرو"
        />
        <ErpButton label="به‌روزرسانی" icon={FaSearch} variant="soft" onClick={() => { void loadDrivers(); }} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filteredDrivers.map((driver) => {
          const selected = selectedDriverIds.includes(driver.id);
          const reservedForOther = driver.queueStatus === 'RESERVED' && driver.reservedLoading?.id !== draft?.id && !selected;
          return (
            <ErpPressable
              key={driver.id}
              type="button"
              onClick={() => toggleSelectedDriver(driver)}
              disabled={reservedForOther}
              className={`rounded-lg border bg-[var(--sds-surface-raised)] p-4 text-right shadow-sm transition hover:border-[var(--sds-accent)]/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[var(--sds-surface-raised)] ${
                selected ? 'border-[var(--sds-accent)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{driver.firstName} {driver.lastName}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)]">{[driver.vehiclePlate, driver.vehicleType, driver.phone, driver.nationalCode].filter(Boolean).join(' · ')}</p>
                  {driver.enteredLoadingAreaAt && <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">ورود برای بارگیری: {new Date(driver.enteredLoadingAreaAt).toLocaleString('fa-IR')}</p>}
                </div>
                <ErpBadge tone={selected ? 'success' : reservedForOther ? 'warning' : 'neutral'}>
                  {selected ? 'انتخاب شده' : reservedForOther ? `رزرو شده برای ${driver.reservedLoading?.loadingNumber || 'بارگیری دیگر'}` : 'آماده بارگیری'}
                </ErpBadge>
              </div>
            </ErpPressable>
          );
        })}
        {!filteredDrivers.length && <ErpEmptyState icon={FaUsers} title="راننده آماده بارگیری وجود ندارد" description="گارد باید از نوبت‌دهی روی «ورود برای بارگیری» کلیک کند." />}
      </div>
      {selectedDrivers.length > 0 && (
        <ErpCard className="mt-4 p-4" tone="info">
          <p className="mb-3 font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">رانندگان انتخاب‌شده</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {selectedDrivers.map((driver) => (
              <div key={driver.id} className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 text-sm dark:bg-[var(--sds-surface-raised)]">
                <span className="font-semibold">{driver.firstName} {driver.lastName}</span>
                <span className="block text-xs text-[var(--sds-text-secondary)]">{driver.vehiclePlate} · {driver.vehicleType}</span>
              </div>
            ))}
          </div>
        </ErpCard>
      )}
    </ErpSection>
  );

  const renderReviewStep = () => (
    <ErpSection title="بازبینی و نهایی‌سازی">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <ErpCard className="p-4">
            <p className="text-sm text-[var(--sds-text-secondary)]">مشتری و پروژه</p>
            <p className="mt-1 font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{selectedCustomer?.customerName || remaining?.project?.customerName || 'انتخاب نشده'}</p>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{remaining?.project?.projectName || remaining?.project?.address || draft?.project?.projectName || ''}</p>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="text-sm text-[var(--sds-text-secondary)]">رانندگان</p>
            <div className="mt-2 space-y-2">
              {selectedDrivers.map((driver) => (
                <div key={driver.id} className="rounded-lg bg-[var(--sds-surface-subtle)] p-2 text-sm dark:bg-[var(--sds-surface-raised)]">
                  <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{driver.firstName} {driver.lastName}</span>
                  <span className="block text-xs text-[var(--sds-text-secondary)]">{driver.vehicleType} · {driver.vehiclePlate}</span>
                </div>
              ))}
              {!selectedDrivers.length && <p className="text-sm text-[var(--sds-text-secondary)]">انتخاب نشده</p>}
            </div>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="mb-3 text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">خلاصه ردیف‌ها</p>
            <div className="space-y-2">
              {groupedLines.map((group) => (
                <div key={group.key} className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 text-sm dark:bg-[var(--sds-surface-raised)]">
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      {group.displayName}
                      <span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{group.lines.map((line) => `قرارداد ${line.source.contractNumber}: ${numberFa(calculateTotalLineQuantity(line))}`).join(' · ')}</span>
                    </span>
                    <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                      {numberFa(group.lines.reduce((sum, line) => sum + calculateTotalLineQuantity(line), 0))} {group.unitLabel}
                    </span>
                  </div>
                </div>
              ))}
              {!groupedLines.length && <p className="text-sm text-[var(--sds-text-secondary)]">ردیفی اضافه نشده است.</p>}
            </div>
          </ErpCard>
          <label>
            <span className={labelClass}>یادداشت</span>
            <ErpTextarea className={`${inputClass} min-h-28`} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
        <ErpCard className="p-4">
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">آمادگی نهایی‌سازی</p>
          <div className="mt-3 space-y-2">
            {blockers.length === 0 ? (
              <p className="rounded-lg bg-[var(--sds-success-surface)] p-3 text-sm font-semibold text-[var(--sds-success)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">همه موارد تکمیل است.</p>
            ) : blockers.map((blocker) => (
              <p key={blocker} className="rounded-lg bg-[var(--sds-warning-surface)] p-3 text-sm text-[var(--sds-warning)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">{blocker}</p>
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
      description="بارگیری از مشتری دارای مانده شروع می‌شود، برای یک پروژه قابل بارگیری پیش‌نویس می‌سازد، ردیف‌های قرارداد را انتخاب می‌کند و مقدار واقعی بارگیری را جداگانه ثبت می‌کند."
      backHref="/dashboard/logistics/loadings"
      actions={[
        { label: saving ? 'در حال ذخیره...' : 'ذخیره پیش‌نویس', icon: FaSave, onClick: saveDraft, disabled: saving || !draft?.id, tone: 'neutral' },
      ]}
    >
      {renderStepNav()}
      {message && <div className="rounded-lg border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-3 text-sm font-semibold text-[var(--sds-success)] dark:border-[var(--sds-success-border)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">{message}</div>}
      {error && <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-3 text-sm font-semibold text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">{error}</div>}

      {step === 'customer' && renderCustomerStep()}
      {step === 'project' && renderProjectStep()}
      {step === 'contracts' && renderContractsStep()}
      {step === 'quantities' && renderQuantitiesStep()}
      {step === 'driver' && renderDriverStep()}
      {step === 'review' && renderReviewStep()}

      <div className="sticky bottom-3 z-10 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-3 shadow-lg backdrop-blur dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
        <div className="flex items-center justify-between gap-3">
          <ErpButton label="قبلی" icon={FaArrowRight} onClick={goBack} disabled={step === 'customer' || saving} tone="neutral" variant="outline" />
          <div className="text-center text-xs text-[var(--sds-text-secondary)]">
            {draft?.loadingNumber ? <span>پیش‌نویس {draft.loadingNumber}</span> : <span>ابتدا مشتری و پروژه قابل بارگیری را انتخاب کنید</span>}
          </div>
          {step === 'review' ? (
            <ErpButton label="نهایی‌سازی" icon={FaCheck} onClick={finalize} disabled={blockers.length > 0 || saving} tone="success" variant="solid" />
          ) : (
            <ErpButton label="بعدی" icon={FaArrowLeft} onClick={goNext} disabled={saving} variant="solid" />
          )}
        </div>
      </div>
    </ErpPage>
  );
}
