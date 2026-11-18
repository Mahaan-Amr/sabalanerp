"use client";

import { useEffect, useRef, useState } from "react";
import { ErpButton, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpSection } from "@/components/erp";
import { LogisticsPage } from "@/features/logistics/LogisticsWorkspace";
import { userFacingError } from "@/features/dispatch/userFacingError";
import { dispatchCaseReference } from "@/features/dispatch-case/dispatchCasePresentation";
import { normalizeDigits } from "@/lib/numberFormat";
import api, { logisticsAPI } from "@/lib/api";

type Revision = { caseId: string; revision: number; integrityHash: string };
type Driver = { id: string; source: string; firstName: string; lastName: string; vehiclePlate: string; vehicleType: string;
  canonicalQueueStatus: string };
type Quantities = Record<string, Record<string, string>>;
type Loading = {
  loadingId: string;
  loadingNumber: string;
  contractNumber: string;
  status: string;
  personalTurnId: string | null;
  source: {
    owner: Revision;
    recipient: { displayName: string; destination: string };
    rows: { productRowId: string; description: string; unit: string; plannedQuantity: string }[];
  };
  allocations: { queueTurnId: string; reservationActive: boolean; lines: { productRowId: string; quantity: string }[] }[];
};

const listPath = "/dashboard/logistics/loadings";
const normalize = (value: string) => normalizeDigits(value).trim();
const unitNames: Record<string, string> = { m: "متر طول", m2: "متر مربع", sqm: "متر مربع", kg: "کیلوگرم", ton: "تن", count: "عدد", piece: "عدد" };
const validQuantity = (value: string) => /^\d+(\.\d+)?$/.test(value) && /[1-9]/.test(value);

