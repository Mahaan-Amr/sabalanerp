import type { DispatchDocumentCase, DispatchDocumentWorkspace, MonetaryAmount } from './dispatchDocumentsViewModel';

export type DispatchDocumentDecision = { action: 'ACCEPT' | 'REJECT'; reason: string; idempotencyKey: string };
export type DispatchDocumentReplacement = { reason: string; idempotencyKey: string };
export type DispatchDocumentHandoff = { kind: 'DOWNLOAD_WAYBILL' | 'DOWNLOAD_STATEMENT' | 'PRINT_WAYBILL' | 'PRINT_STATEMENT' | 'PRINT_BOTH' };
export type DispatchDocumentHandoffArtifact = { kind: 'WAYBILL' | 'STATEMENT'; url: string; fileName: string };
export type DispatchDocumentHandoffResult = { artifacts: DispatchDocumentHandoffArtifact[] };

export interface DispatchDocumentsClient {
  load(): Promise<DispatchDocumentWorkspace>;
  decide(caseId: string, input: DispatchDocumentDecision): Promise<DispatchDocumentCase>;
  replace(caseId: string, input: DispatchDocumentReplacement): Promise<DispatchDocumentCase>;
  handoff(caseId: string, input: DispatchDocumentHandoff): Promise<DispatchDocumentHandoffResult>;
}

type ApiEnvelope<T> = { success: boolean; data: T; error?: string };
type JsonRecord = Record<string, any>;

export class DispatchDocumentsAuthorizationError extends Error {
  constructor(message: string, readonly status: 401 | 403) { super(message); this.name = 'DispatchDocumentsAuthorizationError'; }
}

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const list = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(record) : [];
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = '') => value === null || value === undefined ? fallback : String(value);
const iso = (value: unknown) => text(value) || new Date(0).toISOString();
const money = (amount: unknown, currency: string): MonetaryAmount => ({ amount: text(amount, '0'), currency });

const addDecimals = (values: string[]): string => {
  const scale = values.reduce((maximum, value) => Math.max(maximum, (value.split('.')[1] || '').length), 0);
  const total = values.reduce((sum, value) => {
    const match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match) return sum;
    const fraction = (match[3] || '').padEnd(scale, '0');
    const magnitude = BigInt(`${match[2]}${fraction}` || '0');
    return sum + (match[1] === '-' ? -magnitude : magnitude);
  }, BigInt(0));
  if (!scale) return total.toString();
  const sign = total < 0 ? '-' : '';
  const digits = (total < 0 ? -total : total).toString().padStart(scale + 1, '0');
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
};

