"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FaHistory, FaRedo } from "react-icons/fa";
import {
  ErpEmptyState,
  ErpInlineState,
  ErpListPage,
  ErpPagination,
  ErpStatus,
} from "@/components/erp";
import { securityAPI } from "@/lib/api";
import PersianCalendar from "@/lib/persian-calendar";

type PersonnelRow = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  nationalCode?: string | null;
  isActive: boolean;
  department?: { name?: string; namePersian?: string } | null;
  activeReportCount: number;
  latestReport?: { createdAt: string; status: "ACTIVE" | "VOIDED" } | null;
};

const personName = (row: PersonnelRow) =>
  `${row.firstName} ${row.lastName}`.trim();
const dateTime = (value?: string | null) =>
  value ? PersianCalendar.formatForDisplay(value, true) : "بدون گزارش";

export default function PersonnelReportDirectoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [queryReady, setQueryReady] = useState(false);
  const [filters, setFilters] = useState({
    q: "",
    status: "active",
    departmentId: "",
    hasReports: "",
    page: 1,
  });
  const [rows, setRows] = useState<PersonnelRow[]>([]);
  const [meta, setMeta] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  });
  const [departments, setDepartments] = useState<
    Array<{ id: string; name: string; namePersian: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters({
      q: params.get("q") || "",
      status: params.get("status") || "active",
      departmentId: params.get("department") || "",
      hasReports: params.get("reports") || "",
      page: Math.max(1, Number(params.get("page") || 1)),
    });
    setQueryReady(true);
  }, []);

  const params = useMemo(
    () => ({
      q: filters.q.trim() || undefined,
      status: filters.status,
      departmentId: filters.departmentId || undefined,
      hasReports: filters.hasReports === "with" ? "true" : undefined,
      page: filters.page,
      pageSize: 25,
    }),
    [filters],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await securityAPI.getPersonnelReportDirectory(params);
      setRows(response.data.data || []);
      setMeta(response.data.meta);
      setDepartments(response.data.facets?.departments || []);
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.error ||
          "دریافت سوابق گزارش پرسنل ناموفق بود.",
      );
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    if (!queryReady) return;
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load, queryReady]);
  useEffect(() => {
    if (!queryReady) return;
    const next = new URLSearchParams();
    if (filters.q.trim()) next.set("q", filters.q.trim());
    if (filters.status !== "active") next.set("status", filters.status);
    if (filters.departmentId) next.set("department", filters.departmentId);
    if (filters.hasReports) next.set("reports", filters.hasReports);
    if (filters.page > 1) next.set("page", String(filters.page));
    router.replace(next.size ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  }, [filters, pathname, queryReady, router]);

  const setFilter = (key: keyof typeof filters, value: string | number) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key !== "page" ? { page: 1 } : {}),
    }));
  return (
    <ErpListPage<PersonnelRow>
      title="سوابق گزارش‌های گارد پرسنل"
      description="گزارش‌های لحظه‌ای گارد بر اساس افراد مرتبط؛ ارتباط با گزارش به معنی تخلف یا قضاوت انضباطی نیست."
      actions={[
        {
          label: "به‌روزرسانی",
          icon: FaRedo,
          variant: "outline",
          onClick: load,
        },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      isLoading={loading}
      filters={[
        {
          id: "q",
          label: "جستجوی پرسنل",
          type: "search",
          value: filters.q,
          placeholder: "نام، شماره پرسنلی یا کد ملی",
          onChange: (value) => setFilter("q", value),
        },
        {
          id: "status",
          label: "وضعیت همکاری",
          type: "select",
          value: filters.status,
          options: [
            { value: "active", label: "پرسنل فعال" },
            { value: "inactive", label: "پرسنل غیرفعال" },
            { value: "all", label: "همه پرسنل" },
          ],
          onChange: (value) => setFilter("status", value || "active"),
        },
        {
          id: "department",
          label: "واحد سازمانی",
          type: "select",
          value: filters.departmentId,
          options: departments.map((item) => ({
            value: item.id,
            label: item.namePersian || item.name,
          })),
          onChange: (value) => setFilter("departmentId", value),
        },
        {
          id: "reports",
          label: "وجود گزارش",
          type: "select",
          value: filters.hasReports,
          options: [{ value: "with", label: "فقط دارای گزارش" }],
          onChange: (value) => setFilter("hasReports", value),
        },
      ]}
      columns={[
        {
          id: "person",
          header: "پرسنل",
          priority: "primary",
          cell: (row) => (
            <div>
              <Link
                className="font-bold text-[var(--sds-text-primary)] hover:text-[var(--sds-accent)]"
                href={`/dashboard/security/personnel-report-history/${row.id}`}
              >
                {personName(row)}
              </Link>
              <p className="mt-1 text-xs sds-text-muted">
                {row.employeeNumber || "بدون شماره پرسنلی"} ·{" "}
                {row.department?.namePersian ||
                  row.department?.name ||
                  "بدون واحد"}
              </p>
            </div>
          ),
        },
        {
          id: "state",
          header: "وضعیت",
          mobileLabel: "وضعیت",
          priority: "secondary",
          cell: (row) => (
            <ErpStatus
              label={row.isActive ? "فعال" : "غیرفعال"}
              tone={row.isActive ? "success" : "neutral"}
            />
          ),
        },
        {
          id: "count",
          header: "گزارش فعال",
          mobileLabel: "گزارش فعال",
          priority: "meta",
          cell: (row) => row.activeReportCount.toLocaleString("fa-IR"),
        },
        {
          id: "latest",
          header: "آخرین گزارش",
          mobileLabel: "آخرین گزارش",
          priority: "meta",
          cell: (row) => (
            <div>
              <span>{dateTime(row.latestReport?.createdAt)}</span>
              {row.latestReport && (
                <div className="mt-1">
                  <ErpStatus
                    label={
                      row.latestReport.status === "VOIDED" ? "باطل‌شده" : "فعال"
                    }
                    tone={
                      row.latestReport.status === "VOIDED"
                        ? "danger"
                        : "success"
                    }
                  />
                </div>
              )}
            </div>
          ),
        },
      ]}
      rowActions={(row) => [
        {
          label: "مشاهده تاریخچه",
          href: `/dashboard/security/personnel-report-history/${row.id}`,
          icon: FaHistory,
        },
      ]}
      emptyState={
        error ? (
          <ErpInlineState
            kind="error"
            title={error}
            action={{ label: "تلاش مجدد", onClick: load }}
          />
        ) : (
          <ErpEmptyState
            title="پرسنلی مطابق فیلترها پیدا نشد"
            description="فیلترها یا عبارت جستجو را تغییر دهید."
          />
        )
      }
      footer={
        <ErpPagination
          currentPage={meta.page}
          totalPages={meta.totalPages}
          totalItems={meta.total}
          itemsPerPage={meta.pageSize}
          itemLabel="پرسنل"
          onPageChange={(page) => setFilter("page", page)}
        />
      }
    >
      {error && rows.length > 0 && (
        <ErpInlineState
          kind="stale"
          title={error}
          action={{ label: "تلاش مجدد", onClick: load }}
        />
      )}
    </ErpListPage>
  );
}
