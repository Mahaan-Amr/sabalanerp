"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FaHistory, FaPlus } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpTextarea,
} from "@/components/erp";
import { apiError, fromIsoDate, HrField, HrMessage, toIsoDate } from "@/features/hr/hrUi";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import { hrAPI } from "@/lib/api";

const assignmentTypeLabel: Record<string, string> = {
  PRIMARY: "اصلی",
  SECONDARY: "ثانویه",
  ACTING: "سرپرستی موقت",
};

const relationshipLabel: Record<string, string> = {
  ACTIVE: "فعال",
  SUSPENDED: "تعلیق‌شده",
  PLANNED: "برنامه‌ریزی‌شده",
  ENDED: "پایان‌یافته",
  CANCELLED: "لغوشده",
};

export default function PositionHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const requestedOrigin = searchParams.get("origin") || "";
  const origin = /^\/dashboard\/hr\/structure\/positions(?:\?filter=[a-z-]+)?$/.test(requestedOrigin)
    ? requestedOrigin
    : "/dashboard/hr/structure/positions";
  const focus = searchParams.get("focus") || id;
  const backHref = `${origin}${origin.includes("?") ? "&" : "?"}focus=${encodeURIComponent(focus)}`;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [capacity, setCapacity] = useState({ newCapacity: "", effectiveAt: new Date().toISOString().slice(0, 10), reason: "" });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData((await hrAPI.getPositionHistory(id)).data.data);
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const now = new Date();
    const rows = data?.assignments || [];
    return {
      current: rows.filter((row: any) => row.type !== "ACTING" && ["ACTIVE", "SUSPENDED"].includes(row.relationshipStatus) && new Date(row.effectiveFrom) <= now && (!row.effectiveTo || new Date(row.effectiveTo) >= now)),
      planned: rows.filter((row: any) => row.type !== "ACTING" && row.relationshipStatus === "PLANNED" && row.hireConvertedAt),
      preConversion: rows.filter((row: any) => row.relationshipStatus === "PLANNED" && !row.hireConvertedAt),
      acting: rows.filter((row: any) => row.type === "ACTING" && new Date(row.effectiveFrom) <= now && (!row.effectiveTo || new Date(row.effectiveTo) >= now)),
      ended: rows.filter((row: any) => row.relationshipStatus === "ENDED" || (row.effectiveTo && new Date(row.effectiveTo) < now)),
      future: rows.filter((row: any) => new Date(row.effectiveFrom) > now && row.relationshipStatus !== "PLANNED"),
    };
  }, [data]);

  const submitCapacity = async () => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      await hrAPI.changePositionCapacity(id, {
        newCapacity: Number(capacity.newCapacity),
        effectiveAt: capacity.effectiveAt,
        reason: capacity.reason,
        expectedUpdatedAt: data.position.updatedAt,
        idempotencyKey: crypto.randomUUID(),
      });
      setSuccess("تغییر ظرفیت با تاریخ اثر ثبت شد.");
      setCapacity((current) => ({ ...current, newCapacity: "", reason: "" }));
      await load();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;
  if (!data) return <ErpPage title="سوابق جایگاه" backHref={backHref}><ErpEmptyState icon={FaHistory} title="جایگاه پیدا نشد" /></ErpPage>;

  return (
    <ErpPage eyebrow="منابع انسانی" title={data.position.title} backHref={backHref}>
      {error && <HrMessage>{error}</HrMessage>}
      {success && <HrMessage tone="success">{success}</HrMessage>}
      <ErpCard className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-black text-[var(--sds-text-primary)]">{data.position.code}</p>
            <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{data.position.job.title} · {data.position.organizationalUnit.name}</p>
          </div>
          <ErpBadge tone={data.position.isActive ? "success" : "neutral"}>{data.position.isActive ? "فعال" : "غیرفعال"}</ErpBadge>
        </div>
      </ErpCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="space-y-5">
          {([
            ["current", "تخصیص‌های جاری"],
            ["planned", "رزروهای شروع"],
            ["preConversion", "برنامه‌ریزی‌شده پیش از تبدیل استخدام"],
            ["acting", "سرپرستی موقت (بدون مصرف ظرفیت)"],
            ["ended", "تخصیص‌های پایان‌یافته"],
            ["future", "تخصیص‌های آینده"],
          ] as const).map(([key, title]) => (
            <AssignmentSection key={key} title={title} rows={groups[key]} />
          ))}
          <ErpSection title="تاریخچه ساختاری و ظرفیت">
            <div className="space-y-3">
              {[...(data.capacityChanges || []).map((row: any) => ({ id: row.id, date: row.effectiveAt, reason: row.reason, text: `ظرفیت ${row.previousCapacity.toLocaleString("fa-IR")} ← ${row.newCapacity.toLocaleString("fa-IR")}` })), ...(data.structuralChanges || []).map((row: any) => ({ id: row.id, date: row.effectiveFrom, reason: row.reason, text: "تغییر ساختاری یا چرخه عمر" }))]
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((row: any) => <ErpCard key={row.id} className="p-3"><p className="font-bold">{row.text}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{new Date(row.date).toLocaleDateString("fa-IR")} · {row.reason}</p></ErpCard>)}
            </div>
          </ErpSection>
          {(data.recruitmentRequests || []).length > 0 && (
            <ErpSection title="درخواست‌های جذب مرتبط">
              <div className="space-y-3">
                {data.recruitmentRequests.map((request: any) => (
                  <ErpCard key={request.id} className="p-3">
                    <p className="font-bold">{request.status} · {(request.approvedHeadcount - request.convertedHires).toLocaleString("fa-IR")} نفر باقیمانده</p>
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{new Date(request.effectiveFrom).toLocaleDateString("fa-IR")}</p>
                  </ErpCard>
                ))}
              </div>
            </ErpSection>
          )}
        </div>

        {data.capabilities?.canEditCapacity && <div className="xl:sticky xl:top-24 xl:self-start">
          <ErpSection title="تغییر ظرفیت" description={`ظرفیت جاری: ${data.position.capacity.toLocaleString("fa-IR")}`}>
            <ErpCard className="space-y-3 p-4">
              <HrField label="ظرفیت جدید" required><ErpInput type="number" min={1} value={capacity.newCapacity} onChange={(event) => setCapacity({ ...capacity, newCapacity: event.target.value })} /></HrField>
              <HrField label="تاریخ اثر" required><HrPersianCalendar value={fromIsoDate(capacity.effectiveAt)} onChange={(value) => setCapacity({ ...capacity, effectiveAt: toIsoDate(value) })} disablePastDates /></HrField>
              <HrField label="دلیل کاهش"><ErpTextarea value={capacity.reason} onChange={(event) => setCapacity({ ...capacity, reason: event.target.value })} /></HrField>
              <ErpButton label="ثبت تغییر ظرفیت" icon={FaPlus} disabled={saving || !capacity.newCapacity || Number(capacity.newCapacity) < 1} onClick={submitCapacity} />
            </ErpCard>
          </ErpSection>
        </div>}
      </div>
    </ErpPage>
  );
}

function AssignmentSection({ title, rows }: { title: string; rows: any[] }) {
  return (
    <ErpSection title={title}>
      <div className="space-y-3">
        {rows.map((row) => (
          <ErpCard key={row.id} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{row.personnel?.name || "اطلاعات متصدی محدود است"}</p>
              <ErpBadge tone={row.type === "ACTING" ? "info" : "neutral"}>{assignmentTypeLabel[row.type]}</ErpBadge>
            </div>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{relationshipLabel[row.relationshipStatus]} · {new Date(row.effectiveFrom).toLocaleDateString("fa-IR")} تا {row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString("fa-IR") : "ادامه دارد"}</p>
          </ErpCard>
        ))}
        {!rows.length && <ErpEmptyState icon={FaHistory} title="موردی در این گروه نیست" />}
      </div>
    </ErpSection>
  );
}