/** Maps the frozen Accounting combined read-model DTO; no amount or stable row identity is recomputed. */
export function mapDispatchDocumentReadModel(value: unknown): DispatchDocumentCase {
  const candidate = record(value);
  const revision = record(candidate.allocationRevision);
  const snapshot = record(revision.snapshot);
  const loading = record(snapshot.loading);
  const customer = record(loading.customer);
  const project = record(loading.project);
  const admission = record(record(snapshot.queueTurn).admissionSnapshot);
  const references = list(revision.pricingReferences);
  const currency = text(record(references[0]?.pricingVersion).currency, 'IRR');
  const events = list(revision.pricedAllocationEvents);
  const eventByLine = new Map(events.map((event) => [text(event.allocationRevisionLineId), event]));
  const contractGroups = new Map<string, { id: string; number: string; rows: DispatchDocumentCase['contracts'][number]['rows'] }>();

  for (const line of list(revision.lines)) {
    const lineSnapshot = record(line.snapshot);
    const contractId = text(line.sourceContractId, text(lineSnapshot.contractId));
    const group = contractGroups.get(contractId) || { id: contractId, number: text(lineSnapshot.contractNumber, contractId), rows: [] };
    const priced = eventByLine.get(text(line.id)) || {};
    group.rows.push({
      id: text(line.sourceContractItemId, text(lineSnapshot.contractItemId)),
      label: text(lineSnapshot.productName, text(lineSnapshot.label, text(line.productRowId))),
      quantity: text(line.quantity), unit: text(line.unit),
      gross: money(priced.grossAmount, currency), discount: money(priced.discountAmount, currency), net: money(priced.netAmount, currency),
    });
    contractGroups.set(contractId, group);
  }

  const waybills = list(candidate.waybills);
  const active = [...waybills].reverse().find((waybill) => waybill.status === 'ISSUED' || waybill.status === 'EXIT_RECORDED') || waybills[waybills.length - 1];
  const status = text(candidate.status);
  const blockedCode = status === 'EVIDENCE_CONFLICT' ? 'EVIDENCE_CONFLICT' : status === 'STALE_REQUIRES_SUCCESSOR' ? 'STALE_PRICING' : 'INCOMPLETE_EVIDENCE';
  const state: DispatchDocumentCase['state'] = active ? 'ISSUED' : status === 'PENDING' ? 'READY' : 'BLOCKED';
  const total = events.length ? addDecimals(events.map((event) => text(event.netAmount, '0'))) : 'UNKNOWN';
  const contracts = Array.from(contractGroups.values());

  const bundle = active ? {
    id: text(active.id), number: text(active.number), status: text(active.status) as NonNullable<DispatchDocumentCase['bundle']>['status'],
    issuedAt: iso(active.issuedAt),
    artifacts: list(active.documentArtifacts).map((artifact) => ({ id: text(artifact.id),
      kind: (artifact.kind === 'STATEMENT_ADJUSTMENT' ? 'ADJUSTMENT' : artifact.kind) as 'WAYBILL' | 'STATEMENT' | 'ADJUSTMENT',
      fileName: `${text(artifact.kind).toLowerCase()}-${text(active.number)}.pdf`, checksum: text(artifact.sha256),
      byteSize: Number(artifact.byteLength || 0), createdAt: iso(artifact.publishedAt) })),
    printHistory: list(active.printHandoffs).map((handoff) => ({ id: text(handoff.id),
      action: array(handoff.requestedKinds).length > 1 ? 'BOTH' as const : array(handoff.requestedKinds)[0] === 'STATEMENT' ? 'STATEMENT' as const : 'WAYBILL' as const,
      actorName: text(handoff.requestedBy), occurredAt: iso(handoff.completedAt || handoff.requestedAt),
      outcome: handoff.status === 'SUCCEEDED' ? 'SUCCEEDED' as const : 'FAILED' as const })),
    adjustments: list(active.statementAdjustments).map((adjustment) => {
      const adjustmentSnapshot = record(adjustment.snapshot);
      const payload = record(adjustmentSnapshot.payload);
      return { id: text(adjustment.id), sequence: Number(adjustment.sequence), sharedNumber: text(active.number),
        issuedAt: iso(adjustment.issuedAt), summary: text(payload.reason, text(adjustmentSnapshot.reason)),
        netDelta: money(payload.netAmountDelta ?? adjustmentSnapshot.netAmountDelta, currency),
        artifactId: text(list(active.documentArtifacts).find((artifact) => artifact.statementAdjustmentId === adjustment.id)?.id) };
    }),
    history: waybills.map((waybill) => ({ id: text(waybill.id), number: text(waybill.number), status: text(waybill.status),
      occurredAt: iso(waybill.voidedAt || waybill.issuedAt), reason: waybill.voidReason ? text(waybill.voidReason) : undefined })),
  } : undefined;

  return {
    id: text(candidate.id), state,
    customerName: text(customer.companyName, text(customer.name, text(customer.id, 'مشتری در تصویر ثابت ثبت نشده'))),
    destination: text(project.address, text(project.name, text(project.id, 'مقصد در تصویر ثابت ثبت نشده'))),
    loadingNumber: text(loading.number, text(loading.id, `پرونده ${text(candidate.id)}`)), finalizedAt: iso(revision.finalizedAt || snapshot.finalizedAt),
    total: money(total, currency), vehiclePlate: text(admission.vehiclePlate, text(record(admission.vehicle).plate,
      text(admission.externalVehicleId, 'ثبت نشده در تصویر ثابت'))),
    driverName: text(admission.driverName, text(record(admission.driver).name,
      text(admission.externalDriverId || admission.internalDriverId, 'ثبت نشده در تصویر ثابت'))),
    readiness: state === 'BLOCKED'
      ? { code: blockedCode, label: status === 'EVIDENCE_CONFLICT' ? 'تعارض شواهد' : 'نیازمند اصلاح در منبع', reasons: [{ id: `${candidate.id}:${blockedCode}`,
        label: text(candidate.dispositionReason, 'شواهد این پرونده برای صدور آماده نیست.'), ownerLabel: 'بازگشت به لجستیک', ownerHref: '/dashboard/logistics' }] }
      : { code: 'READY', label: state === 'ISSUED' ? 'بسته صادرشده' : 'آماده بررسی', reasons: [] },
    contracts, bundle,
  };
}

const parseJsonResponse = async <T,>(response: Response): Promise<T> => {
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (response.status === 401 || response.status === 403) throw new DispatchDocumentsAuthorizationError('این عملیات متوقف شد چون مجوز اسناد ارسال فعال نیست. مدیر حسابداری باید مجوز مرتبط را بررسی کند.', response.status);
  if (!response.ok || !body?.success) {
    const safeMessage = typeof body?.error === 'string' && /[\u0600-\u06FF]/.test(body.error)
      ? body.error
      : 'ارتباط با سرویس اسناد ارسال متوقف شد. پشتیبان سامانه باید وضعیت سرور را بررسی کند.';
    throw new Error(safeMessage);
  }
  return body.data;
};

const send = (url: string, init?: RequestInit) => fetch(url, { credentials: 'include', ...init,
  headers: { 'Content-Type': 'application/json', ...init?.headers } });

