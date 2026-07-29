"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { positionCapacityCoverage } from "@/features/hr/hrDashboardViewModel";
import { apiError, HrMessage } from "@/features/hr/hrUi";
import { hrAPI } from "@/lib/api";

const filters = [
  { id: "all", label: "همه جایگاه‌ها" },
  { id: "vacant", label: "ظرفیت خالی" },
  { id: "committed", label: "ظرفیت متعهد" },
  { id: "vacant-supervisor", label: "سرپرستی بدون متصدی" },
] as const;

export default function HrPositionCapacityPage() {
  const searchParams = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData((await hrAPI.getFoundation()).data.data);
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const positions = useMemo(
    () =>
      (data?.positions || []).filter((position: any) => {
        if (activeFilter === "vacant") return position.vacancy > 0;
        if (activeFilter === "committed")
          return position.occupancy.committed > 0;
        if (activeFilter === "vacant-supervisor")
          return (
            position._count?.subordinatePositions > 0 &&
            position.occupancy.active === 0
          );
        return true;
      }),
    [activeFilter, data],
  );
  const committed = (data?.positions || []).reduce(
    (sum: number, position: any) =>
      sum + Number(position.occupancy.committed || 0),
    0,
  );
  const vacant = (data?.positions || []).reduce(
    (sum: number, position: any) => sum + Number(position.vacancy || 0),
    0,
  );
  const coverage = positionCapacityCoverage(committed, vacant);

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
        <ErpProgressRingCard
          title="پوشش ظرفیت جایگاه‌ها"
          label="ظرفیت متعهد"
          percentage={coverage.percentage}
          detail={`${coverage.committed.toLocaleString("fa-IR")} ظرفیت متعهد از ${coverage.total.toLocaleString("fa-IR")} ظرفیت جایگاه`}
        />
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
              <ErpNeumorphicCard key={position.id} as="article" className="p-4">
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
                    <dt>فعال</dt>
                    <dd className="mt-1 font-black text-[var(--sds-text-primary)]">
                      {position.occupancy.active.toLocaleString("fa-IR")}
                    </dd>
                  </div>
                  <div>
                    <dt>متعهد</dt>
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
              </ErpNeumorphicCard>
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
