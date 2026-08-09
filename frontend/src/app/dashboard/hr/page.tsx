"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FaBuilding,
  FaClipboardCheck,
  FaExchangeAlt,
  FaSync,
  FaUserPlus,
  FaUserTie,
  FaUsers,
} from "react-icons/fa";
import {
  ErpButton,
  ErpLoading,
  ErpNeumorphicActionGrid,
  ErpNeumorphicMetricGrid,
  ErpProgressRingCard,
  ErpWorkList,
} from "@/components/erp";
import { apiError, HrMessage } from "@/features/hr/hrUi";
import { authAPI, hrAPI } from "@/lib/api";
import { hiringAPI } from "@/lib/hiringApi";

export default function HrDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [workSummary, setWorkSummary] = useState<any>({
    progress: { completed: 0, remaining: 0, total: 0, percentage: null },
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [dashboard, work, currentUserResponse] = await Promise.all([
        hrAPI.getDashboard(),
        hiringAPI.workItemSummary(),
        authAPI.getMe(),
      ]);
      setData(dashboard.data.data);
      setWorkSummary(work.data.data);
      setCurrentUser(currentUserResponse.data.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <ErpLoading />;

  const metrics = data?.metrics || {};
  const verification = data?.verification || {};
  const progress = workSummary?.progress || {
    completed: 0,
    remaining: 0,
    total: 0,
    percentage: null,
  };

  return (
    <main
      dir="rtl"
      lang="fa"
      className="sds-workspace sds-neumorphic-scope mx-auto w-full max-w-7xl space-y-6 pb-24 lg:pb-2"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-black tracking-tight text-[var(--sds-text-primary)] sm:text-3xl">
          داشبورد منابع انسانی
        </h1>
        <ErpButton
          label="به‌روزرسانی"
          icon={FaSync}
          onClick={load}
          tone="neutral"
          variant="soft"
        />
      </header>

      {error && <HrMessage>{error}</HrMessage>}

      <ErpNeumorphicMetricGrid
        items={[
          {
            id: "personnel",
            label: "پرسنل ثبت‌شده",
            value: Number(metrics.personnel || 0).toLocaleString("fa-IR"),
            icon: FaUsers,
            tone: "primary",
            href: "/dashboard/hr/personnel",
          },
          {
            id: "active-headcount",
            label: "سرانه فعال",
            value: Number(metrics.activeHeadcount || 0).toLocaleString("fa-IR"),
            icon: FaUserTie,
            tone: "success",
            href: "/dashboard/hr/personnel?relationshipStatus=ACTIVE",
          },
          {
            id: "committed-capacity",
            label: "ظرفیت متعهد آینده",
            value: Number(metrics.committedCapacity || 0).toLocaleString(
              "fa-IR",
            ),
            icon: FaClipboardCheck,
            tone: "info",
            href: "/dashboard/hr/structure/positions?filter=committed",
          },
          {
            id: "vacancies",
            label: "ظرفیت خالی",
            value: Number(metrics.vacancies || 0).toLocaleString("fa-IR"),
            icon: FaBuilding,
            tone: "warning",
            href: "/dashboard/hr/structure/positions?filter=vacant",
          },
        ]}
      />

      <ErpNeumorphicActionGrid
        title="دسترسی سریع"
        items={[
          {
            id: "structure",
            title: "ساختار سازمانی",
            href: "/dashboard/hr/structure",
            icon: FaBuilding,
          },
          {
            id: "hiring",
            title: "جذب و پرونده‌های متقاضیان",
            href: "/dashboard/hr/hiring",
            icon: FaUserPlus,
          },
          {
            id: "personnel",
            title: "پرسنل و روابط استخدامی",
            href: "/dashboard/hr/personnel",
            icon: FaUsers,
          },
          {
            id: "migration",
            title: "مهاجرت و تطبیق",
            href: "/dashboard/hr/migration",
            icon: FaExchangeAlt,
          },
          {
            id: "authority",
            title: "اختیار و مسئولیت",
            href: "/dashboard/hr/hiring/authorities",
            icon: FaClipboardCheck,
          },
          ...(["ADMIN", "MANAGER"].includes(currentUser?.role) ? [{
            id: "users",
            title: "مدیریت کاربران",
            href: "/dashboard/users",
            icon: FaUsers,
          }] : []),
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <ErpWorkList
            title="وظایف و موارد نیازمند پیگیری"
            items={[
              {
                id: "relationships-without-primary-assignment",
                label: "رابطه فاقد تخصیص اصلی",
                count: Number(
                  verification.relationshipsWithoutPrimaryAssignment || 0,
                ),
                href: "/dashboard/hr/personnel?attention=missing-primary",
                tone: "danger",
              },
              {
                id: "vacant-supervisor-positions",
                label: "جایگاه سرپرستی بدون متصدی",
                count: Number(verification.vacantSupervisorPositions || 0),
                href: "/dashboard/hr/structure/positions?filter=vacant-supervisor",
                tone: "danger",
              },
              {
                id: "inactive-foundation-records",
                label: "تعاریف غیرفعال",
                count: Number(verification.inactiveFoundationRecords || 0),
                href: "/dashboard/hr/structure?view=inactive",
                tone: "warning",
              },
              {
                id: "planned-hiring",
                label: "استخدام برنامه‌ریزی‌شده",
                count: Number(metrics.planned || 0),
                href: "/dashboard/hr/personnel?relationshipStatus=PLANNED",
                tone: "info",
              },
              {
                id: "suspended-hiring",
                label: "استخدام معلق",
                count: Number(metrics.suspended || 0),
                href: "/dashboard/hr/personnel?relationshipStatus=SUSPENDED",
                tone: "warning",
              },
            ]}
          />
        </div>

        <div className="xl:col-span-2">
          <ErpProgressRingCard
            title="پیشرفت وظایف من"
            label="کارهای محول‌شده"
            percentage={progress.percentage}
            emptyLabel="بدون وظیفه"
            detail={
              progress.total === 0
                ? "وظیفه‌ای به شما محول نشده است"
                : `${Number(progress.completed).toLocaleString("fa-IR")} انجام‌شده · ${Number(progress.remaining).toLocaleString("fa-IR")} باقی‌مانده`
            }
            href="/dashboard/hr/tasks?scope=mine"
          />
        </div>
      </div>
    </main>
  );
}
