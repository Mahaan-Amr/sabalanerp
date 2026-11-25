import type {
  DispatchDocumentCase,
  DispatchDocumentFilter,
  DispatchDocumentWorkspace,
  MonetaryAmount,
} from "./dispatchDocumentsViewModel";
import { browserScopedFetch } from '@/lib/browserScopedFetch';
import { dispatchDocumentApiPaths } from './dispatchDocumentApiPaths';
export { dispatchDocumentApiPaths } from './dispatchDocumentApiPaths';

export type DispatchDocumentDecision = {
  action: "ACCEPT" | "REJECT";
  reason: string;
  idempotencyKey: string;
};
export type DispatchDocumentReplacement = {
  reason: string;
  idempotencyKey: string;
  waybillId?: string;
};
export type DispatchDocumentReceipt =
  | { status: 'ISSUED'; number: string }
  | { status: 'REPLACED'; number: string }
  | { status: 'REJECTED' }
  | { status: 'BLOCKED' };
export type DispatchDocumentHandoff = {
  kind:
    | "DOWNLOAD_WAYBILL"
    | "DOWNLOAD_STATEMENT"
    | "PRINT_WAYBILL"
    | "PRINT_STATEMENT"
    | "PRINT_BOTH";
};
export type DispatchDocumentHandoffArtifact = {
  kind: "WAYBILL" | "STATEMENT";
  url: string;
  fileName: string;
};
export type DispatchDocumentHandoffResult = {
  artifacts: DispatchDocumentHandoffArtifact[];
};

export interface DispatchDocumentsClient {
  load(filter?: DispatchDocumentFilter, page?: number): Promise<DispatchDocumentWorkspace>;
  loadGroup(loadingId: string): Promise<DispatchDocumentWorkspace>;
  read(candidate: DispatchDocumentCase): Promise<DispatchDocumentCase>;
  decide(
    caseId: string,
    input: DispatchDocumentDecision,
  ): Promise<DispatchDocumentReceipt>;
  replace(
    caseId: string,
    input: DispatchDocumentReplacement,
  ): Promise<DispatchDocumentReceipt>;
  handoff(
    caseId: string,
    input: DispatchDocumentHandoff,
  ): Promise<DispatchDocumentHandoffResult>;
}

type ApiEnvelope<T> = { success: boolean; data: T; error?: string };
type JsonRecord = Record<string, any>;

export class DispatchDocumentsAuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "DispatchDocumentsAuthorizationError";
  }
}

export class DispatchDocumentsOutcomeUnknownError extends Error {
  constructor() {
    super('پاسخ قطعی فرمان دریافت نشد. نتیجه را با همان شناسه بازیابی کنید.');
    this.name = 'DispatchDocumentsOutcomeUnknownError';
  }
}

export const dispatchDocumentsAccessDenied = (error: unknown) => error instanceof DispatchDocumentsAuthorizationError
  || (error as { code?: unknown })?.code === 'AUTH_CONTEXT_CHANGED'
  || (error as { message?: unknown })?.message === 'PRIVATE_FETCH_SCOPE_CONFLICT';

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const list = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(record) : [];
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = "") =>
  value === null || value === undefined ? fallback : String(value);
const iso = (value: unknown) => text(value) || new Date(0).toISOString();
const money = (amount: unknown, currency: string): MonetaryAmount => ({
  amount: text(amount, "0"),
  currency,
});

const addDecimals = (values: string[]): string => {
  const scale = values.reduce(
    (maximum, value) => Math.max(maximum, (value.split(".")[1] || "").length),
    0,
  );
  const total = values.reduce((sum, value) => {
    const match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match) return sum;
    const fraction = (match[3] || "").padEnd(scale, "0");
    const magnitude = BigInt(`${match[2]}${fraction}` || "0");
    return sum + (match[1] === "-" ? -magnitude : magnitude);
  }, BigInt(0));
  if (!scale) return total.toString();
  const sign = total < 0 ? "-" : "";
  const digits = (total < 0 ? -total : total)
    .toString()
    .padStart(scale + 1, "0");
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
};