export function PartnerLoadingDraft({ draftId }: { draftId: string }) {
  const [loading, setLoading] = useState<Loading | null>(null);
  const [reading, setReading] = useState(Boolean(draftId));
  const [quantities, setQuantities] = useState<Quantities>({});
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const finalizeKey = useRef<string | null>(null);

  useEffect(() => {
    if (!draftId) { setReading(false); setLoading(null); return; }
    let active = true;
    setReading(true);
    setLoading(null);
    setError("");
    finalizeKey.current = null;
    logisticsAPI.getLoading(draftId).then(({ data }) => {
      if (!active) return;
      const next = data.data as Loading;
      if (next.source?.owner == null) throw new Error("بارگیری پیدا نشد.");
      setLoading(next);
      setQuantities(Object.fromEntries(next.allocations.filter(allocation => allocation.reservationActive).map(allocation =>
        [allocation.queueTurnId, Object.fromEntries(allocation.lines.map(line => [line.productRowId, line.quantity]))])));
      if (next.status === "DRAFT") {
        void logisticsAPI.getDrivers({ loadingId: draftId }).then(({ data }) => {
          if (active) setDrivers(data.data);
        }).catch(err => {
          if (active) setError(userFacingError(err, "دریافت فهرست رانندگان ناموفق بود."));
        });
      }
    }).catch(err => {
      if (active) setError(userFacingError(err, "دریافت بارگیری ناموفق بود."));
    }).finally(() => { if (active) setReading(false); });
    return () => { active = false; };
  }, [draftId]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try { await work(); }
    catch (err) { setError(userFacingError(err, "عملیات بارگیری انجام نشد.")); }
    finally { lock.current = false; setPending(false); }
  }

  async function refreshDrivers(loadingId: string) {
    const { data } = await logisticsAPI.getDrivers({ loadingId });
    setDrivers(data.data);
  }

  async function togglePersonal() {
    if (!loading) return;
    const { data } = await logisticsAPI.selectLoadingTransport(loading.loadingId, loading.personalTurnId ? "DRIVERS" : "PERSONAL", loading.source.owner);
    setLoading({ ...loading, personalTurnId: data.data.turn?.id ?? null });
    setQuantities({});
    await refreshDrivers(loading.loadingId);
  }

  async function toggleDriver(driver: Driver) {
    if (!loading) return;
    if (driver.canonicalQueueStatus === "RESERVED_FOR_LOADING") {
      await logisticsAPI.releaseCanonicalDriver(driver.id, loading.loadingId, "تغییر راننده بارگیری");
      setQuantities(current => {
        const remaining = { ...current };
        delete remaining[driver.id];
        return remaining;
      });
    } else {
      await logisticsAPI.reserveCanonicalDriver(driver.id, loading.loadingId, { expected: loading.source.owner, reason: "انتخاب راننده بارگیری" });
    }
    await refreshDrivers(loading.loadingId);
  }

  const otherDrivers = drivers.filter(driver => driver.source !== "PERSONAL_PICKUP");
  const selectedDrivers = loading?.personalTurnId ? [{ id: loading.personalTurnId, name: "راننده شخصی" }]
    : otherDrivers.filter(driver => driver.canonicalQueueStatus === "RESERVED_FOR_LOADING")
      .map(driver => ({ id: driver.id, name: [driver.firstName, driver.lastName].filter(Boolean).join(" ") || driver.vehiclePlate }));
  const entered = selectedDrivers.map(driver => ({ ...driver, lines: loading?.source.rows.flatMap(row => {
    const quantity = normalize(quantities[driver.id]?.[row.productRowId] || "");
    return quantity ? [{ sourceKind: "PARTNER_CASE", productRowId: row.productRowId, quantity, unit: row.unit }] : [];
  }) ?? [] }));
  const ready = entered.length > 0 && entered.every(driver => driver.lines.length > 0 && driver.lines.every(row => validQuantity(row.quantity)));
  async function recoverFinalizedLoading(loadingId: string) {
    const response = await logisticsAPI.getLoading(encodeURIComponent(loadingId)).catch(() => null);
    const current = response?.data.data as Loading | undefined;
    if (current?.loadingId !== loadingId || current.status !== "FINALIZED") return false;
    setLoading(current);
    return true;
  }

  async function save(finalize: boolean) {
    if (!loading || !ready) return;
    if (finalizeKey.current && await recoverFinalizedLoading(loading.loadingId)) return;
    const id = encodeURIComponent(loading.loadingId);
    for (const driver of entered) {
      await logisticsAPI.saveCanonicalAllocation(id, encodeURIComponent(driver.id), {
        expected: loading.source.owner, lines: driver.lines, reason: "ثبت مقدار بارگیری",
      });
    }
    if (!finalize) return;
    finalizeKey.current ??= crypto.randomUUID();
    try {
      await api.post(`/logistics/loadings/${id}/finalize`, {
        expected: loading.source.owner, reason: "نهایی‌سازی بارگیری",
      }, { headers: { "Idempotency-Key": finalizeKey.current } });
      setLoading({ ...loading, status: "FINALIZED" });
    } catch (error) {
      if (!await recoverFinalizedLoading(loading.loadingId)) throw error;
    }
  }

  return (
    <LogisticsPage title="بارگیری جدید" backHref={listPath}>
      {error && <ErpInlineState kind="error" title={error} />}
      {reading && <ErpLoading />}
      {loading && <>
        <ErpSection title={dispatchCaseReference(loading.loadingNumber)}>
          <p>قرارداد مشتری {loading.contractNumber}</p>
          <p>{loading.source.recipient.displayName} · {loading.source.recipient.destination}</p>
        </ErpSection>
        {loading.status === "DRAFT" ? <>
          <ErpSection title="انتخاب راننده">
            <div className="flex flex-wrap gap-2">
              <ErpButton label="راننده شخصی" disabled={pending} aria-pressed={Boolean(loading.personalTurnId)}
                variant={loading.personalTurnId ? "solid" : "outline"} onClick={() => void run(togglePersonal)} />
              {!loading.personalTurnId && otherDrivers.map(driver => {
                const selected = driver.canonicalQueueStatus === "RESERVED_FOR_LOADING";
                const label = [[driver.firstName, driver.lastName].filter(Boolean).join(" "), driver.vehicleType, driver.vehiclePlate].filter(Boolean).join(" · ");
                return <ErpButton key={driver.id} label={label} disabled={pending} aria-pressed={selected}
                  variant={selected ? "solid" : "outline"} onClick={() => void run(() => toggleDriver(driver))} />;
              })}
            </div>
          </ErpSection>
          {selectedDrivers.length > 0 && <ErpSection title="مقدار بارگیری">
            <div className="grid gap-4">
              {selectedDrivers.map(driver => <div key={driver.id} className="grid gap-3">
                {!loading.personalTurnId && <p>{driver.name}</p>}
                {loading.source.rows.map((row, index) => (
                  <ErpField key={row.productRowId} label={`مقدار ردیف ${index + 1} · ${row.description}${loading.personalTurnId ? "" : ` · ${driver.name}`}`}
                    hint={`مقدار برنامه تحویل ${row.plannedQuantity} ${unitNames[row.unit] || row.unit}`}>
                    <ErpInput inputMode="decimal" value={quantities[driver.id]?.[row.productRowId] || ""} disabled={pending}
                      onChange={event => {
                        const value = event.target.value;
                        setQuantities(current => ({ ...current, [driver.id]: { ...current[driver.id], [row.productRowId]: value } }));
                      }} />
                  </ErpField>
                ))}
              </div>)}
              <div className="flex flex-wrap gap-2">
                <ErpButton label="ذخیره مقدارها" variant="outline" disabled={!ready || pending} onClick={() => void run(() => save(false))} />
                <ErpButton label="نهایی‌سازی بارگیری" disabled={!ready || pending} onClick={() => void run(() => save(true))} />
              </div>
            </div>
          </ErpSection>}
        </> : <ErpInlineState kind={loading.status === "FINALIZED" ? "success" : "empty"}
          title={loading.status === "FINALIZED" ? "بارگیری نهایی شد." : "بارگیری بسته شده است."} />}
      </>}
    </LogisticsPage>
  );
}
