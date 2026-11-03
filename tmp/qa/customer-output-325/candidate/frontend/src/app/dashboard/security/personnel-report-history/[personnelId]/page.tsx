"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FaFilePdf,
  FaImages,
  FaRedo,
  FaSearchMinus,
  FaSearchPlus,
  FaUndo,
} from "react-icons/fa";
import PersianCalendarComponent from "@/components/PersianCalendar";
import {
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpEmptyState,
  ErpFilters,
  ErpInlineState,
  ErpPage,
  ErpPagination,
  ErpPressable,
  ErpSection,
  ErpSheet,
  ErpSkeleton,
  ErpStatus,
} from "@/components/erp";
import { securityAPI } from "@/lib/api";
import PersianCalendar from "@/lib/persian-calendar";

type Report = any;
const dateTime = (value?: string | null) =>
  value ? PersianCalendar.formatForDisplay(value, true) : "—";
const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
const sessionLabel: Record<string, string> = {
  ACTIVE: "فعال",
  CLOSED: "بسته‌شده",
  FORCE_CLOSED: "بسته‌شده توسط مدیر",
};

export default function PersonnelReportHistoryPage({
  params: routeParams,
}: {
  params: { personnelId: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const personnelId = routeParams.personnelId;
  const [queryReady, setQueryReady] = useState(false);
  const [filters, setFilters] = useState({
    q: "",
    status: "ACTIVE",
    start: "",
    end: "",
    categoryId: "",
    reportTypeId: "",
    reporterId: "",
    attachments: "all",
    page: 1,
  });
  const [personnel, setPersonnel] = useState<any>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [facets, setFacets] = useState<any>({
    categories: [],
    reportTypes: [],
    reporters: [],
  });
  const [meta, setMeta] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [selected, setSelected] = useState<Report | null>(null);
  const reportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setFilters({
      q: p.get("q") || "",
      status: p.get("status") || "ACTIVE",
      start: p.get("start") || "",
      end: p.get("end") || "",
      categoryId: p.get("category") || "",
      reportTypeId: p.get("type") || "",
      reporterId: p.get("reporter") || "",
      attachments: p.get("attachments") || "all",
      page: Math.max(1, Number(p.get("page") || 1)),
    });
    setQueryReady(true);
  }, []);
  const apiFilters = useMemo(
    () => ({
      q: filters.q.trim() || undefined,
      status: filters.status,
      startDate: filters.start
        ? PersianCalendar.toGregorianDateOnly(filters.start)
        : undefined,
      endDate: filters.end
        ? PersianCalendar.toGregorianDateOnly(filters.end)
        : undefined,
      categoryId: filters.categoryId || undefined,
      reportTypeId: filters.reportTypeId || undefined,
      reporterId: filters.reporterId || undefined,
      attachments: filters.attachments,
      page: filters.page,
      pageSize: 20,
    }),
    [filters],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await securityAPI.getPersonnelReportHistory(
        personnelId,
        apiFilters,
      );
      setPersonnel(response.data.data.personnel);
      setReports(response.data.data.reports || []);
      setFacets(
        response.data.facets || {
          categories: [],
          reportTypes: [],
          reporters: [],
        },
      );
      setMeta(response.data.meta);
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.error ||
          "دریافت گزارش‌های مرتبط با پرسنل ناموفق بود.",
      );
    } finally {
      setLoading(false);
    }
  }, [apiFilters, personnelId]);
  useEffect(() => {
    if (!queryReady) return;
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load, queryReady]);
  useEffect(() => {
    if (!queryReady) return;
    const p = new URLSearchParams();
    if (filters.q.trim()) p.set("q", filters.q.trim());
    if (filters.status !== "ACTIVE") p.set("status", filters.status);
    if (filters.start) p.set("start", filters.start);
    if (filters.end) p.set("end", filters.end);
    if (filters.categoryId) p.set("category", filters.categoryId);
    if (filters.reportTypeId) p.set("type", filters.reportTypeId);
    if (filters.reporterId) p.set("reporter", filters.reporterId);
    if (filters.attachments !== "all")
      p.set("attachments", filters.attachments);
    if (filters.page > 1) p.set("page", String(filters.page));
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  }, [filters, pathname, queryReady, router]);
  const setFilter = (key: keyof typeof filters, value: string | number) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "categoryId" ? { reportTypeId: "" } : {}),
      ...(key !== "page" ? { page: 1 } : {}),
    }));
  const types = facets.reportTypes.filter(
    (item: any) =>
      !filters.categoryId || item.categoryId === filters.categoryId,
  );
  const reportTitle = (report: Report) =>
    `${report.categoryNameSnapshot}${report.reportTypeNameSnapshot ? ` / ${report.reportTypeNameSnapshot}` : ""}`;
  const attachmentUrl = (attachmentId: string) =>
    `/api/security/reports/personnel-history/${personnelId}/attachments/${attachmentId}`;
  const activeAttachments = selected?.attachments || [];
  const preview = previewIndex == null ? null : activeAttachments[previewIndex];
  const exportPdf = async () => {
    if (!meta.total) return;
    setExporting(true);
    setError("");
    try {
      const { page: _page, pageSize: _pageSize, ...scope } = apiFilters;
      const response = await securityAPI.downloadPersonnelReportHistoryPdf(
        personnelId,
        scope,
        includeImages,
      );
      downloadBlob(
        response.data,
        `security-personnel-reports-${personnel?.employeeNumber || personnelId}.pdf`,
      );
      setExportOpen(false);
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.error ||
          "ساخت PDF سوابق گزارش پرسنل ناموفق بود.",
      );
    } finally {
      setExporting(false);
    }
  };

  if (loading && !personnel)
    return (
      <ErpPage
        title="گزارش‌های مرتبط با پرسنل"
        backHref="/dashboard/security/personnel-report-history"
      >
        <ErpSkeleton lines={8} />
      </ErpPage>
    );
  if (error && !personnel)
    return (
      <ErpPage
        title="گزارش‌های مرتبط با پرسنل"
        backHref="/dashboard/security/personnel-report-history"
      >
        <ErpInlineState
          kind="error"
          title={error}
          action={{ label: "تلاش مجدد", onClick: load }}
        />
      </ErpPage>
    );
  const personnelName =
    `${personnel?.firstName || ""} ${personnel?.lastName || ""}`.trim();
  return (
    <ErpPage
      eyebrow="سوابق گزارش پرسنل"
      title={`گزارش‌های مرتبط با ${personnelName}`}
      description={`${personnel?.employeeNumber || "بدون شماره پرسنلی"} · ${personnel?.department?.namePersian || personnel?.department?.name || "بدون واحد"}`}
      backHref="/dashboard/security/personnel-report-history"
      actions={[
        {
          label: "به‌روزرسانی",
          icon: FaRedo,
          variant: "outline",
          onClick: load,
        },
        {
          label: "خروجی PDF",
          icon: FaFilePdf,
          disabled: meta.total === 0,
          onClick: () => setExportOpen(true),
        },
      ]}
      metrics={[
        {
          label: "گزارش مطابق فیلتر",
          value: meta.total.toLocaleString("fa-IR"),
          icon: FaImages,
          tone: "info",
        },
        {
          label: "وضعیت پرسنل",
          value:
            personnel?.isActive && !personnel?.archivedAt ? "فعال" : "غیرفعال",
          tone:
            personnel?.isActive && !personnel?.archivedAt
              ? "success"
              : "neutral",
        },
      ]}
    >
      <ErpFilters
        filters={[
          {
            id: "q",
            label: "جستجوی گزارش",
            type: "search",
            value: filters.q,
            placeholder: "شرح، دسته‌بندی، نوع یا نگهبان",
            onChange: (value) => setFilter("q", value),
          },
          {
            id: "status",
            label: "وضعیت گزارش",
            type: "select",
            value: filters.status,
            options: [
              { value: "ACTIVE", label: "فعال" },
              { value: "VOIDED", label: "باطل‌شده" },
              { value: "all", label: "همه وضعیت‌ها" },
            ],
            onChange: (value) => setFilter("status", value || "ACTIVE"),
          },
          {
            id: "category",
            label: "دسته‌بندی",
            type: "select",
            value: filters.categoryId,
            options: facets.categories.map((item: any) => ({
              value: item.id,
              label: item.name,
            })),
            onChange: (value) => setFilter("categoryId", value),
          },
          {
            id: "type",
            label: "نوع گزارش",
            type: "select",
            value: filters.reportTypeId,
            options: types.map((item: any) => ({
              value: item.id,
              label: item.name,
            })),
            onChange: (value) => setFilter("reportTypeId", value),
          },
          {
            id: "reporter",
            label: "نگهبان گزارش‌دهنده",
            type: "select",
            value: filters.reporterId,
            options: facets.reporters.map((item: any) => ({
              value: item.id,
              label: item.name,
            })),
            onChange: (value) => setFilter("reporterId", value),
          },
          {
            id: "attachments",
            label: "تصاویر",
            type: "select",
            value: filters.attachments,
            options: [
              { value: "all", label: "همه گزارش‌ها" },
              { value: "with", label: "دارای تصویر" },
              { value: "without", label: "بدون تصویر" },
            ],
            onChange: (value) => setFilter("attachments", value || "all"),
          },
        ]}
      />
      <ErpSection title="بازه تاریخ ثبت">
        <div className="grid gap-3 sm:grid-cols-2">
          <PersianCalendarComponent
            value={filters.start}
            onChange={(value) => setFilter("start", value)}
            placeholder="از تاریخ"
            clearable
          />
          <PersianCalendarComponent
            value={filters.end}
            onChange={(value) => setFilter("end", value)}
            placeholder="تا تاریخ"
            clearable
          />
        </div>
      </ErpSection>
      {error && reports.length > 0 && (
        <ErpInlineState
          kind="stale"
          title={error}
          action={{ label: "تلاش مجدد", onClick: load }}
        />
      )}
      <ErpSection title="تاریخچه گزارش‌ها">
        {loading ? (
          <ErpSkeleton lines={7} />
        ) : reports.length === 0 ? (
          <ErpEmptyState
            title="گزارشی مطابق فیلترها وجود ندارد"
            description="فیلترها یا بازه زمانی را تغییر دهید."
          />
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <ErpPressable
                key={report.id}
                type="button"
                onClick={(event) => {
                  reportTriggerRef.current = event.currentTarget;
                  setSelected(report);
                }}
                className="block w-full text-right"
              >
                <ErpCard interactive className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-bold sds-text-primary">
                        ردیف {report.rowNumber.toLocaleString("fa-IR")} ·{" "}
                        {reportTitle(report)}
                      </p>
                      <p className="mt-1 text-xs sds-text-muted">
                        {dateTime(report.createdAt)} · {report.reporterName}
                      </p>
                      <p className="mt-3 line-clamp-2 text-sm leading-6 sds-text-secondary">
                        {report.description || "بدون شرح"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ErpStatus
                        label={report.status === "VOIDED" ? "باطل‌شده" : "فعال"}
                        tone={report.status === "VOIDED" ? "danger" : "success"}
                      />
                      {report.attachments.length > 0 && (
                        <ErpStatus
                          label={`${report.attachments.length.toLocaleString("fa-IR")} تصویر`}
                          tone="info"
                        />
                      )}
                    </div>
                  </div>
                </ErpCard>
              </ErpPressable>
            ))}
          </div>
        )}
        <div className="mt-4">
          <ErpPagination
            currentPage={meta.page}
            totalPages={meta.totalPages}
            totalItems={meta.total}
            itemsPerPage={meta.pageSize}
            itemLabel="گزارش"
            onPageChange={(page) => setFilter("page", page)}
          />
        </div>
      </ErpSection>

      <ErpSheet
        open={Boolean(selected) && previewIndex === null}
        onClose={() => {
          setSelected(null);
          setPreviewIndex(null);
          window.requestAnimationFrame(() => reportTriggerRef.current?.focus());
        }}
        title={selected ? reportTitle(selected) : "جزئیات گزارش"}
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ErpStatus
                label={selected.status === "VOIDED" ? "باطل‌شده" : "فعال"}
                tone={selected.status === "VOIDED" ? "danger" : "success"}
              />
              <span className="text-xs sds-text-muted">
                ردیف {selected.rowNumber.toLocaleString("fa-IR")} ·{" "}
                {dateTime(selected.createdAt)}
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold sds-text-muted">شرح گزارش</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 sds-text-primary">
                {selected.description || "بدون شرح"}
              </p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs sds-text-muted">گزارش‌دهنده</dt>
                <dd className="mt-1 font-semibold">{selected.reporterName}</dd>
              </div>
              <div>
                <dt className="text-xs sds-text-muted">شناسه گزارش</dt>
                <dd className="mt-1 break-all text-xs">{selected.id}</dd>
              </div>
              <div>
                <dt className="text-xs sds-text-muted">بازه برنامه</dt>
                <dd className="mt-1 text-sm">
                  {dateTime(selected.session?.slot?.startsAt)} تا{" "}
                  {dateTime(selected.session?.slot?.endsAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs sds-text-muted">بازه واقعی</dt>
                <dd className="mt-1 text-sm">
                  {dateTime(selected.session?.startedAt)} تا{" "}
                  {dateTime(selected.session?.endedAt)} ·{" "}
                  {sessionLabel[selected.session?.status] ||
                    selected.session?.status}
                </dd>
              </div>
            </dl>
            <div>
              <p className="text-xs font-semibold sds-text-muted">
                افراد مرتبط
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.participants.map((item: any, index: number) =>
                  item.id ? (
                    <ErpButton
                      key={`${item.id}-${index}`}
                      href={`/dashboard/security/personnel-report-history/${item.id}`}
                      variant="outline"
                      label={`${item.name}${item.id === personnelId ? " · پرونده جاری" : ""}${item.historicalUserAssociation ? " · پیوند کاربری تاریخی" : ""}`}
                    />
                  ) : (
                    <span
                      key={index}
                      className="inline-flex min-h-11 items-center rounded-lg border border-[var(--sds-border-default)] px-3 text-sm"
                    >
                      {item.name} · پیوند تاریخی
                    </span>
                  ),
                )}
              </div>
            </div>
            {selected.status === "VOIDED" && (
              <div className="sds-tone-danger sds-tone-surface rounded-xl border p-3 text-sm">
                <p className="font-bold">اطلاعات ابطال</p>
                <p className="mt-1">
                  {dateTime(selected.voidedAt)} · {selected.voidedByName || "—"}
                </p>
                <p className="mt-1">{selected.voidReason || "—"}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold sds-text-muted">
                تصاویر گزارش
              </p>
              {selected.attachments.length ? (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {selected.attachments.map(
                    (attachment: any, index: number) => (
                      <ErpPressable
                        key={attachment.id}
                        type="button"
                        onClick={() => {
                          setPreviewIndex(index);
                          setZoom(1);
                        }}
                        className="min-h-28 overflow-hidden rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] text-right"
                      >
                        <img
                          src={attachmentUrl(attachment.id)}
                          alt={attachment.originalName}
                          className="h-28 w-full object-cover"
                        />
                        <span className="block truncate px-2 py-2 text-xs">
                          {attachment.originalName}
                        </span>
                      </ErpPressable>
                    ),
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm sds-text-muted">
                  تصویری پیوست نشده است.
                </p>
              )}
            </div>
          </div>
        )}
      </ErpSheet>
      <ErpSheet
        open={Boolean(preview)}
        onClose={() => setPreviewIndex(null)}
        title={preview?.originalName || "پیش‌نمایش تصویر"}
        presentation="modal"
        size="wide"
        footer={
          preview && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <ErpButton
                  label="قبلی"
                  variant="outline"
                  disabled={previewIndex === 0}
                  onClick={() => {
                    setPreviewIndex((value) => Math.max(0, (value || 0) - 1));
                    setZoom(1);
                  }}
                />
                <ErpButton
                  label="بعدی"
                  variant="outline"
                  disabled={previewIndex === activeAttachments.length - 1}
                  onClick={() => {
                    setPreviewIndex((value) =>
                      Math.min(activeAttachments.length - 1, (value || 0) + 1),
                    );
                    setZoom(1);
                  }}
                />
              </div>
              <div className="flex gap-2">
                <ErpButton
                  label="کوچک‌نمایی"
                  icon={FaSearchMinus}
                  variant="outline"
                  disabled={zoom <= 1}
                  onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
                />
                <ErpButton
                  label="بازنشانی"
                  icon={FaUndo}
                  variant="ghost"
                  disabled={zoom === 1}
                  onClick={() => setZoom(1)}
                />
                <ErpButton
                  label="بزرگ‌نمایی"
                  icon={FaSearchPlus}
                  variant="outline"
                  disabled={zoom >= 3}
                  onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                />
              </div>
            </div>
          )
        }
      >
        <div className="overflow-auto rounded-xl bg-[var(--sds-surface-subtle)] p-3 text-center">
          {preview && (
            <img
              src={attachmentUrl(preview.id)}
              alt={preview.originalName}
              className="mx-auto max-h-[65dvh] max-w-full origin-center object-contain transition-transform"
              style={{ transform: `scale(${zoom})` }}
            />
          )}
        </div>
      </ErpSheet>
      <ErpSheet
        open={exportOpen}
        onClose={() => !exporting && setExportOpen(false)}
        title="خروجی PDF سوابق گزارش"
        presentation="modal"
        dismissible={!exporting}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={exporting}
              onClick={() => setExportOpen(false)}
            />
            <ErpButton
              label={
                exporting
                  ? "در حال ساخت…"
                  : `دریافت ${meta.total.toLocaleString("fa-IR")} گزارش`
              }
              icon={FaFilePdf}
              disabled={exporting || meta.total === 0}
              onClick={exportPdf}
            />
          </div>
        }
      >
        <p className="text-sm leading-6 sds-text-secondary">
          تمام گزارش‌های مطابق فیلترهای جاری، مستقل از صفحه‌بندی، صادر می‌شوند.
        </p>
        <div className="mt-4">
          <ErpCheckbox
            checked={includeImages}
            onChange={(event) => setIncludeImages(event.target.checked)}
            label="درج تصاویر در PDF"
          />
          <p className="mt-1 text-xs sds-text-muted">
            {includeImages
              ? "تصاویر همراه نام اصلی زیر گزارش درج می‌شوند."
              : "فقط تعداد و نام فایل‌ها درج می‌شود و حذف تصاویر در سند اعلام خواهد شد."}
          </p>
        </div>
      </ErpSheet>
    </ErpPage>
  );
}
