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
  FaTruck,
} from "react-icons/fa";
import {
  ErpButton,
  ErpEmptyState,
  ErpInlineState,
  ErpLoading,
  ErpNeumorphicActionGrid,
  ErpNeumorphicMetricGrid,
  ErpProgressRingCard,
  ErpWorkspacePage,
  ErpWorkList,
} from "@/components/erp";
import { apiError } from "@/features/hr/hrUi";
import { dashboardAPI, hrAPI } from "@/lib/api";
import { hiringAPI } from "@/lib/hiringApi";
import { hasHrFeature, projectHrWorkspaceLanding } from '@/features/hr/hrAccessNavigation';
import {
  hasHrWorkspaceAccess,
  shouldShowHrPersonalDashboard,
} from '@/features/hr/hrDashboardViewModel';

const actionIconById = {
  structure: FaBuilding,
  hiring: FaUserPlus,
  tasks: FaClipboardCheck,
  personnel: FaUsers,
  authority: FaClipboardCheck,
  migration: FaExchangeAlt,
  users: FaUsers,
} as const;

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
      const currentUserResponse = await dashboardAPI.getProfile();
      const profile = currentUserResponse.data.data;
      const features = profile.permissions?.features || [];
      const workspaces = profile.permissions?.workspaces || [];
      setCurrentUser(profile);
      if (hasHrWorkspaceAccess(workspaces)) {
        void hiringAPI.workItemSummary()
          .then((work) => setWorkSummary(work.data.data))
          .catch(() => setWorkSummary({ progress: { completed: 0, remaining: 0, total: 0, percentage: null }, items: [] }));
      }
      if (!hasHrFeature(features, 'DASHBOARD')) return;

      const dashboard = await hrAPI.getDashboard();
      setData(dashboard.data.data);
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

  if (!currentUser) {
    return <ErpEmptyState title="خواندن دسترسی منابع انسانی ناموفق بود" description={error || 'دوباره تلاش کنید.'} action={{ label: 'تلاش دوباره', onClick: load }} />;
  }

  const features = currentUser.permissions?.features || [];
  const workspaces = currentUser.permissions?.workspaces || [];
  const landing = projectHrWorkspaceLanding(features, currentUser.role);
  if (!shouldShowHrPersonalDashboard(workspaces, landing.kind)) {
    return (
      <ErpWorkspacePage
        title="فضای کاری منابع انسانی"
        className="sds-neumorphic-scope pb-24 lg:pb-2"
      >
        {landing.kind === 'limited' ? (
          <ErpNeumorphicActionGrid
            title="بخش‌های در دسترس"
            showTitle={false}
            items={landing.links.map((link) => ({
              id: link.id,
              title: link.label,
              href: link.href,
              icon: actionIconById[link.id as keyof typeof actionIconById],
            }))}
          />
        ) : (
          <ErpEmptyState
            icon={FaClipboardCheck}
            title="دسترسی فضای کاری وجود دارد، اما هیچ مجوزی برای بخش‌های منابع انسانی به حساب شما داده نشده است"
            description="برای مشاهده یک بخش، مدیر سامانه باید مجوز پایه همان بخش را ثبت کند."
          />
        )}
      </ErpWorkspacePage>
    );
  }

  const metrics = data?.metrics || {};
  const verification = data?.verification || {};
  const progress = workSummary?.progress || {
    completed: 0,
    remaining: 0,
    total: 0,
    percentage: null,
  };
  const personalWorkItems = (workSummary?.items || []).map((item: any) => ({
    id: `personal-work-${item.id}`,
    label: item.title,
    count: 1,
    href: item.destinationHref,
    tone: item.status === 'IN_PROGRESS' ? 'info' as const : 'warning' as const,
  }));
  const verificationWorkItems = data ? [
    {
      id: "relationships-without-primary-assignment",
      label: "رابطه فاقد تخصیص اصلی",
      count: Number(
        verification.relationshipsWithoutPrimaryAssignment || 0,
      ),
      href: "/dashboard/hr/personnel?attention=missing-primary",
      tone: "danger" as const,
    },
    {
      id: "vacant-supervisor-positions",
      label: "جایگاه سرپرستی بدون متصدی",
      count: Number(verification.vacantSupervisorPositions || 0),
      href: "/dashboard/hr/structure/positions?filter=vacant-supervisor",
      tone: "danger" as const,
    },
    {
      id: "inactive-foundation-records",
      label: "تعاریف غیرفعال",
      count: Number(verification.inactiveFoundationRecords || 0),
      href: "/dashboard/hr/structure?view=inactive",
      tone: "warning" as const,
    },
    {
      id: "planned-hiring",
      label: "استخدام برنامه‌ریزی‌شده",
      count: Number(metrics.planned || 0),
      href: "/dashboard/hr/personnel?relationshipStatus=PLANNED",
      tone: "info" as const,
    },
    {
      id: "suspended-hiring",
      label: "استخدام معلق",
      count: Number(metrics.suspended || 0),
      href: "/dashboard/hr/personnel?relationshipStatus=SUSPENDED",
      tone: "warning" as const,
    },
  ].filter((item) => (
    item.href.startsWith('/dashboard/hr/personnel')
      ? hasHrFeature(features, 'PERSONNEL')
      : hasHrFeature(features, 'ORGANIZATIONAL_STRUCTURE')
  )) : [];

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

      {error && <ErpInlineState kind="error" title={error} />}

      {data && <ErpNeumorphicMetricGrid
        items={[
          {
            id: "personnel",
            label: "پرسنل ثبت‌شده",
            value: Number(metrics.personnel || 0).toLocaleString("fa-IR"),
            icon: FaUsers,
            tone: "primary",
            href: hasHrFeature(features, 'PERSONNEL') ? "/dashboard/hr/personnel" : undefined,
          },
          {
            id: "active-headcount",
            label: "سرانه فعال",
            value: Number(metrics.activeHeadcount || 0).toLocaleString("fa-IR"),
            icon: FaUserTie,
            tone: "success",
            href: hasHrFeature(features, 'PERSONNEL') ? "/dashboard/hr/personnel?relationshipStatus=ACTIVE" : undefined,
          },
          {
            id: "committed-capacity",
            label: "ظرفیت متعهد آینده",
            value: Number(metrics.committedCapacity || 0).toLocaleString(
              "fa-IR",
            ),
            icon: FaClipboardCheck,
            tone: "info",
            href: hasHrFeature(features, 'ORGANIZATIONAL_STRUCTURE') ? "/dashboard/hr/structure/positions?filter=committed" : undefined,
          },
          {
            id: "vacancies",
            label: "ظرفیت خالی",
            value: Number(metrics.vacancies || 0).toLocaleString("fa-IR"),
            icon: FaBuilding,
            tone: "warning",
            href: hasHrFeature(features, 'ORGANIZATIONAL_STRUCTURE') ? "/dashboard/hr/structure/positions?filter=vacant" : undefined,
          },
        ]}
      />}

      {landing.links.length > 0 && <ErpNeumorphicActionGrid
        title="دسترسی سریع"
        items={[
          ...landing.links.map((link) => ({
            id: link.id,
            title: link.label,
            href: link.href,
            icon: actionIconById[link.id as keyof typeof actionIconById],
          })),
          ...(['ADMIN', 'MANAGER'].includes(currentUser.role) ? [{
            id: "vehicle-operations",
            title: "رانندگان و خودروهای شرکت",
            href: "/dashboard/hr/vehicle-operations",
            icon: FaTruck,
          }] : []),
        ]}
      />}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <ErpWorkList
            title="وظایف و موارد نیازمند پیگیری"
            items={[...personalWorkItems, ...verificationWorkItems]}
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
            href={hasHrFeature(features, 'HR_WORK_MANAGEMENT') ? "/dashboard/hr/tasks?scope=mine" : undefined}
          />
        </div>
      </div>
    </main>
  );
}
