'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaBoxOpen, FaClipboardCheck, FaMapMarkerAlt, FaTimes, FaTruck } from 'react-icons/fa';
import {
  ErpButton, ErpEmptyState, ErpField, ErpInlineState, ErpNeumorphicWorkflowProgress,
  ErpSearchableSelect, ErpSection, ErpSheet, ErpSkeleton, ErpSummaryGrid,
} from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { LogisticsPage } from '@/features/logistics/LogisticsWorkspace';
import { projectReturnDriverLabel, projectReturnVisitApi, type ProjectReturnVisit } from './projectReturnVisitApi';
import { projectReturnReceiptApi, projectReturnReceiptHref, type ProjectReturnProduct, type ProjectReturnReceiptDetails } from './projectReturnReceiptApi';
import { StoneReturnLookup } from './StoneReturnLookup';
import { ProjectReturnMeasurement, ProjectReturnWidth } from './ProjectReturnMeasurement';
import { damagedProjectReturnAreaLabel, healthyProjectReturnAreaLabel, projectReturnQuantityFacts } from './projectReturnAreaFacts';
import { emptyProjectReturnQuantity, resolveProjectReturnArea, resolveProjectReturnQuantity, resolveProjectReturnWidth, type ProjectReturnQuantityDraft, type ProjectReturnLinearCalculation } from './projectReturnQuantity';
import { stoneReturnUnitLabels, type StoneReturnOption } from './stoneReturnApi';

const listHref = '/dashboard/logistics/returns';
const steps = [
  { id: 1, label: 'راننده و خودرو', icon: FaTruck },
  { id: 2, label: 'مشتری و پروژه', icon: FaMapMarkerAlt },
  { id: 3, label: 'محصول و مقدار', icon: FaBoxOpen },
  { id: 4, label: 'بازبینی و نهایی‌سازی', icon: FaClipboardCheck },
];

type ProductOption = StoneReturnOption & ProjectReturnProduct;
type Condition = 'healthy' | 'damaged';
type SelectionChange = { kind: 'customer'; customer: StoneReturnOption | null } | { kind: 'project'; id: string };
type Item = { product: ProductOption; healthy: ProjectReturnQuantityDraft; damaged: ProjectReturnQuantityDraft; manualWidth: string };

const priorQuantity = (direct: string, linear?: ProjectReturnLinearCalculation | null): ProjectReturnQuantityDraft =>
  linear ? { mode: 'linear', direct, linear } : { ...emptyProjectReturnQuantity(), direct };

