'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

const activeDriverRequestFrom = (loading: any) => (loading?.driverRequests || []).find((request: any) => ['PENDING_SECURITY', 'DRIVER_ENTERED'].includes(request.status)) || null;
const requestOverrideUnset = Symbol('requestOverrideUnset');

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
  const [driverId, setDriverId] = useState('');
  const [driverSnapshot, setDriverSnapshot] = useState<any>(emptyDriver);
  const [driverRequest, setDriverRequest] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectingProjectId, setSelectingProjectId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedSourceIds = useMemo(() => new Set(lines.map((line) => line.source.contractItemId)), [lines]);

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

  const syncDriverState = (loadingDraft: any, requestOverride: any = requestOverrideUnset) => {
    const request = requestOverride === requestOverrideUnset ? activeDriverRequestFrom(loadingDraft) : requestOverride;
    setDriverRequest(request || null);
    const queueTurn = request?.queueTurn || loadingDraft?.driverQueueTurn;
    setDriverId(queueTurn?.id || '');
    setDriverSnapshot(loadingDraft?.driverSnapshot || request?.loading?.driverSnapshot || emptyDriver);
  };

  const refreshDriverRequest = useCallback(async () => {
    if (!draft?.id) return;
    try {
      const response = await logisticsAPI.getDriverRequest(draft.id);
      if (response.data.success) {
        const request = response.data.data;
        setDriverRequest(request || null);
        setDriverId(request?.queueTurn?.id || '');
        setDriverSnapshot(request?.loading?.driverSnapshot || emptyDriver);
        if (request?.loading?.driverSnapshot) {
          setDraft((current: any) => current ? { ...current, driverSnapshot: request.loading.driverSnapshot, vehiclePairId: request.loading.vehiclePairId } : current);
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'به‌روزرسانی درخواست راننده ناموفق بود.');
    }
  }, [draft?.id]);

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    if (!draft?.id || step !== 'driver') return undefined;
    void refreshDriverRequest();
    const handle = window.setInterval(() => { void refreshDriverRequest(); }, 5000);
    return () => window.clearInterval(handle);
  }, [draft?.id, step, refreshDriverRequest]);

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
        groupKey: line.groupKey,
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

  const requestDriverFromSecurity = async () => {
    if (!draft?.id) return;
    const saved = await saveDraft();
    if (!saved) return;
    setSaving(true);
    setError('');
    try {
      const response = await logisticsAPI.requestDriver(draft.id);
      if (response.data.success) {
        setDriverRequest(response.data.data);
        setMessage('درخواست راننده برای حراست ثبت شد.');
        await refreshDriverRequest();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت درخواست راننده ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const cancelDriverRequest = async () => {
    if (!draft?.id || !driverRequest) return;
    setSaving(true);
    setError('');
    try {
      const response = await logisticsAPI.cancelDriverRequest(draft.id);
      if (response.data.success) {
        const loadingDraft = response.data.data;
        setDraft(loadingDraft);
        syncDriverState(loadingDraft, null);
        setMessage('درخواست راننده لغو شد.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'لغو درخواست راننده ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const hasValidLineQuantities = lines.length > 0 && lines.every((line) => calculateLineQuantity(line) > 0);
  const blockers = useMemo(() => {
    const items: string[] = [];
    if (!draft?.projectId) items.push('پروژه انتخاب نشده است.');
    if (!lines.length) items.push('حداقل یک ردیف بارگیری لازم است.');
    if (lines.some((line) => calculateLineQuantity(line) <= 0)) items.push('مقدار همه ردیف‌ها باید بیشتر از صفر باشد.');
    if (!driverId) items.push('راننده هنوز توسط حراست برای بارگیری وارد نشده است.');
    return items;
  }, [draft, lines, driverId]);

  const canEnterStep = (target: WizardStep) => {
    if (target === 'customer') return true;
    if (target === 'project') return Boolean(selectedCustomer);
    if (target === 'contracts') return Boolean(draft?.id);
    if (target === 'driver') return Boolean(draft?.id && lines.length);
    if (target === 'quantities') return Boolean(draft?.id && lines.length && driverId);
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
    if (step === 'driver' && !driverId) {
      setError('منتظر ورود راننده توسط حراست بمانید.');
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
          <button
            key={item.id}
            type="button"
            disabled={!canEnterStep(item.id)}
            onClick={() => { void navigateToStep(item.id); }}
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

  const renderCustomerStep = () => (
    <ErpSection title="انتخاب مشتری" description="فقط مشتری‌هایی نمایش داده می‌شوند که حداقل یک پروژه با مانده مثبت بارگیری دارند.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
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
          <button
            key={customer.id}
            type="button"
            onClick={() => loadCustomerProjects(customer)}
            className={`rounded-lg border bg-white p-4 text-right shadow-sm transition hover:border-[#074747]/40 dark:bg-slate-900/70 ${
              selectedCustomer?.id === customer.id ? 'border-[#074747]' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{customer.customerName}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {[customer.companyName, customer.brandName, customer.primaryPhone].filter(Boolean).join(' · ') || 'بدون اطلاعات تکمیلی'}
                </p>
                {customer.projectManagerName && (
                  <p className="mt-1 text-xs text-slate-500">مدیر پروژه: {customer.projectManagerName} {customer.projectManagerNumber ? `· ${customer.projectManagerNumber}` : ''}</p>
                )}
              </div>
              <ErpBadge tone="success">{numberFa(customer.loadableProjectCount, 0)} پروژه قابل بارگیری</ErpBadge>
            </div>
          </button>
        ))}
        {!customers.length && <ErpEmptyState icon={FaUser} title="مشتری قابل بارگیری پیدا نشد" />}
      </div>
    </ErpSection>
  );

  const renderProjectStep = () => (
    <ErpSection title="انتخاب پروژه" description="فقط پروژه‌هایی که مانده مثبت بارگیری دارند قابل انتخاب هستند.">
      {selectedCustomer && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
          مشتری انتخاب‌شده: {selectedCustomer.customerName || selectedCustomer.companyName}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {projects.map((project) => (
          <ErpCard key={project.id} interactive className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{project.projectName || project.address}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{[project.city, project.address].filter(Boolean).join(' · ')}</p>
                {(project.projectManagerName || project.projectManagerNumber) && (
                  <p className="mt-1 text-xs text-slate-500">مدیر پروژه: {[project.projectManagerName, project.projectManagerNumber].filter(Boolean).join(' · ')}</p>
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
                    <p className="font-semibold text-slate-900 dark:text-white">قرارداد {contract.contractNumber}</p>
                    <p className="mt-1 text-xs text-slate-500">{numberFa(contract.rows.length, 0)} ردیف قابل بارگیری · {numberFa(selectedCount, 0)} انتخاب‌شده</p>
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
                        <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700">
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
                            <tr key={source.contractItemId} className="border-b border-slate-100 align-top dark:border-slate-800">
                              <td className="px-3 py-4 font-semibold text-slate-900 dark:text-white">{source.productSnapshot?.name || source.groupDisplayName}</td>
                              <td className="px-3 py-4 text-xs leading-6 text-slate-500">{productIdentityParts(source.productSnapshot).join(' · ') || 'بدون مشخصات'}</td>
                              <td className="px-3 py-4">
                                <div className="flex max-w-md flex-wrap gap-1">
                                  {details.length ? details.slice(0, 5).map((detail) => <ErpBadge key={detail} tone="info">{detail}</ErpBadge>) : <span className="text-xs text-slate-400">بدون جزئیات افزوده</span>}
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
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">قرارداد {line.source.contractNumber}</p>
          <p className="mt-1 text-xs text-slate-500">مانده قابل بارگیری: {numberFa(line.source.remainingQuantity)} {line.source.unitLabel}</p>
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
            <label><span className={labelClass}>خط راس</span><input className={inputClass} value={line.khatRas} onChange={(event) => updateLine(line.key, { khatRas: event.target.value })} /></label>
            <label><span className={labelClass}>تعداد</span><input className={inputClass} value={line.pieceCount} onChange={(event) => updateLine(line.key, { pieceCount: event.target.value })} /></label>
            <label><span className={labelClass}>اضافه</span><input className={inputClass} value={line.plus} onChange={(event) => updateLine(line.key, { plus: event.target.value })} /></label>
            <label><span className={labelClass}>کسر</span><input className={inputClass} value={line.minus} onChange={(event) => updateLine(line.key, { minus: event.target.value })} /></label>
          </>
        ) : (
          <label><span className={labelClass}>مقدار مستقیم</span><input className={inputClass} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
        )}
      </div>
      <p className="mt-2 text-xs font-semibold text-[#074747] dark:text-teal-200">
        مقدار محاسبه‌شده: {numberFa(calculateLineQuantity(line))} {unitLabels[line.source.unit] || line.source.unit}
      </p>
    </div>
  );

  const renderQuantitiesStep = () => (
    <ErpSection title="مقداردهی ردیف‌های انتخاب‌شده" description="ردیف‌های مشابه به صورت خلاصه گروهی نمایش داده می‌شوند، اما مقدار هر منبع قراردادی جداگانه وارد می‌شود.">
      {groupedLines.length === 0 ? (
        <ErpEmptyState icon={FaClipboardList} title="هنوز ردیفی انتخاب نشده است" action={{ label: 'رفتن به قراردادها', onClick: () => setStep('contracts'), icon: FaPlus }} />
      ) : (
        <div className="space-y-3">
          {groupedLines.map((group) => {
            const total = group.lines.reduce((sum, line) => sum + calculateLineQuantity(line), 0);
            const remainingTotal = group.lines.reduce((sum, line) => sum + Number(line.source.remainingQuantity || 0), 0);
            const isOpen = expandedGroups[group.key] ?? true;
            return (
              <ErpCard key={group.key} className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{group.displayName}</p>
                    <p className="mt-1 text-xs text-slate-500">{productIdentityParts(group.snapshot).join(' · ') || 'بدون مشخصات'}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ErpBadge tone={total > 0 ? 'success' : 'warning'}>جمع مقدار: {numberFa(total)} {group.unitLabel}</ErpBadge>
                      <ErpBadge tone="neutral">مانده کل: {numberFa(remainingTotal)} {group.unitLabel}</ErpBadge>
                      <ErpBadge tone="info">{numberFa(group.lines.length, 0)} منبع قراردادی</ErpBadge>
                    </div>
                  </div>
                  <ErpButton
                    label={isOpen ? 'بستن جزئیات' : 'جزئیات'}
                    icon={isOpen ? FaChevronUp : FaChevronDown}
                    onClick={() => setExpandedGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                    tone="neutral"
                  />
                </div>
                {isOpen && <div>{group.lines.map((line) => <div key={line.key}>{renderLineQuantityInputs(line)}</div>)}</div>}
              </ErpCard>
            );
          })}
        </div>
      )}
    </ErpSection>
  );

  const renderDriverStep = () => {
    const requestStatus = driverRequest?.status;
    const waiting = requestStatus === 'PENDING_SECURITY';
    const entered = requestStatus === 'DRIVER_ENTERED' || Boolean(driverId);

    return (
      <ErpSection title="درخواست راننده از حراست" description="لجستیک فقط درخواست می‌دهد؛ حراست از صف نوبت‌دهی راننده را با «ورود برای بارگیری» وارد می‌کند. این بخش هر ۵ ثانیه به‌روزرسانی می‌شود.">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              {entered ? 'راننده توسط حراست وارد شد' : waiting ? 'در انتظار حراست' : 'درخواست راننده هنوز ثبت نشده است'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {driverRequest?.requestedAt ? `زمان درخواست: ${new Date(driverRequest.requestedAt).toLocaleString('fa-IR')}` : 'پس از انتخاب قراردادها، درخواست را برای حراست ارسال کنید.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ErpButton label="به‌روزرسانی" icon={FaSearch} variant="soft" onClick={() => { void refreshDriverRequest(); }} />
            {!driverRequest && <ErpButton label="درخواست راننده از حراست" icon={FaTruck} onClick={() => { void requestDriverFromSecurity(); }} disabled={saving} />}
            {driverRequest && !entered && <ErpButton label="لغو درخواست" icon={FaTrash} tone="danger" variant="soft" onClick={() => { void cancelDriverRequest(); }} disabled={saving} />}
            {entered && draft?.status === 'DRAFT' && <ErpButton label="لغو درخواست و آزادسازی راننده" icon={FaTrash} tone="danger" variant="soft" onClick={() => { void cancelDriverRequest(); }} disabled={saving} />}
          </div>
        </div>

        {driverRequest && (
          <ErpCard className="mt-4 p-4" tone={entered ? 'success' : 'warning'}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{entered ? 'وضعیت: راننده وارد شد' : 'وضعیت: در انتظار حراست'}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {driverRequest.requester ? `درخواست‌دهنده: ${driverRequest.requester.firstName || ''} ${driverRequest.requester.lastName || driverRequest.requester.username || ''}` : ''}
                  {driverRequest.fulfilledAt ? ` · ورود: ${new Date(driverRequest.fulfilledAt).toLocaleString('fa-IR')}` : ''}
                </p>
              </div>
              <ErpBadge tone={entered ? 'success' : 'warning'}>{entered ? 'راننده وارد شد' : 'در انتظار حراست'}</ErpBadge>
            </div>
          </ErpCard>
        )}

        {entered && (
          <ErpCard className="mt-4 p-4" tone="info">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {driverFields.map(([field, label]) => (
                <div key={field}>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{driverSnapshot[field] || '—'}</p>
                </div>
              ))}
            </div>
          </ErpCard>
        )}

        {!entered && <ErpEmptyState icon={FaTruck} title="منتظر ورود راننده توسط حراست" description="پس از کلیک حراست روی «ورود برای بارگیری»، راننده اینجا نمایش داده می‌شود و می‌توانید به مرحله مقدار بروید." />}
      </ErpSection>
    );
  };

  const renderReviewStep = () => (
    <ErpSection title="بازبینی و نهایی‌سازی">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <ErpCard className="p-4">
            <p className="text-sm text-slate-500">مشتری و پروژه</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{selectedCustomer?.customerName || remaining?.project?.customerName || 'انتخاب نشده'}</p>
            <p className="mt-1 text-xs text-slate-500">{remaining?.project?.projectName || remaining?.project?.address || draft?.project?.projectName || ''}</p>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="text-sm text-slate-500">راننده</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{driverSnapshot.firstName || 'بدون نام'} {driverSnapshot.lastName || ''}</p>
            <p className="mt-1 text-xs text-slate-500">{driverSnapshot.vehicleType || 'نوع ماشین'} · {driverSnapshot.vehiclePlate || 'پلاک'}</p>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">خلاصه ردیف‌ها</p>
            <div className="space-y-2">
              {groupedLines.map((group) => (
                <div key={group.key} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      {group.displayName}
                      <span className="mt-1 block text-xs text-slate-500">{group.lines.map((line) => `قرارداد ${line.source.contractNumber}: ${numberFa(calculateLineQuantity(line))}`).join(' · ')}</span>
                    </span>
                    <span className="font-semibold text-[#074747] dark:text-teal-200">
                      {numberFa(group.lines.reduce((sum, line) => sum + calculateLineQuantity(line), 0))} {group.unitLabel}
                    </span>
                  </div>
                </div>
              ))}
              {!groupedLines.length && <p className="text-sm text-slate-500">ردیفی اضافه نشده است.</p>}
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
      description="بارگیری از مشتری دارای مانده شروع می‌شود، برای یک پروژه قابل بارگیری پیش‌نویس می‌سازد، ردیف‌های قرارداد را انتخاب می‌کند و مقدار واقعی بارگیری را جداگانه ثبت می‌کند."
      backHref="/dashboard/logistics/loadings"
      actions={[
        { label: saving ? 'در حال ذخیره...' : 'ذخیره پیش‌نویس', icon: FaSave, onClick: saveDraft, disabled: saving || !draft?.id, tone: 'neutral' },
      ]}
    >
      {renderStepNav()}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{error}</div>}

      {step === 'customer' && renderCustomerStep()}
      {step === 'project' && renderProjectStep()}
      {step === 'contracts' && renderContractsStep()}
      {step === 'quantities' && renderQuantitiesStep()}
      {step === 'driver' && renderDriverStep()}
      {step === 'review' && renderReviewStep()}

      <div className="sticky bottom-3 z-10 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex items-center justify-between gap-3">
          <ErpButton label="قبلی" icon={FaArrowRight} onClick={goBack} disabled={step === 'customer' || saving} tone="neutral" variant="outline" />
          <div className="text-center text-xs text-slate-500">
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
