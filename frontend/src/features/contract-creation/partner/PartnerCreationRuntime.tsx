'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CaseDraftIntentSchema, DuplicateCustomerMatchSchema, PartnerCaseViewSchema, PartnerCommandSchema, PartnerCreationContextSchema,
  PartnerApprovalMatchSetSchema, PartnerWholesaleQuoteSchema, PartnerWizardRecoverySnapshotSchema,
  PartnerTechnicalCatalogPageSchema, PaymentPlanSchema, canonicalHash, partnerError, previewPartnerTechnicalDraft,
  type PartnerCaseView, type PartnerCommand, type PartnerCommandPort,
  type DuplicateCustomerMatch, type PartnerCreationContext, type PartnerTechnicalSaveReceipt,
  type PartnerTechnicalCatalogPage, type PartnerTechnicalDraft, type PartnerTechnicalOperation, type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCard, ErpCombobox, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpRialInput, ErpSelect, ErpSheet, ErpTextarea } from '@/components/erp';
import api from '@/lib/api';
import { createPartnerTechnicalHttpPorts } from './partnerTechnicalHttpPorts';
import { createPartnerInquiryHttpPorts } from '../../partner-sales/inquiries/partnerInquiryHttpPorts';
import { PartnerInquiryWorkspace } from '../../partner-sales/inquiries/PartnerInquiryWorkspace';
import type { PartnerConfiguredInquiryRows } from '../../partner-sales/inquiries/partnerInquirySubmission';
import { isUsableInquiryRow, type PartnerInquiryView, type PartnerInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import { PartnerContractWizard, partnerWizardSteps, type PartnerWizardDraft, type PartnerWizardStep } from './PartnerContractWizard';
import { WizardProgressBar } from '../components/shared/WizardProgressBar';
import { createPartnerCaseSubmission, type PartnerSubmitCommand } from './partnerCaseSubmission';
import { enterPartnerWizard, preservePartnerDeliveriesAcrossProductEdit, rebasePartnerWizardSnapshot,
  shouldPreferLocalPartnerWizard } from './partnerWizardEntry';
import { partnerRetailSummary, remainingPartnerAmount } from './partnerRetail';
import { PartnerTechnicalDraftEditor } from './PartnerTechnicalDraftEditor';
import { buildPartnerCustomerCreateCommand, emptyPartnerCustomerDraft, validatePartnerCustomerDraft,
  type PartnerCustomerDraft } from './partnerCustomerCreation';
import { sendPartnerConfirmation } from '../../partner-sales/cases/partnerCaseHttpPort';
import { PartnerQuickInquiryEditor, type PartnerInquiryDimensions } from './PartnerQuickInquiryEditor';
import { isPartnerContractConfigurationComplete, removePartnerTechnicalProduct } from './partnerTechnicalDraftAdapter';
import { normalizeNumericText } from '@/lib/numberFormat';
import { parseCanonicalDecimal } from '@sabalanerp/contract-product-graph';
import { commitPartnerTechnicalDraft } from './partnerTechnicalCommit';
import { getPartnerBrowserSessionId } from './partnerBrowserSession';
import { canSubmitPartnerTechnicalAction, showPartnerContractConfigurationWarning } from './partnerCreationFlow';
import { PartnerPreparationNavigation } from './PartnerPreparationNavigation';
import { readPartnerCreationContext } from './partnerCreationContext';

type PartnerContext = Extract<PartnerCreationContext, { kind: 'PARTNER' }>;
type Access = { schemaVersion: 1; recoveryId: string; browserSessionId: string;
  leaseToken: string; baseRevision: number };
type PersistedRuntime = { actorId: string; inquiryId: string; access: Access;
  saved: PartnerTechnicalSaveReceipt; configuredRows: PartnerConfiguredInquiryRows; customerId: string;
  contractDate?: string; projectId?: string };

const ports = createPartnerTechnicalHttpPorts();
const inquiryPorts = createPartnerInquiryHttpPorts();
const runtimeKey = (actorId: string, inquiryId: string) => `partner-creation-runtime:${actorId}:${inquiryId}`;
const inquiryPendingKey = (actorId: string) => `partner-inquiry-pending:${actorId}`;
const casePendingKey = (actorId: string) => `partner-case-pending:${actorId}`;
const wizardDraftKey = (actorId: string, recoveryId: string) => `partner-wizard-draft:${actorId}:${recoveryId}`;
const emptyTechnicalDraft = (inputRevision = 0): PartnerTechnicalDraft => ({
  schemaVersion: 1, inputRevision, rows: [], dependents: [], stairSystems: [], editingValues: [],
});
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

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
  const freshInquiryRef = useRef(searchParams.get('newInquiry') === '1');
  const [context, setContext] = useState<PartnerCreationContext | null>(null);
  const [runtime, setRuntime] = useState<PersistedRuntime | null>(null);
  const runtimeRef = useRef<PersistedRuntime | null>(null);
  runtimeRef.current = runtime;
  const [catalog, setCatalog] = useState<PartnerTechnicalProduct[]>([]);
  const [operations, setOperations] = useState<PartnerTechnicalOperation[]>([]);
  const [inquiryNote, setInquiryNote] = useState('');
  const [quickDimensions, setQuickDimensions] = useState<Record<string, PartnerInquiryDimensions>>({});
  const [technicalDraft, setTechnicalDraft] = useState<PartnerTechnicalDraft>(() => emptyTechnicalDraft());
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
  const [contractDate, setContractDate] = useState(today);
  const [projectId, setProjectId] = useState('');
  const [preparationStep, setPreparationStep] = useState(1);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectAddress, setProjectAddress] = useState('');
  const [customerDraft, setCustomerDraft] = useState<PartnerCustomerDraft>(emptyPartnerCustomerDraft);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerNotice, setCustomerNotice] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateCustomerMatch | null>(null);
  const [transferReason, setTransferReason] = useState('');
  const [wizard, setWizard] = useState<PartnerWizardDraft | null>(null);
  const wizardServerRevision = useRef(0);
  const wizardSaveFlight = useRef<Promise<boolean> | null>(null);
  const wizardSavePending = useRef<PartnerWizardDraft | null>(null);
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const [draftDeleteTarget, setDraftDeleteTarget] = useState<string>();
  const autoTitledDrafts = useRef(new Set<string>());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const technicalPreview = useMemo(() => previewPartnerTechnicalDraft(technicalDraft,
    { products: catalog, operations, sawKerfMeters: '0.003' }), [catalog, operations, technicalDraft]);
  const technicalReady = technicalPreview.ok && technicalDraft.rows.length > 0 && technicalPreview.value.conflicts.length === 0
    && technicalPreview.value.rows.every(row => row.calculation.ok);
  const contractConfigurationReady = isPartnerContractConfigurationComplete(technicalDraft);
  const normalizedQuickDimensions = (productRowId: string) => Object.fromEntries(Object.entries(quickDimensions[productRowId] ?? {})
    .filter((entry): entry is [keyof PartnerInquiryDimensions, string] => Boolean(entry[1]?.trim()))
    .map(([key, value]) => [key, parseCanonicalDecimal(normalizeNumericText(value))])) as PartnerInquiryDimensions;
  const quickDimensionsValid = mode !== 'inquiry' || technicalDraft.rows.every(row => {
    try { normalizedQuickDimensions(row.productRowId); return true; } catch { return false; }
  });
  const technicalActionReady = canSubmitPartnerTechnicalAction({ mode, pending, technicalReady,
    contractConfigurationReady, quickDimensionsValid, hasDraftAccess: Boolean(draftAccess) });

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
            const response = await api.put(`/partner/cases/drafts/${encodeURIComponent(current.intent.recoveryId)}/wizard`, {
              schemaVersion: 1, expectedWizardRevision: wizardServerRevision.current,
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
  }, [runtime]);

  useEffect(() => {
    if (!wizardRecoveryId || !runtime) return;
    const timer = window.setTimeout(() => void persistWizardServer(wizard), 700);
    return () => window.clearTimeout(timer);
  }, [persistWizardServer, runtime, wizard, wizardRecoveryId]);

  useEffect(() => {
    let active = true;
    void readPartnerCreationContext(() => api.get('/partner/cases/creation-context')).then(response => {
      const parsed = PartnerCreationContextSchema.safeParse((response.data as { data?: unknown })?.data);
      if (!active) return;
      if (!parsed.success) throw new Error('Invalid Partner creation context');
      setContext(parsed.data);
      setError(null);
      if (parsed.data.kind === 'PARTNER') {
        const startFresh = searchParams.get('newInquiry') === '1';
        freshInquiryRef.current = startFresh;
        const requestedInquiry = searchParams.get('inquiryId') || parsed.data.latestInquiryId || '';
        const configureForSale = mode === 'sale' && searchParams.get('configure') === '1';
        const saved = startFresh || configureForSale || !requestedInquiry ? null
          : readStored<PersistedRuntime>(runtimeKey(parsed.data.actorId, requestedInquiry));
        if (saved?.actorId === parsed.data.actorId) {
          setRuntime(saved); setCustomerId(saved.customerId);
          if (saved.contractDate) setContractDate(saved.contractDate);
          if (saved.projectId) setProjectId(saved.projectId);
        }
        else {
          const requestedCustomer = searchParams.get('customerId');
          setCustomerId(parsed.data.customers.some(customer => customer.id === requestedCustomer) ? requestedCustomer! : parsed.data.customers[0]?.id || '');
        }
        setShowCustomerForm(searchParams.get('newCustomer') === '1');
      }
    }).catch(() => active && setError('تشخیص مسیر ایجاد قرارداد انجام نشد. دوباره تلاش کنید.'));
    return () => { active = false; };
  }, [mode, searchParams]);

  const createCustomer = async (partner: PartnerContext) => {
    if (pending || !validatePartnerCustomerDraft(customerDraft)) return;
    setPending(true); setError(null); setCustomerNotice(null); setDuplicateMatch(null);
    try {
      const command = await buildPartnerCustomerCreateCommand(customerDraft, {
        commandId: `partner-customer-${crypto.randomUUID()}`,
        correlationId: `partner-customer-correlation-${crypto.randomUUID()}`,
        idempotencyKey: `partner-customer-idempotency-${crypto.randomUUID()}`,
      });
      const response = await api.post('/crm/partner/customers', command, {
        headers: { 'X-Correlation-Id': command.correlationId },
      });
      const value = (response.data as { data?: unknown })?.data;
      const row = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).customer : null;
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid customer response');
      const customer = row as Record<string, unknown>;
      if (typeof customer.customerId !== 'string' || typeof customer.displayName !== 'string') {
        throw new Error('Invalid customer response');
      }
      const created = { id: customer.customerId, displayName: customer.displayName, address: customerDraft.address.trim() };
      setContext({ ...partner, customers: [created, ...partner.customers] });
      setCustomerId(created.id);
      setProjectId('');
      setCustomerDraft(emptyPartnerCustomerDraft);
      setShowCustomerForm(false);
      setCustomerNotice('مشتری با موفقیت ثبت و برای فروش همکار انتخاب شد.');
    } catch (caught) {
      const response = (caught as { response?: { data?: { code?: string } } })?.response;
      if (response?.data?.code === 'STATE_CONFLICT') {
        try {
          const duplicate = await api.post('/crm/partner/customer-duplicates/search', { schemaVersion: 1,
            correlationId: `partner-duplicate-${crypto.randomUUID()}`, phone: customerDraft.phone.trim(),
            ...(customerDraft.nationalCode.trim() ? { nationalCode: customerDraft.nationalCode.trim() } : {}) });
          const match = DuplicateCustomerMatchSchema.safeParse((duplicate.data as { data?: unknown })?.data);
          if (match.success) { setDuplicateMatch(match.data); setError(null); return; }
        } catch { /* Keep the non-disclosing duplicate message below. */ }
        setError('مشتری تکراری است، اما شاهد امن انتقال در دسترس نیست.');
      } else setError('ثبت مشتری کامل نشد. ورودی‌ها را بررسی و دوباره تلاش کنید.');
    } finally { setPending(false); }
  };

  const requestCustomerTransfer = async () => {
    if (!duplicateMatch || pending || !/[\u0600-\u06ff]/.test(transferReason)) return;
    setPending(true); setError(null);
    try {
      const intent = { schemaVersion: 1 as const, matchReference: duplicateMatch.matchReference, reason: transferReason.trim() };
      const payloadHash = await canonicalHash(intent); const commandId = `partner-transfer-${crypto.randomUUID()}`;
      await api.post('/crm/partner/customer-transfers', { ...intent, commandId,
        correlationId: `partner-transfer-correlation-${crypto.randomUUID()}`, idempotencyKey: commandId, payloadHash });
      setDuplicateMatch(null); setTransferReason('');
      setCustomerNotice('درخواست انتقال مشتری ثبت شد و پس از تصمیم مسئول مجاز قابل استفاده خواهد بود.');
    } catch { setError('ثبت درخواست انتقال مشتری انجام نشد. شاهد ممکن است منقضی شده باشد.'); }
    finally { setPending(false); }
  };

  const createProject = async (partner: PartnerContext, selectedCustomerId = customerId) => {
    if (pending || !selectedCustomerId || !projectTitle.trim()) return;
    setPending(true); setError(null);
    try {
      const intent = { schemaVersion: 1 as const, customerId: selectedCustomerId, title: projectTitle.trim(),
        workType: 'فروش سنگ پروژه ساختمانی', status: 'جدید',
        ...(projectAddress.trim() ? { address: projectAddress.trim() } : {}),
        reason: 'ثبت پروژه توسط فروشنده همکار' };
      const payloadHash = await canonicalHash(intent);
      const commandId = `partner-project-${crypto.randomUUID()}`;
      const response = await api.post(`/crm/partner/customers/${encodeURIComponent(selectedCustomerId)}/projects`, {
        ...intent, commandId, correlationId: `partner-project-correlation-${crypto.randomUUID()}`,
        idempotencyKey: commandId, payloadHash,
      });
      const value = (response.data as { data?: unknown })?.data;
      const project = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as { project?: { projectId?: unknown; title?: unknown } }).project : undefined;
      if (typeof project?.projectId !== 'string' || typeof project.title !== 'string') throw new Error('Invalid project response');
      const created = { id: project.projectId, customerId: selectedCustomerId, title: project.title };
      setContext({ ...partner, projects: [created, ...partner.projects] });
      setProjectId(created.id); setProjectTitle(''); setProjectAddress(''); setShowProjectForm(false);
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
      const candidate = fresh ? undefined : partner.recoverableDrafts?.find(item => item.recoveryId === requestedDraft)
        ?? partner.recoverableDraft;
      const recoveryId = candidate?.recoveryId ?? `partner-recovery-${crypto.randomUUID()}`;
      const browserSessionId = getPartnerBrowserSessionId(window.sessionStorage, partner.actorId);
      const baseRevision = candidate?.baseRevision ?? 0;
      const lease = await ports.lease.acquire({ schemaVersion: 1, recoveryId, browserSessionId, baseRevision, takeover });
      if (!lease.ok) { setRecoveryBlocked(Boolean(candidate)); setError(lease.error.message); return; }
      const access: Access = { schemaVersion: 1, recoveryId, browserSessionId,
        leaseToken: lease.value.leaseToken, baseRevision: lease.value.baseRevision };
      const recovered = await ports.recovery.read(access);
      if (!recovered.ok) { setError(recovered.error.message); return; }
      setDraftAccess(access); setRecoveryRevision(recovered.value.recoveryRevision);
      checkpointedInputRevision.current = recovered.value.draft?.inputRevision ?? 0;
      if (fresh) setTechnicalDraft(emptyTechnicalDraft());
      else if (recovered.value.draft) setTechnicalDraft(recovered.value.draft);
      setRecoveryBlocked(false);
    } catch { setError('بازیابی پیش‌نویس فنی انجام نشد.'); }
    finally { recoveryStarting.current = false; }
  }, [mode, runtime, searchParams]);

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
    const requestedDraft = searchParams.get('draftId');
    const candidate = partner.recoverableDrafts?.find(item => item.recoveryId === requestedDraft) ?? partner.recoverableDraft;
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
    if ((context.recoverableDrafts?.length ?? 0) > 1 && !searchParams.get('draftId') && !freshInquiryRef.current) return;
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

  const contextActorId = context?.kind === 'PARTNER' ? context.actorId : null;
  const persistRuntime = useCallback((value: PersistedRuntime | null) => {
    setRuntime(value);
    if (!contextActorId) return;
    if (value) window.localStorage.setItem(runtimeKey(contextActorId, value.inquiryId), JSON.stringify(value));
    else if (runtimeRef.current) window.localStorage.removeItem(runtimeKey(contextActorId, runtimeRef.current.inquiryId));
  }, [contextActorId]);

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

  const readApprovalMatches = async (saved: PartnerTechnicalSaveReceipt) => {
    const response = await api.post('/partner/cases/approval-matches', { schemaVersion: 1,
      recoveryId: saved.recoveryId, recoveryRevision: saved.recoveryRevision });
    const parsed = PartnerApprovalMatchSetSchema.safeParse((response.data as { data?: unknown })?.data);
    if (!parsed.success || parsed.data.recoveryId !== saved.recoveryId ||
        parsed.data.recoveryRevision !== saved.recoveryRevision) throw new Error('Invalid approval matches');
    return parsed.data;
  };

  const startInquiry = async (partner: PartnerContext) => {
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
      const matches = mode === 'sale' ? await readApprovalMatches(saved.value) : null;
      const missing = new Set(matches?.missingPricingSubjectIds ?? subjects.map(row => row.configurationRef.productRowId));
      const configuredRows: PartnerConfiguredInquiryRows = subjects.filter(row => missing.has(row.configurationRef.productRowId)).map(row => ({
        rowId: `partner-inquiry-row-${crypto.randomUUID()}`, configuration: row.configurationRef,
        ...(mode === 'inquiry' ? { dimensions: normalizedQuickDimensions(row.configurationRef.productRowId) } : {}),
        ...(inquiryNote.trim() ? { sellerNote: inquiryNote.trim() } : {}) }));
      if (!configuredRows.length && matches?.rows.length) {
        const inquiryId = matches.rows[0].approvedRowBinding!.inquiryId;
        persistRuntime({ actorId: partner.actorId, inquiryId, access: draftAccess, saved: saved.value,
          configuredRows: matches.rows.map(row => ({ rowId: row.rowId, configuration: row.configurationRef })),
          customerId, contractDate, projectId });
        freshInquiryRef.current = false;
        router.replace('/dashboard/sales/contracts/create');
        return;
      }
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
      const value = { actorId: partner.actorId, inquiryId, access: draftAccess, saved: saved.value, configuredRows,
        customerId, ...(mode === 'sale' ? { contractDate, projectId } : {}) };
      window.localStorage.removeItem(inquiryPendingKey(partner.actorId)); persistRuntime(value);
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
    return createPartnerCaseSubmission({ actorId: submissionActorId, commands: caseCommands, recovery: {
      pending: () => readStored<PartnerSubmitCommand>(casePendingKey(submissionActorId)),
      savePending: async command => {
        const active = runtimeRef.current;
        if (!active || active.actorId !== submissionActorId || active.access.recoveryId !== submissionRecoveryId) {
          throw new Error('Recovery changed');
        }
        const refreshed = await reacquireRuntime(active);
        if (!refreshed) throw new Error('Recovery lease unavailable');
        const current = await ports.saved.readSaved({ ...refreshed.access, recoveryRevision: refreshed.saved.recoveryRevision });
        if (!current.ok || current.value.graphHash !== refreshed.saved.graphHash) throw new Error('Recovery changed');
        window.localStorage.setItem(casePendingKey(submissionActorId), JSON.stringify(command));
      },
      clearPending: async () => { window.localStorage.removeItem(casePendingKey(submissionActorId)); },
      finalizeCommitted: async () => {
        window.localStorage.removeItem(casePendingKey(submissionActorId));
        const active = runtimeRef.current;
        if (active) {
          window.localStorage.removeItem(runtimeKey(submissionActorId, active.inquiryId));
          window.localStorage.removeItem(wizardDraftKey(submissionActorId, active.access.recoveryId));
        }
      },
    } });
  }, [reacquireRuntime, submissionActorId, submissionRecoveryId]);

  const enterWizard = async (inquiry: PartnerInquiryView) => {
    if (!runtime || !context || context.kind !== 'PARTNER') return;
    setError(null);
    const refreshed = await reacquireRuntime(runtime);
    if (!refreshed) return;
    const validated = await ports.saved.readSaved({ ...refreshed.access, recoveryRevision: refreshed.saved.recoveryRevision });
    if (!validated.ok) { setError(validated.error.message); return; }
    let inquiryRows: readonly PartnerInquiryRow[] = inquiry.rows;
    try {
      const matches = await readApprovalMatches(refreshed.saved);
      if (matches.missingPricingSubjectIds.length) {
        const missing = new Set(matches.missingPricingSubjectIds);
        const pendingPrimaryIds = validated.value.rows
          .map(row => row.configurationRef.productRowId)
          .filter(productRowId => missing.has(productRowId));
        if (pendingPrimaryIds.length > 0 && pendingPrimaryIds.length < validated.value.rows.length) {
          const subset = pendingPrimaryIds.reduce(removePartnerTechnicalProduct, technicalDraft);
          setTechnicalDraft(subset);
          persistRuntime(null);
          setWizard(null);
          setError('ردیف‌های در انتظار از این قرارداد کنار گذاشته شدند؛ استعلام آن‌ها در تاریخچه باقی می‌ماند. محصولات آماده را بررسی و ادامه دهید.');
          router.replace(`/dashboard/sales/contracts/create?configure=1&draftId=${encodeURIComponent(refreshed.saved.recoveryId)}`);
          return;
        }
        persistRuntime(null);
        setWizard(null);
        setError('برای ادامه با پاسخ‌های آماده، ردیف‌های در انتظار را از این فروش حذف کنید. استعلام آن‌ها در تاریخچه باقی می‌ماند.');
        router.replace(`/dashboard/sales/contracts/create?configure=1&draftId=${encodeURIComponent(refreshed.saved.recoveryId)}`);
        return;
      }
      inquiryRows = matches.rows;
    } catch { /* The exact inquiry view remains a safe fallback for older records. */ }
    const selectedCustomerId = runtime.customerId || customerId || context.customers[0]?.id || '';
    const customer = context.customers.find(item => item.id === selectedCustomerId);
    const selectedProject = context.projects.find(item => item.id === runtime.projectId && item.customerId === selectedCustomerId);
    const approved = inquiryRows.filter(row => row.state === 'APPROVED' && row.approvedPrice);
    const currency = approved[0]?.approvedPrice?.currency;
    if (!customer) { setShowCustomerForm(true); setError('برای ایجاد قرارداد، مشتری را ثبت یا انتخاب کنید.'); return; }
    if (!selectedProject) { setPreparationStep(3); setError('برای ایجاد قرارداد، پروژه را انتخاب کنید.'); return; }
    if (!currency) { setError('پاسخ معتبر استعلام را بررسی کنید.'); return; }
    const selectedContractDate = runtime.contractDate || contractDate || today();
    const draft = enterPartnerWizard({ inquiryRows, now: Date.now(), validated: validated.value,
      base: { customerId: customer.id, recoveryId: runtime.saved.recoveryId, recoveryRevision: runtime.saved.recoveryRevision,
        contractDate: selectedContractDate, projectId: selectedProject.id,
        customerPaymentPlan: { planId: `partner-customer-plan-${crypto.randomUUID()}`, version: 1,
          effectiveDate: selectedContractDate, installments: [{ installmentId: `partner-installment-${crypto.randomUUID()}`,
            dueDate: addDays(selectedContractDate, 30), amount: { amount: '0', currency }, method: 'BANK_TRANSFER' }] },
        deliveries: runtime.saved.rows.map((row, index) => ({ deliveryId: `partner-delivery-${crypto.randomUUID()}`,
          date: addDays(selectedContractDate, 7 + index), destination: customer.address,
          items: [{ productRowId: row.configurationRef.productRowId, quantity: row.quantity }] })),
        retailDiscount: { amount: '0', currency },
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
        rows: rows.map(row => ({ productRowId: row.productRowId,
          approvedRowBinding: row.inquiryRow.approvedRowBinding!, retailUnitPrice: row.retailUnitPrice })),
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
        rows: rows.map(row => ({ productRowId: row.productRowId,
          approvedRowBinding: row.inquiryRow.approvedRowBinding!, retailUnitPrice: row.retailUnitPrice })),
        additionalMaterialApprovals: draft.intent.additionalMaterialApprovals };
      setCustomerId(nextCustomerId);
      setWizard({ ...draft, step: 'products', rows, intent: nextIntent });
    };
    const stored = readStored<{ savedAt: number; serverRevision?: number; draft: PartnerWizardDraft }>(
      wizardDraftKey(runtime.actorId, draft.intent.recoveryId));
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
    setWizard(draft);
  };

  const updateWizard = (next: PartnerWizardDraft) => {
    const summary = partnerRetailSummary(next.rows, next.intent.retailDiscount);
    const installments = next.intent.customerPaymentPlan.installments;
    const firstAmount = summary.valid ? remainingPartnerAmount(summary.retail,
      installments.slice(1).map(item => item.amount.amount)) : null;
    setWizard(summary.valid && installments[0] && firstAmount !== null ? { ...next, intent: { ...next.intent,
      customerPaymentPlan: { ...next.intent.customerPaymentPlan, installments: [{ ...installments[0],
        amount: { amount: firstAmount, currency: installments[0].amount.currency } }, ...installments.slice(1)] } } } : next);
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

  const renameDraft = async (recoveryId: string) => {
    const title = draftTitles[recoveryId]?.trim();
    if (!title || context?.kind !== 'PARTNER') return;
    await api.patch(`/partner/cases/drafts/${encodeURIComponent(recoveryId)}`, { title });
    setContext({ ...context, recoverableDrafts: context.recoverableDrafts?.map(item =>
      item.recoveryId === recoveryId ? { ...item, title } : item),
      recoverableDraft: context.recoverableDraft?.recoveryId === recoveryId
        ? { ...context.recoverableDraft, title } : context.recoverableDraft });
  };
  const deleteDraft = async (recoveryId: string) => {
    if (context?.kind !== 'PARTNER') return;
    await api.delete(`/partner/cases/drafts/${encodeURIComponent(recoveryId)}`);
    setContext({ ...context, recoverableDrafts: context.recoverableDrafts?.filter(item => item.recoveryId !== recoveryId),
      recoverableDraft: context.recoverableDraft?.recoveryId === recoveryId ? undefined : context.recoverableDraft });
  };

  const quoteKey = wizard ? JSON.stringify({ recoveryId: wizard.intent.recoveryId,
    recoveryRevision: wizard.intent.recoveryRevision, graphHash: wizard.intent.graphHash,
    customerId: wizard.intent.customerId, projectId: wizard.intent.projectId,
    rows: wizard.intent.rows.map(row => ({ productRowId: row.productRowId, binding: row.approvedRowBinding })),
    materials: wizard.intent.additionalMaterialApprovals }) : '';
  useEffect(() => {
    if (!wizard?.intent.projectId || !runtime) return;
    let cancelled = false;
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
            current.intent.recoveryRevision !== quote.data.recoveryRevision) return current;
        const rows = current.rows.map(row => {
          const price = quote.data.rows.find(item => item.productRowId === row.productRowId)?.wholesaleUnitPrice;
          return price ? { ...row, wholesaleUnitPrice: price,
            retailUnitPrice: row.wholesaleUnitPrice ? row.retailUnitPrice : price } : row;
        });
        const summary = partnerRetailSummary(rows, current.intent.retailDiscount);
        const installments = current.intent.customerPaymentPlan.installments;
        const firstAmount = summary.valid ? remainingPartnerAmount(summary.retail,
          installments.slice(1).map(item => item.amount.amount)) : null;
        return summary.valid && installments[0] && firstAmount !== null ? { ...current, rows, intent: { ...current.intent,
          rows: rows.map(row => ({ productRowId: row.productRowId, approvedRowBinding: row.inquiryRow.approvedRowBinding!,
            retailUnitPrice: row.retailUnitPrice })), customerPaymentPlan: { ...current.intent.customerPaymentPlan,
            installments: [{ ...installments[0], amount: { ...installments[0].amount, amount: firstAmount } },
              ...installments.slice(1)] } } } : { ...current, rows };
      });
    })().catch(() => !cancelled && setError('محاسبه قیمت خرید انجام نشد؛ دوباره تلاش کنید.'));
    return () => { cancelled = true; };
  // quoteKey excludes retail-only edits so changing the customer price cannot refetch or overwrite it.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed by price-bearing identities only
  }, [quoteKey]);

  useEffect(() => {
    if (!wizardRecoveryId || !runtime) return;
    let cancelled = false;
    const refresh = async () => {
      const result = await readApprovalMatches(runtime.saved);
      if (cancelled) return;
      setWizard(current => {
        if (!current) return current;
        const latestFor = (subjectId: string, previous: PartnerInquiryRow) => result.rows
          .filter(row => row.configurationRef.productRowId === subjectId && isUsableInquiryRow(row, Date.now()))
          .at(-1) ?? previous;
        const rows = current.rows.map(row => ({ ...row, inquiryRow: latestFor(row.productRowId, row.inquiryRow) }));
        const materialInquiryRows = (current.materialInquiryRows ?? []).map(row => ({ ...row,
          inquiryRow: latestFor(row.pricingSubjectId, row.inquiryRow) }));
        const additionalMaterialApprovals = materialInquiryRows.flatMap(row => row.inquiryRow.approvedRowBinding
          ? [{ pricingSubjectId: row.pricingSubjectId, approvedRowBinding: row.inquiryRow.approvedRowBinding }] : []);
        return { ...current, rows, materialInquiryRows, intent: { ...current.intent,
          rows: rows.map(row => ({ productRowId: row.productRowId, approvedRowBinding: row.inquiryRow.approvedRowBinding!,
            retailUnitPrice: row.retailUnitPrice })), additionalMaterialApprovals } };
      });
    };
    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [runtime, wizardRecoveryId]);

  const reinquireFromWizard = async (row: PartnerInquiryRow) => {
    if (!runtime) return;
    setError(null);
    try {
      const nextRowId = `partner-inquiry-row-${crypto.randomUUID()}`;
      const rows = [{ rowId: nextRowId, configuration: row.configurationRef,
        predecessor: { rowId: row.rowId, revision: row.revision } }];
      const intent = { schemaVersion: 1 as const, type: 'INQUIRY_SUBMIT' as const,
        partnerSellerId: runtime.actorId, rows };
      const payloadHash = await canonicalHash(intent);
      const command = PartnerCommandSchema.parse({ ...intent, commandId: payloadHash, correlationId: payloadHash,
        idempotency: { actorId: runtime.actorId, operation: 'INQUIRY_SUBMIT', targetId: runtime.inquiryId,
          key: payloadHash, payloadHash } });
      const result = await inquiryPorts.commands.execute(command);
      if (!result.ok) setError(result.error.message);
    } catch { setError('ارسال استعلام مجدد انجام نشد؛ اطلاعات Wizard حفظ شده است.'); }
  };

  const renderSection = (step: Exclude<PartnerWizardStep, 'products'>, draft: PartnerWizardDraft) => {
    if (!context || context.kind !== 'PARTNER') return null;
    if (step === 'date') return <ErpField label="تاریخ قرارداد" required><ErpInput type="date" value={draft.intent.contractDate}
      onChange={event => updateWizard({ ...draft, intent: { ...draft.intent, contractDate: event.target.value } })} /></ErpField>;
    if (step === 'customer') return <ErpCombobox label="مشتری" value={draft.intent.customerId}
      options={context.customers.map(customer => ({ value: customer.id, label: customer.displayName }))}
      onChange={value => updateWizard({ ...draft, intent: { ...draft.intent, customerId: value,
        projectId: context.projects.some(project => project.id === draft.intent.projectId && project.customerId === value)
          ? draft.intent.projectId : undefined } })} />;
    if (step === 'project') return <div className="space-y-4">
      <ErpCombobox label="پروژه" value={draft.intent.projectId ?? ''}
        options={context.projects.filter(project => project.customerId === draft.intent.customerId)
          .map(project => ({ value: project.id, label: project.title }))}
        onChange={value => updateWizard({ ...draft, intent: { ...draft.intent, projectId: value } })} />
      <ErpButton label="ثبت پروژه جدید" variant="outline" disabled={!draft.intent.customerId}
        onClick={() => setShowProjectForm(true)} />
      <ErpSheet open={showProjectForm} onClose={() => setShowProjectForm(false)} title="ثبت پروژه جدید"
        presentation="modal" pending={pending} footer={<ErpButton label="ثبت و انتخاب پروژه"
          disabled={pending || !projectTitle.trim()} onClick={() => void createProject(context, draft.intent.customerId)
            .then(created => created && updateWizard({ ...draft, intent: { ...draft.intent, projectId: created.id } }))} />}>
        <div className="space-y-4">
          <ErpField label="عنوان پروژه" required><ErpInput value={projectTitle} maxLength={300}
            onChange={event => setProjectTitle(event.target.value)} /></ErpField>
          <ErpField label="نشانی پروژه"><ErpTextarea value={projectAddress} maxLength={1000}
            onChange={event => setProjectAddress(event.target.value)} /></ErpField>
        </div>
      </ErpSheet>
    </div>;
    if (step === 'delivery') return <div className="space-y-3">{draft.intent.deliveries.map((delivery, index) => <ErpCard key={delivery.deliveryId} className="space-y-3 p-4">
      <ErpField label={`تاریخ تحویل ${(index + 1).toLocaleString('fa-IR')}`}><ErpInput type="date" value={delivery.date}
        onChange={event => updateWizard({ ...draft, intent: { ...draft.intent, deliveries: draft.intent.deliveries.map(item => item.deliveryId === delivery.deliveryId ? { ...item, date: event.target.value } : item) } })} /></ErpField>
      <ErpField label="مقصد"><ErpInput value={delivery.destination} onChange={event => updateWizard({ ...draft,
        intent: { ...draft.intent, deliveries: draft.intent.deliveries.map(item => item.deliveryId === delivery.deliveryId ? { ...item, destination: event.target.value } : item) } })} /></ErpField>
      <div className="grid gap-3 sm:grid-cols-2">{delivery.items.map(item => <ErpField key={item.productRowId}
        label={`مقدار ${draft.rows.find(row => row.productRowId === item.productRowId)?.inquiryRow.description ?? 'محصول'}`}>
        <ErpInput inputMode="decimal" value={item.quantity} onChange={event => updateWizard({ ...draft, intent: { ...draft.intent,
          deliveries: draft.intent.deliveries.map(row => row.deliveryId === delivery.deliveryId ? { ...row,
            items: row.items.map(product => product.productRowId === item.productRowId ? { ...product, quantity: event.target.value } : product) } : row) } })} />
      </ErpField>)}</div>
      {draft.intent.deliveries.length > 1 && <ErpButton label="حذف برنامه تحویل" tone="danger" variant="outline"
        onClick={() => updateWizard({ ...draft, intent: { ...draft.intent,
          deliveries: draft.intent.deliveries.filter(item => item.deliveryId !== delivery.deliveryId) } })} />}
    </ErpCard>)}<ErpButton label="افزودن برنامه تحویل" variant="outline" onClick={() => updateWizard({ ...draft, intent: { ...draft.intent,
      deliveries: [...draft.intent.deliveries, { deliveryId: `partner-delivery-${crypto.randomUUID()}`,
        date: addDays(draft.intent.contractDate, 7), destination: context.customers.find(item => item.id === draft.intent.customerId)?.address ?? '',
        items: draft.rows.map(row => ({ productRowId: row.productRowId, quantity: row.quantity })) }] } })} /></div>;
    if (step === 'payment') return <div className="space-y-3">{draft.intent.customerPaymentPlan.installments.map((installment, installmentIndex) => <ErpCard key={installment.installmentId} className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3"><ErpField label={`مبلغ قسط ${(installmentIndex + 1).toLocaleString('fa-IR')}`}><ErpRialInput
        value={installment.amount.amount} disabled={installmentIndex === 0} onValueChange={amount => updateWizard({ ...draft,
          intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
            installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId
              ? { ...item, amount: { ...item.amount, amount } } : item) } } })} /></ErpField>
      <ErpField label="سررسید"><ErpInput type="date" value={installment.dueDate} onChange={event => updateWizard({ ...draft, intent: { ...draft.intent,
        customerPaymentPlan: { ...draft.intent.customerPaymentPlan, installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId
          ? { ...item, dueDate: event.target.value, ...(item.check ? { check: { ...item.check, dueDate: event.target.value } } : {}) } : item) } } })} /></ErpField>
      <ErpField label="روش پرداخت"><ErpSelect value={installment.method}
        onChange={event => updateWizard({ ...draft, intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
          installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId ? (() => {
            const method = event.target.value as 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'CREDIT';
            return { ...item, method, ...(method === 'CHECK' ? { check: item.check ?? { number: '', bank: '', dueDate: item.dueDate } } : { check: undefined }) };
          })() : item) } } })}>
        <option value="BANK_TRANSFER">واریز بانکی</option><option value="CASH">نقدی</option><option value="CHECK">چک</option><option value="CREDIT">اعتباری</option>
      </ErpSelect></ErpField></div>
      {installment.method === 'CHECK' && <div className="grid gap-3 sm:grid-cols-2">
        <ErpField label="شماره چک" required><ErpInput value={installment.check?.number ?? ''} onChange={event => updateWizard({ ...draft,
          intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
            installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId
              ? { ...item, check: { number: event.target.value, bank: item.check?.bank ?? '', dueDate: item.dueDate } } : item) } } })} /></ErpField>
        <ErpField label="بانک" required><ErpInput value={installment.check?.bank ?? ''} onChange={event => updateWizard({ ...draft,
          intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
            installments: draft.intent.customerPaymentPlan.installments.map(item => item.installmentId === installment.installmentId
              ? { ...item, check: { number: item.check?.number ?? '', bank: event.target.value, dueDate: item.dueDate } } : item) } } })} /></ErpField>
      </div>}
      {installmentIndex > 0 && <ErpButton label="حذف قسط" tone="danger" variant="outline" onClick={() => updateWizard({ ...draft,
        intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
          installments: draft.intent.customerPaymentPlan.installments.filter(item => item.installmentId !== installment.installmentId) } } })} />}
    </ErpCard>)}<ErpButton label="افزودن قسط" variant="outline" onClick={() => updateWizard({ ...draft, intent: { ...draft.intent,
      customerPaymentPlan: { ...draft.intent.customerPaymentPlan, installments: [...draft.intent.customerPaymentPlan.installments,
        { installmentId: `partner-installment-${crypto.randomUUID()}`, dueDate: addDays(draft.intent.contractDate, 30),
          amount: { amount: '0', currency: draft.intent.customerPaymentPlan.installments[0].amount.currency }, method: 'BANK_TRANSFER' }] } } })} /></div>;
    const customer = context.customers.find(item => item.id === draft.intent.customerId);
    return <div className="space-y-2"><p>مشتری: {customer?.displayName}</p>
      {customer?.phone && <p>شماره همراه: {customer.phone}</p>}
      <p>تعداد ردیف‌ها: {draft.rows.length.toLocaleString('fa-IR')}</p>
      <p>پس از ثبت، پیامک تأیید با همان لینک و کد قرارداد عادی قابل ارسال است.</p></div>;
  };

  if (!context) return error ? <ErpInlineState kind="error" title={error} /> : <ErpLoading />;
  if (context.kind === 'ORDINARY_SALES') return <>{ordinary}</>;
  if (!context.writable) return <ErpInlineState kind="permission"
    title={`ایجاد پرونده فروش همکار در وضعیت فعلی مجاز نیست.${context.blockedCode ? ` (${context.blockedCode})` : ''}`} />;
  if (!runtime && !draftAccess && (context.recoverableDrafts?.length ?? 0) > 1 && !searchParams.get('draftId') && !freshInquiryRef.current) {
    return <section dir="rtl" className="mx-auto max-w-3xl space-y-4"><h1 className="text-2xl font-bold">پیش‌نویس‌ها</h1>
      <div className="grid gap-3 sm:grid-cols-2">{context.recoverableDrafts!.map((item, index) => <ErpCard key={item.recoveryId} className="space-y-3 p-4">
        <strong>{item.title || `پیش‌نویس ${(index + 1).toLocaleString('fa-IR')}`}</strong>
        <p className="text-sm sds-text-secondary">آخرین تغییر: {new Date(item.updatedAt).toLocaleString('fa-IR')}</p>
        <ErpField label="نام پیش‌نویس"><ErpInput value={draftTitles[item.recoveryId] ?? item.title ?? ''}
          onChange={event => setDraftTitles(value => ({ ...value, [item.recoveryId]: event.target.value }))} /></ErpField>
        <div className="flex flex-wrap gap-2"><ErpButton label="ذخیره نام" variant="outline"
          onClick={() => void renameDraft(item.recoveryId).catch(() => setError('تغییر نام پیش‌نویس انجام نشد.'))} />
          <ErpButton label="حذف پیش‌نویس" tone="danger" variant="outline"
            onClick={() => setDraftDeleteTarget(item.recoveryId)} /></div>
        <ErpButton label="ادامه پیش‌نویس" onClick={() => router.replace(`${mode === 'inquiry' ? '/dashboard/sales/partner-inquiries?' : '/dashboard/sales/contracts/create?'}draftId=${encodeURIComponent(item.recoveryId)}`)} />
      </ErpCard>)}</div>
      <ErpSheet open={Boolean(draftDeleteTarget)} onClose={() => setDraftDeleteTarget(undefined)} title="حذف پیش‌نویس" presentation="modal"
        footer={<ErpButton label="حذف" tone="danger" onClick={() => { const target = draftDeleteTarget; if (!target) return;
          void deleteDraft(target).then(() => setDraftDeleteTarget(undefined)).catch(() => setError('حذف پیش‌نویس انجام نشد.')); }} />}>
        <p>استعلام‌های مستقل و سوابق آن‌ها حذف نمی‌شوند.</p>
      </ErpSheet>
      <ErpButton label="شروع پیش‌نویس جدید" variant="outline" onClick={() => void beginNewInquiry(context)} />
    </section>;
  }
  if (recoveryBlocked && !runtime) return <section dir="rtl" className="mx-auto max-w-3xl space-y-4"><ErpInlineState kind="stale"
    title="این پیش‌نویس در نشست دیگری باز است یا نسخه آن تغییر کرده است."
    actions={[{ label: 'تصاحب و ادامه در اینجا', onClick: () => void openDraftRecovery(context, true) },
      { label: 'کنار گذاشتن و شروع جدید', tone: 'danger', variant: 'outline', onClick: () => void discardDraftRecovery(context) }]} />
    {error && <ErpInlineState kind="error" title={error} />}</section>;
  if (wizard && submission) return <PartnerContractWizard draft={wizard} onChange={updateWizard} recovery={{ state: 'writable' }}
    submission={submission} now={Date.now()} renderSection={renderSection}
    validateStep={(step, draft) => step === 'date' && !draft.intent.contractDate ? 'تاریخ قرارداد را وارد کنید.'
      : step === 'customer' && !draft.intent.customerId ? 'مشتری را انتخاب کنید.'
      : step === 'project' && !draft.intent.projectId ? 'پروژه را انتخاب کنید.'
      : step === 'delivery' && draft.intent.deliveries.some(item => !item.date || !item.destination.trim()) ? 'برنامه تحویل را کامل کنید.'
      : step === 'delivery' && draft.rows.some(row => remainingPartnerAmount(row.quantity,
        draft.intent.deliveries.flatMap(delivery => delivery.items.filter(item => item.productRowId === row.productRowId).map(item => item.quantity))) !== '0')
        ? 'مقدار تحویل هر محصول باید دقیقاً با مقدار قرارداد برابر باشد.'
      : step === 'payment' && !PaymentPlanSchema.safeParse(draft.intent.customerPaymentPlan).success
        ? 'برنامه پرداخت را کامل کنید.'
      : step === 'payment' && (() => {
        const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
        return remainingPartnerAmount(summary.valid && summary.retail ? summary.retail : '0',
          draft.intent.customerPaymentPlan.installments.map(item => item.amount.amount)) !== '0';
      })() ? 'جمع اقساط باید با مبلغ فروش برابر باشد.'
        : null}
    onReinquire={row => void reinquireFromWizard(row)} onEditProducts={() => {
      const current = wizard;
      void persistWizardServer(current).then(saved => {
        if (!saved) return;
        setWizard(null); persistRuntime(null);
        router.replace(`/dashboard/sales/contracts/create?configure=1&draftId=${encodeURIComponent(current.intent.recoveryId)}`);
      });
    }} onSendConfirmation={caseId => sendPartnerConfirmation(caseId).then(() => undefined)}
    onOpenCase={caseId => router.push(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(caseId)}`)} />;
  if (runtime) return <div className="min-w-0 space-y-4"><PartnerInquiryWorkspace actorId={runtime.actorId} inquiryId={runtime.inquiryId}
    queries={inquiryPorts.queries} commands={inquiryPorts.commands} recovery={{
      pending: () => readStored(inquiryPendingKey(runtime.actorId)),
      savePending: async command => window.localStorage.setItem(inquiryPendingKey(runtime.actorId), JSON.stringify(command)),
      clearPending: async () => window.localStorage.removeItem(inquiryPendingKey(runtime.actorId)),
    }} writable configuredRows={runtime.configuredRows} configurationEditor={<p>مشخصات فنی ذخیره‌شده برای {runtime.saved.rows.length.toLocaleString('fa-IR')} ردیف</p>}
    onEnterWizard={enterWizard} onOpenInquiry={() => undefined} onCreateNewInquiry={() => void beginNewInquiry(context)}
    prepareSuccessor={async row => ({ rowId: `partner-inquiry-row-${crypto.randomUUID()}`, configuration: row.configurationRef })} />
    {error && <ErpInlineState kind="error" title={error} />}</div>;
  if (showCustomerForm) return <section dir="rtl" className="mx-auto min-w-0 max-w-4xl space-y-5">
    <h1 className="text-2xl font-bold">ثبت مشتری فروش همکار</h1>
    <ErpInlineState kind="empty" title="برای شروع فروش، ابتدا مشتری خود را ثبت کنید. این مشتری فقط در حساب فروش همکار شما قرار می‌گیرد." />
    <ErpCard className="space-y-4 p-4 sm:p-6">
      {duplicateMatch && <ErpCard className="space-y-3 p-4" tone="warning"><ErpInlineState kind="stale"
        title={`مشتری مشابه پیدا شد: ${duplicateMatch.displayName} · ${duplicateMatch.city} · ${duplicateMatch.maskedWitness}`} />
        <ErpField label="دلیل درخواست انتقال" required><ErpTextarea value={transferReason} maxLength={4000}
          onChange={event => setTransferReason(event.target.value)} /></ErpField>
        <ErpButton label="ثبت درخواست انتقال مشتری" tone="warning" disabled={pending || !/[\u0600-\u06ff]/.test(transferReason)}
          onClick={() => void requestCustomerTransfer()} /></ErpCard>}
      <ErpField label="نوع مشتری" required><ErpSelect value={customerDraft.customerType}
        onChange={event => setCustomerDraft({ ...customerDraft, customerType: event.target.value as 'Individual' | 'Company' })}>
        <option value="Individual">شخص حقیقی</option><option value="Company">شخص حقوقی</option>
      </ErpSelect></ErpField>
      <div className="grid gap-4 sm:grid-cols-2">
        <ErpField label="نام" required><ErpInput value={customerDraft.firstName} maxLength={120}
          onChange={event => setCustomerDraft({ ...customerDraft, firstName: event.target.value })} /></ErpField>
        <ErpField label="نام خانوادگی" required><ErpInput value={customerDraft.lastName} maxLength={120}
          onChange={event => setCustomerDraft({ ...customerDraft, lastName: event.target.value })} /></ErpField>
      </div>
      {customerDraft.customerType === 'Company' && <ErpField label="نام شرکت"><ErpInput value={customerDraft.companyName} maxLength={500}
        onChange={event => setCustomerDraft({ ...customerDraft, companyName: event.target.value })} /></ErpField>}
      <div className="grid gap-4 sm:grid-cols-2">
        <ErpField label="شماره تماس" required><ErpInput inputMode="tel" value={customerDraft.phone} maxLength={30}
          onChange={event => setCustomerDraft({ ...customerDraft, phone: event.target.value })} /></ErpField>
        <ErpField label="کد ملی / شناسه ملی"><ErpInput inputMode="numeric" value={customerDraft.nationalCode} maxLength={30}
          onChange={event => setCustomerDraft({ ...customerDraft, nationalCode: event.target.value })} /></ErpField>
      </div>
      <ErpField label="شهر"><ErpInput value={customerDraft.city} maxLength={500}
        onChange={event => setCustomerDraft({ ...customerDraft, city: event.target.value })} /></ErpField>
      <ErpField label="نشانی تحویل" required><ErpTextarea value={customerDraft.address} maxLength={1000} rows={3}
        onChange={event => setCustomerDraft({ ...customerDraft, address: event.target.value })} /></ErpField>
      <div className="flex flex-wrap gap-3">
        <ErpButton label={pending ? 'در حال ثبت…' : 'ثبت مشتری و ادامه'} disabled={pending || !validatePartnerCustomerDraft(customerDraft)}
          onClick={() => void createCustomer(context)} />
        {context.customers.length > 0 && <ErpButton label="انصراف" variant="outline" disabled={pending} onClick={() => setShowCustomerForm(false)} />}
      </div>
    </ErpCard>
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;
  return <section dir="rtl" className="mx-auto min-w-0 max-w-4xl space-y-5">
    <h1 className="text-2xl font-bold">{mode === 'inquiry' ? 'استعلام قیمت جدید' : 'ایجاد فروش همکار'}</h1>
    {mode === 'sale' && <WizardProgressBar currentStep={preparationStep} steps={partnerWizardSteps.map((step, index) => ({ id: index + 1,
      title: step.label, titleEn: step.id, icon: step.icon, description: step.label }))} />}
    {customerNotice && <ErpInlineState kind="success" title={customerNotice} />}
    <ErpCard className="space-y-4 p-4 sm:p-6">
      {mode === 'sale' && preparationStep === 1 && <ErpField label="تاریخ قرارداد" required>
        <ErpInput type="date" value={contractDate} onChange={event => setContractDate(event.target.value)} />
      </ErpField>}
      {mode === 'sale' && preparationStep === 2 && <div className="space-y-4">
        <ErpCombobox label="مشتری" value={customerId}
          options={context.customers.map(customer => ({ value: customer.id, label: customer.displayName }))}
          onChange={value => { setCustomerId(value); setProjectId(current => context.projects.some(project =>
            project.id === current && project.customerId === value) ? current : ''); }} />
        <ErpButton label="ثبت مشتری جدید" variant="outline" onClick={() => setShowCustomerForm(true)} />
      </div>}
      {mode === 'sale' && preparationStep === 3 && <div className="space-y-4">
        <ErpCombobox label="پروژه" value={projectId}
          options={context.projects.filter(project => project.customerId === customerId)
            .map(project => ({ value: project.id, label: project.title }))}
          onChange={setProjectId} />
        <ErpButton label="ثبت پروژه جدید" variant="outline" disabled={!customerId}
          onClick={() => setShowProjectForm(true)} />
        <ErpSheet open={showProjectForm} onClose={() => setShowProjectForm(false)} title="ثبت پروژه جدید"
          presentation="modal" pending={pending} footer={<ErpButton label="ثبت و انتخاب پروژه"
            disabled={pending || !projectTitle.trim()} onClick={() => void createProject(context)} />}>
          <div className="space-y-4">
            <ErpField label="عنوان پروژه" required><ErpInput value={projectTitle} maxLength={300}
              onChange={event => setProjectTitle(event.target.value)} /></ErpField>
            <ErpField label="نشانی پروژه"><ErpTextarea value={projectAddress} maxLength={1000}
              onChange={event => setProjectAddress(event.target.value)} /></ErpField>
          </div>
        </ErpSheet>
      </div>}
      {(mode === 'inquiry' || preparationStep === 4) && <>
        {mode === 'inquiry'
          ? <PartnerQuickInquiryEditor draft={technicalDraft} products={catalog} dimensions={quickDimensions}
              onDimensionsChange={setQuickDimensions} onChange={setTechnicalDraft} />
          : <PartnerTechnicalDraftEditor draft={technicalDraft} products={catalog} operations={operations}
              preview={technicalPreview} onChange={setTechnicalDraft} />}
        <ErpField label="یادداشت (اختیاری)"><ErpTextarea value={inquiryNote} maxLength={2000}
          onChange={event => setInquiryNote(event.target.value)} /></ErpField>
        {mode === 'inquiry' && <ErpButton label="ارسال همه ردیف‌ها" disabled={!technicalActionReady}
          onClick={() => void startInquiry(context)} />}
      </>}
    </ErpCard>
    {mode === 'sale' && <PartnerPreparationNavigation step={preparationStep}
      pending={pending} technicalReady={technicalActionReady}
      onPrevious={() => { setError(null); setPreparationStep(step => Math.max(1, step - 1)); }}
      onNext={() => {
        setError(null);
        if (preparationStep === 1 && !contractDate) { setError('تاریخ قرارداد را وارد کنید.'); return; }
        if (preparationStep === 2 && !customerId) { setError('مشتری را انتخاب کنید.'); return; }
        if (preparationStep === 3 && !projectId) { setError('پروژه را انتخاب کنید.'); return; }
        if (preparationStep < 4) { setPreparationStep(step => step + 1); return; }
        void startInquiry(context);
      }} />}
    {showPartnerContractConfigurationWarning(mode, contractConfigurationReady) && preparationStep === 4
      && <ErpInlineState kind="stale" title="مشخصات و مقدار واقعی این قرارداد را تکمیل کنید." />}
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;
}
