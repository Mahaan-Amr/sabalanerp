'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DuplicateCustomerMatchSchema, PartnerCaseViewSchema, PartnerCommandSchema, PartnerCreationContextSchema,
  PartnerTechnicalCatalogPageSchema, canonicalHash, partnerError, previewPartnerTechnicalDraft,
  type PartnerCaseView, type PartnerCommand, type PartnerCommandPort,
  type DuplicateCustomerMatch, type PartnerCreationContext, type PartnerTechnicalSaveReceipt,
  type PartnerTechnicalCatalogPage, type PartnerTechnicalDraft, type PartnerTechnicalOperation, type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCard, ErpCombobox, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpSelect, ErpTextarea } from '@/components/erp';
import api from '@/lib/api';
import { createPartnerTechnicalHttpPorts } from './partnerTechnicalHttpPorts';
import { createPartnerInquiryHttpPorts } from '../../partner-sales/inquiries/partnerInquiryHttpPorts';
import { PartnerInquiryWorkspace } from '../../partner-sales/inquiries/PartnerInquiryWorkspace';
import type { PartnerConfiguredInquiryRows } from '../../partner-sales/inquiries/partnerInquirySubmission';
import type { PartnerInquiryView } from '../../partner-sales/inquiries/inquiryPresentation';
import { PartnerContractWizard, type PartnerWizardDraft, type PartnerWizardStep } from './PartnerContractWizard';
import { createPartnerCaseSubmission, type PartnerSubmitCommand } from './partnerCaseSubmission';
import { enterPartnerWizard } from './partnerWizardEntry';
import { partnerRetailSummary } from './partnerRetail';
import { PartnerTechnicalDraftEditor } from './PartnerTechnicalDraftEditor';
import { buildPartnerCustomerCreateCommand, emptyPartnerCustomerDraft, validatePartnerCustomerDraft,
  type PartnerCustomerDraft } from './partnerCustomerCreation';

type PartnerContext = Extract<PartnerCreationContext, { kind: 'PARTNER' }>;
type Access = { schemaVersion: 1; recoveryId: string; browserSessionId: string;
  leaseToken: string; baseRevision: number };
type PersistedRuntime = { actorId: string; inquiryId: string; access: Access;
  saved: PartnerTechnicalSaveReceipt; configuredRows: PartnerConfiguredInquiryRows; customerId: string };

const ports = createPartnerTechnicalHttpPorts();
const inquiryPorts = createPartnerInquiryHttpPorts();
const runtimeKey = (actorId: string, inquiryId: string) => `partner-creation-runtime:${actorId}:${inquiryId}`;
const inquiryPendingKey = (actorId: string) => `partner-inquiry-pending:${actorId}`;
const casePendingKey = (actorId: string) => `partner-case-pending:${actorId}`;
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

