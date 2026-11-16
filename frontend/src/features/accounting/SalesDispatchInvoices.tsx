"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { FaBan, FaDownload, FaEye, FaFileInvoice, FaPrint, FaSync } from "react-icons/fa";
import {
  ErpButton,
  ErpCard,
  ErpField,
  ErpInlineState,
  ErpLoading,
  ErpSheet,
  ErpSelect,
  ErpTextarea,
} from "@/components/erp";
import { userFacingError } from "@/features/dispatch/userFacingError";

type Invoice = {
  id: string;
  number: string;
  status: "ISSUED" | "VOIDED" | "INVALIDATED";
  voidReason: string | null;
  invalidReason: string | null;
};
type ReadModel = {
  ready: boolean;
  blockedReason: string | null;
  documentsComplete?: boolean;
  recovery?: { waybillId: string; waybillNumber: string; invoiceId: string; invoiceNumber: string } | null;
  invoices: Invoice[];
};
type RecoveryRequest = { waybillId: string; invoiceId: string; reason: string };
export default function SalesDispatchInvoices({
  loadingId,
  workspace,
  canManage = false,
  refreshKey,
  onActiveInvoiceChange,
  onIssueAll,
  onVoided,
  onPrintAll,
  documentBlockReason,
  issuanceBlockReason,
  onCloseVoid,
}: {
  loadingId: string;
  workspace: "accounting" | "logistics";
  canManage?: boolean;
  refreshKey?: unknown;
  onActiveInvoiceChange?: (invoiceId: string | null) => void;
  onVoided?: () => Promise<void>;
  onIssueAll?: (recovery?: RecoveryRequest) => Promise<void>;
  onPrintAll?: () => Promise<void>;
  documentBlockReason?: string;
  issuanceBlockReason?: string;
  onCloseVoid?: () => void;
}) {
  const [data, setData] = useState<ReadModel | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const [targetId, setTargetId] = useState(""),
    [reason, setReason] = useState("");
  const [recoveryDraft, setRecoveryDraft] = useState<{ waybillId: string; reason: string } | null>(null);
  const [invalidInvoiceVoid, setInvalidInvoiceVoid] = useState<{ invoiceId: string; reason: string } | null>(null);
  const busy = useRef(false),
    requestKey = useRef<string | null>(null);
  const base = `/${workspace}/loadings/${encodeURIComponent(loadingId)}/sales-invoices`;
  const load = useCallback(async () => {
    try {
      const response = await api.get(base);
      setData(response.data.data);
      onActiveInvoiceChange?.(response.data.data.invoices.find((invoice: Invoice) => invoice.status === "ISSUED")?.id || null);
      setError("");
    } catch (e) {
      onActiveInvoiceChange?.(null);
      setError(userFacingError(e, "فاکتورهای فروش دریافت نشد."));
    }
  }, [base, onActiveInvoiceChange]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  const run = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(userFacingError(e, "عملیات فاکتور انجام نشد."));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const file = async (invoice: Invoice, download: boolean) => {
    if (busy.current) return;
    // Safari requires the preview window to open during the click.
    const preview = download ? null : window.open("", "_blank");
    if (!download && !preview) {
      setError("مرورگر پنجره پیش‌نمایش فاکتور را مسدود کرد.");
      return;
    }
    if (preview) preview.opener = null;
    await run(async () => {
      try {
        const response = await api.get(`${base}/${invoice.id}/pdf`, {
          responseType: "blob",
          params: { download },
        });
        const url = URL.createObjectURL(
          new Blob([response.data], { type: "application/pdf" }),
        );
        if (preview) {
          preview.location.href = url;
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.download = `sales_invoice_${invoice.number}.pdf`;
          link.click();
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) {
        preview?.close();
        throw error;
      }
    });
  };
  if (onCloseVoid) {
    const eligible = data?.invoices.filter(invoice => invoice.status !== "VOIDED") ?? [];
    const target = targetId ? eligible.find(invoice => invoice.id === targetId) : eligible.length === 1 ? eligible[0] : undefined;
    return (
      <ErpSheet open onClose={onCloseVoid} title="ابطال فاکتور فروش" presentation="modal" pending={pending}>
        <div className="space-y-3">
          {error && <ErpInlineState kind="error" title={error} />}
          {!data && !error && <ErpLoading />}
          {data && eligible.length === 0 && <ErpInlineState kind="stale" title="این بارگیری فاکتور قابل ابطال ندارد." />}
          {eligible.length > 1 && (
            <ErpField label="فاکتور فروش" required>
              <ErpSelect value={targetId} onChange={event => setTargetId(event.target.value)} disabled={pending}>
                <option value="">انتخاب فاکتور</option>
                {eligible.map(invoice => <option key={invoice.id} value={invoice.id}>فاکتور {invoice.number}</option>)}
              </ErpSelect>
            </ErpField>
          )}
          {target && <>
            <p>فاکتور فروش شماره <bdi>{target.number}</bdi> · کل بارگیری</p>
            <ErpField label="دلیل ابطال" required>
              <ErpTextarea value={reason} onChange={event => setReason(event.target.value)} disabled={pending || !canManage} />
            </ErpField>
            <ErpButton label="ثبت ابطال فاکتور فروش" tone="danger"
              disabled={!canManage || pending || reason.trim().length < 3}
              onClick={() => void run(async () => {
                await api.post(`${base}/${target.id}/void`, { reason: reason.trim() });
                onCloseVoid();
                await onVoided?.();
              })} />
          </>}
        </div>
      </ErpSheet>
    );
  }
  const recovery = canManage && workspace === "accounting" && onIssueAll ? data?.recovery : null;
  const hasInvalidInvoice = data?.invoices.some(invoice => invoice.status === "INVALIDATED");
  const canIssueReplacement = data?.documentsComplete && data.ready && data.invoices.length > 0 &&
    data.invoices.every(invoice => invoice.status === "VOIDED");
  return (
    <ErpCard className="mt-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>فاکتور فروش کل بارگیری</strong>
        <div className="flex flex-wrap gap-2">
          <ErpButton
            label="به‌روزرسانی فاکتورها" icon={FaSync}
            variant="ghost"
            disabled={pending}
            onClick={() => void load()}
          />
          {recovery && recoveryDraft?.waybillId !== recovery.waybillId && (
            <ErpButton label="صدور مجدد بارنامه و فاکتور" icon={FaFileInvoice} disabled={pending}
              onClick={() => setRecoveryDraft({ waybillId: recovery.waybillId, reason: "" })} />
          )}
          {!recovery && canManage && workspace === "accounting" && !(onIssueAll && data?.documentsComplete && data.invoices.some(i => i.status === "ISSUED")) && (
            <ErpButton
              icon={FaFileInvoice}
              label={canIssueReplacement ? "صدور فاکتور جایگزین" :
                onIssueAll ? (data?.invoices.some(i => i.status === "ISSUED") ? "تکمیل صدور بارنامه‌ها" : "صدور بارنامه‌ها و فاکتور فروش") : "صدور فاکتور فروش"}
              disabled={
                pending ||
                Boolean(issuanceBlockReason) ||
                hasInvalidInvoice ||
                (!onIssueAll && !data?.ready) ||
                !data ||
                (!onIssueAll && data.invoices.some((i) => i.status !== "VOIDED"))
              }
              onClick={() =>
                void run(async () => {
                  if (onIssueAll) { await onIssueAll(); return; }
                  requestKey.current ||= crypto.randomUUID();
                  await api.post(base, { idempotencyKey: requestKey.current });
                  requestKey.current = null;
                })
              }
            />
          )}
          {onPrintAll && data?.invoices.some(invoice => invoice.status === "ISSUED") && (
            <ErpButton label="چاپ فاکتور و بارنامه‌ها" icon={FaPrint} variant="soft" disabled={pending || Boolean(documentBlockReason)}
              onClick={() => void run(onPrintAll)} />
          )}
        </div>
      </div>
      {recovery && recoveryDraft?.waybillId === recovery.waybillId && (
        <div className="space-y-3">
          <p>اسناد جدید برای همین بارگیری صادر می‌شوند. بارنامه <bdi>{recovery.waybillNumber}</bdi> و فاکتور <bdi>{recovery.invoiceNumber}</bdi> در سوابق ابطال می‌مانند.</p>
          <ErpField label="دلیل صدور مجدد" required>
            <ErpTextarea autoFocus value={recoveryDraft.reason} maxLength={2000} disabled={pending}
              onChange={event => setRecoveryDraft({ waybillId: recovery.waybillId, reason: event.target.value })} />
          </ErpField>
          <div className="flex flex-wrap gap-2">
            <ErpButton label="تأیید و صدور مجدد" disabled={pending || recoveryDraft.reason.trim().length < 3}
              onClick={() => void run(async () => {
                try {
                  await onIssueAll?.({ waybillId: recovery.waybillId, invoiceId: recovery.invoiceId, reason: recoveryDraft.reason.trim() });
                  setRecoveryDraft(null);
                } catch (error) {
                  await load();
                  throw error;
                }
              })} />
            <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setRecoveryDraft(null)} />
          </div>
        </div>
      )}
      {error && <ErpInlineState kind="error" title={error} />}
      {!recovery && issuanceBlockReason && <ErpInlineState kind="stale" title={issuanceBlockReason} />}
      {!recovery && documentBlockReason && <ErpInlineState kind="stale" title={documentBlockReason} />}
      {!data && !error && <ErpLoading />}
      {!recovery && data?.blockedReason && (
        <ErpInlineState kind="stale" title={data.blockedReason} />
      )}
      {data?.invoices.length === 0 && (
        <p className="text-sm sds-text-secondary">فاکتور فروش صادر نشده است.</p>
      )}
      {data?.invoices.map((invoice) => (
        <div
          key={invoice.id}
          className="space-y-2 border-t border-[var(--sds-border-subtle)] pt-3"
        >
          <p>
            فاکتور{" "}
            {invoice.number.replace(/\d/g, (n) => "۰۱۲۳۴۵۶۷۸۹"[Number(n)])} ·{" "}
            {invoice.status === "ISSUED"
              ? "صادرشده"
              : invoice.status === "VOIDED"
                ? "باطل‌شده"
                : "نامعتبر؛ ابطال ثبت نشده است"}
          </p>
          {invoice.status !== "ISSUED" && (
            <p className="text-sm sds-text-secondary">
              {invoice.voidReason || invoice.invalidReason}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <ErpButton
              label="مشاهده فاکتور" icon={FaEye}
              variant="outline"
              disabled={pending}
              onClick={() => void file(invoice, false)}
            />
            <ErpButton
              label="دانلود فاکتور" icon={FaDownload}
              variant="soft"
              disabled={pending}
              onClick={() => void file(invoice, true)}
            />
            {canManage && workspace === "accounting" && invoice.status === "INVALIDATED" &&
              invalidInvoiceVoid?.invoiceId !== invoice.id && (
                <ErpButton label="ابطال فاکتور نامعتبر" icon={FaBan} variant="outline" tone="danger" disabled={pending}
                  onClick={() => setInvalidInvoiceVoid({ invoiceId: invoice.id, reason: "" })} />
              )}
          </div>
          {canManage && workspace === "accounting" && invoice.status === "INVALIDATED" &&
            invalidInvoiceVoid?.invoiceId === invoice.id && (
              <div className="space-y-3">
                <p>ابطال فقط برای همین فاکتور ثبت می‌شود. بارنامه و مجوز خروج آن حفظ می‌شوند.</p>
                <ErpField label="دلیل ابطال" required>
                  <ErpTextarea autoFocus value={invalidInvoiceVoid.reason} maxLength={2000} disabled={pending}
                    onChange={event => setInvalidInvoiceVoid({ invoiceId: invoice.id, reason: event.target.value })} />
                </ErpField>
                <div className="flex flex-wrap gap-2">
                  <ErpButton label="ثبت ابطال فاکتور فروش" tone="danger" disabled={pending || invalidInvoiceVoid.reason.trim().length < 3}
                    onClick={() => void run(async () => {
                      await api.post(`${base}/${invoice.id}/void`, { reason: invalidInvoiceVoid.reason.trim(), onlyIfInvalidated: true });
                      setInvalidInvoiceVoid(null);
                      await onVoided?.();
                    })} />
                  <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setInvalidInvoiceVoid(null)} />
                </div>
              </div>
            )}
        </div>
      ))}
    </ErpCard>
  );
}
