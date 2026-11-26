"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaPlus, FaTrashAlt } from "react-icons/fa";
import { ErpButton, ErpField, ErpIconButton, ErpInlineState, ErpInput, ErpLoading, ErpSheet } from "@/components/erp";
import { userFacingError } from "@/features/dispatch/userFacingError";
import type { createAccountingAPI } from "@/lib/api";
import { formatNumericInputText, normalizeDigits } from "@/lib/numberFormat";

export const sepidarInvoiceLabel = "شماره فاکتور سپیدار";
export type SepidarInvoice = { number: string; amountRial: string | null };
type AuditValues = { invoices?: SepidarInvoice[]; sepidarLoadingReference?: string | null };
export type SepidarAuditEntry = {
  id: string;
  actorId: string;
  createdAt: string;
  beforeState?: AuditValues | null;
  afterState?: AuditValues | null;
  note?: string | null;
};
export type SepidarInvoiceOwner = {
  id: string;
  loadingId: string;
  canManageSepidarLoadingReference: boolean;
  sepidarInvoices?: SepidarInvoice[];
  sepidarLoadingReference?: string | null;
  sepidarLoadingReferenceHistory?: SepidarAuditEntry[];
};

export function sepidarInvoicesOf(source?: AuditValues | { sepidarInvoices?: SepidarInvoice[]; sepidarLoadingReference?: string | null } | null) {
  if (!source) return [];
  const saved = "sepidarInvoices" in source ? source.sepidarInvoices : "invoices" in source ? source.invoices : undefined;
  return saved ?? (source.sepidarLoadingReference ? [{ number: source.sepidarLoadingReference, amountRial: null }] : []);
}

export function SepidarInvoiceNumbers({ invoices, showAmounts = false }: { invoices: SepidarInvoice[]; showAmounts?: boolean }) {
  if (!invoices.length) return <>—</>;
  return <div className="space-y-1">{invoices.map(invoice =>
    <div key={invoice.number}>
      <bdi>{invoice.number}</bdi>
      {showAmounts && <span className="ms-2 text-xs sds-text-secondary">{invoice.amountRial === null
        ? "مبلغ ثبت نشده"
        : <><bdi>{formatRial(invoice.amountRial)}</bdi> ریال</>}</span>}
    </div>)}</div>;
}

const formatRial = (value: string) => formatNumericInputText(value).displayText;
const rialScale = BigInt("1000000000000");
const threeDecimalStep = rialScale / BigInt(1000);
const roundRialAtoms = (value: bigint) =>
  ((value + threeDecimalStep / BigInt(2)) / threeDecimalStep) * threeDecimalStep;
const zero = BigInt(0);
const rialAtoms = (value: string) => {
  const match = /^(\d{1,38})(?:\.(\d{1,12}))?$/.exec(value);
  return match ? BigInt(match[1]) * rialScale + BigInt((match[2] ?? "").padEnd(12, "0")) : null;
};
const formatAtoms = (value: bigint) => {
  const [whole, fraction] = [value / rialScale, value % rialScale];
  const decimal = String(fraction).padStart(12, "0").replace(/0+$/, "");
  return formatRial(decimal ? `${whole}.${decimal}` : String(whole));
};

type Draft = { key: number; number: string; amountRial: string };
type InvoiceState = { invoices: SepidarInvoice[]; expectedVersion: string | null; totalRial: string | null; unavailableReason?: string };