export function PartnerCreationRuntime({ ordinary }: { ordinary: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const freshInquiryRef = useRef(searchParams.get('newInquiry') === '1');
  const [context, setContext] = useState<PartnerCreationContext | null>(null);
  const [runtime, setRuntime] = useState<PersistedRuntime | null>(null);
  const runtimeRef = useRef<PersistedRuntime | null>(null);
  runtimeRef.current = runtime;
  const [catalog, setCatalog] = useState<PartnerTechnicalProduct[]>([]);
  const [operations, setOperations] = useState<PartnerTechnicalOperation[]>([]);
  const [technicalDraft, setTechnicalDraft] = useState<PartnerTechnicalDraft>(() => emptyTechnicalDraft());
  const [draftAccess, setDraftAccess] = useState<Access | null>(null);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const recoveryRevisionRef = useRef(0);
  recoveryRevisionRef.current = recoveryRevision;
  const recoveryStarting = useRef(false);
  const checkpointFlight = useRef(false);
  const checkpointedInputRevision = useRef(0);
  const inquiryHydrationFlight = useRef(false);
  const [customerId, setCustomerId] = useState('');
  const [customerDraft, setCustomerDraft] = useState<PartnerCustomerDraft>(emptyPartnerCustomerDraft);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerNotice, setCustomerNotice] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateCustomerMatch | null>(null);
  const [transferReason, setTransferReason] = useState('');
  const [wizard, setWizard] = useState<PartnerWizardDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const technicalPreview = useMemo(() => previewPartnerTechnicalDraft(technicalDraft,
    { products: catalog, operations, sawKerfMeters: '0.003' }), [catalog, operations, technicalDraft]);
  const technicalReady = technicalPreview.ok && technicalDraft.rows.length > 0 && technicalPreview.value.conflicts.length === 0
    && technicalPreview.value.rows.every(row => row.calculation.ok);

  useEffect(() => {
    let active = true;
    void api.get('/partner/cases/creation-context').then(response => {
      const parsed = PartnerCreationContextSchema.safeParse((response.data as { data?: unknown })?.data);
      if (!active) return;
      if (!parsed.success) throw new Error('Invalid Partner creation context');
      setContext(parsed.data);
      if (parsed.data.kind === 'PARTNER') {
        const startFresh = searchParams.get('newInquiry') === '1';
        freshInquiryRef.current = startFresh;
        const requestedInquiry = searchParams.get('inquiryId') || parsed.data.latestInquiryId || '';
        const saved = startFresh || !requestedInquiry ? null
          : readStored<PersistedRuntime>(runtimeKey(parsed.data.actorId, requestedInquiry));
        if (saved?.actorId === parsed.data.actorId) { setRuntime(saved); setCustomerId(saved.customerId); }
        else {
          const requestedCustomer = searchParams.get('customerId');
          setCustomerId(parsed.data.customers.some(customer => customer.id === requestedCustomer) ? requestedCustomer! : parsed.data.customers[0]?.id || '');
        }
        setShowCustomerForm(searchParams.get('newCustomer') === '1');
      }
    }).catch(() => active && setError('تشخیص مسیر ایجاد قرارداد انجام نشد. دوباره تلاش کنید.'));
    return () => { active = false; };
  }, [searchParams]);

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
      const candidate = fresh ? undefined : partner.recoverableDraft;
      const recoveryId = candidate?.recoveryId ?? `partner-recovery-${crypto.randomUUID()}`;
      const browserSessionId = `partner-browser-${crypto.randomUUID()}`;
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
  }, [runtime]);

  const discardDraftRecovery = useCallback(async (partner: PartnerContext) => {
    const candidate = partner.recoverableDraft;
    if (!candidate || recoveryStarting.current) return;
    recoveryStarting.current = true; setError(null);
    try {
      const browserSessionId = `partner-browser-${crypto.randomUUID()}`;
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
  }, []);

  useEffect(() => {
    if (context?.kind !== 'PARTNER' || !context.writable || runtime || draftAccess || recoveryBlocked) return;
    void openDraftRecovery(context, false, freshInquiryRef.current);
  }, [context, draftAccess, openDraftRecovery, recoveryBlocked, runtime]);

  useEffect(() => {
    if (!draftAccess || runtime || recoveryBlocked || technicalDraft.inputRevision === 0
        || technicalDraft.inputRevision <= checkpointedInputRevision.current) return;
    const timer = window.setTimeout(async () => {
      if (checkpointFlight.current) return;
      checkpointFlight.current = true;
      const expectedRecoveryRevision = recoveryRevisionRef.current;
      try {
        const result = await ports.recovery.checkpoint({ ...draftAccess, expectedRecoveryRevision,
          idempotencyKey: `partner-checkpoint-${crypto.randomUUID()}`, draft: technicalDraft });
        if (!result.ok) { setRecoveryBlocked(true); setError(result.error.message); return; }
        checkpointedInputRevision.current = result.value.inputRevision;
        setRecoveryRevision(result.value.recoveryRevision);
      } catch { setError('ذخیره خودکار پیش‌نویس نامطمئن است؛ پیش از ادامه دوباره تلاش کنید.'); }
      finally { checkpointFlight.current = false; }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draftAccess, recoveryBlocked, recoveryRevision, runtime, technicalDraft]);

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
    router.replace('/dashboard/sales/contracts/create?newInquiry=1');
    try { await openDraftRecovery(partner, false, true); }
    finally { setPending(false); }
  }, [openDraftRecovery, pending, persistRuntime, router]);

  useEffect(() => {
    if (context?.kind !== 'PARTNER' || runtime || freshInquiryRef.current || !draftAccess || recoveryRevision < 1 || inquiryHydrationFlight.current) return;
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
        configuredRows, customerId: customerId || context.customers[0]?.id || '' });
    }).catch(() => setError('بازیابی استعلام ذخیره‌شده انجام نشد.')).finally(() => { inquiryHydrationFlight.current = false; });
  }, [context, customerId, draftAccess, persistRuntime, recoveryRevision, runtime, searchParams]);

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

  const startInquiry = async (partner: PartnerContext) => {
    if (pending || !technicalReady || !draftAccess || checkpointFlight.current) return;
    setPending(true); setError(null);
    try {
      const saved = await ports.saved.save({ ...draftAccess, expectedRecoveryRevision: recoveryRevisionRef.current,
        idempotencyKey: `partner-save-${crypto.randomUUID()}`, draft: technicalDraft });
      if (!saved.ok) { setError(saved.error.message); return; }
      setRecoveryRevision(saved.value.recoveryRevision);
      const inquiryId = `partner-inquiry-${crypto.randomUUID()}`;
      const configuredRows: PartnerConfiguredInquiryRows = saved.value.rows.map(row => ({
        rowId: `partner-inquiry-row-${crypto.randomUUID()}`, configuration: row.configurationRef }));
      const intent = { schemaVersion: 1 as const, type: 'INQUIRY_SUBMIT' as const,
        partnerSellerId: partner.actorId, rows: configuredRows };
      const payloadHash = await canonicalHash(intent);
      const command = PartnerCommandSchema.parse({ ...intent, commandId: payloadHash, correlationId: payloadHash,
        idempotency: { actorId: partner.actorId, operation: 'INQUIRY_SUBMIT', targetId: inquiryId,
          key: payloadHash, payloadHash } });
      window.localStorage.setItem(inquiryPendingKey(partner.actorId), JSON.stringify(command));
      const submitted = await inquiryPorts.commands.execute(command);
      if (!submitted.ok) { window.localStorage.removeItem(inquiryPendingKey(partner.actorId)); setError(submitted.error.message); return; }
      const value = { actorId: partner.actorId, inquiryId, access: draftAccess, saved: saved.value, configuredRows, customerId: '' };
      window.localStorage.removeItem(inquiryPendingKey(partner.actorId)); persistRuntime(value);
      freshInquiryRef.current = false;
      router.replace('/dashboard/sales/contracts/create');
    } catch { setError('ذخیره مشخصات یا ارسال استعلام کامل نشد؛ ورودی‌ها حفظ شده‌اند.'); }
    finally { setPending(false); }
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
        if (active) window.localStorage.removeItem(runtimeKey(submissionActorId, active.inquiryId));
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
    const customer = context.customers.find(item => item.id === customerId) ?? context.customers[0];
    const approved = inquiry.rows.filter(row => row.state === 'APPROVED' && row.approvedPrice);
    const currency = approved[0]?.approvedPrice?.currency;
    if (!customer) { setShowCustomerForm(true); setError('برای ایجاد قرارداد، مشتری را ثبت یا انتخاب کنید.'); return; }
    if (!currency) { setError('پاسخ معتبر استعلام را بررسی کنید.'); return; }
    const contractDate = today();
    const draft = enterPartnerWizard({ inquiry, now: Date.now(), validated: validated.value,
      base: { customerId: customer.id, recoveryId: runtime.saved.recoveryId, recoveryRevision: runtime.saved.recoveryRevision,
        contractDate,
        customerPaymentPlan: { planId: `partner-customer-plan-${crypto.randomUUID()}`, version: 1,
          effectiveDate: contractDate, installments: [{ installmentId: `partner-installment-${crypto.randomUUID()}`,
            dueDate: addDays(contractDate, 30), amount: { amount: '0', currency }, method: 'BANK_TRANSFER' }] },
        deliveries: runtime.saved.rows.map((row, index) => ({ deliveryId: `partner-delivery-${crypto.randomUUID()}`,
          date: addDays(contractDate, 7 + index), destination: customer.address,
          items: [{ productRowId: row.configurationRef.productRowId, quantity: row.quantity }] })),
        retailDiscount: { amount: '0', currency },
      } });
    if (!draft) { setError('همه ردیف‌های فنی باید پاسخ معتبر و جاری داشته باشند.'); return; }
    const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
    if (!summary.valid) { setError(summary.message); return; }
    draft.intent.customerPaymentPlan.installments[0].amount.amount = summary.retail;
    setWizard(draft);
  };

  const updateWizard = (next: PartnerWizardDraft) => {
    const summary = partnerRetailSummary(next.rows, next.intent.retailDiscount);
    const installments = next.intent.customerPaymentPlan.installments;
    setWizard(summary.valid && installments[0] ? { ...next, intent: { ...next.intent,
      customerPaymentPlan: { ...next.intent.customerPaymentPlan, installments: [{ ...installments[0],
        amount: { amount: summary.retail, currency: installments[0].amount.currency } }, ...installments.slice(1)] } } } : next);
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
      <ErpButton label="ثبت پروژه جدید" variant="outline" href={`/dashboard/crm/potential-projects/create?customerId=${encodeURIComponent(draft.intent.customerId)}`} />
    </div>;
    if (step === 'delivery') return <div className="space-y-3">{draft.intent.deliveries.map((delivery, index) => <ErpCard key={delivery.deliveryId} className="space-y-3 p-4">
      <ErpField label={`تاریخ تحویل ${(index + 1).toLocaleString('fa-IR')}`}><ErpInput type="date" value={delivery.date}
        onChange={event => updateWizard({ ...draft, intent: { ...draft.intent, deliveries: draft.intent.deliveries.map(item => item.deliveryId === delivery.deliveryId ? { ...item, date: event.target.value } : item) } })} /></ErpField>
      <ErpField label="مقصد"><ErpInput value={delivery.destination} onChange={event => updateWizard({ ...draft,
        intent: { ...draft.intent, deliveries: draft.intent.deliveries.map(item => item.deliveryId === delivery.deliveryId ? { ...item, destination: event.target.value } : item) } })} /></ErpField>
    </ErpCard>)}</div>;
    if (step === 'payment') return <ErpCard className="space-y-3 p-4"><p>مبلغ برنامه پرداخت: {draft.intent.customerPaymentPlan.installments[0]?.amount.amount}</p>
      <ErpField label="روش پرداخت"><ErpSelect value={draft.intent.customerPaymentPlan.installments[0]?.method}
        onChange={event => updateWizard({ ...draft, intent: { ...draft.intent, customerPaymentPlan: { ...draft.intent.customerPaymentPlan,
          installments: draft.intent.customerPaymentPlan.installments.map((item, index) => index ? item : { ...item, method: event.target.value as 'CASH' | 'BANK_TRANSFER' | 'CHECK' }) } } })}>
        <option value="BANK_TRANSFER">واریز بانکی</option><option value="CASH">نقدی</option><option value="CHECK">چک</option>
      </ErpSelect></ErpField></ErpCard>;
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
        : null}
    onReinquire={() => setWizard(null)} onOpenCase={caseId => router.push(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(caseId)}`)} />;
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
    <h1 className="text-2xl font-bold">ایجاد فروش همکار</h1>
    {customerNotice && <ErpInlineState kind="success" title={customerNotice} />}
    <ErpCard className="space-y-4 p-4 sm:p-6">
      <PartnerTechnicalDraftEditor draft={technicalDraft} products={catalog} operations={operations}
        preview={technicalPreview} onChange={setTechnicalDraft} />
      <ErpButton label="ارسال استعلام" disabled={pending || !technicalReady || !draftAccess || checkpointFlight.current} onClick={() => void startInquiry(context)} />
    </ErpCard>
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;
}