export const dispatchDocumentApiPaths = (baseUrl = '/api/accounting') => ({
  candidates: () => `${baseUrl}/dispatch-candidates`,
  decision: (candidateId: string) => `${baseUrl}/dispatch-candidates/${encodeURIComponent(candidateId)}/decision`,
  readModel: (candidateId: string, waybillId?: string) => `${baseUrl}/dispatch-candidates/${encodeURIComponent(candidateId)}/document-read-model${waybillId ? `?waybillId=${encodeURIComponent(waybillId)}` : ''}`,
  replace: (waybillId: string) => `${baseUrl}/dispatch-waybills/${encodeURIComponent(waybillId)}/replace`,
  artifact: (waybillId: string, artifactId: string) => `${baseUrl}/dispatch-waybills/${encodeURIComponent(waybillId)}/artifacts/${encodeURIComponent(artifactId)}`,
  print: (waybillId: string) => `${baseUrl}/dispatch-waybills/${encodeURIComponent(waybillId)}/print-handoffs`,
});

/** Production adapter for the authenticated, mounted Accounting routes and their frozen DTOs. */
export function createDispatchDocumentsHttpClient(baseUrl = '/api/accounting'): DispatchDocumentsClient {
  const paths = dispatchDocumentApiPaths(baseUrl);
  const cases = new Map<string, DispatchDocumentCase>();
  const readOne = async (candidateId: string, waybillId?: string) => mapDispatchDocumentReadModel(
    await parseJsonResponse<unknown>(await send(paths.readModel(candidateId, waybillId))));
  const load = async (): Promise<DispatchDocumentWorkspace> => {
    const response = await send(paths.candidates());
    const candidates = await parseJsonResponse<JsonRecord[]>(response);
    const visible = candidates.filter((candidate) => ['PENDING', 'STALE_REQUIRES_SUCCESSOR', 'EVIDENCE_CONFLICT'].includes(text(candidate.status))
      || list(candidate.waybills).length > 0);
    const mapped = await Promise.all(visible.map((candidate) => {
      const waybills = list(candidate.waybills);
      return readOne(text(candidate.id), text(waybills[waybills.length - 1]?.id) || undefined);
    }));
    cases.clear(); mapped.forEach((item) => cases.set(item.id, item));
    const projected = response.headers.get('X-Dispatch-Documents-Permission');
    return { permission: projected === 'MANAGE' ? 'MANAGE' : 'VIEW', cases: mapped, retrievedAt: new Date().toISOString() };
  };
  const requireBundle = (caseId: string) => {
    const item = cases.get(caseId);
    if (!item?.bundle) throw new Error('بسته صادرشده برای این پرونده در دسترس نیست.');
    return item.bundle;
  };
  const pdf = async (url: string) => {
    const response = await fetch(url, { credentials: 'include' });
    if (response.status === 401 || response.status === 403) throw new DispatchDocumentsAuthorizationError('دسترسی به اسناد ارسال مجاز نیست.', response.status);
    if (!response.ok) throw new Error('فایل نگهداری‌شده در دسترس نیست.');
    return URL.createObjectURL(await response.blob());
  };
  return {
    load,
    async decide(caseId, input) {
      const result = record(await parseJsonResponse(await send(paths.decision(caseId), { method: 'POST', headers: { 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input) })));
      if (input.action === 'REJECT' || !result.waybill?.id) return cases.get(caseId)!;
      const item = await readOne(caseId, text(result.waybill.id)); cases.set(caseId, item); return item;
    },
    async replace(caseId, input) {
      const current = requireBundle(caseId);
      const result = record(await parseJsonResponse(await send(paths.replace(current.id), { method: 'POST', headers: { 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input) })));
      const item = await readOne(caseId, text(record(result.replacement).id)); cases.set(caseId, item); return item;
    },
    async handoff(caseId, input) {
      const bundle = requireBundle(caseId);
      const kinds = input.kind === 'PRINT_BOTH' ? ['WAYBILL', 'STATEMENT'] as const
        : [input.kind.endsWith('WAYBILL') ? 'WAYBILL' : 'STATEMENT'] as const;
      if (input.kind.startsWith('PRINT')) {
        const response = await send(paths.print(bundle.id), { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ kinds }) });
        if (response.status === 401 || response.status === 403) throw new DispatchDocumentsAuthorizationError('دسترسی به اسناد ارسال مجاز نیست.', response.status);
        if (!response.ok) throw new Error('تحویل چاپ اسناد انجام نشد.');
        await response.blob();
      }
      return { artifacts: await Promise.all(kinds.map(async (kind) => {
        const artifact = bundle.artifacts.find((item) => item.kind === kind);
        if (!artifact) throw new Error('فایل نگهداری‌شده برای سند در دسترس نیست.');
        return { kind, url: await pdf(paths.artifact(bundle.id, artifact.id)), fileName: artifact.fileName };
      })) };
    },
  };
}
