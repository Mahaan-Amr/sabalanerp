"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import {
  ErpButton,
  ErpCard,
  ErpField,
  ErpInlineState,
  ErpLoading,
  ErpSheet,
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
  invoices: Invoice[];
};
export default function SalesDispatchInvoices({
  loadingId,
  workspace,
  canManage = false,
  refreshKey,
}: {
  loadingId: string;
  workspace: "accounting" | "logistics";
  canManage?: boolean;
  refreshKey?: unknown;
}) {
  const [data, setData] = useState<ReadModel | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const [target, setTarget] = useState<Invoice | null>(null),
    [reason, setReason] = useState("");
  const busy = useRef(false),
    requestKey = useRef<string | null>(null);
  const base = `/${workspace}/loadings/${encodeURIComponent(loadingId)}/sales-invoices`;
  const load = useCallback(async () => {
    try {
      const response = await api.get(base);
      setData(response.data.data);
      setError("");
    } catch (e) {
      setError(userFacingError(e, "فاکتورهای فروش دریافت نشد."));
    }
  }, [base]);
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
  const file = async (invoice: Invoice, download: boolean) =>
    run(async () => {
      const response = await api.get(`${base}/${invoice.id}/pdf`, {
        responseType: "blob",
        params: { download },
      });
      const url = URL.createObjectURL(
        new Blob([response.data], { type: "application/pdf" }),
      );
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = `sales_invoice_${invoice.number}.pdf`;
        link.click();
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  return (
    <ErpCard className="mt-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>فاکتور فروش کل بارگیری</strong>
        <div className="flex flex-wrap gap-2">
          <ErpButton
            label="به‌روزرسانی فاکتورها"
            variant="ghost"
            disabled={pending}
            onClick={() => void load()}
          />
          {canManage && workspace === "accounting" && (
            <ErpButton
              label="صدور فاکتور فروش"
              disabled={
                pending ||
                !data?.ready ||
                data.invoices.some((i) => i.status !== "VOIDED")
              }
              onClick={() =>
                void run(async () => {
                  requestKey.current ||= crypto.randomUUID();
                  await api.post(base, { idempotencyKey: requestKey.current });
                  requestKey.current = null;
                })
              }
            />
          )}
        </div>
      </div>
      {error && <ErpInlineState kind="error" title={error} />}
      {!data && !error && <ErpLoading />}
      {data?.blockedReason && (
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
                : "باطل‌شده؛ نیازمند بررسی حسابداری"}
          </p>
          {invoice.status !== "ISSUED" && (
            <p className="text-sm sds-text-secondary">
              {invoice.voidReason || invoice.invalidReason}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <ErpButton
              label="مشاهده فاکتور"
              variant="outline"
              disabled={pending}
              onClick={() => void file(invoice, false)}
            />
            <ErpButton
              label="دانلود فاکتور"
              variant="soft"
              disabled={pending}
              onClick={() => void file(invoice, true)}
            />
            {canManage &&
              workspace === "accounting" &&
              invoice.status !== "VOIDED" && (
                <ErpButton
                  label="ابطال فاکتور"
                  tone="danger"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setTarget(invoice);
                    setReason("");
                  }}
                />
              )}
          </div>
        </div>
      ))}
      <ErpSheet
        open={Boolean(target)}
        onClose={() => {
          if (!pending) setTarget(null);
        }}
        title="ابطال فاکتور فروش"
        presentation="modal"
        pending={pending}
      >
        <ErpField label="دلیل ابطال" required>
          <ErpTextarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending}
          />
        </ErpField>
        {error && <ErpInlineState kind="error" title={error} />}
        <ErpButton
          label="ثبت ابطال با حفظ سابقه"
          tone="danger"
          disabled={pending || reason.trim().length < 3}
          onClick={() =>
            void run(async () => {
              await api.post(`${base}/${target!.id}/void`, { reason });
              setTarget(null);
              requestKey.current = null;
            })
          }
        />
      </ErpSheet>
    </ErpCard>
  );
}
