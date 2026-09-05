'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PartnerCaseViewSchema, PartnerCommandSchema, PartnerCreationContextSchema,
  PartnerTechnicalCatalogPageSchema, canonicalHash, partnerError,
  type PartnerCaseView, type PartnerCommand, type PartnerCommandPort,
  type PartnerCreationContext, type PartnerTechnicalSaveReceipt,
  type PartnerTechnicalCatalogPage, type PartnerTechnicalFamily, type PartnerTechnicalOperation, type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpSelect } from '@/components/erp';
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
import { buildPartnerProductionTechnicalDraft } from './partnerProductionTechnicalDraft';

type PartnerContext = Extract<PartnerCreationContext, { kind: 'PARTNER' }>;
type Access = { schemaVersion: 1; recoveryId: string; browserSessionId: string;
  leaseToken: string; baseRevision: number };
type PersistedRuntime = { actorId: string; inquiryId: string; access: Access;
  saved: PartnerTechnicalSaveReceipt; configuredRows: PartnerConfiguredInquiryRows; customerId: string };

const ports = createPartnerTechnicalHttpPorts();
const inquiryPorts = createPartnerInquiryHttpPorts();
const runtimeKey = (actorId: string) => `partner-creation-runtime:${actorId}`;
const inquiryPendingKey = (actorId: string) => `partner-inquiry-pending:${actorId}`;
const casePendingKey = (actorId: string) => `partner-case-pending:${actorId}`;
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
  const [context, setContext] = useState<PartnerCreationContext | null>(null);
  const [runtime, setRuntime] = useState<PersistedRuntime | null>(null);
  const runtimeRef = useRef<PersistedRuntime | null>(null);
  runtimeRef.current = runtime;
  const [catalog, setCatalog] = useState<PartnerTechnicalProduct[]>([]);
  const [operations, setOperations] = useState<PartnerTechnicalOperation[]>([]);
  const [family, setFamily] = useState<PartnerTechnicalFamily>('prepared');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [lengthMeters, setLengthMeters] = useState('1');
  const [widthMeters, setWidthMeters] = useState('0.2');
  const [sourceLengthMeters, setSourceLengthMeters] = useState('2');
  const [sourceWidthMeters, setSourceWidthMeters] = useState('1');
  const [toolId, setToolId] = useState('');
  const [finishingId, setFinishingId] = useState('');
  const [includeRemainder, setIncludeRemainder] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [wizard, setWizard] = useState<PartnerWizardDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.get('/partner/cases/creation-context').then(response => {
      const parsed = PartnerCreationContextSchema.safeParse((response.data as { data?: unknown })?.data);
      if (!active) return;
      if (!parsed.success) throw new Error('Invalid Partner creation context');
      setContext(parsed.data);
      if (parsed.data.kind === 'PARTNER') {
        const saved = readStored<PersistedRuntime>(runtimeKey(parsed.data.actorId));
        if (saved?.actorId === parsed.data.actorId) { setRuntime(saved); setCustomerId(saved.customerId); }
        else setCustomerId(parsed.data.customers[0]?.id || '');
      }
    }).catch(() => active && setError('تشخیص مسیر ایجاد قرارداد انجام نشد. دوباره تلاش کنید.'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (context?.kind !== 'PARTNER' || !context.writable || runtime) return;
    let active = true;
    void Promise.all([
      readCatalogPages('PRODUCT'), readCatalogPages('TOOL'), readCatalogPages('FINISHING'),
    ]).then(([productPages, toolPages, finishingPages]) => {
        if (!active) return;
        const products = productPages.flatMap(page => page.kind === 'PRODUCT' ? page.items : []);
        const tools = toolPages.flatMap(page => page.kind === 'TOOL' ? page.items : []);
        const finishings = finishingPages.flatMap(page => page.kind === 'FINISHING' ? page.items : []);
        const available = products.filter(item => item.isAvailable);
        setCatalog(available); setProductId(available.find(item => item.families.includes('prepared'))?.catalogItemId || '');
        setOperations([...tools, ...finishings]);
      }).catch(() => active && setError('دریافت کاتالوگ فنی انجام نشد.'));
    return () => { active = false; };
  }, [context, runtime]);

  useEffect(() => {
    const available = catalog.filter(item => item.families.includes(family));
    if (!available.some(item => item.catalogItemId === productId)) setProductId(available[0]?.catalogItemId || '');
    if (['prepared', 'volumetric'].includes(family)) { setToolId(''); setFinishingId(''); setIncludeRemainder(false); }
  }, [catalog, family, productId]);

  const contextActorId = context?.kind === 'PARTNER' ? context.actorId : null;
  const persistRuntime = useCallback((value: PersistedRuntime | null) => {
    setRuntime(value);
    if (!contextActorId) return;
    if (value) window.localStorage.setItem(runtimeKey(contextActorId), JSON.stringify(value));
    else window.localStorage.removeItem(runtimeKey(contextActorId));
  }, [contextActorId]);

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
    if (pending || !partner.sabalanTermsVersionId || !productId || !customerId || !/^\d+(?:\.\d+)?$/.test(quantity) || Number(quantity) <= 0) return;
    setPending(true); setError(null);
    try {
      const product = catalog.find(item => item.catalogItemId === productId && item.families.includes(family));
      if (!product) throw new Error('Product unavailable');
      const recoveryId = `partner-recovery-${crypto.randomUUID()}`;
      const browserSessionId = `partner-browser-${crypto.randomUUID()}`;
      const lease = await ports.lease.acquire({ schemaVersion: 1, recoveryId, browserSessionId, baseRevision: 0, takeover: false });
      if (!lease.ok) { setError(lease.error.message); return; }
      const access: Access = { schemaVersion: 1, recoveryId, browserSessionId,
        leaseToken: lease.value.leaseToken, baseRevision: lease.value.baseRevision };
      const draft = buildPartnerProductionTechnicalDraft({ family, product, quantity, lengthMeters, widthMeters,
        sourceLengthMeters, sourceWidthMeters,
        tool: operations.find((item): item is Extract<PartnerTechnicalOperation, { kind: 'TOOL' }> =>
          item.kind === 'TOOL' && item.catalogItemId === toolId),
        finishing: operations.find((item): item is Extract<PartnerTechnicalOperation, { kind: 'FINISHING' }> =>
          item.kind === 'FINISHING' && item.catalogItemId === finishingId),
        products: catalog, operationsCatalog: operations, includeRemainder,
      }, kind => `partner-${kind}-${crypto.randomUUID()}`);
      const saved = await ports.saved.save({ ...access, expectedRecoveryRevision: 0,
        idempotencyKey: `partner-save-${crypto.randomUUID()}`, draft });
      if (!saved.ok) { setError(saved.error.message); return; }
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
      const value = { actorId: partner.actorId, inquiryId, access, saved: saved.value, configuredRows, customerId };
      window.localStorage.removeItem(inquiryPendingKey(partner.actorId)); persistRuntime(value);
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
        window.localStorage.removeItem(runtimeKey(submissionActorId));
      },
    } });
  }, [reacquireRuntime, submissionActorId, submissionRecoveryId]);

  const enterWizard = async (inquiry: PartnerInquiryView) => {
    if (!runtime || !context || context.kind !== 'PARTNER' || !context.sabalanTermsVersionId) return;
    setError(null);
    const refreshed = await reacquireRuntime(runtime);
    if (!refreshed) return;
    const validated = await ports.saved.readSaved({ ...refreshed.access, recoveryRevision: refreshed.saved.recoveryRevision });
    if (!validated.ok) { setError(validated.error.message); return; }
    const customer = context.customers.find(item => item.id === customerId);
    const approved = inquiry.rows.filter(row => row.state === 'APPROVED' && row.approvedPrice);
    const currency = approved[0]?.approvedPrice?.currency;
    if (!customer || !currency) { setError('مشتری و پاسخ معتبر استعلام را بررسی کنید.'); return; }
    const contractDate = today();
    const draft = enterPartnerWizard({ inquiry, now: Date.now(), validated: validated.value,
      base: { customerId, recoveryId: runtime.saved.recoveryId, recoveryRevision: runtime.saved.recoveryRevision,
        sabalanTermsVersionId: context.sabalanTermsVersionId, contractDate,
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

  const renderSection = (step: Exclude<PartnerWizardStep, 'retail'>, draft: PartnerWizardDraft) => {
    if (!context || context.kind !== 'PARTNER') return null;
    if (step === 'customer') return <ErpField label="مشتری"><ErpSelect value={draft.intent.customerId}
      onChange={event => updateWizard({ ...draft, intent: { ...draft.intent, customerId: event.target.value } })}>
      {context.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</ErpSelect></ErpField>;
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
    return <div className="space-y-2"><p>مشتری: {context.customers.find(item => item.id === draft.intent.customerId)?.displayName}</p>
      <p>تعداد ردیف‌ها: {draft.rows.length.toLocaleString('fa-IR')}</p><p>تعداد تحویل‌ها: {draft.intent.deliveries.length.toLocaleString('fa-IR')}</p></div>;
  };

  if (!context) return error ? <ErpInlineState kind="error" title={error} /> : <ErpLoading />;
  if (context.kind === 'ORDINARY_SALES') return <>{ordinary}</>;
  if (!context.writable) return <ErpInlineState kind="permission"
    title={`ایجاد پرونده فروش همکار در وضعیت فعلی مجاز نیست.${context.blockedCode ? ` (${context.blockedCode})` : ''}`} />;
  if (!context.customers.length) return <ErpInlineState kind="empty" title="ابتدا یک مشتری خصوصی فروش همکار ثبت کنید." />;
  if (wizard && submission) return <PartnerContractWizard draft={wizard} onChange={updateWizard} recovery={{ state: 'writable' }}
    submission={submission} now={Date.now()} renderSection={renderSection}
    validateStep={(step, draft) => step === 'customer' && !draft.intent.customerId ? 'مشتری را انتخاب کنید.'
      : step === 'delivery' && draft.intent.deliveries.some(item => !item.date || !item.destination.trim()) ? 'برنامه تحویل را کامل کنید.'
        : null}
    onReinquire={() => setWizard(null)} onOpenCase={caseId => router.push(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(caseId)}`)} />;
  if (runtime) return <div className="min-w-0 space-y-4"><PartnerInquiryWorkspace actorId={runtime.actorId} inquiryId={runtime.inquiryId}
    queries={inquiryPorts.queries} commands={inquiryPorts.commands} recovery={{
      pending: () => readStored(inquiryPendingKey(runtime.actorId)),
      savePending: async command => window.localStorage.setItem(inquiryPendingKey(runtime.actorId), JSON.stringify(command)),
      clearPending: async () => window.localStorage.removeItem(inquiryPendingKey(runtime.actorId)),
    }} writable configuredRows={runtime.configuredRows} configurationEditor={<p>مشخصات فنی ذخیره‌شده برای {runtime.saved.rows.length.toLocaleString('fa-IR')} ردیف</p>}
    onEnterWizard={enterWizard} onOpenInquiry={() => undefined}
    prepareSuccessor={async row => ({ rowId: `partner-inquiry-row-${crypto.randomUUID()}`, configuration: row.configurationRef })} />
    {error && <ErpInlineState kind="error" title={error} />}</div>;
  const dimensional = !['prepared', 'volumetric'].includes(family);
  const familyLabels: Record<PartnerTechnicalFamily, string> = { prepared: 'سنگ آماده', volumetric: 'سنگ حجمی',
    longitudinal: 'سنگ طولی', slab: 'اسلب', stair: 'پله' };
  return <section dir="rtl" className="mx-auto min-w-0 max-w-4xl space-y-5">
    <h1 className="text-2xl font-bold">ایجاد فروش همکار</h1>
    <ErpCard className="space-y-4 p-4 sm:p-6">
      <ErpField label="مشتری" required><ErpSelect value={customerId} onChange={event => setCustomerId(event.target.value)}>
        {context.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</ErpSelect></ErpField>
      <ErpField label="خانواده محصول" required><ErpSelect value={family}
        onChange={event => setFamily(event.target.value as PartnerTechnicalFamily)}>
        {(Object.keys(familyLabels) as PartnerTechnicalFamily[]).map(value =>
          <option key={value} value={value}>{familyLabels[value]}</option>)}</ErpSelect></ErpField>
      <ErpField label="محصول فنی" required><ErpSelect value={productId} onChange={event => setProductId(event.target.value)}>
        {catalog.filter(product => product.families.includes(family)).map(product =>
          <option key={product.catalogItemId} value={product.catalogItemId}>{product.name}</option>)}</ErpSelect></ErpField>
      <ErpField label="تعداد" required><ErpInput inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} /></ErpField>
      {dimensional && <div className="grid gap-4 sm:grid-cols-2">
        <ErpField label="طول قطعه (متر)" required><ErpInput inputMode="decimal" value={lengthMeters}
          onChange={event => setLengthMeters(event.target.value)} /></ErpField>
        <ErpField label={family === 'stair' ? 'عرض یا ارتفاع (متر)' : 'عرض قطعه (متر)'} required><ErpInput
          inputMode="decimal" value={widthMeters} onChange={event => setWidthMeters(event.target.value)} /></ErpField>
        {family !== 'longitudinal' && <ErpField label="طول سنگ مادر (متر)" required><ErpInput inputMode="decimal"
          value={sourceLengthMeters} onChange={event => setSourceLengthMeters(event.target.value)} /></ErpField>}
        {family === 'slab' && <ErpField label="عرض سنگ مادر (متر)" required><ErpInput inputMode="decimal"
          value={sourceWidthMeters} onChange={event => setSourceWidthMeters(event.target.value)} /></ErpField>}
      </div>}
      {dimensional && <ErpCard className="space-y-4 p-4">
        <p className="font-semibold">برش و فرآوری فنی</p>
        <ErpField label="ابزار"><ErpSelect value={toolId} onChange={event => setToolId(event.target.value)}>
          <option value="">بدون ابزار</option>{operations.filter(item => item.kind === 'TOOL').map(item =>
            <option key={item.catalogItemId} value={item.catalogItemId}>{item.name}</option>)}</ErpSelect></ErpField>
        <ErpField label="فرآوری"><ErpSelect value={finishingId} onChange={event => setFinishingId(event.target.value)}>
          <option value="">بدون فرآوری</option>{operations.filter(item => item.kind === 'FINISHING').map(item =>
            <option key={item.catalogItemId} value={item.catalogItemId}>{item.name}</option>)}</ErpSelect></ErpField>
        <ErpCheckbox checked={includeRemainder} onChange={event => setIncludeRemainder(event.target.checked)}
          label="ایجاد فرزند از باقی‌مانده قابل استفاده" />
      </ErpCard>}
      <ErpButton label="ذخیره مشخصات و ارسال استعلام" disabled={pending || !productId || !customerId} onClick={() => void startInquiry(context)} />
    </ErpCard>
    {error && <ErpInlineState kind="error" title={error} />}
  </section>;
}