/** Maps the frozen Accounting combined read-model DTO; no amount or stable row identity is recomputed. */
export function mapDispatchDocumentReadModel(
  value: unknown,
): DispatchDocumentCase {
  const candidate = record(value);
  const revision = record(candidate.allocationRevision);
  const snapshot = record(revision.snapshot);
  const loading = record(snapshot.loading);
  const customer = record(loading.customer);
  const project = record(loading.project);
  const admission = record(record(snapshot.queueTurn).admissionSnapshot);
  const references = list(revision.pricingReferences);
  const currency = text(record(references[0]?.pricingVersion).currency, "IRR");
  const events = list(revision.pricedAllocationEvents);
  const eventByLine = new Map(
    events.map((event) => [text(event.allocationRevisionLineId), event]),
  );
  const contractGroups = new Map<
    string,
    {
      id: string;
      number: string;
      rows: DispatchDocumentCase["contracts"][number]["rows"];
    }
  >();

  for (const line of list(revision.lines)) {
    const lineSnapshot = record(line.snapshot);
    const contractId = text(
      line.sourceContractId,
      text(lineSnapshot.contractId),
    );
    const group = contractGroups.get(contractId) || {
      id: contractId,
      number: text(lineSnapshot.contractNumber, "شماره قرارداد ثبت نشده"),
      rows: [],
    };
    const priced = eventByLine.get(text(line.id)) || {};
    group.rows.push({
      id: text(line.sourceContractItemId, text(lineSnapshot.contractItemId)),
      label: text(
        lineSnapshot.productName,
        text(lineSnapshot.label, "محصول ثبت‌شده"),
      ),
      quantity: text(line.quantity),
      unit: text(line.unit),
      gross: money(priced.grossAmount ?? "UNKNOWN", currency),
      discount: money(priced.discountAmount ?? "UNKNOWN", currency),
      net: money(priced.netAmount ?? "UNKNOWN", currency),
    });
    contractGroups.set(contractId, group);
  }

  const waybills = list(candidate.waybills);
  const active =
    [...waybills]
      .reverse()
      .find(
        (waybill) =>
          waybill.status === "ISSUED" || waybill.status === "EXIT_RECORDED",
      ) || waybills[waybills.length - 1];
  const status = text(candidate.status);
  const blockedCode =
    status === "EVIDENCE_CONFLICT"
      ? "EVIDENCE_CONFLICT"
      : status === "STALE_REQUIRES_SUCCESSOR"
        ? "STALE_PRICING"
        : "INCOMPLETE_EVIDENCE";
  const state: DispatchDocumentCase["state"] = active
    ? "ISSUED"
    : status === "PENDING"
      ? "READY"
      : "BLOCKED";
  const revisionLines = list(revision.lines);
  const completeAmounts = revisionLines.length > 0 && revisionLines.every((line) => {
    const event = eventByLine.get(text(line.id));
    return event && /^[+-]?\d+(?:\.\d+)?$/.test(text(event.netAmount));
  });
  const total = completeAmounts
    ? addDecimals(revisionLines.map((line) => text(eventByLine.get(text(line.id))?.netAmount)))
    : "UNKNOWN";
  const contracts = Array.from(contractGroups.values());

  const bundle = active
    ? {
        id: text(active.id),
        number: text(active.number),
        status: text(active.status) as NonNullable<
          DispatchDocumentCase["bundle"]
        >["status"],
        issuedAt: iso(active.issuedAt),
        artifacts: list(active.documentArtifacts).map((artifact) => ({
          id: text(artifact.id),
          kind: (artifact.kind === "STATEMENT_ADJUSTMENT"
            ? "ADJUSTMENT"
            : artifact.kind) as "WAYBILL" | "STATEMENT" | "ADJUSTMENT",
          fileName: `${text(artifact.kind).toLowerCase()}-${text(active.number)}.pdf`,
          checksum: text(artifact.sha256),
          byteSize: Number(artifact.byteLength || 0),
          createdAt: iso(artifact.publishedAt),
        })),
        printHistory: list(active.printHandoffs).map((handoff) => ({
          id: text(handoff.id),
          action:
            array(handoff.requestedKinds).length > 1
              ? ("BOTH" as const)
              : array(handoff.requestedKinds)[0] === "STATEMENT"
                ? ("STATEMENT" as const)
                : ("WAYBILL" as const),
          actorName: "کاربر سامانه",
          occurredAt: iso(handoff.completedAt || handoff.requestedAt),
          outcome:
            handoff.status === "SUCCEEDED"
              ? ("SUCCEEDED" as const)
              : ("FAILED" as const),
        })),
        adjustments: list(active.statementAdjustments).map((adjustment) => {
          const adjustmentSnapshot = record(adjustment.snapshot);
          const payload = record(adjustmentSnapshot.payload);
          return {
            id: text(adjustment.id),
            sequence: Number(adjustment.sequence),
            sharedNumber: text(active.number),
            issuedAt: iso(adjustment.issuedAt),
            summary: text(payload.reason, text(adjustmentSnapshot.reason)),
            netDelta: money(
              payload.netAmountDelta ?? adjustmentSnapshot.netAmountDelta,
              currency,
            ),
            artifactId: text(
              list(active.documentArtifacts).find(
                (artifact) => artifact.statementAdjustmentId === adjustment.id,
              )?.id,
            ),
          };
        }),
        history: waybills.map((waybill) => ({
          id: text(waybill.id),
          number: text(waybill.number),
          status: text(waybill.status),
          occurredAt: iso(waybill.voidedAt || waybill.issuedAt),
          reason: waybill.voidReason ? text(waybill.voidReason) : undefined,
        })),
      }
    : undefined;

  return {
    id: text(candidate.id),
    canManage: false,
    state,
    customerName: text(
      customer.companyName,
      text(customer.name, "مشتری در تصویر ثابت ثبت نشده"),
    ),
    destination: text(
      project.address,
      text(project.name, "مقصد در تصویر ثابت ثبت نشده"),
    ),
    loadingNumber: text(loading.number, "بارگیری ثبت‌شده"),
    finalizedAt: iso(revision.finalizedAt || snapshot.finalizedAt),
    total: money(total, currency),
    vehiclePlate: text(
      admission.vehiclePlate,
      text(record(admission.vehicle).plate, "پلاک در تصویر ثابت ثبت نشده"),
    ),
    driverName: text(
      admission.driverName,
      text(record(admission.driver).name, "نام راننده در تصویر ثابت ثبت نشده"),
    ),
    readiness:
      state === "BLOCKED"
        ? {
            code: blockedCode,
            label:
              status === "EVIDENCE_CONFLICT"
                ? "تعارض شواهد"
                : "نیازمند اصلاح در منبع",
            reasons: [
              {
                id: `${candidate.id}:${blockedCode}`,
                label: text(
                  candidate.dispositionReason,
                  "شواهد این پرونده برای صدور آماده نیست.",
                ),
                ownerLabel: "بازگشت به لجستیک",
                ownerHref: "/dashboard/logistics",
              },
            ],
          }
        : {
            code: "READY",
            label: state === "ISSUED" ? "بسته صادرشده" : "آماده بررسی",
            reasons: [],
          },
    contracts,
    bundle,
  };
}

