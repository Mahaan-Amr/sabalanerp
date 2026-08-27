"use client";

import { useCallback, useEffect, useState } from "react";
import { FaBriefcase, FaBuilding, FaHistory, FaLink } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpLoading,
  ErpPage,
  ErpSection,
} from "@/components/erp";
import { apiError, dateFa, unitTypeLabel } from "@/features/hr/hrUi";
import { hrAPI } from "@/lib/api";

type DetailEntityType = "organizational-unit" | "job";

const entityLabels: Record<DetailEntityType, string> = {
  "organizational-unit": "واحد سازمانی",
  job: "شغل",
};

export default function FoundationDetailPage({ id, entityType }: { id: string; entityType: DetailEntityType }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData((await hrAPI.getFoundationDetail(entityType, id)).data.data);
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setLoading(false);
    }
  }, [entityType, id]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <ErpLoading />;
  const entity = data?.entity;
  if (!entity) return <ErpPage title={`جزئیات ${entityLabels[entityType]}`} backHref="/dashboard/hr/structure"><ErpInlineState kind="error" title={error || "رکورد پیدا نشد."} /></ErpPage>;
  const name = entity.name || entity.title || "تعریف حذف‌شده";
  const linked = data.linked || {};
  return (
    <ErpPage
      eyebrow={`منابع انسانی · ${entityLabels[entityType]}`}
      title={name}
      description={data.deleted ? "این تعریف حذف شده و فقط snapshot ممیزی آن نمایش داده می‌شود." : entity.description || "جزئیات تعریف و تمام پیوندهای قابل مشاهده"}
      backHref={`/dashboard/hr/structure?tab=${entityType === "job" ? "jobs" : "units"}`}
      actions={data.deleted ? [] : [{ label: "ویرایش در ساختار", href: `/dashboard/hr/structure?tab=${entityType === "job" ? "jobs" : "units"}`, icon: entityType === "job" ? FaBriefcase : FaBuilding }]}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      <ErpCard className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-black text-[var(--sds-text-primary)]">{entity.code} · نسخه {(entity.codeOccurrence || 1).toLocaleString("fa-IR")}</p>
            <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">شناسه پایدار: {entity.id}</p>
            {entity.type && <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">نوع: {unitTypeLabel[entity.type] || entity.type}</p>}
          </div>
          <ErpBadge tone={data.deleted ? "danger" : entity.isActive ? "success" : "neutral"}>{data.deleted ? "حذف‌شده" : entity.isActive ? "فعال" : "غیرفعال"}</ErpBadge>
        </div>
      </ErpCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <LinkedDefinitions entityType={entityType} linked={linked} />
        <ErpSection title="تاریخچه کد و وضعیت">
          <div className="space-y-3">
            {(data.codeHistory || []).map((row: any) => <ErpCard key={row.id} className="p-3"><p className="font-bold">{row.code} · نسخه {row.occurrence.toLocaleString("fa-IR")}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">از {dateFa(row.assignedAt)} {row.releasedAt ? `تا ${dateFa(row.releasedAt)}` : "· جاری"}</p></ErpCard>)}
            {(data.lifecycle || []).map((row: any) => <ErpCard key={row.id} className="p-3"><p className="font-bold">{row.status === "ACTIVE" ? "فعال" : "غیرفعال"} · نسخه {row.version.toLocaleString("fa-IR")}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{dateFa(row.effectiveFrom)} · {row.reason}</p></ErpCard>)}
            {!(data.codeHistory || []).length && !(data.lifecycle || []).length && <ErpEmptyState icon={FaHistory} title="سابقه‌ای ثبت نشده است" />}
          </div>
        </ErpSection>
      </div>

      {(linked.assignments || []).length > 0 && <ErpSection title="تخصیص‌های مرتبط"><div className="space-y-3">{linked.assignments.map((row: any) => <ErpCard key={row.id} className="p-3"><p className="font-bold">{row.personnel?.name || "هویت پرسنل برای شما محدود است"}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.position?.title || "جایگاه حذف‌شده"} · {dateFa(row.effectiveFrom)} تا {row.effectiveTo ? dateFa(row.effectiveTo) : "ادامه دارد"}</p>{row.personnel?.id && <ErpButton className="mt-2" label="مشاهده پرونده" href={`/dashboard/hr/personnel?focus=${row.personnel.id}`} variant="ghost" />}</ErpCard>)}</div></ErpSection>}
    </ErpPage>
  );
}

function LinkedDefinitions({ entityType, linked }: { entityType: DetailEntityType; linked: any }) {
  const rows = entityType === "job" ? linked.positions || [] : [...(linked.children || []).map((row: any) => ({ ...row, kind: "unit" })), ...(linked.positions || []).map((row: any) => ({ ...row, kind: "position" }))];
  return <ErpSection title="تعریف‌های پیوندخورده"><div className="space-y-3">{rows.map((row: any) => {
    const position = entityType === "job" || row.kind === "position";
    return <ErpCard key={row.id} className="p-3"><div className="flex items-center justify-between gap-3"><div><p className="font-bold">{row.name || row.title}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.code} · نسخه {(row.codeOccurrence || 1).toLocaleString("fa-IR")}{row.organizationalUnit ? ` · ${row.organizationalUnit.name}` : ""}</p></div><ErpButton label="جزئیات" href={position ? `/dashboard/hr/structure/positions/${row.id}` : `/dashboard/hr/structure/units/${row.id}`} variant="ghost" /></div></ErpCard>;
  })}{!rows.length && <ErpEmptyState icon={FaLink} title="تعریف پیوندخورده‌ای وجود ندارد" />}</div></ErpSection>;
}
