'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaArrowRight, FaCheck, FaClipboardList, FaPlus, FaSave, FaSearch, FaTruck, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { inputClass, labelClass, numberFa, unitLabels } from '../../logistics-ui';

type WizardStep = 'project' | 'remaining' | 'quantities' | 'driver' | 'review';
type QuantityMode = 'linear' | 'direct';
type DriverMode = 'saved';

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
  { id: 'project', label: 'Ù¾Ø±ÙˆÚ˜Ù‡' },
  { id: 'remaining', label: 'Ù…Ø§Ù†Ø¯Ù‡' },
  { id: 'quantities', label: 'Ù…Ù‚Ø¯Ø§Ø±' },
  { id: 'driver', label: 'Ø±Ø§Ù†Ù†Ø¯Ù‡' },
  { id: 'review', label: 'Ø¨Ø§Ø²Ø¨ÛŒÙ†ÛŒ' },
];

const driverFields = [
  ['firstName', 'Ù†Ø§Ù…'],
  ['lastName', 'Ù†Ø§Ù… Ø®Ø§Ù†ÙˆØ§Ø¯Ú¯ÛŒ'],
  ['vehiclePlate', 'Ø´Ù…Ø§Ø±Ù‡ Ù¾Ù„Ø§Ú©'],
  ['vehicleType', 'Ù†ÙˆØ¹ Ù…Ø§Ø´ÛŒÙ†'],
  ['phone', 'Ø´Ù…Ø§Ø±Ù‡ ØªÙ…Ø§Ø³'],
  ['nationalCode', 'Ú©Ø¯ Ù…Ù„ÛŒ'],
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
        vehiclePairId: selectedDriver.id,
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
      setDriverId(loadingDraft.vehiclePairId || loadingDraft.driverSnapshot?.vehiclePairId || '');
      setDriverSnapshot(loadingDraft.driverSnapshot || emptyDriver);
      setLines((loadingDraft.lines || []).map(lineFromLoadingLine));
      await loadRemaining(projectId);
      setMessage(response.data.resumed ? 'Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ ÙØ¹Ø§Ù„ Ø§ÛŒÙ† Ù¾Ø±ÙˆÚ˜Ù‡ Ø§Ø¯Ø§Ù…Ù‡ Ø¯Ø§Ø¯Ù‡ Ø´Ø¯.' : 'Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø³Ø§Ø®ØªÙ‡ Ø´Ø¯.');
      setStep('remaining');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ø³Ø§Ø®Øª Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ Ù†Ø§Ù…ÙˆÙÙ‚ Ø¨ÙˆØ¯.');
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
    setMessage('Ø±Ø¯ÛŒÙ Ø¨Ù‡ Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ Ø§Ø¶Ø§ÙÙ‡ Ø´Ø¯.');
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
      setError('Ø¨Ø±Ø§ÛŒ Ø­Ø¯Ø§Ù‚Ù„ ÛŒÚ© Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯ Ù…Ù‚Ø¯Ø§Ø± ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯.');
      return;
    }

    setLines((current) => [...current, ...added]);
    setSelectedGroupKey('');
    setAllocations({});
    setError('');
    setMessage('ØªØ®ØµÛŒØµ Ù…Ù†Ø¨Ø¹ Ø¨Ù‡ Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ Ø§Ø¶Ø§ÙÙ‡ Ø´Ø¯.');
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
        setMessage('Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ Ø°Ø®ÛŒØ±Ù‡ Ø´Ø¯.');
        return true;
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ø°Ø®ÛŒØ±Ù‡ Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ Ù†Ø§Ù…ÙˆÙÙ‚ Ø¨ÙˆØ¯.');
    } finally {
      setSaving(false);
    }
    return false;
  };

  const blockers = useMemo(() => {
    const items: string[] = [];
    if (!draft?.projectId) items.push('Ù¾Ø±ÙˆÚ˜Ù‡ Ø§Ù†ØªØ®Ø§Ø¨ Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.');
    if (!lines.length) items.push('Ø­Ø¯Ø§Ù‚Ù„ ÛŒÚ© Ø±Ø¯ÛŒÙ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ù„Ø§Ø²Ù… Ø§Ø³Øª.');
    if (lines.some((line) => calculateLineQuantity(line) <= 0)) items.push('Ù…Ù‚Ø¯Ø§Ø± Ù‡Ù…Ù‡ Ø±Ø¯ÛŒÙâ€ŒÙ‡Ø§ Ø¨Ø§ÛŒØ¯ Ø¨ÛŒØ´ØªØ± Ø§Ø² ØµÙØ± Ø¨Ø§Ø´Ø¯.');
    const requiredDriverFields = ['firstName', 'lastName', 'vehiclePlate', 'vehicleType', 'phone', 'nationalCode'];
    if (requiredDriverFields.some((field) => !String(driverSnapshot?.[field] || '').trim())) {
      items.push('Ø§Ø·Ù„Ø§Ø¹Ø§Øª Ø±Ø§Ù†Ù†Ø¯Ù‡ Ùˆ Ø®ÙˆØ¯Ø±Ùˆ Ú©Ø§Ù…Ù„ Ù†ÛŒØ³Øª.');
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
      setError('Ù…ÙˆØ§Ø±Ø¯ Ù„Ø§Ø²Ù… Ø¨Ø±Ø§ÛŒ Ù†Ù‡Ø§ÛŒÛŒâ€ŒØ³Ø§Ø²ÛŒ Ø±Ø§ ØªÚ©Ù…ÛŒÙ„ Ú©Ù†ÛŒØ¯.');
      return;
    }
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const response = await logisticsAPI.finalizeLoading(draft.id);
      if (response.data.success) router.push(`/dashboard/logistics/loadings/${draft.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ù†Ù‡Ø§ÛŒÛŒâ€ŒØ³Ø§Ø²ÛŒ Ù†Ø§Ù…ÙˆÙÙ‚ Ø¨ÙˆØ¯.');
    }
  };

  const goNext = async () => {
    if (step === 'project' && !draft?.id) {
      setError('Ø§Ø¨ØªØ¯Ø§ Ù¾Ø±ÙˆÚ˜Ù‡ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯.');
      return;
    }
    if (step === 'remaining' && lines.length === 0) {
      setError('Ø­Ø¯Ø§Ù‚Ù„ ÛŒÚ© Ù…Ø§Ù†Ø¯Ù‡ Ù‚Ø§Ø¨Ù„ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø±Ø§ Ø§Ø¶Ø§ÙÙ‡ Ú©Ù†ÛŒØ¯.');
      return;
    }
    if (step === 'quantities' && !hasValidLineQuantities) {
      setError('Ù…Ù‚Ø¯Ø§Ø± Ù‡Ù…Ù‡ Ø±Ø¯ÛŒÙâ€ŒÙ‡Ø§ Ø¨Ø§ÛŒØ¯ Ø¨ÛŒØ´ØªØ± Ø§Ø² ØµÙØ± Ø¨Ø§Ø´Ø¯.');
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
    <ErpSection title="Ø§Ù†ØªØ®Ø§Ø¨ Ù¾Ø±ÙˆÚ˜Ù‡" description="Ø§Ù†ØªØ®Ø§Ø¨ Ù¾Ø±ÙˆÚ˜Ù‡ Ø§ÙˆÙ„ÛŒÙ† ØªØ¹Ù‡Ø¯ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø§Ø³ØªØ› Ø§Ú¯Ø± Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ ÙØ¹Ø§Ù„ÛŒ Ø¨Ø±Ø§ÛŒ Ù¾Ø±ÙˆÚ˜Ù‡ ÙˆØ¬ÙˆØ¯ Ø¯Ø§Ø´ØªÙ‡ Ø¨Ø§Ø´Ø¯ Ù‡Ù…Ø§Ù† Ø§Ø¯Ø§Ù…Ù‡ Ø¯Ø§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input className={inputClass} value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Ø¬Ø³ØªØ¬ÙˆÛŒ Ù…Ø´ØªØ±ÛŒØŒ Ø´Ø±Ú©ØªØŒ Ù¾Ø±ÙˆÚ˜Ù‡ØŒ Ø¢Ø¯Ø±Ø³ ÛŒØ§ Ø´Ù…Ø§Ø±Ù‡ ØªÙ…Ø§Ø³" />
        <ErpButton label="Ø¬Ø³ØªØ¬Ùˆ" icon={FaSearch} onClick={loadProjects} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {projects.map((project) => (
          <ErpCard key={project.id} interactive className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{project.projectName || project.address}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{project.companyName || project.customerName} Â· {project.city || 'Ø¨Ø¯ÙˆÙ† Ø´Ù‡Ø±'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ErpButton label="Ø§Ù†ØªØ®Ø§Ø¨" icon={FaTruck} onClick={() => selectProject(project.id)} variant="solid" />
              </div>
            </div>
          </ErpCard>
        ))}
      </div>
    </ErpSection>
  );

  const renderRemainingStep = () => (
    <ErpSection title="Ø§Ù†ØªØ®Ø§Ø¨ Ù…Ø§Ù†Ø¯Ù‡ Ù‚Ø§Ø¨Ù„ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ" description="Ø§Ø¨ØªØ¯Ø§ Ù…Ø§Ù†Ø¯Ù‡â€ŒÙ‡Ø§ÛŒ ÙÛŒØ²ÛŒÚ©ÛŒ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯Ø› Ø§Ú¯Ø± ÛŒÚ© Ú¯Ø±ÙˆÙ‡ Ú†Ù†Ø¯ Ù…Ù†Ø¨Ø¹ Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯ÛŒ Ø¯Ø§Ø´ØªÙ‡ Ø¨Ø§Ø´Ø¯ ØªØ®ØµÛŒØµ Ù…Ù†Ø¨Ø¹ Ø¬Ø¯Ø§Ú¯Ø§Ù†Ù‡ Ø§Ù†Ø¬Ø§Ù… Ù…ÛŒâ€ŒØ´ÙˆØ¯.">
      {!remaining ? (
        <ErpEmptyState icon={FaTruck} title="Ø§Ø¨ØªØ¯Ø§ Ù¾Ø±ÙˆÚ˜Ù‡ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯" />
      ) : remaining.groups.length === 0 ? (
        <ErpEmptyState icon={FaTruck} title="Ù…Ø§Ù†Ø¯Ù‡ Ù‚Ø§Ø¨Ù„ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ ÙˆØ¬ÙˆØ¯ Ù†Ø¯Ø§Ø±Ø¯" />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {remaining.groups.map((group: any) => (
            <ErpCard key={group.groupKey} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{group.displayName}</p>
                  <p className="mt-1 text-xs text-slate-500">{group.productType || 'Ù…Ø­ØµÙˆÙ„'} Â· {group.unitLabel} Â· {group.sources.length.toLocaleString('fa-IR')} Ù…Ù†Ø¨Ø¹</p>
                </div>
                <ErpBadge tone="success">Ù…Ø§Ù†Ø¯Ù‡ {numberFa(group.remainingTotal)} {group.unitLabel}</ErpBadge>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="text-xs text-slate-500">Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯Ù‡Ø§: {group.sources.map((source: any) => source.contractNumber).join('ØŒ ')}</p>
                <ErpButton label={group.sources.length > 1 ? 'ØªØ®ØµÛŒØµ Ù…Ù†Ø¨Ø¹' : 'Ø§ÙØ²ÙˆØ¯Ù†'} icon={FaPlus} onClick={() => openGroupAllocation(group)} />
              </div>
            </ErpCard>
          ))}
        </div>
      )}

      {selectedGroup && (
        <ErpCard className="mt-4 p-4" tone="info">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">ØªØ®ØµÛŒØµ Ù…Ù†Ø¨Ø¹: {selectedGroup.displayName}</h3>
              <p className="mt-1 text-sm text-slate-500">Ø§ÛŒÙ† Ù…Ù‚Ø¯Ø§Ø± Ø§Ø² Ú©Ø¯Ø§Ù… Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯Ù‡Ø§ Ù…ØµØ±Ù Ø´ÙˆØ¯ØŸ</p>
            </div>
            <ErpButton label="Ø¨Ø³ØªÙ†" onClick={() => setSelectedGroupKey('')} tone="neutral" variant="ghost" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {selectedGroup.sources.map((source: any) => (
              <label key={source.contractItemId}>
                <span className={labelClass}>Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯ {source.contractNumber} Â· Ù…Ø§Ù†Ø¯Ù‡ {numberFa(source.remainingQuantity)} {source.unitLabel}</span>
                <input className={inputClass} value={allocations[source.contractItemId] || ''} onChange={(event) => setAllocations((current) => ({ ...current, [source.contractItemId]: event.target.value }))} placeholder="Ù…Ù‚Ø¯Ø§Ø± Ù…ØµØ±Ù Ø§Ø² Ø§ÛŒÙ† Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯" />
              </label>
            ))}
          </div>
          <div className="mt-4">
            <ErpButton label="Ø§ÙØ²ÙˆØ¯Ù† ØªØ®ØµÛŒØµâ€ŒÙ‡Ø§" icon={FaPlus} onClick={addAllocatedSources} variant="solid" />
          </div>
        </ErpCard>
      )}
    </ErpSection>
  );

  const renderQuantitiesStep = () => (
    <ErpSection title="Ù…Ù‚Ø¯Ø§Ø±Ø¯Ù‡ÛŒ Ø±Ø¯ÛŒÙâ€ŒÙ‡Ø§" description="Ø¨Ø±Ø§ÛŒ Ø±Ø¯ÛŒÙâ€ŒÙ‡Ø§ÛŒ Ù…ØªØ± Ø·ÙˆÙ„ØŒ Ø®Ø· Ø±Ø§Ø³ Ù¾ÛŒØ´â€ŒÙØ±Ø¶ Ø§Ø³Øª Ùˆ Ù…Ù‚Ø¯Ø§Ø± Ù…Ø³ØªÙ‚ÛŒÙ… Ù‡Ù…Ú†Ù†Ø§Ù† Ø¯Ø± Ø¯Ø³ØªØ±Ø³ Ù…ÛŒâ€ŒÙ…Ø§Ù†Ø¯.">
      {lines.length === 0 ? (
        <ErpEmptyState icon={FaClipboardList} title="Ù‡Ù†ÙˆØ² Ø±Ø¯ÛŒÙÛŒ Ø§Ø¶Ø§ÙÙ‡ Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª" action={{ label: 'Ø±ÙØªÙ† Ø¨Ù‡ Ø§Ù†ØªØ®Ø§Ø¨ Ù…Ø§Ù†Ø¯Ù‡', onClick: () => setStep('remaining'), icon: FaPlus }} />
      ) : (
        <div className="space-y-3">
          {lines.map((line) => {
            const quantity = calculateLineQuantity(line);
            return (
              <ErpCard key={line.key} className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{line.source.productSnapshot?.name || 'Ù…Ø­ØµÙˆÙ„'}</p>
                    <p className="mt-1 text-xs text-slate-500">Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯ {line.source.contractNumber} Â· Ù…Ø§Ù†Ø¯Ù‡ {numberFa(line.source.remainingQuantity)} {line.source.unitLabel}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ErpBadge tone={quantity > 0 ? 'success' : 'warning'}>{numberFa(quantity)} {unitLabels[line.source.unit] || line.source.unit}</ErpBadge>
                    <ErpButton label="Ø­Ø°Ù" onClick={() => removeLine(line.key)} tone="danger" variant="soft" />
                  </div>
                </div>
                {line.source.unit === 'meter' && (
                  <div className="mt-4">
                    <ErpSegmentedControl<QuantityMode>
                      value={line.mode}
                      onChange={(value) => updateLine(line.key, { mode: value })}
                      options={[
                        { value: 'linear', label: 'Ø®Ø· Ø±Ø§Ø³' },
                        { value: 'direct', label: 'Ù…Ù‚Ø¯Ø§Ø± Ù…Ø³ØªÙ‚ÛŒÙ…' },
                      ]}
                    />
                  </div>
                )}
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                  {line.mode === 'linear' ? (
                    <>
                      <label><span className={labelClass}>Ø®Ø· Ø±Ø§Ø³</span><input className={inputClass} value={line.khatRas} onChange={(event) => updateLine(line.key, { khatRas: event.target.value })} /></label>
                      <label><span className={labelClass}>ØªØ¹Ø¯Ø§Ø¯</span><input className={inputClass} value={line.pieceCount} onChange={(event) => updateLine(line.key, { pieceCount: event.target.value })} /></label>
                      <label><span className={labelClass}>Ø§Ø¶Ø§ÙÙ‡</span><input className={inputClass} value={line.plus} onChange={(event) => updateLine(line.key, { plus: event.target.value })} /></label>
                      <label><span className={labelClass}>Ú©Ø³Ø±</span><input className={inputClass} value={line.minus} onChange={(event) => updateLine(line.key, { minus: event.target.value })} /></label>
                    </>
                  ) : (
                    <label><span className={labelClass}>Ù…Ù‚Ø¯Ø§Ø± Ù…Ø³ØªÙ‚ÛŒÙ…</span><input className={inputClass} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
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
  const renderDriverStep = () => (
    <ErpSection title="راننده و خودرو" description="لجستیک فقط راننده/خودروی فعال تعریف‌شده در حراست را انتخاب می‌کند؛ snapshot برای تاریخچه بارگیری ذخیره می‌شود.">
      <ErpSegmentedControl<DriverMode>
        value={driverMode}
        onChange={setDriverMode}
        options={[
          { value: 'saved', label: 'راننده و خودروی فعال حراست', icon: FaUsers },
        ]}
      />

      <div className="mt-4 space-y-4">
        <label>
          <span className={labelClass}>انتخاب راننده و خودرو</span>
          <select className={inputClass} value={driverId} onChange={(event) => setDriverId(event.target.value)}>
            <option value="">بدون انتخاب</option>
            {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.firstName} {driver.lastName} · {driver.vehiclePlate}</option>)}
          </select>
        </label>
        {renderDriverForm(driverSnapshot, (patch) => setDriverSnapshot((current: any) => ({ ...current, ...patch })))}
      </div>
    </ErpSection>
  );
  const renderReviewStep = () => (
    <ErpSection title="Ø¨Ø§Ø²Ø¨ÛŒÙ†ÛŒ Ùˆ Ù†Ù‡Ø§ÛŒÛŒâ€ŒØ³Ø§Ø²ÛŒ">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <ErpCard className="p-4">
            <p className="text-sm text-slate-500">Ù¾Ø±ÙˆÚ˜Ù‡</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{draft?.project?.projectName || draft?.project?.address || remaining?.project?.projectName || 'Ø§Ù†ØªØ®Ø§Ø¨ Ù†Ø´Ø¯Ù‡'}</p>
            <p className="mt-1 text-xs text-slate-500">{remaining?.project?.companyName || remaining?.project?.customerName || ''}</p>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="text-sm text-slate-500">Ø±Ø§Ù†Ù†Ø¯Ù‡</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{driverSnapshot.firstName || 'Ø¨Ø¯ÙˆÙ† Ù†Ø§Ù…'} {driverSnapshot.lastName || ''}</p>
            <p className="mt-1 text-xs text-slate-500">{driverSnapshot.vehicleType || 'Ù†ÙˆØ¹ Ù…Ø§Ø´ÛŒÙ†'} Â· {driverSnapshot.vehiclePlate || 'Ù¾Ù„Ø§Ú©'}</p>
          </ErpCard>
          <ErpCard className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Ø±Ø¯ÛŒÙâ€ŒÙ‡Ø§</p>
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.key} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <span>{line.source.productSnapshot?.name || 'Ù…Ø­ØµÙˆÙ„'} Â· Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯ {line.source.contractNumber}</span>
                  <span className="font-semibold text-[#074747] dark:text-teal-200">{numberFa(calculateLineQuantity(line))} {unitLabels[line.source.unit] || line.source.unit}</span>
                </div>
              ))}
              {!lines.length && <p className="text-sm text-slate-500">Ø±Ø¯ÛŒÙÛŒ Ø§Ø¶Ø§ÙÙ‡ Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.</p>}
            </div>
          </ErpCard>
          <label>
            <span className={labelClass}>ÛŒØ§Ø¯Ø¯Ø§Ø´Øª</span>
            <textarea className={`${inputClass} min-h-28`} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
        <ErpCard className="p-4">
          <p className="font-semibold text-slate-900 dark:text-white">Ø¢Ù…Ø§Ø¯Ú¯ÛŒ Ù†Ù‡Ø§ÛŒÛŒâ€ŒØ³Ø§Ø²ÛŒ</p>
          <div className="mt-3 space-y-2">
            {blockers.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">Ù‡Ù…Ù‡ Ù…ÙˆØ§Ø±Ø¯ ØªÚ©Ù…ÛŒÙ„ Ø§Ø³Øª.</p>
            ) : blockers.map((blocker) => (
              <p key={blocker} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-100">{blocker}</p>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            <ErpButton label={saving ? 'Ø¯Ø± Ø­Ø§Ù„ Ø°Ø®ÛŒØ±Ù‡...' : 'Ø°Ø®ÛŒØ±Ù‡ Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³'} icon={FaSave} onClick={saveDraft} disabled={saving || !draft?.id} tone="neutral" />
            <ErpButton label="Ø«Ø¨Øª Ù†Ù‡Ø§ÛŒÛŒ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ" icon={FaCheck} onClick={finalize} disabled={blockers.length > 0 || saving} tone="success" variant="solid" />
          </div>
        </ErpCard>
      </div>
    </ErpSection>
  );

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="Ù„Ø¬Ø³ØªÛŒÚ©"
      title="Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø¬Ø¯ÛŒØ¯"
      description="ÛŒÚ© Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø§Ø² Ø§Ù†ØªØ®Ø§Ø¨ Ù¾Ø±ÙˆÚ˜Ù‡ Ø´Ø±ÙˆØ¹ Ù…ÛŒâ€ŒØ´ÙˆØ¯ØŒ Ø¨Ù‡â€ŒØµÙˆØ±Øª Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ Ù‚Ø§Ø¨Ù„ Ø§Ø¯Ø§Ù…Ù‡ Ø§Ø³ØªØŒ Ùˆ ÙÙ‚Ø· Ø¯Ø± Ø¨Ø§Ø²Ø¨ÛŒÙ†ÛŒ Ù†Ù‡Ø§ÛŒÛŒ Ú©Ø§Ù…Ù„ Ø¨ÙˆØ¯Ù† Ø±Ø¯ÛŒÙâ€ŒÙ‡Ø§ Ùˆ Ø±Ø§Ù†Ù†Ø¯Ù‡ Ø±Ø§ Ø§Ù„Ø²Ø§Ù… Ù…ÛŒâ€ŒÚ©Ù†Ø¯."
      backHref="/dashboard/logistics/loadings"
      actions={[
        { label: saving ? 'Ø¯Ø± Ø­Ø§Ù„ Ø°Ø®ÛŒØ±Ù‡...' : 'Ø°Ø®ÛŒØ±Ù‡ Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³', icon: FaSave, onClick: saveDraft, disabled: saving || !draft?.id, tone: 'neutral' },
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
            <ErpButton label="Ù‚Ø¨Ù„ÛŒ" icon={FaArrowRight} onClick={goBack} disabled={step === 'project'} tone="neutral" variant="outline" />
          <div className="text-center text-xs text-slate-500">
            {draft?.loadingNumber ? <span>Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³ {draft.loadingNumber}</span> : <span>Ø§Ø¨ØªØ¯Ø§ Ù¾Ø±ÙˆÚ˜Ù‡ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯</span>}
          </div>
          {step === 'review' ? (
            <ErpButton label="Ù†Ù‡Ø§ÛŒÛŒâ€ŒØ³Ø§Ø²ÛŒ" icon={FaCheck} onClick={finalize} disabled={blockers.length > 0 || saving} tone="success" variant="solid" />
          ) : (
            <ErpButton label="Ø¨Ø¹Ø¯ÛŒ" icon={FaArrowLeft} onClick={goNext} disabled={(step === 'project' && !draft?.id) || (step !== 'project' && !draft?.id)} variant="solid" />
          )}
        </div>
      </div>
    </ErpPage>
  );
}