const parseJsonResponse = async <T>(response: Pick<Response, 'json' | 'status' | 'ok'>): Promise<T> => {
  const body = (await response
    .json()
    .catch(error => {
      if (dispatchDocumentsAccessDenied(error)) throw error;
      return null;
    })) as ApiEnvelope<T> | null;
  if (response.status === 401 || response.status === 403)
    throw new DispatchDocumentsAuthorizationError(
      "این عملیات متوقف شد چون مجوز اسناد ارسال فعال نیست. مدیر حسابداری باید مجوز مرتبط را بررسی کند.",
      response.status,
    );
  if (!response.ok || !body?.success) {
    const safeMessage =
      typeof body?.error === "string" && /[\u0600-\u06FF]/.test(body.error)
        ? body.error
        : "ارتباط با سرویس اسناد ارسال متوقف شد. پشتیبان سامانه باید وضعیت سرور را بررسی کند.";
    throw new Error(safeMessage);
  }
  return body.data;
};

/** Production adapter for the authenticated, mounted Accounting routes and their frozen DTOs. */
export function createDispatchDocumentsHttpClient(
  baseUrl = "/api/accounting",
  actorId?: string,
): DispatchDocumentsClient {
  const paths = dispatchDocumentApiPaths(baseUrl);
  const printKeys = new Map<string, string>();
  const send = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    if (actorId) headers.set('X-Sabalan-Expected-User', actorId);
    return browserScopedFetch(url, { ...init, headers });
  };
  const submit = async (url: string, input: DispatchDocumentDecision | DispatchDocumentReplacement) => {
    const response = await send(url, {
      method: 'POST', headers: { 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input),
    }).catch(error => {
      if (dispatchDocumentsAccessDenied(error)) throw error;
      throw new DispatchDocumentsOutcomeUnknownError();
    });
    if (response.status >= 500 || response.status === 408) throw new DispatchDocumentsOutcomeUnknownError();
    try { return record(await parseJsonResponse(response)); }
    catch (error) {
      if (response.ok && !dispatchDocumentsAccessDenied(error)) throw new DispatchDocumentsOutcomeUnknownError();
      throw error;
    }
  };
  const cases = new Map<string, DispatchDocumentCase>();
  const readOne = async (
    candidateId: string,
    waybillId?: string,
    canManage = cases.get(candidateId)?.canManage ?? false,
  ) => ({
    ...mapDispatchDocumentReadModel(
      await parseJsonResponse<unknown>(
        await send(paths.readModel(candidateId, waybillId)),
      ),
    ),
    canManage,
  });
  type Header = Pick<DispatchDocumentCase, 'id' | 'loadingId' | 'waybillId' | 'state' | 'canManage'
    | 'customerName' | 'destination' | 'loadingNumber' | 'total'>;
  const loadQueue = async (url: string): Promise<DispatchDocumentWorkspace> => {
    const response = await send(url);
    const data = await parseJsonResponse<{
      rows: Header[]; relatedRows?: Header[]; counts?: Record<DispatchDocumentFilter, number>; page?: number; pageSize?: number;
    }>(response);
    const summary = (row: Header): DispatchDocumentCase => ({
      ...mapDispatchDocumentReadModel({ id: row.id, status: 'PENDING' }), ...row,
    });
    const projected = response.headers.get("X-Dispatch-Documents-Permission");
    return {
      permission: projected === "MANAGE" ? "MANAGE" : "VIEW",
      cases: data.rows.map(summary),
      relatedCases: data.relatedRows?.map(summary),
      counts: data.counts,
      page: data.page,
      pageSize: data.pageSize,
      retrievedAt: new Date().toISOString(),
    };
  };
  const requireBundle = (caseId: string) => {
    const item = cases.get(caseId);
    if (!item?.bundle)
      throw new Error("بسته صادرشده برای این پرونده در دسترس نیست.");
    return item.bundle;
  };
  const pdf = async (url: string) => {
    const response = await send(url);
    if (response.status === 401 || response.status === 403)
      throw new DispatchDocumentsAuthorizationError(
        "دسترسی به اسناد ارسال مجاز نیست.",
        response.status,
      );
    if (!response.ok) throw new Error("فایل نگهداری‌شده در دسترس نیست.");
    return URL.createObjectURL(await response.blob());
  };
  return {
    async load(filter = 'READY', page = 1) {
      cases.clear();
      return loadQueue(paths.queue(filter, page));
    },
    loadGroup: loadingId => loadQueue(paths.group(loadingId)),
    async read(candidate) {
      const detail = await readOne(candidate.id, candidate.waybillId, candidate.canManage);
      if (detail.id !== candidate.id) throw new Error('جزئیات پرونده با انتخاب فعلی منطبق نیست.');
      const item = { ...detail, loadingId: candidate.loadingId, waybillId: candidate.waybillId };
      cases.set(item.id, item);
      return item;
    },
    async decide(caseId, input) {
      const result = await submit(paths.decision(caseId), input);
      if (result.candidateId !== caseId) throw new DispatchDocumentsOutcomeUnknownError();
      if (input.action === 'REJECT' && result.status === 'REJECTED') return { status: 'REJECTED' };
      if (result.status === 'EVIDENCE_CONFLICT' || result.status === 'STALE_REQUIRES_SUCCESSOR') return { status: 'BLOCKED' };
      const waybill = record(result.waybill);
      if (input.action !== 'ACCEPT' || result.status !== 'ACCEPTED' || !waybill.id || !waybill.number)
        throw new DispatchDocumentsOutcomeUnknownError();
      return { status: 'ISSUED', number: text(waybill.number) };
    },
    async replace(caseId, input) {
      const waybillId = input.waybillId ?? requireBundle(caseId).id;
      const result = await submit(paths.replace(waybillId), input);
      const replacement = record(result.replacement);
      if (record(result.voided).id !== waybillId || !replacement.id || !replacement.number)
        throw new DispatchDocumentsOutcomeUnknownError();
      return { status: 'REPLACED', number: text(replacement.number) };
    },
    async handoff(caseId, input) {
      const bundle = requireBundle(caseId);
      const kinds =
        input.kind === "PRINT_BOTH"
          ? (["WAYBILL", "STATEMENT"] as const)
          : ([
              input.kind.endsWith("WAYBILL") ? "WAYBILL" : "STATEMENT",
            ] as const);
      if (input.kind.startsWith("PRINT")) {
        const operation = JSON.stringify([bundle.id, input.kind]);
        const key = printKeys.get(operation) ?? crypto.randomUUID();
        printKeys.set(operation, key);
        const response = await send(`${paths.print(bundle.id)}?format=form-data`, {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({ kinds }),
        });
        if (response.status === 401 || response.status === 403)
          throw new DispatchDocumentsAuthorizationError(
            "دسترسی به اسناد ارسال مجاز نیست.",
            response.status,
          );
        if (!response.ok) throw new Error("تحویل چاپ اسناد انجام نشد.");
        const contentType = response.headers.get('Content-Type') ?? '';
        const form = await new Response(await response.blob(), { headers: { 'Content-Type': contentType } }).formData();
        const held = kinds.map(kind => {
          const files = form.getAll(kind);
          const artifact = bundle.artifacts.find(item => item.kind === kind);
          if (files.length !== 1 || !(files[0] instanceof Blob) || !artifact)
            throw new Error('فایل تحویل چاپ با سند درخواستی منطبق نیست.');
          return { kind, bytes: files[0], fileName: artifact.fileName };
        });
        printKeys.delete(operation);
        return { artifacts: held.map(item => ({ kind: item.kind, fileName: item.fileName, url: URL.createObjectURL(item.bytes) })) };
      }
      return {
        artifacts: await Promise.all(
          kinds.map(async (kind) => {
            const artifact = bundle.artifacts.find(
              (item) => item.kind === kind,
            );
            if (!artifact)
              throw new Error("فایل نگهداری‌شده برای سند در دسترس نیست.");
            return {
              kind,
              url: await pdf(paths.artifact(bundle.id, artifact.id)),
              fileName: artifact.fileName,
            };
          }),
        ),
      };
    },
  };
}
