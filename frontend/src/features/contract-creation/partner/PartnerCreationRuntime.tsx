'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CaseDraftIntentSchema, PartnerCaseRuntimeResultSchema, PartnerCaseViewSchema, PartnerCommandSchema, PartnerCreationContextSchema,
  PartnerApprovalMatchSetSchema, PartnerWholesaleQuoteSchema, PartnerWizardRecoverySnapshotSchema,
  PartnerTechnicalCatalogPageSchema, CustomerPaymentPlanSchema, canonicalHash, partnerError, previewPartnerTechnicalDraft,
  type PartnerCaseView, type PartnerCommand, type PartnerCommandPort, type PartnerApprovalMatchSet,
  type PartnerCreationContext, type PartnerTechnicalSaveReceipt,
  type PartnerTechnicalCatalogPage, type PartnerTechnicalDraft, type PartnerTechnicalOperation, type PartnerTechnicalProduct,
  type CustomerPaymentPlan,
} from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpField, ErpFieldView, ErpInlineState, ErpInput, ErpLoading, ErpNeumorphicCard, ErpNeumorphicDisclosure, ErpNeumorphicWorkflowLayout, ErpPressable, ErpRialInput, ErpSheet } from '@/components/erp';
import api from '@/lib/api';
import { createPartnerTechnicalHttpPorts } from './partnerTechnicalHttpPorts';
import { createPartnerInquiryHttpPorts } from '../../partner-sales/inquiries/partnerInquiryHttpPorts';
import { PartnerInquiryWorkspace } from '../../partner-sales/inquiries/PartnerInquiryWorkspace';
import type { PartnerConfiguredInquiryRows } from '../../partner-sales/inquiries/partnerInquirySubmission';
import { isUsableInquiryRow, type PartnerInquiryView, type PartnerInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import { PartnerContractWizard, partnerWizardPresentationSteps, type PartnerWizardDraft,
  type PartnerWizardStep } from './PartnerContractWizard';
import { ContractWizardFrame } from '../components/shared/ContractWizardFrame';
import { ContractCreationDraftPrompt } from '../components/shared/ContractCreationDraftPrompt';
import { CustomerProjectFormFields, emptyCustomerProjectFormValue } from '../../crm/customer-workflow/CustomerProjectFormFields';
import { ContractCustomerStepView, ContractDateStepView, ContractDeliveryDetailsFields, ContractProjectStepView,
  type ContractCustomerOption, type ContractProjectOption } from '../components/shared/ContractWizardStepViews';
import { ContractPaymentInstallmentFields } from '../components/shared/ContractPaymentInstallmentFields';
import { ContractPaymentCheckFields } from '../components/shared/ContractPaymentCheckFields';
import { ContractDiscountEditor } from '../components/shared/ContractDiscountEditor';
import { PaymentEntryModal } from '../components/modals/PaymentEntryModal';
import type { PaymentEntry } from '../types/contract.types';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { createPartnerCaseSubmission, type PartnerDraftCommand } from './partnerCaseSubmission';
import { selectPartnerReinquiryRows } from './partnerReinquiry';
import { enterPartnerWizard, preservePartnerDeliveriesAcrossProductEdit, rebasePartnerWizardSnapshot,
  partnerCasePendingStorageKey, shouldPreferLocalPartnerWizard,
  isExplicitPartnerCreationEntry, partnerProductEditPath, shouldOfferPartnerDraftChoice,
  shouldStartFreshPartnerCreation } from './partnerWizardEntry';
import { alignPartnerCustomerPaymentPlan, partnerMoneyText, partnerRetailIntentRows, refreshPartnerInquiryRow,
  partnerRetailDiscountFromPercent, partnerRetailSubtotal, partnerRetailSummary, remainingPartnerAmount } from './partnerRetail';
import { PartnerTechnicalDraftEditor } from './PartnerTechnicalDraftEditor';
import { finalizePartnerCase, sendPartnerConfirmation } from '../../partner-sales/cases/partnerCaseHttpPort';
import { PartnerQuickInquiryEditor, type PartnerInquiryDimensions } from './PartnerQuickInquiryEditor';
import { isPartnerContractConfigurationComplete, removePartnerTechnicalProduct } from './partnerTechnicalDraftAdapter';
import { normalizeNumericText } from '@/lib/numberFormat';
import { parseCanonicalDecimal } from '@sabalanerp/contract-product-graph';
import { commitPartnerTechnicalDraft } from './partnerTechnicalCommit';
import { getPartnerBrowserSessionId } from './partnerBrowserSession';
import { canSubmitPartnerTechnicalAction, showPartnerContractConfigurationWarning } from './partnerCreationFlow';
import { readPartnerCreationContext } from './partnerCreationContext';
import { partnerPaymentChoice, partnerPaymentMethodUpdate } from './partnerPaymentMethodAdapter';
import { paymentEntryFromPartnerInstallment, partnerInstallmentFromPaymentEntry } from './partnerPaymentEntryAdapter';
import { firstPartnerPaymentPlanError, validatePartnerPaymentInstallment } from './partnerPaymentValidation';
import { buildPartnerInquirySubjectOptions, type PartnerInquirySubjectOption } from './partnerInquirySubjectOptions';
import { validateOptionalIranianMobile } from '@/lib/phoneFormat';

type PartnerContext = Extract<PartnerCreationContext, { kind: 'PARTNER' }>;
type PartnerCustomer = PartnerContext['customers'][number];
type PartnerPaymentInstallment = CustomerPaymentPlan['installments'][number];
type PartnerPaymentModalErrors = Partial<Record<'amount' | 'paymentDate' | 'checkNumber' | 'checkOwnerName' | 'handoverDate' | 'nationalCode', string>>;
const partnerSaleEntrySteps: PartnerWizardStep[] = ['date', 'customer', 'project', 'products'];
type Access = { schemaVersion: 1; recoveryId: string; browserSessionId: string;
  leaseToken: string; baseRevision: number };
type PersistedRuntime = { actorId: string; inquiryId: string; access: Access;
  saved: PartnerTechnicalSaveReceipt; configuredRows: PartnerConfiguredInquiryRows; customerId: string;
  knownInquiryRows?: PartnerInquiryRow[];
  contractDate?: string; projectId?: string };

const ports = createPartnerTechnicalHttpPorts();
const inquiryPorts = createPartnerInquiryHttpPorts();
const runtimeKey = (actorId: string, inquiryId: string) => `partner-creation-runtime:${actorId}:${inquiryId}`;
const inquiryPendingKey = (actorId: string) => `partner-inquiry-pending:${actorId}`;
const wizardDraftKey = (actorId: string, recoveryId: string) => `partner-wizard-draft:${actorId}:${recoveryId}`;
const emptyTechnicalDraft = (inputRevision = 0): PartnerTechnicalDraft => ({
  schemaVersion: 1, inputRevision, rows: [], dependents: [], stairSystems: [], editingValues: [],
});
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function partnerCustomerOption(context: PartnerContext, customer: PartnerCustomer): ContractCustomerOption {
  return { id: customer.id, title: customer.displayName, phone: customer.phone,
    projectCount: context.projects.filter(project => project.customerId === customer.id).length };
}

function partnerCustomerOptions(context: PartnerContext, searchTerm: string): ContractCustomerOption[] {
  const query = searchTerm.trim().toLocaleLowerCase('fa-IR');
  return context.customers
    .filter(customer => !query || `${customer.displayName} ${customer.phone ?? ''}`.toLocaleLowerCase('fa-IR').includes(query))
    .map(customer => partnerCustomerOption(context, customer));
}

function selectedPartnerCustomer(context: PartnerContext, customerId: string): ContractCustomerOption | undefined {
  const customer = context.customers.find(item => item.id === customerId);
  return customer ? partnerCustomerOption(context, customer) : undefined;
}

function partnerProjectSelection(context: PartnerContext, customerId: string): {
  customerName?: string;
  projects: ContractProjectOption[];
} {
  return {
    customerName: context.customers.find(customer => customer.id === customerId)?.displayName,
    projects: context.projects.filter(project => project.customerId === customerId)
      .map(project => ({ id: project.id, title: project.title })),
  };
}

async function readCatalogPages(kind: PartnerTechnicalCatalogPage['kind']): Promise<PartnerTechnicalCatalogPage[]> {
  const pages: PartnerTechnicalCatalogPage[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const result = await ports.catalog.read({
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, limit: 100, ...(cursor ? { cursor } : {}),
    });
    if (!result.ok) throw result.error;
    if (result.value.kind !== kind) throw new Error('Catalog kind mismatch');
    pages.push(result.value);
    cursor = result.value.nextCursor;
    if (!cursor) return pages;
  }
  throw new Error('Catalog pagination limit exceeded');
}

const caseCommands: PartnerCommandPort = { async execute(input) {
  const command = PartnerCommandSchema.safeParse(input);
  if (!command.success || !['CASE_SUBMIT', 'CASE_DRAFT_REVISE'].includes(command.data.type)) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  }
  try {
    const response = await api.post('/partner/cases/commands', command.data);
    const value = (response.data as { success?: unknown; data?: unknown })?.data;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const row = value as Record<string, unknown>;
    const view = PartnerCaseViewSchema.safeParse(row.case);
    if (!view.success || row.commandId !== command.data.commandId || typeof row.replayed !== 'boolean' || !Array.isArray(row.eventIds)) {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    return { ok: true, value: { commandId: command.data.commandId, replayed: row.replayed,
      case: view.data, eventIds: row.eventIds.filter((id): id is string => typeof id === 'string') } };
  } catch (error) {
    const response = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
    if (response?.data?.code) return { ok: false, error: partnerError(response.data.code as never) };
    throw error;
  }
} };

function readStored<T>(key: string): T | null {
  try { const value = window.localStorage.getItem(key); return value ? JSON.parse(value) as T : null; }
  catch { return null; }
}

export function PartnerCreationRuntime({ ordinary, mode = 'sale' }: { ordinary: React.ReactNode; mode?: 'sale' | 'inquiry' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const freshInquiryRef = useRef(shouldStartFreshPartnerCreation(searchParams));
  const [context, setContext] = useState<PartnerCreationContext | null>(null);
  const [runtime, setRuntime] = useState<PersistedRuntime | null>(null);
  const runtimeRef = useRef<PersistedRuntime | null>(null);
  runtimeRef.current = runtime;
  const [catalog, setCatalog] = useState<PartnerTechnicalProduct[]>([]);
  const [operations, setOperations] = useState<PartnerTechnicalOperation[]>([]);
  const [retainedCatalog, setRetainedCatalog] = useState<{ products: PartnerTechnicalProduct[];
    operations: PartnerTechnicalOperation[]; sawKerfMeters: string } | null>(null);
  const [inquiryNote, setInquiryNote] = useState('');
  const [quickDimensions, setQuickDimensions] = useState<Record<string, PartnerInquiryDimensions>>({});
  const [technicalDraft, setTechnicalDraft] = useState<PartnerTechnicalDraft>(() => emptyTechnicalDraft());
  const [mandatoryDefaults, setMandatoryDefaults] = useState({ enabled: false, percentage: '20' });
  const [draftAccess, setDraftAccess] = useState<Access | null>(null);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const recoveryRevisionRef = useRef(0);
  recoveryRevisionRef.current = recoveryRevision;
  const recoveryStarting = useRef(false);
  const checkpointFlight = useRef<Promise<boolean> | null>(null);
  const technicalCommitFlight = useRef(false);
  const checkpointedInputRevision = useRef(0);
  const inquiryHydrationFlight = useRef(false);
  const [customerId, setCustomerId] = useState('');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [contractDate, setContractDate] = useState(today);
  const [projectId, setProjectId] = useState('');
  const [saleStep, setSaleStep] = useState<PartnerWizardStep>('date');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectForm, setProjectForm] = useState(emptyCustomerProjectFormValue);
  const projectCommandRef = useRef<{ signature: string; commandId: string; correlationId: string } | null>(null);
  const projectFormErrors = {
    projectManagerNumber: validateOptionalIranianMobile(projectForm.projectManagerNumber) || undefined,
    marketerPhoneNumber: validateOptionalIranianMobile(projectForm.marketerPhoneNumber) || undefined,
  };
  const projectFormValid = Boolean(projectForm.projectName.trim() && projectForm.projectAddress.trim() &&
    !projectFormErrors.projectManagerNumber && !projectFormErrors.marketerPhoneNumber);
  const [customerNotice, setCustomerNotice] = useState<string | null>(null);
  const [wizard, setWizard] = useState<PartnerWizardDraft | null>(null);
  const [editingCase, setEditingCase] = useState<PartnerCaseView | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    installment: PartnerPaymentInstallment;
    isNew: boolean;
    isFirst: boolean;
  } | null>(null);
  const [paymentForm, setPaymentForm] = useState<Partial<PaymentEntry>>({});
  const [paymentModalErrors, setPaymentModalErrors] = useState<PartnerPaymentModalErrors>({});
  const editingHydrationFlight = useRef(false);
  const runtimeWizardHydrationFlight = useRef(false);
  const wizardServerRevision = useRef(0);
  const wizardSaveFlight = useRef<Promise<boolean> | null>(null);
  const wizardSavePending = useRef<PartnerWizardDraft | null>(null);
  const autoTitledDrafts = useRef(new Set<string>());
  const [pending, setPending] = useState(false);
  const [initialInquiryOpen, setInitialInquiryOpen] = useState(false);
  const [initialInquiryMatches, setInitialInquiryMatches] = useState<PartnerApprovalMatchSet | null>(null);
  const [initialInquirySubjects, setInitialInquirySubjects] = useState<PartnerInquirySubjectOption[]>([]);
  const [initialInquirySelection, setInitialInquirySelection] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const contextActorId = context?.kind === 'PARTNER' ? context.actorId : null;
  const persistRuntime = useCallback((value: PersistedRuntime | null) => {
    setRuntime(value);
    if (!contextActorId) return;
    if (value) window.localStorage.setItem(runtimeKey(contextActorId, value.inquiryId), JSON.stringify(value));
    else if (runtimeRef.current) window.localStorage.removeItem(runtimeKey(contextActorId, runtimeRef.current.inquiryId));
  }, [contextActorId]);
  const technicalProducts = useMemo(() => [...catalog, ...(retainedCatalog?.products ?? []).filter(item =>
    !catalog.some(current => current.catalogItemId === item.catalogItemId &&
      current.catalogSnapshotVersion === item.catalogSnapshotVersion))], [catalog, retainedCatalog]);
  const technicalOperations = useMemo(() => [...operations, ...(retainedCatalog?.operations ?? []).filter(item =>
    !operations.some(current => current.catalogItemId === item.catalogItemId &&
      current.catalogSnapshotVersion === item.catalogSnapshotVersion))], [operations, retainedCatalog]);
  const technicalPreview = useMemo(() => previewPartnerTechnicalDraft(technicalDraft,
    { products: technicalProducts, operations: technicalOperations,
      sawKerfMeters: retainedCatalog?.sawKerfMeters ?? '0.003' }),
  [technicalProducts, technicalOperations, retainedCatalog, technicalDraft]);
  const technicalReady = technicalPreview.ok && technicalDraft.rows.length > 0 && technicalPreview.value.conflicts.length === 0
    && technicalPreview.value.rows.every(row => row.calculation.ok);
  const contractConfigurationReady = isPartnerContractConfigurationComplete(technicalDraft);
  const normalizedQuickDimensions = (productRowId: string) => Object.fromEntries(Object.entries(quickDimensions[productRowId] ?? {})
    .filter((entry): entry is [keyof PartnerInquiryDimensions, string] => Boolean(entry[1]?.trim()))
    .map(([key, value]) => [key, parseCanonicalDecimal(normalizeNumericText(value))])) as PartnerInquiryDimensions;
  const quickDimensionsValid = mode !== 'inquiry' || technicalDraft.rows.every(row => {
    try { normalizedQuickDimensions(row.productRowId); return true; } catch { return false; }
  });
  const retailPricesReady = mode === 'inquiry' || technicalDraft.rows.every(row => Boolean(row.retailUnitPrice?.amount));
  const technicalActionReady = retailPricesReady && canSubmitPartnerTechnicalAction({ mode, pending, technicalReady,
    contractConfigurationReady, quickDimensionsValid, hasDraftAccess: Boolean(draftAccess) });

  const reacquireRuntime = useCallback(async (value: PersistedRuntime): Promise<PersistedRuntime | null> => {
    const lease = await ports.lease.acquire({ schemaVersion: 1, recoveryId: value.access.recoveryId,
      browserSessionId: value.access.browserSessionId, baseRevision: value.access.baseRevision, takeover: false });
    if (!lease.ok) { setError(lease.error.message); return null; }
    if (lease.value.leaseToken === value.access.leaseToken && lease.value.baseRevision === value.access.baseRevision) return value;
    const refreshed = { ...value, access: { ...value.access, leaseToken: lease.value.leaseToken,
      baseRevision: lease.value.baseRevision } };
    persistRuntime(refreshed);
    return refreshed;
  }, [persistRuntime]);

  const wizardRecoveryId = wizard?.intent.recoveryId;
  useEffect(() => {
    if (!wizardRecoveryId || !runtime) return;
    window.localStorage.setItem(wizardDraftKey(runtime.actorId, wizard.intent.recoveryId), JSON.stringify({
      savedAt: Date.now(), serverRevision: wizardServerRevision.current, draft: wizard,
    }));
  }, [runtime, wizard, wizardRecoveryId]);

  const persistWizardServer = useCallback(async (next: PartnerWizardDraft) => {
    if (!runtime || next.intent.recoveryId !== runtime.saved.recoveryId) return false;
    wizardSavePending.current = next;
    if (!wizardSaveFlight.current) {
      wizardSaveFlight.current = (async () => {
        try {
          while (wizardSavePending.current) {
            const current = wizardSavePending.current;
            wizardSavePending.current = null;
            const active = runtimeRef.current;
            if (!active || active.actorId !== runtime.actorId ||
                active.access.recoveryId !== current.intent.recoveryId) throw new Error('Recovery changed');
            const refreshed = await reacquireRuntime(active);
            if (!refreshed) throw new Error('Recovery lease unavailable');
            const response = await api.put(`/partner/cases/drafts/${encodeURIComponent(current.intent.recoveryId)}/wizard`, {
              schemaVersion: 1, expectedWizardRevision: wizardServerRevision.current,
              editLease: { recoveryId: refreshed.access.recoveryId,
                browserSessionId: refreshed.access.browserSessionId, leaseToken: refreshed.access.leaseToken,
                baseRevision: refreshed.access.baseRevision },
              step: current.step, intent: current.intent,
            });
            const parsed = PartnerWizardRecoverySnapshotSchema.safeParse((response.data as { data?: unknown })?.data);
            if (!parsed.success) throw new Error('Invalid wizard recovery');
            wizardServerRevision.current = parsed.data.wizardRevision;
            const key = wizardDraftKey(runtime.actorId, current.intent.recoveryId);
            const local = readStored<{ savedAt: number; serverRevision?: number; draft: PartnerWizardDraft }>(key);
            if (local?.draft.intent.recoveryId === current.intent.recoveryId) {
              window.localStorage.setItem(key, JSON.stringify(rebasePartnerWizardSnapshot(local, parsed.data.wizardRevision)));
            }
          }
          return true;
        } catch {
          wizardSavePending.current = null;
          setError('ذخیره خودکار پیش‌نویس قرارداد انجام نشد؛ اطلاعات این صفحه حفظ شده است.');
          return false;
        } finally { wizardSaveFlight.current = null; }
      })();
    }
    return wizardSaveFlight.current;
  }, [reacquireRuntime, runtime]);

  useEffect(() => {
    if (!wizardRecoveryId || !runtime) return;
    const timer = window.setTimeout(() => void persistWizardServer(wizard), 700);
    return () => window.clearTimeout(timer);
  }, [persistWizardServer, runtime, wizard, wizardRecoveryId]);

  useEffect(() => {
    let active = true;
    const requestedCaseId = searchParams.get('caseId');
    void readPartnerCreationContext(() => api.get(requestedCaseId
      ? `/partner/cases/creation-context?caseId=${encodeURIComponent(requestedCaseId)}`
      : '/partner/cases/creation-context')).then(response => {
      const parsed = PartnerCreationContextSchema.safeParse((response.data as { data?: unknown })?.data);
      if (!active) return;
      if (!parsed.success) throw new Error('Invalid Partner creation context');
      setContext(parsed.data);
      setError(null);
      if (parsed.data.kind === 'PARTNER') {
        const returnedStep = searchParams.get('step');
        if (returnedStep === '2') setSaleStep('customer');
        if (returnedStep === '3') setSaleStep('project');
        const startFresh = shouldStartFreshPartnerCreation(searchParams);
        const recoverableDraftCount = parsed.data.recoverableDrafts?.length ?? (parsed.data.recoverableDraft ? 1 : 0);
        const explicitEntry = isExplicitPartnerCreationEntry(searchParams);
        freshInquiryRef.current = startFresh || (explicitEntry && recoverableDraftCount === 0);
        if (explicitEntry) {
          setRuntime(null); setWizard(null); setDraftAccess(null); setRecoveryRevision(0); setRecoveryBlocked(false);
          recoveryRevisionRef.current = 0; checkpointedInputRevision.current = 0; inquiryHydrationFlight.current = false;
          setTechnicalDraft(emptyTechnicalDraft()); setSaleStep('date'); setEditingCase(null);
        }
        if (shouldOfferPartnerDraftChoice(recoverableDraftCount, searchParams, startFresh)) {
          const requestedCustomer = searchParams.get('customerId');
          const nextCustomerId = parsed.data.customers.some(customer => customer.id === requestedCustomer)
            ? requestedCustomer! : parsed.data.customers[0]?.id || '';
          const requestedProject = searchParams.get('projectId');
          setCustomerId(nextCustomerId);
          setProjectId(parsed.data.projects.some(project => project.id === requestedProject && project.customerId === nextCustomerId)
            ? requestedProject! : '');
          return;
        }
        const requestedInquiry = searchParams.get('inquiryId') || parsed.data.latestInquiryId || '';
        const configureForSale = mode === 'sale' && searchParams.get('configure') === '1';
        if (configureForSale) setSaleStep('products');
        const saved = startFresh || explicitEntry || configureForSale || !requestedInquiry ? null
          : readStored<PersistedRuntime>(runtimeKey(parsed.data.actorId, requestedInquiry));
        if (saved?.actorId === parsed.data.actorId) {
          setRuntime(saved); setCustomerId(saved.customerId);
          setDraftAccess(saved.access); setRecoveryRevision(saved.saved.recoveryRevision);
          setSaleStep('products');
          if (saved.contractDate) setContractDate(saved.contractDate);
          if (saved.projectId) setProjectId(saved.projectId);
        }
        else {
          const requestedCustomer = searchParams.get('customerId');
          const nextCustomerId = parsed.data.customers.some(customer => customer.id === requestedCustomer)
            ? requestedCustomer! : parsed.data.customers[0]?.id || '';
          const requestedProject = searchParams.get('projectId');
          setCustomerId(nextCustomerId);
          setProjectId(parsed.data.projects.some(project => project.id === requestedProject && project.customerId === nextCustomerId)
            ? requestedProject! : '');
        }
        if (searchParams.get('newCustomer') === '1') {
          const params = new URLSearchParams({ returnTo: 'contract', step: '2', partnerContract: '1' });
          const recoveryId = searchParams.get('draftId');
          if (recoveryId) params.set('draftId', recoveryId);
          router.replace(`/dashboard/crm/customers/create?${params.toString()}`);
        }
      }
    }).catch(() => active && setError('تشخیص مسیر ایجاد قرارداد انجام نشد. دوباره تلاش کنید.'));
    return () => { active = false; };
  }, [mode, router, searchParams]);

  const openSharedCustomerCreation = (selectedCustomerId?: string) => {
    const params = new URLSearchParams({ returnTo: 'contract', step: '2', partnerContract: '1' });
    const recoveryId = runtimeRef.current?.access.recoveryId ?? draftAccess?.recoveryId;
    if (recoveryId) params.set('draftId', recoveryId);
    if (selectedCustomerId) params.set('customerId', selectedCustomerId);
    router.push(`/dashboard/crm/customers/create?${params.toString()}`);
  };

  const createProject = async (partner: PartnerContext, selectedCustomerId = customerId) => {
    if (pending || !selectedCustomerId || !projectFormValid) return;
    setPending(true); setError(null);
    try {
      const optional = (value: string) => value.trim() || undefined;
      const intent = { schemaVersion: 1 as const, customerId: selectedCustomerId,
        reason: 'ثبت پروژه مشتری برای قرارداد فروش همکار', project: {
          projectName: projectForm.projectName.trim(), address: projectForm.projectAddress.trim(),
          ...(optional(projectForm.projectCity) ? { city: optional(projectForm.projectCity) } : {}),
          ...(optional(projectForm.projectType) ? { projectType: optional(projectForm.projectType) } : {}),
          ...(optional(projectForm.projectManagerName) ? { projectManagerName: optional(projectForm.projectManagerName) } : {}),
          ...(optional(projectForm.projectManagerNumber) ? { projectManagerNumber: optional(projectForm.projectManagerNumber) } : {}),
          ...(optional(projectForm.marketerFirstName) ? { marketerFirstName: optional(projectForm.marketerFirstName) } : {}),
          ...(optional(projectForm.marketerLastName) ? { marketerLastName: optional(projectForm.marketerLastName) } : {}),
          ...(optional(projectForm.marketerPhoneNumber) ? { marketerPhoneNumber: optional(projectForm.marketerPhoneNumber) } : {}),
        } };
      const payloadHash = await canonicalHash(intent);
      const signature = JSON.stringify(intent);
      if (!projectCommandRef.current || projectCommandRef.current.signature !== signature) {
        projectCommandRef.current = { signature, commandId: `partner-project-${crypto.randomUUID()}`,
          correlationId: `partner-project-correlation-${crypto.randomUUID()}` };
      }
      const { commandId, correlationId } = projectCommandRef.current;
      const response = await api.post(`/crm/partner/contract-customers/${encodeURIComponent(selectedCustomerId)}/projects`, {
        ...intent, commandId, correlationId,
        idempotencyKey: commandId, payloadHash,
      });
      const value = (response.data as { data?: unknown })?.data;
      const project = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as { project?: { id?: unknown; title?: unknown; address?: unknown } }).project : undefined;
      if (typeof project?.id !== 'string' || typeof project.title !== 'string') throw new Error('Invalid project response');
      const created = { id: project.id, customerId: selectedCustomerId, title: project.title,
        ...(typeof project.address === 'string' ? { address: project.address } : {}), source: 'CUSTOMER_PROJECT' as const };
      setContext({ ...partner, projects: [created, ...partner.projects] });
      setProjectId(created.id); setProjectForm(emptyCustomerProjectFormValue); setShowProjectForm(false);
      projectCommandRef.current = null;
      const activeRuntime = runtimeRef.current;
      if (activeRuntime) persistRuntime({ ...activeRuntime, customerId: selectedCustomerId, projectId: created.id });
      setCustomerNotice('پروژه ثبت و انتخاب شد.');
      return created;
    } catch { setError('ثبت پروژه انجام نشد. اطلاعات را بررسی و دوباره تلاش کنید.'); }
    finally { setPending(false); }
  };

  useEffect(() => {
    if (context?.kind !== 'PARTNER' || !context.writable || runtime) return;
    let active = true;
    void Promise.all([
      readCatalogPages('PRODUCT'), readCatalogPages('TOOL'), readCatalogPages('FINISHING'), readCatalogPages('LAYER'),
    ]).then(([productPages, toolPages, finishingPages, layerPages]) => {
        if (!active) return;
        const products = productPages.flatMap(page => page.kind === 'PRODUCT' ? page.items : []);
        const tools = toolPages.flatMap(page => page.kind === 'TOOL' ? page.items : []);
        const finishings = finishingPages.flatMap(page => page.kind === 'FINISHING' ? page.items : []);
        const layers = layerPages.flatMap(page => page.kind === 'LAYER' ? page.items : []);
        setCatalog(products.filter(item => item.isAvailable));
        setOperations([...tools, ...finishings, ...layers]);
      }).catch(() => active && setError('دریافت کاتالوگ فنی انجام نشد.'));
    return () => { active = false; };
  }, [context, runtime]);

  const openDraftRecovery = useCallback(async (partner: PartnerContext, takeover: boolean, fresh = false) => {
    if (recoveryStarting.current || (runtime && !fresh)) return;
    recoveryStarting.current = true; setError(null);
    try {
      const requestedDraft = searchParams.get('draftId');
      const requestedBase = Number(searchParams.get('baseRevision'));
      const requestedCandidate = requestedDraft ? partner.recoverableDrafts?.find(item => item.recoveryId === requestedDraft)
        ?? { recoveryId: requestedDraft, baseRevision: Number.isSafeInteger(requestedBase) && requestedBase >= 0 ? requestedBase : 0,
          updatedAt: new Date().toISOString() } : undefined;
      const candidate = fresh ? undefined : requestedCandidate ?? partner.recoverableDraft;
      const recoveryId = candidate?.recoveryId ?? `partner-recovery-${crypto.randomUUID()}`;
      const browserSessionId = getPartnerBrowserSessionId(window.sessionStorage, partner.actorId);
      const baseRevision = candidate?.baseRevision ?? 0;
      const lease = await ports.lease.acquire({ schemaVersion: 1, recoveryId, browserSessionId, baseRevision, takeover });
      if (!lease.ok) { setRecoveryBlocked(Boolean(candidate)); setError(lease.error.message); return; }
      const access: Access = { schemaVersion: 1, recoveryId, browserSessionId,
        leaseToken: lease.value.leaseToken, baseRevision: lease.value.baseRevision };
      const recovered = await ports.recovery.read(access);
      if (!recovered.ok) { setError(recovered.error.message); return; }
      if (recovered.value.mandatoryDefaults) setMandatoryDefaults(recovered.value.mandatoryDefaults);
      setRetainedCatalog(recovered.value.retainedCatalog ?? null);
      setDraftAccess(access); setRecoveryRevision(recovered.value.recoveryRevision);
      checkpointedInputRevision.current = recovered.value.draft?.inputRevision ?? 0;
      if (fresh) setTechnicalDraft(emptyTechnicalDraft());
      else if (recovered.value.draft) setTechnicalDraft(recovered.value.draft);
      setRecoveryBlocked(false);
    } catch { setError('بازیابی پیش‌نویس فنی انجام نشد.'); }
    finally { recoveryStarting.current = false; }
  }, [runtime, searchParams]);

  const checkpointTechnicalDraft = useCallback((draft: PartnerTechnicalDraft, access: Access): Promise<boolean> => {
    if (checkpointFlight.current) return checkpointFlight.current;
    const expectedRecoveryRevision = recoveryRevisionRef.current;
    checkpointFlight.current = (async () => {
      try {
        const result = await ports.recovery.checkpoint({ ...access, expectedRecoveryRevision,
          idempotencyKey: `partner-checkpoint-${crypto.randomUUID()}`, draft });
        if (!result.ok) { setRecoveryBlocked(true); setError(result.error.message); return false; }
        checkpointedInputRevision.current = result.value.inputRevision;
        recoveryRevisionRef.current = result.value.recoveryRevision;
        setRecoveryRevision(result.value.recoveryRevision);
        return true;
      } catch {
        setError('ذخیره خودکار پیش‌نویس نامطمئن است؛ پیش از ادامه دوباره تلاش کنید.');
        return false;
      } finally { checkpointFlight.current = null; }
    })();
    return checkpointFlight.current;
  }, []);

  const discardDraftRecovery = useCallback(async (partner: PartnerContext) => {
    if (searchParams.get('caseId')) {
      setError('پیش‌نویس متصل به پرونده را نمی‌توان به‌عنوان پیش‌نویس جدید کنار گذاشت.');
      return;
    }
    const requestedDraft = searchParams.get('draftId');
    const candidate = requestedDraft
      ? partner.recoverableDrafts?.find(item => item.recoveryId === requestedDraft)
      : partner.recoverableDraft;
    if (!candidate || recoveryStarting.current) return;
    recoveryStarting.current = true; setError(null);
    try {
      const browserSessionId = getPartnerBrowserSessionId(window.sessionStorage, partner.actorId);
      const lease = await ports.lease.acquire({ schemaVersion: 1, recoveryId: candidate.recoveryId,
        browserSessionId, baseRevision: candidate.baseRevision, takeover: true });
      if (!lease.ok) { setError(lease.error.message); return; }
      const access: Access = { schemaVersion: 1, recoveryId: candidate.recoveryId, browserSessionId,
        leaseToken: lease.value.leaseToken, baseRevision: lease.value.baseRevision };
      const recovered = await ports.recovery.read(access);
      if (!recovered.ok) { setError(recovered.error.message); return; }
      if (recovered.value.mandatoryDefaults) setMandatoryDefaults(recovered.value.mandatoryDefaults);
      setRetainedCatalog(recovered.value.retainedCatalog ?? null);
      const empty: PartnerTechnicalDraft = { schemaVersion: 1, inputRevision: Math.max(1,
        (recovered.value.draft?.inputRevision ?? 0) + 1), rows: [], dependents: [], stairSystems: [], editingValues: [] };
      const cleared = await ports.recovery.checkpoint({ ...access, expectedRecoveryRevision: recovered.value.recoveryRevision,
        idempotencyKey: `partner-discard-${crypto.randomUUID()}`, draft: empty });
      if (!cleared.ok) { setError(cleared.error.message); return; }
      checkpointedInputRevision.current = empty.inputRevision; setTechnicalDraft(empty); setDraftAccess(access);
      setRecoveryRevision(cleared.value.recoveryRevision); setRecoveryBlocked(false);
    } catch { setError('کنار گذاشتن پیش‌نویس انجام نشد.'); }
    finally { recoveryStarting.current = false; }
  }, [searchParams]);

  useEffect(() => {
    if (context?.kind !== 'PARTNER' || !context.writable || runtime || draftAccess || recoveryBlocked) return;
    const recoverableDraftCount = context.recoverableDrafts?.length ?? (context.recoverableDraft ? 1 : 0);
    if (shouldOfferPartnerDraftChoice(recoverableDraftCount, searchParams, freshInquiryRef.current)) return;
    void openDraftRecovery(context, false, freshInquiryRef.current);
  }, [context, draftAccess, openDraftRecovery, recoveryBlocked, runtime, searchParams]);

  useEffect(() => {
    if (!draftAccess || runtime || recoveryBlocked || technicalDraft.inputRevision === 0
        || technicalDraft.inputRevision <= checkpointedInputRevision.current) return;
    const timer = window.setTimeout(async () => {
      if (technicalCommitFlight.current) return;
      await checkpointTechnicalDraft(technicalDraft, draftAccess);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [checkpointTechnicalDraft, draftAccess, recoveryBlocked, recoveryRevision, runtime, technicalDraft]);

  const beginNewInquiry = useCallback(async (partner: PartnerContext) => {
    if (pending || recoveryStarting.current) return;
    setPending(true); setError(null);
    freshInquiryRef.current = true;
    setRuntime(null); setWizard(null); setDraftAccess(null); setRecoveryRevision(0); setRecoveryBlocked(false);
    recoveryRevisionRef.current = 0; checkpointedInputRevision.current = 0; inquiryHydrationFlight.current = false;
    setTechnicalDraft(emptyTechnicalDraft());
    router.replace(mode === 'inquiry' ? '/dashboard/sales/partner-inquiries?newInquiry=1'
      : '/dashboard/sales/contracts/create?newInquiry=1');
    try { await openDraftRecovery(partner, false, true); }
    finally { setPending(false); }
  }, [mode, openDraftRecovery, pending, router]);

  useEffect(() => {
    if (context?.kind !== 'PARTNER' || runtime || freshInquiryRef.current || !draftAccess || recoveryRevision < 1 ||
        searchParams.get('caseId') ||
        inquiryHydrationFlight.current || (mode === 'sale' && searchParams.get('configure') === '1')) return;
    const inquiryId = searchParams.get('inquiryId') || context.latestInquiryId;
    if (!inquiryId) return;
    inquiryHydrationFlight.current = true;
    void inquiryPorts.queries.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId }).then(async result => {
      if (!result.ok || !result.value.rows.length || result.value.rows.some(row => row.configurationRef.recoveryId !== draftAccess.recoveryId
          || row.configurationRef.recoveryRevision !== recoveryRevision)) return;
      const saved = await ports.saved.readSaved({ ...draftAccess, recoveryRevision });
      if (!saved.ok) return;
      const configuredRows: PartnerConfiguredInquiryRows = result.value.rows.map(row => ({ rowId: row.rowId,
        configuration: row.configurationRef }));
      persistRuntime({ actorId: context.actorId, inquiryId, access: draftAccess, saved: { ...saved.value, replayed: true },
        configuredRows, customerId: customerId || context.customers[0]?.id || '',
        ...(mode === 'sale' ? { contractDate, projectId } : {}) });
    }).catch(() => setError('بازیابی استعلام ذخیره‌شده انجام نشد.')).finally(() => { inquiryHydrationFlight.current = false; });
  }, [context, contractDate, customerId, draftAccess, mode, persistRuntime, projectId, recoveryRevision, runtime, searchParams]);

  const readApprovalMatches = useCallback(async (saved: PartnerTechnicalSaveReceipt, caseId?: string) => {
    const response = await api.post('/partner/cases/approval-matches', { schemaVersion: 1,
      recoveryId: saved.recoveryId, recoveryRevision: saved.recoveryRevision, ...(caseId ? { caseId } : {}) });
    const parsed = PartnerApprovalMatchSetSchema.safeParse((response.data as { data?: unknown })?.data);
    if (!parsed.success || parsed.data.recoveryId !== saved.recoveryId ||
        parsed.data.recoveryRevision !== saved.recoveryRevision) throw new Error('Invalid approval matches');
    return parsed.data;
  }, []);

  const readCasePricingRows = useCallback(async (saved: PartnerTechnicalSaveReceipt, caseId: string) => {
    const matches = await readApprovalMatches(saved, caseId);
    const inquiryId = `partner-case-pricing:${saved.recoveryId}:1`;
    const inquiry = await inquiryPorts.queries.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId });
    return inquiry.ok ? inquiry.value.rows : matches.rows;
  }, [readApprovalMatches]);

  const startInquiry = async (partner: PartnerContext, selectedProductRowIds?: ReadonlySet<string>, skipInquiry = false) => {
    if (!technicalActionReady || !draftAccess || (mode === 'sale' && (!contractDate || !customerId || !projectId))) return;
    setPending(true); setError(null);
    technicalCommitFlight.current = true;
    try {
      const saved = await commitPartnerTechnicalDraft({
        checkpointRequired: technicalDraft.inputRevision > checkpointedInputRevision.current,
        checkpoint: () => checkpointTechnicalDraft(technicalDraft, draftAccess),
        save: () => ports.saved.save({ ...draftAccess, expectedRecoveryRevision: recoveryRevisionRef.current,
          idempotencyKey: `partner-save-${crypto.randomUUID()}`, draft: technicalDraft }),
      });
      if (!saved) return;
      if (!saved.ok) { setError(saved.error.message); return; }
      setRecoveryRevision(saved.value.recoveryRevision);
      const subjects = saved.value.pricingSubjects ?? saved.value.rows.map(row => ({ configurationRef: row.configurationRef,
        role: 'PRIMARY' as const }));
      const matches = mode === 'sale' && !skipInquiry ? await readApprovalMatches(saved.value) : null;
      const missing = new Set(matches?.missingPricingSubjectIds ?? subjects.map(row => row.configurationRef.productRowId));
      const availableRows: PartnerConfiguredInquiryRows = subjects.filter(row => missing.has(row.configurationRef.productRowId)).map(row => ({
        rowId: `partner-inquiry-row-${crypto.randomUUID()}`, configuration: row.configurationRef,
        ...(mode === 'inquiry' ? { dimensions: normalizedQuickDimensions(row.configurationRef.productRowId) } : {}),
        ...(inquiryNote.trim() ? { sellerNote: inquiryNote.trim() } : {}) }));
      const configuredByProductRowId = new Map(availableRows.map(row => [row.configuration.productRowId, row]));
      for (const row of matches?.rows ?? []) configuredByProductRowId.set(row.configurationRef.productRowId,
        { rowId: row.rowId, configuration: row.configurationRef });
      const allConfiguredRows = subjects.map(subject => configuredByProductRowId.get(subject.configurationRef.productRowId)!)
        .filter(Boolean);
      if (skipInquiry && mode === 'sale') {
        const inquiryId = `${saved.value.recoveryId}-unpriced`;
        const value = { actorId: partner.actorId, inquiryId, access: draftAccess, saved: saved.value,
          configuredRows: allConfiguredRows, knownInquiryRows: [], customerId, contractDate, projectId };
        persistRuntime(value);
        setInitialInquiryOpen(false);
        freshInquiryRef.current = false;
        await enterWizard({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId, rows: [] }, value);
        return;
      }
      if (!availableRows.length && matches?.rows.length) {
        const inquiryId = matches.rows[0].approvedRowBinding!.inquiryId;
        persistRuntime({ actorId: partner.actorId, inquiryId, access: draftAccess, saved: saved.value,
          configuredRows: allConfiguredRows, knownInquiryRows: matches.rows,
          customerId, contractDate, projectId });
        setInitialInquiryOpen(false);
        freshInquiryRef.current = false;
        router.replace('/dashboard/sales/contracts/create');
        return;
      }
      const configuredRows = selectedProductRowIds
        ? availableRows.filter(row => selectedProductRowIds.has(row.configuration.productRowId)) : availableRows;
      if (!configuredRows.length) { setError('حداقل یک ردیف نیازمند استعلام را انتخاب کنید.'); return; }
      const inquiryId = `partner-inquiry-${crypto.randomUUID()}`;
      const intent = { schemaVersion: 1 as const, type: 'INQUIRY_SUBMIT' as const,
        partnerSellerId: partner.actorId, rows: configuredRows };
      const payloadHash = await canonicalHash(intent);
      const command = PartnerCommandSchema.parse({ ...intent, commandId: payloadHash, correlationId: payloadHash,
        idempotency: { actorId: partner.actorId, operation: 'INQUIRY_SUBMIT', targetId: inquiryId,
          key: payloadHash, payloadHash } });
      window.localStorage.setItem(inquiryPendingKey(partner.actorId), JSON.stringify(command));
      const submitted = await inquiryPorts.commands.execute(command);
      if (!submitted.ok) { window.localStorage.removeItem(inquiryPendingKey(partner.actorId)); setError(submitted.error.message); return; }
      const value = { actorId: partner.actorId, inquiryId, access: draftAccess, saved: saved.value,
        configuredRows: allConfiguredRows, knownInquiryRows: matches?.rows,
        customerId, ...(mode === 'sale' ? { contractDate, projectId } : {}) };
      window.localStorage.removeItem(inquiryPendingKey(partner.actorId)); persistRuntime(value);
      setInitialInquiryOpen(false);
      freshInquiryRef.current = false;
      router.replace(mode === 'inquiry'
        ? `/dashboard/sales/partner-inquiries?inquiryId=${encodeURIComponent(inquiryId)}`
        : '/dashboard/sales/contracts/create');
    } catch { setError('ذخیره مشخصات یا ارسال استعلام کامل نشد؛ ورودی‌ها حفظ شده‌اند.'); }
    finally { technicalCommitFlight.current = false; setPending(false); }
  };

  const submissionActorId = runtime?.actorId;
  const submissionRecoveryId = runtime?.access.recoveryId;
  const submission = useMemo(() => {
    if (!submissionActorId || !submissionRecoveryId) return null;
    return createPartnerCaseSubmission({ actorId: submissionActorId, commands: caseCommands, initialCase: editingCase ?? undefined, recovery: {
      pending: () => readStored<PartnerDraftCommand>(partnerCasePendingStorageKey(submissionActorId, submissionRecoveryId)),
      savePending: async command => {
        const active = runtimeRef.current;
        if (!active || active.actorId !== submissionActorId || active.access.recoveryId !== submissionRecoveryId) {
          throw new Error('Recovery changed');
        }
        if (command.type === 'CASE_SUBMIT') {
          const refreshed = await reacquireRuntime(active);
          if (!refreshed) throw new Error('Recovery lease unavailable');
          const current = await ports.saved.readSaved({ ...refreshed.access, recoveryRevision: refreshed.saved.recoveryRevision });
          if (!current.ok || current.value.graphHash !== refreshed.saved.graphHash) throw new Error('Recovery changed');
        }
        window.localStorage.setItem(partnerCasePendingStorageKey(submissionActorId, submissionRecoveryId), JSON.stringify(command));
      },
      clearPending: async () => { window.localStorage.removeItem(partnerCasePendingStorageKey(submissionActorId, submissionRecoveryId)); },
      // The numbered Case is now created at the pricing boundary. Keep the
      // recovery/runtime alive because delivery and payment still belong to
      // this same editable Case; only the command checkpoint is complete.
      finalizeCommitted: async () => {
        window.localStorage.removeItem(partnerCasePendingStorageKey(submissionActorId, submissionRecoveryId));
      },
      prepareEditLease: async () => {
        const active = runtimeRef.current;
        if (!active || active.actorId !== submissionActorId || active.access.recoveryId !== submissionRecoveryId) {
          throw new Error('Recovery changed');
        }
        const refreshed = await reacquireRuntime(active);
        if (!refreshed) throw new Error('Recovery lease unavailable');
        return { recoveryId: refreshed.access.recoveryId, browserSessionId: refreshed.access.browserSessionId,
          leaseToken: refreshed.access.leaseToken, baseRevision: refreshed.access.baseRevision };
      },
    } });
  }, [editingCase, reacquireRuntime, submissionActorId, submissionRecoveryId]);

  const enterWizard = async (inquiry: PartnerInquiryView, runtimeOverride?: PersistedRuntime) => {
    const currentRuntime = runtimeOverride ?? runtime;
    if (!currentRuntime || !context || context.kind !== 'PARTNER') return;
    setError(null);
    const refreshed = await reacquireRuntime(currentRuntime);
    if (!refreshed) return;
    const validated = await ports.saved.readSaved({ ...refreshed.access, recoveryRevision: refreshed.saved.recoveryRevision });
    if (!validated.ok) { setError(validated.error.message); return; }
    let inquiryRows: readonly PartnerInquiryRow[] = inquiry.rows;
    try {
      const caseId = editingCase?.owner.caseId;
      inquiryRows = caseId ? await readCasePricingRows(refreshed.saved, caseId) : inquiry.rows;
    } catch { /* The exact inquiry view remains a safe fallback for older records. */ }
    const selectedCustomerId = currentRuntime.customerId || customerId || context.customers[0]?.id || '';
    const customer = context.customers.find(item => item.id === selectedCustomerId);
    const selectedProject = context.projects.find(item => item.id === currentRuntime.projectId && item.customerId === selectedCustomerId);
    const approved = inquiryRows.filter(row => row.state === 'APPROVED' && row.approvedPrice);
    const currency = technicalDraft.rows.find(row => row.retailUnitPrice)?.retailUnitPrice?.currency
      ?? approved[0]?.approvedPrice?.currency ?? 'IRT';
    if (!customer) { openSharedCustomerCreation(); return; }
    if (!selectedProject) { setSaleStep('project'); setError('برای ایجاد قرارداد، پروژه را انتخاب کنید.'); return; }
    const selectedContractDate = currentRuntime.contractDate || contractDate || today();
    const draft = enterPartnerWizard({ inquiryRows, now: Date.now(), validated: validated.value,
      retailUnitPrices: new Map(technicalDraft.rows.flatMap(row => row.retailUnitPrice
        ? [[row.productRowId, row.retailUnitPrice] as const] : [])),
      base: { customerId: customer.id, recoveryId: currentRuntime.saved.recoveryId, recoveryRevision: currentRuntime.saved.recoveryRevision,
        contractDate: selectedContractDate, projectId: selectedProject.id,
        customerPaymentPlan: { planId: `partner-customer-plan-${crypto.randomUUID()}`, version: 1,
          effectiveDate: selectedContractDate, installments: [{ installmentId: `partner-installment-${crypto.randomUUID()}`,
            dueDate: addDays(selectedContractDate, 30), amount: { amount: '0', currency }, method: 'BANK_TRANSFER', subtype: 'SHIBA' }] },
        deliveries: currentRuntime.saved.rows.map((row, index) => ({ deliveryId: `partner-delivery-${crypto.randomUUID()}`,
          date: addDays(selectedContractDate, 7 + index), destination: customer.address,
          receiverName: customer.displayName,
          items: [{ productRowId: row.configurationRef.productRowId, quantity: row.quantity }] })),
        retailDiscount: { amount: '0', currency }, retailDiscountPercent: '0',
      } });
    if (!draft) { setError('همه ردیف‌های فنی باید پاسخ معتبر و جاری داشته باشند.'); return; }
    draft.step = 'products';
    const restoreIntent = (intent: typeof draft.intent, step: PartnerWizardStep) => {
      if (intent.recoveryRevision !== draft.intent.recoveryRevision || intent.graphHash !== draft.intent.graphHash ||
          intent.rows.length !== draft.rows.length || intent.rows.some(row => !draft.rows.some(current => current.productRowId === row.productRowId))) {
        return false;
      }
      const rows = draft.rows.map(row => ({ ...row,
        retailUnitPrice: intent.rows.find(item => item.productRowId === row.productRowId)!.retailUnitPrice }));
      setWizard({ ...draft, step, rows, intent: { ...intent,
        rows: partnerRetailIntentRows(rows),
        customerPaymentPlan: alignPartnerCustomerPaymentPlan(rows, intent.retailDiscount, intent.customerPaymentPlan),
        additionalMaterialApprovals: draft.intent.additionalMaterialApprovals } });
      return true;
    };
    const restoreAcrossProductEdit = (intent: typeof draft.intent) => {
      const preservedCustomer = context.customers.find(item => item.id === intent.customerId);
      const nextCustomerId = preservedCustomer?.id ?? draft.intent.customerId;
      const preservedProject = context.projects.find(item => item.id === intent.projectId
        && item.customerId === nextCustomerId);
      const rows = draft.rows.map(row => {
        const previous = intent.rows.find(item => item.productRowId === row.productRowId);
        return previous?.retailUnitPrice.currency === row.retailUnitPrice.currency
          ? { ...row, retailUnitPrice: previous.retailUnitPrice } : row;
      });
      const deliveries = preservePartnerDeliveriesAcrossProductEdit(intent.deliveries, draft.intent.deliveries,
        rows.map(row => row.productRowId));
      const paymentPlan = intent.customerPaymentPlan.installments.every(item => item.amount.currency === currency)
        ? intent.customerPaymentPlan : draft.intent.customerPaymentPlan;
      const retailDiscount = intent.retailDiscount.currency === currency ? intent.retailDiscount : draft.intent.retailDiscount;
      const nextIntent = { ...draft.intent, contractDate: intent.contractDate, customerId: nextCustomerId,
        ...(preservedProject ? { projectId: preservedProject.id } : {}), deliveries, customerPaymentPlan: paymentPlan,
        retailDiscount, belowCostConfirmed: false,
        rows: partnerRetailIntentRows(rows),
        additionalMaterialApprovals: draft.intent.additionalMaterialApprovals };
      setCustomerId(nextCustomerId);
      setWizard({ ...draft, step: 'products', rows, intent: { ...nextIntent,
        customerPaymentPlan: alignPartnerCustomerPaymentPlan(rows, nextIntent.retailDiscount,
          nextIntent.customerPaymentPlan) } });
    };
    const stored = readStored<{ savedAt: number; serverRevision?: number; draft: PartnerWizardDraft }>(
      wizardDraftKey(currentRuntime.actorId, draft.intent.recoveryId));
    const storedIntent = stored && Date.now() - stored.savedAt <= 7 * 24 * 60 * 60 * 1000
      ? CaseDraftIntentSchema.safeParse(stored.draft?.intent) : undefined;
    try {
      const response = await api.get(`/partner/cases/drafts/${encodeURIComponent(draft.intent.recoveryId)}/wizard`);
      const savedWizard = PartnerWizardRecoverySnapshotSchema.safeParse((response.data as { data?: unknown })?.data);
      if (savedWizard.success) {
        wizardServerRevision.current = savedWizard.data.wizardRevision;
        if (stored && storedIntent?.success && shouldPreferLocalPartnerWizard(stored.serverRevision, savedWizard.data.wizardRevision)) {
          const sameLocalRows = stored.draft.rows.length === draft.rows.length &&
            stored.draft.rows.every(row => draft.rows.some(current => current.productRowId === row.productRowId));
          if (sameLocalRows && storedIntent.data.recoveryRevision === draft.intent.recoveryRevision &&
              storedIntent.data.graphHash === draft.intent.graphHash && restoreIntent(storedIntent.data, stored.draft.step)) return;
          restoreAcrossProductEdit(storedIntent.data);
          return;
        }
        if (restoreIntent(savedWizard.data.intent, savedWizard.data.step)) return;
        restoreAcrossProductEdit(savedWizard.data.intent);
        return;
      }
    } catch (caught) {
      const status = (caught as { response?: { status?: number } })?.response?.status;
      if (status !== 404) setError('بازیابی پیش‌نویس قرارداد انجام نشد؛ نسخه محلی بررسی می‌شود.');
    }
    const sameRows = storedIntent?.success && stored!.draft.rows.length === draft.rows.length &&
      stored!.draft.rows.every(row => draft.rows.some(current => current.productRowId === row.productRowId));
    if (sameRows && storedIntent?.success && storedIntent.data.recoveryRevision === draft.intent.recoveryRevision &&
        storedIntent.data.graphHash === draft.intent.graphHash) {
      if (restoreIntent(storedIntent.data, stored!.draft.step)) return;
    }
    if (storedIntent?.success) { restoreAcrossProductEdit(storedIntent.data); return; }
    wizardServerRevision.current = 0;
    setWizard({ ...draft, intent: { ...draft.intent,
      customerPaymentPlan: alignPartnerCustomerPaymentPlan(draft.rows, draft.intent.retailDiscount,
        draft.intent.customerPaymentPlan) } });
  };
  const enterWizardRef = useRef(enterWizard);
  enterWizardRef.current = enterWizard;

  useEffect(() => {
    const caseId = searchParams.get('caseId');
    if (!caseId || context?.kind !== 'PARTNER' || !draftAccess || recoveryRevision < 1 || wizard ||
        editingHydrationFlight.current) return;
    editingHydrationFlight.current = true;
    void (async () => {
      const [caseResponse, wizardResponse, savedResult] = await Promise.all([
        api.post('/partner/cases/query-v2', { caseId }),
        api.get(`/partner/cases/drafts/${encodeURIComponent(draftAccess.recoveryId)}/wizard`),
        ports.saved.readSaved({ ...draftAccess, recoveryRevision }),
      ]);
      const cases = PartnerCaseRuntimeResultSchema.safeParse((caseResponse.data as { data?: unknown })?.data);
      const recoveredWizard = PartnerWizardRecoverySnapshotSchema.safeParse((wizardResponse.data as { data?: unknown })?.data);
      if (!cases.success || cases.data.cases.length !== 1 || !savedResult.ok || !recoveredWizard.success ||
          cases.data.cases[0].view.owner.caseId !== caseId ||
          recoveredWizard.data.intent.recoveryId !== draftAccess.recoveryId) throw new Error('Invalid editable Case recovery');
      const savedReceipt: PartnerTechnicalSaveReceipt = { ...savedResult.value, replayed: true };
      const matches = await readApprovalMatches(savedReceipt, caseId);
      const inquiryId = matches.rows[0]?.approvedRowBinding?.inquiryId ?? `${draftAccess.recoveryId}-edit`;
      const configuredRows: PartnerConfiguredInquiryRows = (savedResult.value.pricingSubjects ?? savedResult.value.rows.map(row => ({
        configurationRef: row.configurationRef, role: 'PRIMARY' as const,
      }))).map((subject, index) => ({
        rowId: matches.rows.find(row => row.configurationRef.productRowId === subject.configurationRef.productRowId)?.rowId
          ?? `${subject.configurationRef.productRowId}-edit-${index + 1}`,
        configuration: subject.configurationRef,
      }));
      const value: PersistedRuntime = { actorId: context.actorId, inquiryId, access: draftAccess,
        saved: savedReceipt, configuredRows, knownInquiryRows: matches.rows,
        customerId: recoveredWizard.data.intent.customerId,
        contractDate: recoveredWizard.data.intent.contractDate,
        ...(recoveredWizard.data.intent.projectId ? { projectId: recoveredWizard.data.intent.projectId } : {}) };
      setEditingCase(cases.data.cases[0].view);
      setCustomerId(value.customerId); setContractDate(value.contractDate!); setProjectId(value.projectId ?? '');
      persistRuntime(value);
      if (searchParams.get('configure') === '1') setSaleStep('products');
      else await enterWizardRef.current({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId, rows: matches.rows }, value);
    })().catch(() => setError('بازیابی پرونده ذخیره‌شده انجام نشد؛ هیچ تغییری ثبت نشده است.'))
      .finally(() => { editingHydrationFlight.current = false; });
  }, [context, draftAccess, persistRuntime, readApprovalMatches, recoveryRevision, searchParams, wizard]);

  useEffect(() => {
    if (mode !== 'sale' || !runtime || wizard || searchParams.get('caseId') || searchParams.get('configure') === '1' || runtimeWizardHydrationFlight.current) return;
    runtimeWizardHydrationFlight.current = true;
    void enterWizardRef.current({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: runtime.inquiryId,
      rows: runtime.knownInquiryRows ?? [] }, runtime)
      .catch(() => setError('بازیابی مرحله قرارداد انجام نشد؛ اطلاعات ذخیره‌شده حفظ شده است.'))
      .finally(() => { runtimeWizardHydrationFlight.current = false; });
  }, [mode, runtime, searchParams, wizard]);

  const updateWizard = (next: PartnerWizardDraft) => {
    const retailDiscount = next.intent.retailDiscountPercent === undefined ? next.intent.retailDiscount
      : partnerRetailDiscountFromPercent(next.rows, next.intent.retailDiscountPercent,
        next.intent.retailDiscount.currency) ?? next.intent.retailDiscount;
    setWizard({ ...next, intent: { ...next.intent, retailDiscount,
      customerPaymentPlan: alignPartnerCustomerPaymentPlan(next.rows, retailDiscount,
        next.intent.customerPaymentPlan) } });
    if (context?.kind === 'PARTNER' && next.intent.projectId && next.intent.recoveryId) {
      const customer = context.customers.find(item => item.id === next.intent.customerId)?.displayName;
      const project = context.projects.find(item => item.id === next.intent.projectId)?.title;
      const existing = context.recoverableDrafts?.find(item => item.recoveryId === next.intent.recoveryId)?.title;
      if (!existing && customer && project && !autoTitledDrafts.current.has(next.intent.recoveryId)) {
        const recoveryId = next.intent.recoveryId;
        const title = `${customer} — ${project}`;
        autoTitledDrafts.current.add(recoveryId);
        void api.patch(`/partner/cases/drafts/${encodeURIComponent(recoveryId)}`, { title }).then(() => {
          setContext(current => current?.kind === 'PARTNER' ? { ...current,
            recoverableDrafts: current.recoverableDrafts?.map(item => item.recoveryId === recoveryId ? { ...item, title } : item),
            recoverableDraft: current.recoverableDraft?.recoveryId === recoveryId
              ? { ...current.recoverableDraft, title } : current.recoverableDraft } : current);
        }).catch(() => autoTitledDrafts.current.delete(recoveryId));
      }
    }
  };

  const openPartnerPaymentModal = (installment: PartnerPaymentInstallment, isNew: boolean, isFirst: boolean) => {
    setPaymentModal({ installment, isNew, isFirst });
    setPaymentForm(paymentEntryFromPartnerInstallment(installment));
    setPaymentModalErrors({});
  };

  const closePartnerPaymentModal = () => {
    setPaymentModal(null);
    setPaymentForm({});
    setPaymentModalErrors({});
  };

  const savePartnerPayment = (draft: PartnerWizardDraft) => {
    if (!paymentModal) return;
    const entry: PaymentEntry = {
      id: paymentModal.installment.installmentId,
      method: paymentForm.method ?? 'CASH_SHIBA',
      amount: Number(paymentForm.amount ?? 0),
      paymentDate: paymentForm.paymentDate ?? '',
      nationalCode: paymentForm.nationalCode ? normalizeNumericText(paymentForm.nationalCode).replace(/\D/g, '') : undefined,
      checkNumber: paymentForm.checkNumber,
      checkOwnerName: paymentForm.checkOwnerName,
      handoverDate: paymentForm.handoverDate,
    };
    const installment = partnerInstallmentFromPaymentEntry(paymentModal.installment, entry);
    const validation = validatePartnerPaymentInstallment(installment, today());
    if (Object.keys(validation).length > 0) {
      setPaymentModalErrors({
        amount: validation.amount,
        paymentDate: validation.date,
        checkNumber: validation.number,
        checkOwnerName: validation.ownerName,
        handoverDate: validation.handoverDate,
        nationalCode: validation.nationalCode,
      });
      return;
    }
    const current = draft.intent.customerPaymentPlan.installments;
    const installments = paymentModal.isNew
      ? [...current, installment]
      : current.map(item => item.installmentId === installment.installmentId ? installment : item);
    updateWizard({ ...draft, intent: { ...draft.intent,
      customerPaymentPlan: { ...draft.intent.customerPaymentPlan, installments } } });
    closePartnerPaymentModal();
  };

  const deleteDraft = async (recoveryId: string) => {
    if (context?.kind !== 'PARTNER') return;
    await api.delete(`/partner/cases/drafts/${encodeURIComponent(recoveryId)}`);
    setContext({ ...context, recoverableDrafts: context.recoverableDrafts?.filter(item => item.recoveryId !== recoveryId),
      recoverableDraft: context.recoverableDraft?.recoveryId === recoveryId ? undefined : context.recoverableDraft });
  };

  const quoteReady = Boolean(wizard?.intent.projectId);
  const quoteKey = wizard && quoteReady ? JSON.stringify({ recoveryId: wizard.intent.recoveryId,
    recoveryRevision: wizard.intent.recoveryRevision, graphHash: wizard.intent.graphHash,
    customerId: wizard.intent.customerId, projectId: wizard.intent.projectId,
    rows: wizard.intent.rows.map(row => ({ productRowId: row.productRowId,
      retailUnitPrice: row.retailUnitPrice, binding: row.approvedRowBinding })),
    materials: wizard.intent.additionalMaterialApprovals }) : '';
  useEffect(() => {
    if (!wizard?.intent.projectId || !runtime || !quoteReady) return;
    let cancelled = false;
    const requestedRetailPrices = new Map(wizard.intent.rows.map(row => [row.productRowId,
      `${row.retailUnitPrice.currency}:${row.retailUnitPrice.amount}`]));
    void (async () => {
      const payloadHash = await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: wizard.intent });
      const command = PartnerCommandSchema.parse({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: wizard.intent,
        commandId: `partner-quote-${crypto.randomUUID()}`, correlationId: `partner-quote-${crypto.randomUUID()}`,
        idempotency: { actorId: runtime.actorId, operation: 'CASE_SUBMIT', targetId: wizard.intent.recoveryId,
          key: `partner-quote-${crypto.randomUUID()}`, payloadHash } });
      const response = await api.post('/partner/cases/quote', command);
      const quote = PartnerWholesaleQuoteSchema.safeParse((response.data as { data?: unknown })?.data);
      if (!quote.success || cancelled || quote.data.recoveryId !== wizard.intent.recoveryId ||
          quote.data.recoveryRevision !== wizard.intent.recoveryRevision || quote.data.graphHash !== wizard.intent.graphHash) return;
      setWizard(current => {
        if (!current || current.intent.recoveryId !== quote.data.recoveryId ||
            current.intent.recoveryRevision !== quote.data.recoveryRevision || current.intent.rows.some(row =>
              requestedRetailPrices.get(row.productRowId) !==
                `${row.retailUnitPrice.currency}:${row.retailUnitPrice.amount}`)) return current;
        const rows = current.rows.map(row => {
          const quoted = quote.data.rows.find(item => item.productRowId === row.productRowId);
          return quoted ? { ...row, retailEffectiveUnitPrice: quoted.retailEffectiveUnitPrice,
            ...(quoted.wholesaleUnitPrice ? { wholesaleUnitPrice: quoted.wholesaleUnitPrice } : {}) } : row;
        });
        const retailDiscount = current.intent.retailDiscountPercent === undefined ? current.intent.retailDiscount
          : partnerRetailDiscountFromPercent(rows, current.intent.retailDiscountPercent,
            current.intent.retailDiscount.currency) ?? current.intent.retailDiscount;
        return { ...current, rows, intent: { ...current.intent, rows: partnerRetailIntentRows(rows), retailDiscount,
          customerPaymentPlan: alignPartnerCustomerPaymentPlan(rows, retailDiscount,
            current.intent.customerPaymentPlan) } };
      });
    })().catch(() => !cancelled && setError('محاسبه مبلغ محصولات انجام نشد؛ دوباره تلاش کنید.'));
    return () => { cancelled = true; };
  // quoteKey includes Partner material prices and approval bindings, but excludes
  // derived effective rates so applying a response cannot start a request loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed by price-bearing identities only
  }, [quoteKey, quoteReady]);

  useEffect(() => {
    if (!wizardRecoveryId || !runtime) return;
    let cancelled = false;
    const refresh = async () => {
      const activeCaseId = submission?.getSnapshot().case?.owner.caseId;
      if (!activeCaseId) return;
      const rowsFromCase = await readCasePricingRows(runtime.saved, activeCaseId);
      if (cancelled) return;
      setWizard(current => {
        if (!current) return current;
        const latestFor = (subjectId: string, previous: PartnerInquiryRow) => rowsFromCase
          .filter(row => row.configurationRef.productRowId === subjectId && row.state !== 'SUPERSEDED')
          .at(-1) ?? previous;
        const rows = current.rows.map(row => {
          const inquiryRow = latestFor(row.productRowId, row.inquiryRow);
          return refreshPartnerInquiryRow(row, inquiryRow);
        });
        const materialInquiryRows = (current.materialInquiryRows ?? []).map(row => ({ ...row,
          inquiryRow: latestFor(row.pricingSubjectId, row.inquiryRow) }));
        const additionalMaterialApprovals = materialInquiryRows.flatMap(row => row.inquiryRow.approvedRowBinding
          ? [{ pricingSubjectId: row.pricingSubjectId, approvedRowBinding: row.inquiryRow.approvedRowBinding }] : []);
        return { ...current, rows, materialInquiryRows, intent: { ...current.intent,
          rows: partnerRetailIntentRows(rows), additionalMaterialApprovals } };
      });
    };
    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [readCasePricingRows, runtime, submission, wizardRecoveryId]);

  const reinquireFromWizard = async (requestedRow?: PartnerInquiryRow) => {
    if (!runtime || !wizard) return;
    setError(null);
    try {
      const activeOwner = submission?.getSnapshot().case?.owner;
      if (!activeOwner) throw new Error('Numbered Case required');
      const sourceRows = [...wizard.rows.map(item => item.inquiryRow),
        ...(wizard.materialInquiryRows ?? []).map(item => item.inquiryRow)];
      const selectedPackage = selectPartnerReinquiryRows(sourceRows,
        `partner-case-pricing:${wizard.intent.recoveryId}:1`, requestedRow);
      const selected = selectedPackage.rows;
      const rows = selected.map(item => {
        const deliveryFacts = wizard.intent.deliveries.flatMap(delivery => delivery.items
          .filter(deliveryItem => deliveryItem.productRowId === item.configurationRef.productRowId)
          .map(deliveryItem => ({ date: delivery.date, quantity: deliveryItem.quantity })));
        return { rowId: `partner-inquiry-row-${crypto.randomUUID()}`, configuration: item.configurationRef,
          ...(deliveryFacts.length ? { deliveryFacts } : {}),
          predecessor: { rowId: item.rowId, revision: item.revision } };
      });
      const scopedInquiryId = selectedPackage.inquiryId;
      const intent = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const,
        caseId: activeOwner.caseId, expected: activeOwner, inquiryId: scopedInquiryId, rows };
      const payloadHash = await canonicalHash(intent);
      const command = PartnerCommandSchema.parse({ ...intent, commandId: payloadHash, correlationId: payloadHash,
        idempotency: { actorId: runtime.actorId, operation: intent.type,
          targetId: activeOwner.caseId,
          key: payloadHash, payloadHash } });
      const result = await inquiryPorts.commands.execute(command);
      if (!result.ok) { setError(result.error.message); return; }
      const pendingByProductRowId = new Map(rows.map(item => [item.configuration.productRowId, {
        inquiryId: scopedInquiryId, rowId: item.rowId, revision: 1, state: 'PENDING' as const,
      }]));
      setWizard(current => current ? { ...current,
        rows: current.rows.map(item => ({ ...item, inquiryRow: pendingByProductRowId.has(item.productRowId)
          ? { ...item.inquiryRow, successor: pendingByProductRowId.get(item.productRowId) } : item.inquiryRow })),
        materialInquiryRows: current.materialInquiryRows?.map(item => ({ ...item,
          inquiryRow: pendingByProductRowId.has(item.pricingSubjectId)
            ? { ...item.inquiryRow, successor: pendingByProductRowId.get(item.pricingSubjectId) } : item.inquiryRow })),
      } : current);
    } catch { setError('ارسال استعلام مجدد انجام نشد؛ اطلاعات Wizard حفظ شده است.'); }
  };

  const renderSection = (step: Exclude<PartnerWizardStep, 'products' | 'pricing'>, draft: PartnerWizardDraft,
    showValidationErrors: boolean) => {
    if (!context || context.kind !== 'PARTNER') return null;
    if (step === 'date') return <ContractDateStepView creatorName={context.actorDisplayName}
      dateControl={<PersianCalendarComponent value={draft.intent.contractDate} className="w-full"
        onChange={contractDate => updateWizard({ ...draft, intent: { ...draft.intent, contractDate } })} />}
      numberNotice="شماره پس از ثبت موفق قرارداد تخصیص داده می‌شود." />;
    if (step === 'customer') return <ContractCustomerStepView
      customers={partnerCustomerOptions(context, customerSearchTerm)}
      selectedCustomer={selectedPartnerCustomer(context, draft.intent.customerId)}
      selectedCustomerId={draft.intent.customerId} searchTerm={customerSearchTerm} totalCount={context.customers.length}
      searchPlaceholder="جستجو با نام یا شماره تلفن"
      onSearchChange={setCustomerSearchTerm} onCreate={() => openSharedCustomerCreation(draft.intent.customerId)}
      onSelect={value => updateWizard({ ...draft, intent: { ...draft.intent, customerId: value,
        projectId: context.projects.some(project => project.id === draft.intent.projectId && project.customerId === value)
          ? draft.intent.projectId : undefined } })} />;
    if (step === 'project') {
      const selection = partnerProjectSelection(context, draft.intent.customerId);
      return <div className="space-y-4">
      <ContractProjectStepView
        customerName={selection.customerName}
        projects={selection.projects}
        selectedProjectId={draft.intent.projectId} onCreate={() => setShowProjectForm(true)}
        onSelect={value => updateWizard({ ...draft, intent: { ...draft.intent, projectId: value } })} />
      <ErpSheet open={showProjectForm} onClose={() => setShowProjectForm(false)} title="ثبت پروژه جدید"
        presentation="modal" pending={pending} footer={<ErpButton label="ثبت و انتخاب پروژه"
          disabled={pending || !projectFormValid} onClick={() => void createProject(context, draft.intent.customerId)
            .then(created => created && updateWizard({ ...draft, intent: { ...draft.intent, projectId: created.id } }))} />}>
        <CustomerProjectFormFields value={projectForm} errors={projectFormErrors}
          onChange={(field, value) => setProjectForm(current => ({ ...current, [field]: value }))} />
      </ErpSheet>
      </div>;
    }
    if (step === 'delivery') return <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-medium">لیست تحویل‌ها</h3>
        <ErpButton label="افزودن تحویل" onClick={() => updateWizard({ ...draft, intent: { ...draft.intent,
          deliveries: [...draft.intent.deliveries, { deliveryId: `partner-delivery-${crypto.randomUUID()}`,
            date: addDays(draft.intent.contractDate, 7), destination: context.customers.find(item => item.id === draft.intent.customerId)?.address ?? '',
            receiverName: context.customers.find(item => item.id === draft.intent.customerId)?.displayName,
            items: [] }] } })} />
      </div>{draft.intent.deliveries.map((delivery, index) => <ErpNeumorphicCard key={delivery.deliveryId} className="space-y-4 p-6">
      <div className="flex items-center justify-between"><h3 className="font-semibold">تحویل {(index + 1).toLocaleString('fa-IR')}</h3>
        {draft.intent.deliveries.length > 1 && <ErpButton label="حذف تحویل" tone="danger" variant="outline"
          onClick={() => updateWizard({ ...draft, intent: { ...draft.intent,
            deliveries: draft.intent.deliveries.filter(item => item.deliveryId !== delivery.deliveryId) } })} />}</div>
      <ContractDeliveryDetailsFields value={{ date: delivery.date, address: delivery.destination,
        projectManagerName: delivery.projectManagerName ?? '', receiverName: delivery.receiverName ?? '',
        notes: delivery.notes ?? '' }} errors={showValidationErrors ? {
          ...(!delivery.date ? { date: 'تاریخ تحویل الزامی است.' } : {}),
          ...(!delivery.destination.trim() ? { address: 'آدرس تحویل الزامی است.' } : {}),
          ...(!delivery.projectManagerName?.trim() ? { projectManagerName: 'نام مدیر پروژه الزامی است.' } : {}),
          ...(!delivery.receiverName?.trim() ? { receiverName: 'نام تحویل‌گیرنده الزامی است.' } : {}),
        } : {}} onChange={updates => updateWizard({ ...draft, intent: { ...draft.intent,
          deliveries: draft.intent.deliveries.map(item => item.deliveryId === delivery.deliveryId ? {
            ...item,
            ...(updates.date !== undefined ? { date: updates.date } : {}),
            ...(updates.address !== undefined ? { destination: updates.address } : {}),
            ...(updates.projectManagerName !== undefined
              ? { projectManagerName: updates.projectManagerName || undefined } : {}),
            ...(updates.receiverName !== undefined ? { receiverName: updates.receiverName || undefined } : {}),
            ...(updates.notes !== undefined ? { notes: updates.notes || undefined } : {}),
          } : item),
        } })} />
      <ErpNeumorphicCard className="space-y-3 p-4"><h4 className="text-sm font-semibold">محصولات این تحویل</h4>
        {draft.rows.map(row => {
          const current = delivery.items.find(item => item.productRowId === row.productRowId)?.quantity ?? '0';
          const others = draft.intent.deliveries.filter(item => item.deliveryId !== delivery.deliveryId)
            .flatMap(item => item.items.filter(product => product.productRowId === row.productRowId).map(product => product.quantity));
          const maximum = remainingPartnerAmount(row.quantity, others);
          const unallocated = remainingPartnerAmount(row.quantity, draft.intent.deliveries
            .flatMap(item => item.items.filter(product => product.productRowId === row.productRowId).map(product => product.quantity)));
          const updateQuantity = (quantity: string) => {
            if (remainingPartnerAmount(row.quantity, [...others, quantity]) === null) return;
            updateWizard({ ...draft, intent: { ...draft.intent, deliveries: draft.intent.deliveries.map(item =>
              item.deliveryId !== delivery.deliveryId ? item : { ...item,
                items: [...item.items.filter(product => product.productRowId !== row.productRowId),
                  ...(Number(quantity) > 0 ? [{ productRowId: row.productRowId, quantity }] : [])] }) } });
          };
          return <ErpCard key={row.productRowId} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{row.inquiryRow.description}</strong>
              <ErpField label={`مقدار (${row.unit})`}><ErpInput inputMode="decimal" value={current}
                onChange={event => updateQuantity(event.target.value)} /></ErpField></div>
            <div className="sds-text-secondary flex flex-wrap gap-3 text-xs"><span>کل قرارداد: {row.quantity} {row.unit}</span>
              <span>تحویل‌های دیگر: {maximum === null ? 'نامعتبر' : remainingPartnerAmount(row.quantity, [maximum])} {row.unit}</span>
              <span>مانده: {unallocated ?? 'نامعتبر'} {row.unit}</span>
              {maximum !== null && current !== maximum && <ErpPressable type="button"
                onClick={() => updateQuantity(maximum)}>پر کردن ({maximum})</ErpPressable>}</div>
            {showValidationErrors && unallocated !== '0' && <ErpInlineState kind="stale"
              title="جمع مقدارهای تحویل باید دقیقاً با مقدار قرارداد برابر باشد." />}
          </ErpCard>;
        })}
      </ErpNeumorphicCard>
    </ErpNeumorphicCard>)}</div>;
    if (step === 'payment') { const retailSummary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
      const retailSubtotal = partnerRetailSubtotal(draft.rows, draft.intent.retailDiscount.currency); return <div className="space-y-3">
      <ContractDiscountEditor mode="percent" value={draft.intent.retailDiscountPercent ?? '0'}
        label="درصد تخفیف فروش به مشتری" max="100"
        description="این تخفیف فقط از قیمت فروش شما به مشتری کم می‌شود و قیمت توافق‌شده سبلان را تغییر نمی‌دهد."
        summaryItems={retailSummary.valid ? [
          { label: 'جمع قبل از تخفیف', value: retailSubtotal
            ? partnerMoneyText(retailSubtotal, draft.intent.retailDiscount.currency) : '—' },
          { label: 'جمع فروش پس از تخفیف', value: partnerMoneyText(retailSummary.retail, draft.intent.retailDiscount.currency) },
          { label: 'سود/زیان', value: retailSummary.difference === undefined ? 'پس از تکمیل استعلام'
            : partnerMoneyText(retailSummary.difference, draft.intent.retailDiscount.currency) },
        ] : []}
        error={!retailSummary.valid && retailSummary.field === 'discount' ? retailSummary.message : undefined}
        onValueChange={percent => {
          const normalizedPercent = String(Math.min(Math.max(Number(percent) || 0, 0), 100));
          const retailDiscount = partnerRetailDiscountFromPercent(draft.rows, normalizedPercent,
            draft.intent.retailDiscount.currency);
          if (!retailDiscount) return;
          updateWizard({ ...draft, intent: { ...draft.intent,
            retailDiscount, retailDiscountPercent: normalizedPercent, belowCostConfirmed: false } });
        }} />
      {retailSummary.valid && retailSummary.loss && <ErpInlineState kind="stale"
        title="پس از تخفیف، مبلغ فروش به مشتری از مبلغ خرید شما کمتر است." />}
      {retailSummary.valid && retailSummary.loss && <ErpCheckbox label="زیان را بررسی کرده‌ام و ادامه می‌دهم"
        checked={draft.intent.belowCostConfirmed}
        onChange={event => updateWizard({ ...draft, intent: { ...draft.intent, belowCostConfirmed: event.target.checked } })} />}
      {draft.intent.customerPaymentPlan.installments.map((installment, installmentIndex) => { const paymentErrors = showValidationErrors
        ? validatePartnerPaymentInstallment(installment, today()) : {}; const nationalCodeRequired = installment.method !== 'CREDIT'
          && Boolean(installment.dueDate) && installment.dueDate !== today(); return <ErpCard key={installment.installmentId} className="space-y-3 p-4">
      <ContractPaymentInstallmentFields method={partnerPaymentChoice(installment)} amount={installment.amount.amount}
        amountLabel={`مبلغ قسط ${(installmentIndex + 1).toLocaleString('fa-IR')} (تومان)`} date={installment.dueDate}
        dateLabel="سررسید" disabledAmount={installmentIndex === 0} amountError={paymentErrors.amount} dateError={paymentErrors.date}
        onAmountChange={amount => updateWizard({ ...draft, intent: { ...draft.intent,
          customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
            installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId
              ? { ...item, amount: { ...item.amount, amount } } : item) } } })}
        onDateChange={date => updateWizard({ ...draft, intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
          installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId
            ? { ...item, dueDate: date, ...(item.check ? { check: { ...item.check, dueDate: date } } : {}) } : item) } } })}
        onMethodChange={value => updateWizard({ ...draft, intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
          installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId ? (() => {
            const method = partnerPaymentMethodUpdate(value, item.dueDate);
            return { ...item, ...method, ...(value === 'CHECK' && item.check ? { check: item.check } : {}) };
          })() : item) } } })} />
      {(installment.method === 'CHECK' || nationalCodeRequired) && <ContractPaymentCheckFields
        showCheckFields={installment.method === 'CHECK'} nationalCodeRequired={nationalCodeRequired}
        value={{ number: installment.check?.number ?? '', bank: installment.check?.bank ?? '',
          ownerName: installment.check?.ownerName ?? '', handoverDate: installment.check?.handoverDate ?? '',
          nationalCode: installment.nationalCode ?? '' }} errors={paymentErrors}
        onChange={updates => updateWizard({ ...draft, intent: { ...draft.intent,
          customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
            installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId
              ? { ...item, ...(updates.nationalCode !== undefined ? { nationalCode: updates.nationalCode } : {}),
                ...(item.method === 'CHECK' ? { check: { number: updates.number ?? item.check?.number ?? '',
                  bank: updates.bank ?? item.check?.bank ?? '', dueDate: item.dueDate,
                  ...(updates.ownerName !== undefined || item.check?.ownerName !== undefined
                    ? { ownerName: updates.ownerName ?? item.check?.ownerName ?? '' } : {}),
                  ...(updates.handoverDate !== undefined || item.check?.handoverDate !== undefined
                    ? { handoverDate: updates.handoverDate ?? item.check?.handoverDate ?? '' } : {}) } } : {}) } : item) } } })} />}
      {installmentIndex > 0 && <ErpButton label="حذف قسط" tone="danger" variant="outline" onClick={() => updateWizard({ ...draft,
        intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
          installments: draft.intent.customerPaymentPlan.installments.filter(item => item.installmentId !== installment.installmentId) } } })} />}
    </ErpCard>; })}<ErpButton label="افزودن پرداخت" variant="outline" onClick={() => openPartnerPaymentModal({
      installmentId: `partner-installment-${crypto.randomUUID()}`,
      dueDate: addDays(draft.intent.contractDate, 30),
      amount: { amount: '0', currency: draft.intent.customerPaymentPlan.installments[0].amount.currency },
      method: 'BANK_TRANSFER', subtype: 'SHIBA',
    }, true, false)} />
      {paymentModal && <PaymentEntryModal
        isOpen
        onClose={closePartnerPaymentModal}
        form={paymentForm}
        onFormChange={updates => {
          setPaymentForm(current => ({ ...current, ...updates,
            ...(updates.nationalCode !== undefined
              ? { nationalCode: normalizeNumericText(updates.nationalCode).replace(/\D/g, '') }
              : {}) }));
          setPaymentModalErrors(current => { const next = { ...current };
            Object.keys(updates).forEach(key => delete next[key as keyof PartnerPaymentModalErrors]); return next; });
        }}
        onSave={() => savePartnerPayment(draft)}
        currency={paymentModal.installment.amount.currency}
        fieldErrors={paymentModalErrors}
        isEdit={!paymentModal.isNew}
        disabledAmount={paymentModal.isFirst}
        nationalCodeRequired={paymentForm.method !== 'CUSTOMER_BALANCE'
          && Boolean(paymentForm.paymentDate) && paymentForm.paymentDate !== today()}
      />}
    </div>; }
    const customer = context.customers.find(item => item.id === draft.intent.customerId);
    const caseView = submission?.getSnapshot().case ?? editingCase;
    const retailSummary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
    return <div className="mx-auto max-w-6xl space-y-6">
      <ErpNeumorphicCard className="space-y-5 p-6">
        <h3 className="text-2xl font-bold">خلاصه قرارداد</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <ErpNeumorphicCard className="grid gap-3 p-4 sm:grid-cols-2">
            <ErpFieldView label="شماره پرونده" value={caseView?.caseNumber ?? 'پس از ثبت'} tone="primary" />
            <ErpFieldView label="تاریخ قرارداد" value={draft.intent.contractDate} />
          </ErpNeumorphicCard>
          <ErpNeumorphicCard className="grid gap-3 p-4 sm:grid-cols-2">
            <ErpFieldView label="مشتری" value={customer?.displayName ?? '—'} />
            <ErpFieldView label="شماره موبایل تأیید" value={customer?.phone ?? 'موبایل معتبر ثبت نشده'} />
          </ErpNeumorphicCard>
        </div>
        <ErpNeumorphicCard className="grid gap-3 p-4 sm:grid-cols-3">
          <ErpFieldView label="مبلغ فروش به مشتری" value={retailSummary.valid
            ? partnerMoneyText(retailSummary.retail, draft.intent.retailDiscount.currency) : '—'} tone="primary" />
          <ErpFieldView label="مبلغ توافق‌شده با سبلان" value={retailSummary.valid && retailSummary.wholesale
            ? partnerMoneyText(retailSummary.wholesale, draft.intent.retailDiscount.currency) : '—'} tone="info" />
          <ErpFieldView label="تخفیف مشتری" value={`${draft.intent.retailDiscountPercent ?? '0'}٪`} tone="success" />
        </ErpNeumorphicCard>
      </ErpNeumorphicCard>
      <ErpNeumorphicDisclosure open>
        <summary className="cursor-pointer px-4 py-3 font-semibold">محصولات قرارداد ({draft.rows.length.toLocaleString('fa-IR')})</summary>
        <div className="space-y-3 px-4 pb-4">{draft.rows.map(row => <ErpCard key={row.productRowId} className="p-4">
          <p className="font-semibold">{row.inquiryRow.description}</p>
          <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">مقدار: {row.quantity} {row.unit} · قیمت فروش واحد: {partnerMoneyText(row.retailUnitPrice.amount, row.retailUnitPrice.currency)}</p>
        </ErpCard>)}</div>
      </ErpNeumorphicDisclosure>
      <ErpNeumorphicDisclosure>
        <summary className="cursor-pointer px-4 py-3 font-semibold">برنامه تحویل ({draft.intent.deliveries.length.toLocaleString('fa-IR')})</summary>
        <div className="space-y-3 px-4 pb-4">{draft.intent.deliveries.map((delivery, index) => <ErpCard key={delivery.deliveryId} className="grid gap-3 p-4 sm:grid-cols-3">
          <ErpFieldView label={`تحویل ${(index + 1).toLocaleString('fa-IR')}`} value={delivery.date} />
          <ErpFieldView label="تحویل‌گیرنده" value={delivery.receiverName ?? '—'} />
          <ErpFieldView label="نشانی" value={delivery.destination} />
        </ErpCard>)}</div>
      </ErpNeumorphicDisclosure>
      <ErpNeumorphicDisclosure>
        <summary className="cursor-pointer px-4 py-3 font-semibold">برنامه پرداخت ({draft.intent.customerPaymentPlan.installments.length.toLocaleString('fa-IR')})</summary>
        <div className="space-y-3 px-4 pb-4">{draft.intent.customerPaymentPlan.installments.map((installment, index) => <ErpCard key={installment.installmentId} className="grid gap-3 p-4 sm:grid-cols-3">
          <ErpFieldView label={`پرداخت ${(index + 1).toLocaleString('fa-IR')}`} value={partnerMoneyText(installment.amount.amount, installment.amount.currency)} />
          <ErpFieldView label="سررسید" value={installment.dueDate} />
          <ErpFieldView label="روش" value={partnerPaymentChoice(installment)} />
        </ErpCard>)}</div>
      </ErpNeumorphicDisclosure>
      <ErpInlineState kind="empty" title="با «تأیید و نهایی‌سازی قرارداد»، شماره عمومی قرارداد تخصیص می‌یابد و تعهد خرید شما با مبلغ توافق‌شده سبلان برای حسابداری ثبت می‌شود." />
    </div>;
  };

  if (!context) return error ? <ErpInlineState kind="error" title={error} /> : <ErpLoading />;
  if (context.kind === 'ORDINARY_SALES') return <>{ordinary}</>;
  if (!context.writable) return <ErpInlineState kind="permission"
    title={`ایجاد پرونده فروش همکار در وضعیت فعلی مجاز نیست.${context.blockedCode ? ` (${context.blockedCode})` : ''}`} />;
  const recoverableDrafts = context.recoverableDrafts?.length
    ? context.recoverableDrafts
    : context.recoverableDraft ? [context.recoverableDraft] : [];
  if (!runtime && !draftAccess && shouldOfferPartnerDraftChoice(recoverableDrafts.length, searchParams, freshInquiryRef.current)) {
    const latestDraft = recoverableDrafts[0];
    return <ErpNeumorphicWorkflowLayout title="ایجاد قرارداد">
      <ContractCreationDraftPrompt
        className="mb-4"
        pending={pending}
        onResume={() => router.replace(`${mode === 'inquiry'
          ? '/dashboard/sales/partner-inquiries?'
          : '/dashboard/sales/contracts/create?'}draftId=${encodeURIComponent(latestDraft.recoveryId)}`)}
        onStartNew={async () => {
          try {
            await deleteDraft(latestDraft.recoveryId);
            await beginNewInquiry(context);
          } catch {
            setError('کنار گذاشتن پیش‌نویس و شروع قرارداد جدید انجام نشد.');
          }
        }}
      />
      {error && <ErpInlineState kind="error" title={error} />}
    </ErpNeumorphicWorkflowLayout>;
  }
  if (recoveryBlocked && !runtime) return <section dir="rtl" className="mx-auto max-w-3xl space-y-4">
    <ContractCreationDraftPrompt mode="takeover" pending={pending}
      onResume={() => openDraftRecovery(context, true)}
      onStartNew={() => discardDraftRecovery(context)} />
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;
  if (wizard && submission) return <PartnerContractWizard draft={wizard} onChange={updateWizard} recovery={{ state: 'writable' }}
    submission={submission} now={Date.now()} renderSection={renderSection}
    canonicalRetailReady={wizard.rows.every(row => Boolean(row.retailEffectiveUnitPrice))}
    validateStep={(step, draft) => step === 'date' && !draft.intent.contractDate ? 'تاریخ قرارداد را وارد کنید.'
      : step === 'customer' && !draft.intent.customerId ? 'مشتری را انتخاب کنید.'
      : step === 'project' && !draft.intent.projectId ? 'پروژه را انتخاب کنید.'
      : step === 'delivery' && draft.intent.deliveries.some(item => item.items.length === 0 || !item.date || !item.destination.trim()
        || !item.projectManagerName?.trim() || !item.receiverName?.trim()) ? 'برنامه تحویل را کامل کنید.'
      : step === 'delivery' && draft.rows.some(row => remainingPartnerAmount(row.quantity,
        draft.intent.deliveries.flatMap(delivery => delivery.items.filter(item => item.productRowId === row.productRowId).map(item => item.quantity))) !== '0')
        ? 'مقدار تحویل هر محصول باید دقیقاً با مقدار قرارداد برابر باشد.'
      : step === 'payment' && !CustomerPaymentPlanSchema.safeParse(draft.intent.customerPaymentPlan).success
        ? 'برنامه پرداخت را کامل کنید.'
      : step === 'payment' && firstPartnerPaymentPlanError(draft.intent.customerPaymentPlan, today())
        ? firstPartnerPaymentPlanError(draft.intent.customerPaymentPlan, today())
      : step === 'payment' && (() => {
        const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
        return remainingPartnerAmount(summary.valid && summary.retail ? summary.retail : '0',
          draft.intent.customerPaymentPlan.installments.map(item => item.amount.amount)) !== '0';
      })() ? 'جمع اقساط باید با مبلغ فروش برابر باشد.'
        : null}
    onReinquire={row => void reinquireFromWizard(row)} onEditProduct={row => {
      const current = wizard;
      void persistWizardServer(current).then(saved => {
        if (!saved) return;
        const caseId = editingCase?.owner.caseId ?? submission.getSnapshot().case?.owner.caseId;
        setWizard(null);
        router.replace(partnerProductEditPath(current.intent.recoveryId, caseId, row.configurationRef.productRowId));
      });
    }} onEditProducts={() => {
      const current = wizard;
      void persistWizardServer(current).then(saved => {
        if (!saved) return;
        const caseId = editingCase?.owner.caseId ?? submission.getSnapshot().case?.owner.caseId;
        setWizard(null);
        router.replace(partnerProductEditPath(current.intent.recoveryId, caseId));
      });
    }} onSendConfirmation={caseId => sendPartnerConfirmation(caseId).then(() => undefined)}
    onFinalize={async view => {
      const response = await finalizePartnerCase(view, Boolean(partnerRetailSummary(wizard.rows,
        wizard.intent.retailDiscount).loss));
      if (!(response as { success?: boolean })?.success) throw new Error('finalization-failed');
      router.replace('/dashboard/sales/contracts');
    }}
    onCaseNumbered={caseId => router.replace(`/dashboard/sales/contracts/create?caseId=${encodeURIComponent(caseId)}`)}
    onOpenCase={() => router.push('/dashboard/sales/contracts')} />;
  const inquiryWorkspace = runtime && <PartnerInquiryWorkspace actorId={runtime.actorId} inquiryId={runtime.inquiryId}
    queries={inquiryPorts.queries} commands={inquiryPorts.commands} recovery={{
      pending: () => readStored(inquiryPendingKey(runtime.actorId)),
      savePending: async command => window.localStorage.setItem(inquiryPendingKey(runtime.actorId), JSON.stringify(command)),
      clearPending: async () => window.localStorage.removeItem(inquiryPendingKey(runtime.actorId)),
    }} writable configuredRows={runtime.configuredRows} knownInquiryRows={runtime.knownInquiryRows}
    configuredRowLabels={Object.fromEntries(technicalDraft.rows.map(row => [
      row.productRowId, catalog.find(product => product.catalogItemId === row.catalogItemId)?.name ?? row.productRowId,
    ]))} configurationEditor={<p>مشخصات فنی ذخیره‌شده برای {runtime.saved.rows.length.toLocaleString('fa-IR')} ردیف</p>}
    onOpenInquiry={() => undefined} onCreateNewInquiry={() => void beginNewInquiry(context)}
    prepareSuccessor={async row => ({ rowId: `partner-inquiry-row-${crypto.randomUUID()}`, configuration: row.configurationRef })} />;
  if (runtime && mode === 'inquiry') return <div className="min-w-0 space-y-4">{inquiryWorkspace}
    {error && <ErpInlineState kind="error" title={error} />}</div>;
  if (mode === 'inquiry') return <section dir="rtl" className="mx-auto min-w-0 max-w-4xl space-y-5">
    <h1 className="text-2xl font-bold">استعلام‌های قیمت</h1>
    <ErpInlineState kind="empty" title="استعلام جدید فقط از داخل پرونده شماره‌دار فروش همکار ایجاد می‌شود. برای حفظ مشتری، پروژه، نسخه محصول و تاریخچه قیمت‌گذاری، ابتدا ایجاد قرارداد را شروع کنید."
      action={{ label: 'ایجاد قرارداد فروش همکار', onClick: () => router.push('/dashboard/sales/contracts/create') }} />
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;
  const saleStepIndex = partnerSaleEntrySteps.indexOf(saleStep);
  const openInitialInquiry = async () => {
    if (!technicalActionReady || !draftAccess || context?.kind !== 'PARTNER') return;
    await startInquiry(context, new Set(), true);
  };
  const advanceSale = () => {
    setError(null);
    if (saleStep === 'date' && !contractDate) { setError('تاریخ قرارداد را وارد کنید.'); return; }
    if (saleStep === 'customer' && !customerId) { setError('مشتری را انتخاب کنید.'); return; }
    if (saleStep === 'project' && !projectId) { setError('پروژه را انتخاب کنید.'); return; }
    if (saleStepIndex < partnerSaleEntrySteps.length - 1) {
      setSaleStep(partnerSaleEntrySteps[saleStepIndex + 1]); return;
    }
    void openInitialInquiry();
  };
  return <ContractWizardFrame
    title="ایجاد فروش همکار"
    currentStep={saleStepIndex + 1}
    steps={partnerWizardPresentationSteps}
    notices={<div className="mb-4 space-y-3">
      {customerNotice && <ErpInlineState kind="success" title={customerNotice} />}
      {showPartnerContractConfigurationWarning(mode, contractConfigurationReady) && saleStep === 'products'
        && <ErpInlineState kind="stale" title="مشخصات و مقدار واقعی این قرارداد را تکمیل کنید." />}
      {!retailPricesReady && saleStep === 'products'
        && <ErpInlineState kind="stale" title="قیمت فروش به مشتری را برای همه محصولات وارد کنید." />}
      {error && <ErpInlineState kind="error" title={error} />}
    </div>}
    navigation={{
      onPrevious: () => { setError(null); setSaleStep(partnerSaleEntrySteps[Math.max(0, saleStepIndex - 1)]); },
      onNext: advanceSale,
      loading: pending,
      canGoPrevious: !pending && saleStepIndex > 0,
      canGoNext: !pending && (saleStep !== 'products' || technicalActionReady),
      labels: { next: saleStep === 'products' ? 'ادامه تکمیل قرارداد' : 'بعدی' }
    }}
  >
    <div className="space-y-4">
      {saleStep === 'date' && <ContractDateStepView creatorName={context.actorDisplayName}
        dateControl={<PersianCalendarComponent value={contractDate} onChange={value => {
          setContractDate(value); if (runtime) persistRuntime({ ...runtime, contractDate: value });
        }} className="w-full" />}
        numberNotice="شماره پس از ثبت موفق قرارداد تخصیص داده می‌شود." />}
      {saleStep === 'customer' && <ContractCustomerStepView
        customers={partnerCustomerOptions(context, customerSearchTerm)}
        selectedCustomer={selectedPartnerCustomer(context, customerId)}
        selectedCustomerId={customerId} searchTerm={customerSearchTerm} totalCount={context.customers.length}
        searchPlaceholder="جستجو با نام یا شماره تلفن"
        onSearchChange={setCustomerSearchTerm} onCreate={() => openSharedCustomerCreation(customerId)}
        onSelect={value => { const nextProjectId = context.projects.some(project =>
          project.id === projectId && project.customerId === value) ? projectId : '';
          setCustomerId(value); setProjectId(nextProjectId);
          if (runtime) persistRuntime({ ...runtime, customerId: value, projectId: nextProjectId }); }} />}
      {saleStep === 'project' && (() => { const selection = partnerProjectSelection(context, customerId); return <div className="space-y-4">
        <ContractProjectStepView customerName={selection.customerName}
          projects={selection.projects}
          selectedProjectId={projectId} onSelect={value => {
            setProjectId(value); if (runtime) persistRuntime({ ...runtime, projectId: value });
          }} onCreate={() => setShowProjectForm(true)} />
        <ErpSheet open={showProjectForm} onClose={() => setShowProjectForm(false)} title="ثبت پروژه جدید"
          presentation="modal" pending={pending} footer={<ErpButton label="ثبت و انتخاب پروژه"
            disabled={pending || !projectFormValid}
            onClick={() => void createProject(context)} />}>
          <CustomerProjectFormFields value={projectForm} errors={projectFormErrors}
            onChange={(field, value) => setProjectForm(current => ({ ...current, [field]: value }))} />
        </ErpSheet>
      </div>; })()}
      {saleStep === 'products' && <>
        {searchParams.get('focusProductRowId') && runtime?.knownInquiryRows?.find(row =>
          row.configurationRef.productRowId === searchParams.get('focusProductRowId'))?.noteOrReason &&
          <ErpInlineState kind="stale" title={runtime.knownInquiryRows.find(row =>
            row.configurationRef.productRowId === searchParams.get('focusProductRowId'))!.noteOrReason!} />}
        <PartnerTechnicalDraftEditor draft={technicalDraft} products={technicalProducts} currentProducts={catalog}
          operations={technicalOperations}
          sawKerfMeters={retainedCatalog?.sawKerfMeters ?? '0.003'}
          mandatoryDefaults={mandatoryDefaults}
          preview={technicalPreview} focusProductRowId={searchParams.get('focusProductRowId') ?? undefined} onChange={setTechnicalDraft} />
      </>}
      <ErpSheet open={initialInquiryOpen} onClose={() => setInitialInquiryOpen(false)} title="استعلام جدید"
        presentation="modal" pending={pending} footer={<div className="flex flex-wrap gap-2"><ErpButton
          label={initialInquiryMatches?.missingPricingSubjectIds.length === 0 ? 'ادامه با قیمت‌های معتبر' : 'ارسال ردیف‌های انتخاب‌شده'}
          disabled={pending || (Boolean(initialInquiryMatches?.missingPricingSubjectIds.length) && initialInquirySelection.size === 0)}
          onClick={() => void startInquiry(context, initialInquirySelection)} />
          <ErpButton label="ادامه بدون ارسال استعلام" variant="outline" disabled={pending}
            onClick={() => void startInquiry(context, new Set(), true)} /></div>}>
        <div className="space-y-3">
          {initialInquirySubjects.map(subject => { const reusable = initialInquiryMatches?.rows.find(match =>
            match.configurationRef.productRowId === subject.productRowId); return <ErpCard key={subject.productRowId} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ErpCheckbox label={subject.label}
                checked={initialInquirySelection.has(subject.productRowId)} disabled={pending || Boolean(reusable)}
                onChange={event => setInitialInquirySelection(current => { const next = new Set(current);
                  if (event.target.checked) next.add(subject.productRowId); else next.delete(subject.productRowId); return next; })} />
              <ErpBadge tone={reusable ? 'success' : 'warning'}>{reusable ? 'استعلام معتبر' : 'استعلام ارسال نشده'}</ErpBadge>
            </div>
          </ErpCard>; })}
        </div>
      </ErpSheet>
    </div>
  </ContractWizardFrame>;
}