export default function SepidarDispatchInvoices({ loadingId, contracts, api, blocked, onClose, onSaved, onError, subject = "loading" }: {
  loadingId: string;
  contracts: string[];
  subject?: "loading" | "return";
  api: Pick<ReturnType<typeof createAccountingAPI>, "getSepidarDispatchInvoices" | "saveSepidarDispatchInvoices">;
  blocked: boolean;
  onClose: () => void;
  onSaved: (invoices: SepidarInvoice[], auditEntry: SepidarAuditEntry, correction: boolean) => void;
  onError: (error: unknown, loadingId: string) => boolean;
}) {
  const subjectLabel = subject === "return" ? "مرجوعی" : "بارگیری";
  const [state, setState] = useState<InvoiceState | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{ text: string; reload?: boolean } | null>(null);
  const pendingRef = useRef(false);
  const nextRowKey = useRef(0);
  const loadRequest = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadRequest.current?.abort();
    const request = new AbortController();
    loadRequest.current = request;
    setLoading(true);
    try {
      const { data } = await api.getSepidarDispatchInvoices(loadingId, request.signal);
      if (request.signal.aborted) return;
      const next: InvoiceState = data.data;
      const entries = next.invoices.length ? next.invoices : [{ number: "", amountRial: null }];
      setState(next);
      setRows(entries.map(invoice => ({
        key: nextRowKey.current++, number: invoice.number, amountRial: invoice.amountRial ?? "",
      })));
      setError(null);
    } catch (failure) {
      if (!request.signal.aborted && !onError(failure, loadingId)) setError({ text: userFacingError(failure, "دریافت فاکتورهای سپیدار انجام نشد."), reload: true });
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [api, loadingId, onError]);

  useEffect(() => {
    void load();
    return () => loadRequest.current?.abort();
  }, [load]);

  const correction = Boolean(state?.invoices.length || state?.expectedVersion);
  const invoices = rows.map(({ number, amountRial }) => ({
    number: normalizeDigits(number).trim(),
    amountRial: amountRial.replace(/\.$/, ""),
  }));
  const parsedAmounts = invoices.map(invoice => rialAtoms(invoice.amountRial));
  const everyAmountEntered = parsedAmounts.every(amount => amount !== null);
  const invoiceTotal = roundRialAtoms(parsedAmounts.reduce<bigint>((total, amount) => total + (amount ?? zero), zero));
  const loadingTotal = state?.totalRial == null ? null : rialAtoms(state.totalRial);
  const expected = loadingTotal === null ? null : roundRialAtoms(loadingTotal);
  const balance = expected === null ? null : expected - invoiceTotal;
  const hasExcess = balance !== null && balance < zero;
  const numbersValid = invoices.every(invoice => /^\d{1,64}$/.test(invoice.number)) &&
    new Set(invoices.map(invoice => invoice.number)).size === invoices.length;
  const clear = rows.length === 0 && Boolean(state?.invoices.length);
  const matches = everyAmountEntered && balance === zero;
  const canSave = Boolean(state && !loading && !pending && !blocked && !error?.reload &&
    (!correction || reason.trim()) && (clear || (invoices.length && numbersValid && matches)));

  const update = (key: number, field: "number" | "amountRial", value: string) => {
    setRows(current => current.map(row => row.key === key ? { ...row, [field]: value } : row));
    if (!error?.reload) setError(null);
  };
  const save = async () => {
    if (!canSave || !state || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const { data } = await api.saveSepidarDispatchInvoices(loadingId, {
        invoices, expectedVersion: state.expectedVersion, reason: correction ? reason.trim() : undefined,
      });
      onSaved(data.data.invoices, data.data.auditEntry, correction);
    } catch (failure) {
      if (onError(failure, loadingId)) return;
      const code = (failure as { response?: { data?: { code?: string } } })?.response?.data?.code;
      setError({ text: userFacingError(failure, "ذخیره فاکتورهای سپیدار انجام نشد."),
        reload: code === "SEPIDAR_REFERENCE_STALE" || code === "SEPIDAR_AMOUNT_MISMATCH" });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return <ErpSheet open onClose={onClose} pending={pending} presentation="modal"
    title={correction ? "اصلاح فاکتورهای سپیدار" : "ثبت فاکتورهای سپیدار"}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={onClose} />
      <ErpButton label={clear ? "پاک‌کردن فاکتورها" : "ذخیره فاکتورها"} tone={clear ? "danger" : "primary"}
        disabled={!canSave} onClick={() => void save()} />
    </div>}>
    <div className="space-y-4">
      {loading && <ErpLoading />}
      {error && <ErpInlineState kind="error" title={error.text} />}
      {error?.reload && <ErpButton label={`دریافت دوباره اطلاعات ${subjectLabel}`} variant="outline" disabled={loading || pending} onClick={() => void load()} />}
      {state && <>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="sds-text-secondary">جمع این {subjectLabel}</dt>
            <dd>{expected === null ? "در دسترس نیست" : <><bdi>{formatAtoms(expected)}</bdi> ریال</>}</dd></div>
          <div><dt className="sds-text-secondary">جمع مبلغ فاکتورها</dt>
            <dd><bdi>{formatAtoms(invoiceTotal)}</bdi> ریال</dd></div>
          {balance !== null && <div role="status" aria-atomic="true">
            <dt className="sds-text-secondary">{hasExcess ? "مبلغ مازاد" : "مبلغ باقی‌مانده"}</dt>
            <dd><bdi>{formatAtoms(hasExcess ? -balance : balance)}</bdi> ریال</dd>
          </div>}
          {contracts.length > 0 && <div className="sm:col-span-3">
            <dt className="sds-text-secondary">قراردادهای {subjectLabel}</dt><dd>{contracts.join("، ")}</dd>
          </div>}
        </dl>
        {!clear && expected === null && <ErpInlineState kind="stale" title={state.unavailableReason || `جمع معتبر ${subjectLabel} در دسترس نیست.`} />}
        {rows.length > 0 && everyAmountEntered && expected !== null && !matches &&
          <ErpInlineState kind="error" title={`جمع فاکتورها باید دقیقاً با جمع این ${subjectLabel} برابر باشد.`} />}
        {rows.map((row, index) => {
          const number = normalizeDigits(row.number).trim();
          const duplicate = number && invoices.filter(invoice => invoice.number === number).length > 1;
          return <div key={row.key} className="grid gap-2 border-t border-[var(--sds-border-default)] pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <ErpField label={sepidarInvoiceLabel} required error={duplicate ? "این شماره در فهرست تکرار شده است."
              : number && !/^\d{1,64}$/.test(number) ? "شماره فاکتور را فقط با رقم وارد کنید." : undefined}>
              <ErpInput dir="ltr" inputMode="numeric" maxLength={64} value={row.number} disabled={loading || pending}
                onChange={event => update(row.key, "number", event.target.value)} />
            </ErpField>
            <ErpField label="مبلغ فاکتور (ریال)" required
              error={row.amountRial && parsedAmounts[index] === null ? "یک مبلغ عددی معتبر به ریال وارد کنید." : undefined}>
              <ErpInput dir="ltr" numberFormat="money" maxLength={64} value={row.amountRial}
                disabled={loading || pending} onChange={event => update(row.key, "amountRial", event.target.value)} />
            </ErpField>
            <ErpIconButton label={`حذف فاکتور ${index + 1}`} icon={FaTrashAlt} tone="danger" disabled={loading || pending}
              onClick={() => setRows(current => current.filter(entry => entry.key !== row.key))} />
          </div>;
        })}
        <ErpButton label="افزودن فاکتور" icon={FaPlus} variant="outline" disabled={loading || pending || rows.length >= 100}
          onClick={() => setRows(current => [...current, { key: nextRowKey.current++, number: "", amountRial: "" }])} />
        {correction && <ErpField label="دلیل اصلاح" required>
          <ErpInput maxLength={200} disabled={loading || pending} value={reason} onChange={event => setReason(event.target.value)} />
        </ErpField>}
      </>}
    </div>
  </ErpSheet>;
}