export function ProjectReturnIntake({ visitId, revision, onRevised, onClose }: {
  visitId?: string;
  revision?: ProjectReturnReceiptDetails;
  onRevised?: (receipt: ProjectReturnReceiptDetails) => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const firstStep = revision || visitId ? 2 : 1;
  const [step, setStep] = useState(firstStep);
  const [visits, setVisits] = useState<ProjectReturnVisit[] | undefined>(revision?.visit ? [revision.visit] : undefined);
  const [visit, setVisit] = useState<ProjectReturnVisit | null>(revision?.visit ?? null);
  const [customer, setCustomer] = useState<StoneReturnOption | null>(revision ? { id: revision.customerId, label: revision.customerName } : null);
  const [projects, setProjects] = useState<StoneReturnOption[]>(revision?.version.projects.map(project => ({ id: project.projectId, label: project.projectName })) ?? []);
  const [items, setItems] = useState<Item[]>(revision?.version.items.map(item => ({
    product: { ...item, suggestedWidthMeters: item.effectiveWidthMeters, id: JSON.stringify([item.productId, item.unit]), label: item.productName,
      description: `${item.productCode} · ${stoneReturnUnitLabels[item.unit] ?? item.unit}` },
    healthy: priorQuantity(item.healthyQuantity, item.healthyCalculation),
    damaged: priorQuantity(item.damagedQuantity, item.damagedCalculation),
    manualWidth: '',
  })) ?? []);
  const [partnerContract, setPartnerContract] = useState<StoneReturnOption | null>(null);
  const [showPartnerContracts, setShowPartnerContracts] = useState(false);
  const [selectionChange, setSelectionChange] = useState<SelectionChange>();
  const [loadingError, setLoadingError] = useState('');
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const onProjects = useCallback(async () => {
    if (!customer) return [];
    return projectReturnReceiptApi.projects(customer.id);
  }, [customer]);
  const onPartnerContracts = useCallback(async (search: string) => {
    if (!customer || !projects.length) return [];
    return projectReturnReceiptApi.partnerContracts(customer.id, projects.map(project => project.id), search);
  }, [customer, projects]);
  useEffect(() => {
    if (step !== 3) return;
    let current = true;
    void onPartnerContracts('').then(rows => {
      if (current) setShowPartnerContracts(rows.length > 0);
    }).catch(() => {
      if (current) setShowPartnerContracts(true);
    });
    return () => { current = false; };
  }, [step, onPartnerContracts]);
  const onProducts = useCallback(async (search: string): Promise<ProductOption[]> => {
    if (!customer || !projects.length) return [];
    const rows = await projectReturnReceiptApi.products(customer.id, projects.map(project => project.id), search, partnerContract?.id);
    return rows.map(row => ({
      ...row, partnerContractId: partnerContract?.id, id: JSON.stringify([row.productId, row.unit]), label: row.productName,
      description: `${row.productCode} · ${stoneReturnUnitLabels[row.unit] ?? row.unit}`,
    }));
  }, [customer, projects, partnerContract]);

  const resolvedItems = items.map(item => ({
    product: item.product,
    widthMeters: item.product.suggestedWidthMeters ?? resolveProjectReturnWidth(item.manualWidth),
    manualWidth: item.manualWidth,
    healthy: resolveProjectReturnQuantity(item.healthy, item.product.unit),
    damaged: resolveProjectReturnQuantity(item.damaged, item.product.unit),
  }));

  useEffect(() => {
    if (revision) return;
    let current = true;
    setLoadingError('');
    void projectReturnVisitApi.list().then(response => {
      if (!current) return;
      if (!response.capabilities.canCancel) {
        setLoadingError('مجوز ثبت مرجوعی لازم است.');
        return;
      }
      const rows = response.data.filter(row => row.projectReturnStatus === 'AWAITING_RECEIPT');
      setVisits(rows);
      setVisit(rows.find(row => row.id === visitId) ?? null);
    }).catch(reason => {
      if (current) setLoadingError(userFacingError(reason, 'دریافت ورودهای مرجوعی ناموفق بود.'));
    });
    return () => { current = false; };
  }, [visitId, retry, revision]);

  function selectCustomer(next: StoneReturnOption | null) {
    if (customer?.id === next?.id) return;
    const change: SelectionChange = { kind: 'customer', customer: next };
    if (projects.length || items.length) setSelectionChange(change);
    else applySelectionChange(change);
  }

  function addProject(project: StoneReturnOption | null) {
    if (!project) return;
    setProjects(rows => rows.some(row => row.id === project.id) ? rows : [...rows, project]);
  }

  function removeProject(id: string) {
    const change: SelectionChange = { kind: 'project', id };
    if (items.length) setSelectionChange(change);
    else applySelectionChange(change);
  }

  function applySelectionChange(change: SelectionChange) {
    if (change.kind === 'customer') {
      setCustomer(change.customer);
      setProjects([]);
    } else {
      setProjects(rows => rows.filter(row => row.id !== change.id));
    }
    setItems([]);
    setPartnerContract(null);
    setShowPartnerContracts(false);
    setValidationError('');
    setSelectionChange(undefined);
  }

  function addProduct(product: ProductOption | null) {
    if (!product) return;
    setItems(rows => rows.some(row => row.product.id === product.id) ? rows : [
      ...rows, { product, healthy: emptyProjectReturnQuantity(), damaged: emptyProjectReturnQuantity(), manualWidth: '' },
    ]);
    setValidationError('');
  }

  function updateQuantity(id: string, condition: Condition, draft: ProjectReturnQuantityDraft) {
    setItems(rows => rows.map(row => row.product.id === id ? { ...row, [condition]: draft } : row));
  }

  async function advance() {
    setValidationError('');
    setError('');
    if (step >= 3) {
      const incomplete = resolvedItems.find(item => !item.healthy || !item.damaged
        || (item.healthy.value === '0' && item.damaged.value === '0'));
      if (incomplete) {
        setValidationError(`برای «${incomplete.product.productName}» مقدار سالم یا آسیب‌دیدهٔ معتبر وارد کنید.`);
        return;
      }
    }
    if (step >= 3) {
      const invalidWidth = resolvedItems.find(item => item.manualWidth.trim() && item.widthMeters === null);
      if (invalidWidth) {
        setValidationError(`عرض واقعی «${invalidWidth.product.productName}» باید بزرگ‌تر از صفر باشد.`);
        return;
      }
      const invalidArea = resolvedItems.find(({ product, widthMeters, healthy, damaged }) =>
        product.unit === 'meter' && widthMeters !== null && [healthy, damaged].some(quantity =>
          quantity && resolveProjectReturnArea(quantity.value, product.unit, widthMeters) === null));
      if (invalidArea) {
        setValidationError(`مساحت «${invalidArea.product.productName}» از محدودهٔ قابل ثبت بیشتر است.`);
        return;
      }
    }
    if (step < 4) {
      setStep(step + 1);
      return;
    }
    if (busy.current || !visit || !customer || !projects.length || !items.length) return;
    busy.current = true;
    setPending(true);
    try {
      const input: Parameters<typeof projectReturnReceiptApi.submit>[0] = {
        visitId: visit.id, customerId: customer.id, projectIds: projects.map(project => project.id),
        items: resolvedItems.flatMap(({ product, widthMeters, healthy, damaged }) => healthy && damaged ? [{
          productId: product.productId, unit: product.unit,
          ...(widthMeters && { effectiveWidthMeters: widthMeters }),
          ...(product.partnerContractId && { partnerContractId: product.partnerContractId }),
          ...(healthy.calculation ? { healthyCalculation: healthy.calculation } : { healthyQuantity: healthy.value }),
          ...(damaged.calculation ? { damagedCalculation: damaged.calculation } : { damagedQuantity: damaged.value }),
        }] : []),
      };
      if (revision) {
        const changed = await projectReturnReceiptApi.edit(revision.id, revision.version.id, input);
        onRevised?.(changed);
      } else {
        const receipt = await projectReturnReceiptApi.submit(input);
        router.replace(projectReturnReceiptHref(receipt.id));
      }
      return;
    } catch (reason) {
      const status = (reason as { response?: { status?: number } }).response?.status;
      setUncertain(!status || status >= 500);
      setError(userFacingError(reason, 'ثبت رسید ناموفق بود. دوباره تلاش کنید.'));
      busy.current = false;
      setPending(false);
    }
  }

  const nextDisabled = step === 1 ? !visit : step === 2 ? !projects.length : step === 3 ? !items.length : false;
  const contents = loadingError ? <ErpInlineState kind="error" title={loadingError}
      action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />
      : !visits ? <ErpSkeleton label="دریافت ورودهای مرجوعی" />
      : visitId && !visit ? <ErpInlineState kind="stale" title="این مراجعه دیگر در انتظار دریافت مرجوعی نیست."
        action={{ label: 'بازگشت به صف مرجوعی', href: listHref }} />
      : !visits.length ? <ErpEmptyState title="ورود در انتظار تحویل مرجوعی وجود ندارد" />
      : <div className="space-y-4">
        <ErpNeumorphicWorkflowProgress steps={steps.slice(firstStep - 1)} currentStep={step} ariaLabel="مراحل دریافت مرجوعی پروژه" />
        <ErpSection>
          {step === 1 && <ErpField label="راننده و خودرو" required>
            <ErpSearchableSelect value={visit?.id ?? ''} required
              onChange={event => setVisit(visits.find(row => row.id === event.target.value) ?? null)}>
              <option value="">انتخاب راننده و خودرو</option>
              {visits.map(row => <option key={row.id} value={row.id}>{projectReturnDriverLabel(row)}</option>)}
            </ErpSearchableSelect>
          </ErpField>}
          {step === 2 && <div className="space-y-3">
            {visitId && visit && <p className="break-words text-sm sds-text-secondary">{projectReturnDriverLabel(visit)}</p>}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <StoneReturnLookup label="مشتری" placeholder="انتخاب مشتری" selected={customer}
                onChange={selectCustomer} fetchOptions={projectReturnReceiptApi.customers} required disabled={false} />
              <StoneReturnLookup key={customer?.id} label="پروژه‌ها" placeholder="انتخاب پروژه" selected={null}
                onChange={addProject} fetchOptions={onProjects} excludedIds={projects.map(project => project.id)}
                enabled={Boolean(customer)} disabled={projects.length >= 50} />
            </div>
            {projects.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="پروژه‌های انتخاب‌شده">
              {projects.map(project => <li key={project.id} className="min-w-0">
                <ErpButton label={`حذف ${project.label}`} icon={FaTimes} variant="soft"
                  onClick={() => removeProject(project.id)} />
              </li>)}
            </ul>}
          </div>}
          {step === 3 && <div className="space-y-4">
            {showPartnerContracts && <StoneReturnLookup label="فیلتر قرارداد فروش همکار" placeholder="همهٔ قراردادهای پروژه"
              selected={partnerContract} onChange={setPartnerContract} fetchOptions={onPartnerContracts} disabled={false} />}
            <StoneReturnLookup label="محصول" placeholder="جست‌وجوی محصول پروژه" selected={null} onChange={addProduct}
              fetchOptions={onProducts} excludedIds={items.map(item => item.product.id)} disabled={items.length >= 100} />
            {items.map(item => {
              const { product } = item;
              const widthMeters = product.suggestedWidthMeters ?? resolveProjectReturnWidth(item.manualWidth);
              return <ErpSection key={product.id} title={product.productName} description={product.description}
                actions={[{ label: 'حذف محصول', tone: 'danger', onClick: () => {
                  setItems(rows => rows.filter(row => row.product.id !== product.id));
                  setValidationError('');
                } }]}>
                {product.unit === 'meter' && <ProjectReturnWidth recorded={product.suggestedWidthMeters}
                  manual={item.manualWidth} validate={Boolean(validationError)} onChange={manualWidth =>
                    setItems(rows => rows.map(row => row.product.id === product.id ? { ...row, manualWidth } : row))} />}
                <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
                  <ProjectReturnMeasurement label="مقدار سالم" productName={product.productName} unit={product.unit}
                    draft={item.healthy} widthMeters={widthMeters} areaLabel={healthyProjectReturnAreaLabel} onChange={draft => updateQuantity(product.id, 'healthy', draft)} validate={Boolean(validationError)} />
                  <ProjectReturnMeasurement label="مقدار آسیب‌دیده" productName={product.productName} unit={product.unit}
                    draft={item.damaged} widthMeters={widthMeters} areaLabel={damagedProjectReturnAreaLabel} onChange={draft => updateQuantity(product.id, 'damaged', draft)} validate={Boolean(validationError)} />
                </div>
              </ErpSection>;
            })}
            {validationError && <ErpInlineState kind="error" title={validationError} />}
          </div>}
          {step === 4 && visit && customer && <div className="space-y-4">
            <ErpSummaryGrid columns={2} items={[
              { label: 'راننده و خودرو', value: projectReturnDriverLabel(visit) },
              { label: 'مشتری', value: customer.label },
              { label: 'پروژه‌ها', value: projects.map(project => project.label).join('، ') },
            ]} />
            {resolvedItems.map(({ product, widthMeters, healthy, damaged }) => healthy && damaged && <ErpSection key={product.id}
              title={product.productName} description={product.description}>
              <ErpSummaryGrid columns={2} items={[
                ...projectReturnQuantityFacts({
                  unit: product.unit, healthyQuantity: healthy.value, damagedQuantity: damaged.value,
                  healthyAreaSquareMeters: resolveProjectReturnArea(healthy.value, product.unit, widthMeters),
                  damagedAreaSquareMeters: resolveProjectReturnArea(damaged.value, product.unit, widthMeters),
                }),
              ]} />
            </ErpSection>)}
          </div>}
          {error && <ErpInlineState kind="error" title={error} />}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {revision && <ErpButton label="بازگشت به رسید" variant="ghost" disabled={pending} onClick={onClose} />}
            {step > firstStep && <ErpButton label="مرحله قبل" variant="ghost" disabled={pending || uncertain} onClick={() => {
              setStep(step - 1); setValidationError(''); setError('');
            }} />}
            <ErpButton label={pending ? 'در حال ثبت…' : uncertain ? 'تلاش دوباره برای ثبت' : step === 4 ? revision ? 'ثبت اصلاح' : 'ثبت نهایی دریافت' : 'مرحله بعد'}
              tone="primary" disabled={pending || nextDisabled} onClick={() => void advance()} />
          </div>
        </ErpSection>
        <ErpSheet open={Boolean(selectionChange)} onClose={() => setSelectionChange(undefined)} presentation="modal"
          title={selectionChange?.kind === 'customer' ? 'تغییر مشتری' : 'حذف پروژه'} footer={<>
            <ErpButton label="بازگشت" variant="ghost" onClick={() => setSelectionChange(undefined)} />
            <ErpButton label={selectionChange?.kind === 'customer' ? 'تأیید تغییر مشتری' : 'تأیید حذف پروژه'}
              tone="danger" onClick={() => selectionChange && applySelectionChange(selectionChange)} />
          </>}>
          <p>{selectionChange?.kind === 'customer'
            ? 'با تغییر مشتری، پروژه‌ها، محصولات و مقدارهای واردشده در این فرم پاک می‌شوند.'
            : 'با حذف پروژه، محصولات و مقدارهای واردشده در این فرم پاک می‌شوند.'}</p>
        </ErpSheet>
      </div>;
  return <LogisticsPage title={revision ? 'ویرایش مرجوعی پروژه' : 'ثبت دریافت مرجوعی پروژه'}
    backHref={revision ? projectReturnReceiptHref(revision.id) : listHref}>{contents}</LogisticsPage>;
}
