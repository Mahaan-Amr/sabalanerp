"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FaBuilding, FaEdit, FaSync } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpEmptyState,
  ErpLoading,
  ErpNeumorphicCard,
  ErpPage,
  ErpProgressRingCard,
} from "@/components/erp";
import { apiError, HrMessage } from "@/features/hr/hrUi";
import { hrAPI } from "@/lib/api";

const filters = [
  { id: "all", label: "همه جایگاه‌ها" },
  { id: "vacant", label: "ظرفیت خالی" },
  { id: "in-use", label: "در استفاده" },
  { id: "reserved", label: "رزرو شروع" },
  { id: "acting", label: "سرپرستی موقت" },
  { id: "ended", label: "پایان‌یافته" },
  { id: "future", label: "آینده" },
  { id: "inactive", label: "غیرفعال" },
  { id: "vacant-supervisor", label: "سرپرستی بدون متصدی" },
] as const;

export default function HrPositionCapacityPage() {
  const searchParams = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";
  const dependencyAt = searchParams.get("dependencyAt") || "";
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [positionsResponse, summaryResponse] = await Promise.all([
        hrAPI.getPositions({ filter: activeFilter, ...(dependencyAt ? { dependencyAt } : {}) }),
        hrAPI.getPositionCapacitySummary(dependencyAt ? { dependencyAt } : undefined),
      ]);
      setData({
        positions: positionsResponse.data.data.positions,
        capacitySummary: summaryResponse.data.data,
      });
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setLoading(false);
    }
  }, [activeFilter, dependencyAt]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!loading && focus) {
      const savedScroll = sessionStorage.getItem(`hr-position-list-scroll:${activeFilter}:${focus}`);
      if (savedScroll) window.scrollTo({ top: Number(savedScroll), behavior: "auto" });
      document.getElementById(`position-${focus}`)?.focus({ preventScroll: true });
    }
  }, [activeFilter, loading, searchParams]);

  const positions = data?.positions || [];
  const coverage = data?.capacitySummary || {
    capacity: 0,
    inUse: 0,
    reservedForStart: 0,
    vacancy: 0,
    percentage: null,
  };

  if (loading) return <ErpLoading />;
  return (
    <ErpPage
      eyebrow="منابع انسانی"
      title="نمای ظرفیت جایگاه‌ها"
      backHref="/dashboard/hr"
      actions={[
        {
          label: "مدیریت جایگاه‌ها",
          icon: FaEdit,
          href: "/dashboard/hr/structure?tab=positions",
        },
        { label: "به‌روزرسانی", icon: FaSync, onClick: load, tone: "neutral" },
      ]}
    >
      {error && <HrMessage>{error}</HrMessage>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div className="xl:sticky xl:top-24 xl:self-start">
          <ErpProgressRingCard
            title="پوشش ظرفیت جایگاه‌ها"
            label="در استفاده و رزرو شروع"
            percentage={coverage.percentage}
            emptyLabel="بدون ظرفیت فعال"
            size="compact"
            href="/dashboard/hr/structure/positions?filter=allocated"
            detail={coverage.percentage === null
              ? "هیچ جایگاه فعالی ظرفیت ندارد؛ بنابراین درصد پوشش تعریف‌نشده است."
              : `${coverage.inUse.toLocaleString("fa-IR")} در استفاده · ${coverage.reservedForStart.toLocaleString("fa-IR")} رزرو شروع · ${coverage.vacancy.toLocaleString("fa-IR")} خالی`}
          />
        </div>
        <ErpNeumorphicCard className="p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <ErpButton
                key={filter.id}
                label={filter.label}
                href={
                  filter.id === "all"
                    ? "/dashboard/hr/structure/positions"
                    : `/dashboard/hr/structure/positions?filter=${filter.id}`
                }
                tone={activeFilter === filter.id ? "primary" : "neutral"}
                variant={activeFilter === filter.id ? "soft" : "ghost"}
              />
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {positions.map((position: any) => (
              <div key={position.id} id={`position-${position.id}`} tabIndex={-1}>
              <ErpNeumorphicCard as="article" className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-[var(--sds-text-primary)]">
                      {position.title}
                    </p>
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                      {position.code} · {position.organizationalUnit?.name}
                    </p>
                  </div>
                  <ErpBadge tone={position.vacancy ? "warning" : "success"}>
                    {position.vacancy
                      ? `${position.vacancy.toLocaleString("fa-IR")} خالی`
                      : "تکمیل"}
                  </ErpBadge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-[var(--sds-text-secondary)]">
                  <div>
                    <dt>در استفاده</dt>
                    <dd className="mt-1 font-black text-[var(--sds-text-primary)]">
                      {position.occupancy.active.toLocaleString("fa-IR")}
                    </dd>
                  </div>
                  <div>
                    <dt>رزرو شروع</dt>
                    <dd className="mt-1 font-black text-[var(--sds-text-primary)]">
                      {position.occupancy.committed.toLocaleString("fa-IR")}
                    </dd>
                  </div>
                  <div>
                    <dt>ظرفیت</dt>
                    <dd className="mt-1 font-black text-[var(--sds-text-primary)]">
                      {position.capacity.toLocaleString("fa-IR")}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <ErpButton
                    label="سوابق و ظرفیت"
                    href={`/dashboard/hr/structure/positions/${position.id}?origin=${encodeURIComponent(`/dashboard/hr/structure/positions${activeFilter === "all" ? "" : `?filter=${activeFilter}`}`)}&focus=${encodeURIComponent(position.id)}`}
                    onClick={() => sessionStorage.setItem(`hr-position-list-scroll:${activeFilter}:${position.id}`, String(window.scrollY))}
                    tone="neutral"
                    variant="outline"
                  />
                </div>
              </ErpNeumorphicCard>
              </div>
            ))}
            {!positions.length && (
              <ErpEmptyState
                icon={FaBuilding}
                title="جایگاهی با این وضعیت وجود ندارد"
              />
            )}
          </div>
        </ErpNeumorphicCard>
      </div>
    </ErpPage>
  );
}
