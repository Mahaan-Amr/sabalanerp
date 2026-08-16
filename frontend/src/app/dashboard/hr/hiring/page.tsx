"use client";
import { ErpCheckbox, ErpInput, ErpPressable, ErpSegmentedControl, ErpSelect } from "@/components/erp";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  FaArchive,
  FaClipboardList,
  FaFilter,
  FaPlus,
  FaSearch,
  FaSync,
  FaUndo,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpInlineState,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSheet,
} from "@/components/erp";
import { hrAPI } from "@/lib/api";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
import { dateTimeFa } from "@/features/hr/hrUi";
import { hrDisplayLabel } from "@/features/hr/hrDisplay";
import {
  hiringLifecyclePhaseOptions,
  hiringLifecycleStatusLabel,
  type HiringLifecycleStatus,
} from "@/features/hr-hiring/hiringLifecycleViewModel";
import {
  buildHiringQueueParams,
  buildHiringCaseHref,
  buildHiringQueueHref,
  parseHiringQueueContext,
  type HiringQueueFilters,
} from "@/features/hr-hiring/hiringQueueViewModel";
import { HR_HIRING_METRIC_VIEWS } from "@/features/hr-hiring/hrHiringMetricViews";

type HiringCreateForm = {
  firstName: string;
  lastName: string;
  mobile: string;
  nationalCode: string;
  positionId: string;
};
type FormalAssessmentKind = "DISC" | "EQ" | "BIG_FIVE";
type FormalAssessmentDecision = "" | "SELECT" | "NONE";
type FormalAssessmentExecutionMethod = "APPLICANT" | "COMPANY";
type CreateOutcome = { kind: "success" | "error" | "stale"; title: string } | null;
const formalAssessmentOptions: Array<{ value: FormalAssessmentKind; label: string }> = [
  { value: "DISC", label: "DISC (ارزیابی الگوی رفتاری دیسک)" },
  { value: "EQ", label: "EQ (ارزیابی هوش هیجانی)" },
  { value: "BIG_FIVE", label: "BIG FIVE (ارزیابی پنج عامل بزرگ شخصیت)" },
];
const blank: HiringCreateForm = {
  firstName: "",
  lastName: "",
  mobile: "",
  nationalCode: "",
  positionId: "",
};
const blankFilters: HiringQueueFilters = {
  attention: "",
  phase: "",
  outcome: "",
  search: "",
  positionId: "",
  disposition: "",
  sortBy: "priority",
  sortDirection: "asc",
  page: 1,
};
const field =
  "w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]";
const badgeTone = (status: HiringLifecycleStatus) => {
  if (status === "COMPLETED") return "success";
  if (status === "ACTION_REQUIRED") return "info";
  if (status === "WAITING") return "warning";
  if (status === "BLOCKED") return "danger";
  return "neutral";
};

export default function HiringCasesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialContext = parseHiringQueueContext(searchParams);
  const representedView = searchParams.get("view") === HR_HIRING_METRIC_VIEWS.actionableCollateralOrContracts
    ? HR_HIRING_METRIC_VIEWS.actionableCollateralOrContracts
    : "";
  const [rows, setRows] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [form, setForm] = useState<HiringCreateForm>(blank);
  const [filters, setFilters] = useState<HiringQueueFilters>(initialContext.filters);
  const [searchDraft, setSearchDraft] = useState(initialContext.filters.search || "");
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOutcome, setCreateOutcome] = useState<CreateOutcome>(null);
  const [actionPermissions, setActionPermissions] = useState<string[]>([]);
  const [assessmentDecision, setAssessmentDecision] = useState<FormalAssessmentDecision>("");
  const [assessmentKinds, setAssessmentKinds] = useState<FormalAssessmentKind[]>([]);
  const [assessmentExecutionMethod, setAssessmentExecutionMethod] = useState<FormalAssessmentExecutionMethod>("APPLICANT");
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [decisionDetail, setDecisionDetail] = useState<any>(null);
  const [archiveView, setArchiveView] = useState(initialContext.archived);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createDiscardOpen, setCreateDiscardOpen] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<any>(null);
  const requestSequence = useRef(0);
  const foundationLoaded = useRef(false);
  const programmaticHref = useRef("");
  const canManageFormalAssessmentPlan = actionPermissions.includes("MANAGE_COMPANY_EVALUATION_PLAN");
  const createDirty = Boolean(form.firstName || form.lastName || form.mobile || form.nationalCode || form.positionId || assessmentDecision || assessmentKinds.length);

  const load = async (nextFilters: HiringQueueFilters = filters, nextArchiveView = archiveView) => {
    const sequence = ++requestSequence.current;
    const needsFoundation = !foundationLoaded.current;
    try {
      setLoading(true);
      setError("");
      const [cases, foundation, permissions] = await Promise.all([
        hiringAPI.list({
          ...buildHiringQueueParams(nextFilters),
          archived: String(nextArchiveView),
          ...(representedView ? { view: representedView } : {}),
        }),
        needsFoundation ? hrAPI.getFoundation() : Promise.resolve(null),
        needsFoundation ? hiringAPI.myActionPermissions() : Promise.resolve(null),
      ]);
      if (sequence !== requestSequence.current) return;
      setRows(cases.data.data);
      setMeta(
        cases.data.meta || {
          page: 1,
          totalPages: 1,
          total: cases.data.data.length,
        },
      );
      if (foundation) {
        setPositions(foundation.data.data.positions || []);
        setActionPermissions(permissions?.data?.data || []);
        foundationLoaded.current = true;
      }
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setHasLoaded(true);
      }
    }
  };

  useEffect(() => {
    const restored = parseHiringQueueContext(searchParams);
    setFilters(restored.filters);
    setSearchDraft(restored.filters.search || "");
    setArchiveView(restored.archived);
    const currentHref = buildHiringQueueHref(restored.filters, restored.archived, representedView);
    if (programmaticHref.current === currentHref) {
      programmaticHref.current = "";
      return;
    }
    programmaticHref.current = "";
    void load(restored.filters, restored.archived).then(() => {
      const focus = searchParams.get("focus");
      const storedScroll = sessionStorage.getItem("hrHiringQueueScroll");
      window.setTimeout(() => {
        if (focus) document.getElementById(`hiring-case-${focus}`)?.focus();
        else if (storedScroll) window.scrollTo({ top: Number(storedScroll), behavior: "auto" });
      }, 50);
    });
    // URL-owned state is intentionally reloaded after browser Back or in-app return.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, representedView]);

  const commitContext = (nextFilters: HiringQueueFilters, nextArchiveView = archiveView) => {
    const href = buildHiringQueueHref(nextFilters, nextArchiveView, representedView);
    setFilters(nextFilters);
    setSearchDraft(nextFilters.search || "");
    setArchiveView(nextArchiveView);
    programmaticHref.current = href;
    router.replace(href);
    void load(nextFilters, nextArchiveView);
  };

  useEffect(() => {
    const committedSearch = (filters.search || "").trim();
    const nextSearch = searchDraft.trim();
    if (nextSearch === committedSearch) return;
    const timeout = window.setTimeout(() => {
      commitContext({ ...filters, search: nextSearch, page: 1 });
    }, 250);
    return () => window.clearTimeout(timeout);
    // Only text entry owns this debounce; the remaining filters keep their explicit apply action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const queueHref = buildHiringQueueHref(filters, archiveView, representedView);
  const rememberQueuePosition = () => sessionStorage.setItem("hrHiringQueueScroll", String(window.scrollY));

  const create = async () => {
    try {
      setBusy(true);
      setError("");
      setCreateError("");
      const response = await hiringAPI.create({
        ...form,
        ...(canManageFormalAssessmentPlan ? {
          formalAssessmentPlan: {
            explicitlyNoAssessment: assessmentDecision === "NONE",
            executionMethod: assessmentDecision === "SELECT" ? assessmentExecutionMethod : null,
            selections: assessmentDecision === "SELECT"
              ? assessmentKinds.map((assessmentKind) => ({ assessmentKind, executionMethod: assessmentExecutionMethod }))
              : [],
          },
        } : {}),
      });
      const createdCandidate = response.data.data.candidate;
      const delivery = response.data.data.invitationDelivery;
      if (delivery?.status === "SENT") {
        setCreateOutcome({ kind: "success", title: `پرونده ${createdCandidate.firstName} ${createdCandidate.lastName} ساخته شد و پیامک دعوت با موفقیت ارسال شد.${delivery.debugOtp ? ` کد محیط آزمایشی: ${delivery.debugOtp}` : ""}` });
      } else if (delivery?.status === "FAILED") {
        setCreateOutcome({ kind: "error", title: `پرونده و برنامه ارزیابی ثبت شد، اما ارسال پیامک ناموفق بود. از داخل پرونده دوباره ارسال کنید.${delivery.error ? ` ${delivery.error}` : ""}` });
      } else if (delivery?.status === "UNKNOWN") {
        setCreateOutcome({ kind: "stale", title: "پرونده و برنامه ارزیابی ثبت شد، اما نتیجه ارسال پیامک مشخص نیست. وضعیت ارسال را بررسی کنید و پیش از ارسال مجدد از تحویل نشدن آن مطمئن شوید." });
      } else {
        setCreateOutcome({ kind: "success", title: `پرونده ${createdCandidate.firstName} ${createdCandidate.lastName} ساخته شد. کاربر دارای مجوز مدیریت برنامه ارزیابی باید برنامه را نهایی کند تا دعوت ارسال شود.` });
      }
      setForm(blank);
      setAssessmentDecision("");
      setAssessmentKinds([]);
      setAssessmentExecutionMethod("APPLICANT");
      setCreateOpen(false);
      await load();
    } catch (cause) {
      setCreateError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };

  const invite = async (id: string) => {
    try {
      setBusy(true);
      const result = await hiringAPI.invite(id);
      setCreateOutcome({ kind: "success", title: `دعوت‌نامه ارسال شد.${result.data.data.debugOtp ? ` کد محیط آزمایشی: ${result.data.data.debugOtp}` : ""}` });
      return true;
    } catch (cause) {
      setError(hiringError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };


  if (loading && !hasLoaded) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · جذب"
      title="جذب و پرونده‌های متقاضیان"
      description="جریان یکپارچه متقاضی، بررسی، پیشنهاد همکاری، تبدیل به پرسنل و فعال‌سازی"
      backHref="/dashboard/hr"
      metrics={[
        { label: archiveView ? "پرونده بایگانی" : "پرونده در صف", value: meta.total.toLocaleString("fa-IR"), tone: archiveView ? "warning" : "primary" },
        { label: "جایگاه فعال", value: positions.filter((item: any) => item.isActive).length.toLocaleString("fa-IR"), tone: "neutral" },
      ]}
      actions={[
        {
          label: "ایجاد متقاضی",
          icon: FaPlus,
          onClick: () => {
            setCreateError("");
            setCreateOpen(true);
          },
          tone: "success",
        },
        {
          label: archiveView ? "فهرست فعال" : "بایگانی متقاضیان",
          icon: archiveView ? FaUndo : FaArchive,
          onClick: () => commitContext({ ...filters, page: 1 }, !archiveView),
        },
        {
          label: "معیارهای مصاحبه اولیه",
          icon: FaClipboardList,
          href: "/dashboard/hr/interview-criteria",
        },
        { label: "به‌روزرسانی", icon: FaSync, onClick: () => load() },
      ]}
    >
      {error && (
        <p className="rounded-xl bg-[var(--sds-danger-surface)] p-3 text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
          {error}
        </p>
      )}
      {createOutcome && <ErpInlineState kind={createOutcome.kind} title={createOutcome.title} />}

      <ErpSheet
        open={createOpen}
        onClose={() => {
          if (createDirty) setCreateDiscardOpen(true);
          else setCreateOpen(false);
        }}
        title="ایجاد متقاضی و ارسال دعوت"
        presentation="modal"
        dismissible={!busy}
      >
        <ErpCard className="grid gap-3 p-4 sm:grid-cols-2">
          {createError && <div className="sm:col-span-2"><ErpInlineState kind="error" title={createError} /></div>}
          <ErpInput
            className={field}
            placeholder="نام"
            value={form.firstName}
            onChange={(event) =>
              setForm({ ...form, firstName: event.target.value })
            }
          />
          <ErpInput
            className={field}
            placeholder="نام خانوادگی"
            value={form.lastName}
            onChange={(event) =>
              setForm({ ...form, lastName: event.target.value })
            }
          />
          <ErpInput
            className={field}
            placeholder="شماره همراه"
            value={form.mobile}
            onChange={(event) =>
              setForm({ ...form, mobile: event.target.value })
            }
          />
          <ErpInput
            className={field}
            placeholder="کد ملی (اختیاری در دعوت)"
            value={form.nationalCode}
            onChange={(event) =>
              setForm({ ...form, nationalCode: event.target.value })
            }
          />
          <ErpSelect
            className={field}
            value={form.positionId}
            onChange={(event) =>
              setForm({ ...form, positionId: event.target.value })
            }
          >
            <option value="">انتخاب جایگاه</option>
            {positions
              .filter((position: any) => position.isActive)
              .map((position: any) => (
                <option key={position.id} value={position.id}>
                  {position.title}
                </option>
              ))}
          </ErpSelect>
          {canManageFormalAssessmentPlan && (
            <ErpCard className="grid gap-4 p-4 sm:col-span-2">
              <div>
                <p className="font-semibold text-[var(--sds-text-primary)]">تصمیم ارزیابی رسمی شرکت</p>
                <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">پیش از ساخت پرونده باید آزمون‌ها یا گزینهٔ «بدون ارزیابی رسمی» را صریحاً تعیین کنید.</p>
              </div>
              <ErpSegmentedControl
                value={assessmentDecision}
                onChange={(value) => {
                  setAssessmentDecision(value);
                  if (value === "NONE") setAssessmentKinds([]);
                }}
                options={[
                  { value: "", label: "هنوز تصمیم نگرفته‌ام" },
                  { value: "SELECT", label: "انتخاب آزمون‌ها" },
                  { value: "NONE", label: "بدون ارزیابی رسمی" },
                ]}
              />
              {assessmentDecision === "SELECT" && (
                <div className="grid gap-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {formalAssessmentOptions.map((option) => (
                      <ErpCheckbox
                        key={option.value}
                        label={option.label}
                        checked={assessmentKinds.includes(option.value)}
                        onChange={(event) => setAssessmentKinds((current) => event.target.checked
                          ? [...current, option.value]
                          : current.filter((kind) => kind !== option.value))}
                      />
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold text-[var(--sds-text-primary)]">روش اجرای مشترک برای همهٔ آزمون‌های انتخاب‌شده</p>
                    <ErpSegmentedControl
                      value={assessmentExecutionMethod}
                      onChange={setAssessmentExecutionMethod}
                      options={[
                        { value: "APPLICANT", label: "توسط متقاضی در فرم /apply" },
                        { value: "COMPANY", label: "حضوری در شرکت" },
                      ]}
                    />
                  </div>
                </div>
              )}
            </ErpCard>
          )}
          <div className="sm:col-span-2">
            <ErpButton
              label="ساخت پرونده"
              icon={FaPlus}
              disabled={
                busy ||
                !form.firstName ||
                !form.lastName ||
                !form.mobile ||
                !form.positionId ||
                (canManageFormalAssessmentPlan && (
                  !assessmentDecision ||
                  (assessmentDecision === "SELECT" && assessmentKinds.length === 0)
                ))
              }
              onClick={create}
              tone="success"
            />
          </div>
        </ErpCard>
      </ErpSheet>
      <ErpSheet
        open={createDiscardOpen}
        onClose={() => setCreateDiscardOpen(false)}
        title="صرف‌نظر از اطلاعات واردشده؟"
        presentation="modal"
        dismissible={!busy}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="ادامه ویرایش" variant="ghost" disabled={busy} onClick={() => setCreateDiscardOpen(false)} />
            <ErpButton
              label="حذف اطلاعات"
              tone="danger"
              disabled={busy}
              onClick={() => {
                setForm(blank);
                setAssessmentDecision("");
                setAssessmentKinds([]);
                setAssessmentExecutionMethod("APPLICANT");
                setCreateDiscardOpen(false);
                setCreateOpen(false);
              }}
            />
          </div>
        }
      >
        <ErpInlineState kind="stale" title="اطلاعات این فرم هنوز ذخیره نشده است." />
      </ErpSheet>

      <ErpSection
        title="صف جذب"
        description="فیلترها از همان وضعیت محاسبه‌شده در پرونده استفاده می‌کنند."
      >
        <ErpCard className="mb-4 grid gap-3 p-4 md:grid-cols-4">
          <div className="relative">
            <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sds-text-muted)]" />
            <ErpInput
              type="search"
              aria-label="جست‌وجوی پرونده‌های متقاضیان"
              className={`${field} pr-10`}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitContext({ ...filters, search: searchDraft.trim(), page: 1 });
              }}
            />
          </div>
          <ErpSelect
            className={field}
            value={filters.positionId || ""}
            onChange={(event) =>
              setFilters({
                ...filters,
                positionId: event.target.value,
                page: 1,
              })
            }
          >
            <option value="">همه شغل‌ها و جایگاه‌ها</option>
            {positions.map((position: any) => (
              <option key={position.id} value={position.id}>
                {position.title}
              </option>
            ))}
          </ErpSelect>
          <ErpSelect
            className={field}
            value={filters.disposition || ""}
            onChange={(event) =>
              setFilters({
                ...filters,
                disposition: event.target.value,
                page: 1,
              })
            }
          >
            <option value="">همه برچسب‌ها</option>
            <option value="INITIAL_REJECTED">رد اولیه</option>
            <option value="RESERVE">رد/ذخیره</option>
          </ErpSelect>
          <div className="flex gap-2">
            <ErpSelect
              className={field}
              value={filters.sortBy || "priority"}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  sortBy: event.target.value as HiringQueueFilters["sortBy"],
                  page: 1,
                })
              }
            >
              <option value="priority">
                اقدام‌های من، مسدود و آخرین تغییر
              </option>
              <option value="updatedAt">آخرین تغییر</option>
              <option value="candidateName">نام متقاضی</option>
              <option value="position">شغل و جایگاه</option>
              <option value="status">وضعیت پرونده</option>
            </ErpSelect>
            <ErpSelect
              className={field}
              value={filters.sortDirection || "desc"}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  sortDirection: event.target.value as "asc" | "desc",
                  page: 1,
                })
              }
            >
              <option value="desc">نزولی</option>
              <option value="asc">صعودی</option>
            </ErpSelect>
          </div>
          <ErpSelect
            className={field}
            value={filters.attention}
            onChange={(event) =>
              setFilters({
                ...filters,
                attention: event.target
                  .value as HiringQueueFilters["attention"],
              })
            }
          >
            <option value="">همه وضعیت‌ها</option>
            <option value="MY_ACTIONS">اقدام‌های من</option>
            <option value="BLOCKED">مسدود</option>
            <option value="WAITING">در انتظار</option>
            <option value="PAUSED">متوقف</option>
          </ErpSelect>
          <ErpSelect
            className={field}
            value={filters.phase}
            onChange={(event) =>
              setFilters({ ...filters, phase: event.target.value })
            }
          >
            <option value="">همه مراحل</option>
            {hiringLifecyclePhaseOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </ErpSelect>
          <ErpSelect
            className={field}
            value={filters.outcome}
            onChange={(event) =>
              setFilters({ ...filters, outcome: event.target.value })
            }
          >
            <option value="">فعال، متوقف و بسته (بدون استخدام‌شده)</option>
            <option value="ALL">همه پرونده‌ها با استخدام‌شده‌ها</option>
            <option value="HIRED">استخدام‌شده</option>
            <option value="REJECTED">رد شده</option>
            <option value="WITHDRAWN">انصراف متقاضی</option>
            <option value="REQUEST_CANCELLED">لغو درخواست</option>
          </ErpSelect>
          <div className="flex gap-2">
            <ErpButton
              label="اعمال فیلتر"
              icon={FaFilter}
              onClick={() => commitContext({ ...filters, search: searchDraft.trim(), page: 1 })}
              disabled={loading}
            />
            <ErpPressable
              type="button"
              className="rounded-xl border border-[var(--sds-border-default)] px-3 py-2 text-xs font-bold dark:border-[var(--sds-border-strong)]"
              onClick={() => {
                commitContext(blankFilters);
              }}
            >
              پاک‌کردن
            </ErpPressable>
          </div>
        </ErpCard>

        <ErpCard className="hidden overflow-x-auto md:block" aria-busy={loading}>
          <table className="min-w-[1250px] w-full text-right text-xs">
            <thead className="bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)]">
              <tr>
                {[
                  "متقاضی و موبایل",
                  "شغل / جایگاه",
                  "مرحله",
                  "وضعیت و برچسب",
                  "مصاحبه اولیه با HR",
                  "تأیید اولیه HR",
                  "تأیید مدیریت",
                  "اقدام بعدی / مسئول",
                  "آخرین تغییر",
                  "عملیات",
                ].map((title) => (
                  <th key={title} className="whitespace-nowrap p-3 font-black">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const summary = row.lifecycleSummary;
                const decisionKinds = [
                  "HR_INTERVIEW",
                  "HR_PRELIMINARY_APPROVAL",
                  "COMPANY_APPROVAL",
                ];
                return (
                  <tr
                    key={row.id}
                    id={`hiring-case-${row.id}`}
                    tabIndex={-1}
                    className="border-t align-top dark:border-[var(--sds-border-strong)]"
                  >
                    <td className="p-3">
                      <Link
                        className="font-black hover:text-[var(--sds-success)]"
                        href={buildHiringCaseHref(row.id, queueHref)}
                        onClick={rememberQueuePosition}
                      >
                        {row.candidate.firstName} {row.candidate.lastName}
                      </Link>
                      <span
                        className="mt-1 block font-mono text-[var(--sds-text-secondary)]"
                        dir="ltr"
                      >
                        {row.candidate.mobile}
                      </span>
                    </td>
                    <td className="p-3">
                      <b>{row.position.job?.title || "—"}</b>
                      <span className="mt-1 block text-[var(--sds-text-secondary)]">
                        {row.position.title}
                      </span>
                    </td>
                    <td className="p-3">
                      <b>{summary?.phaseTitle || hrDisplayLabel(row.stage)}</b>
                      {summary && (
                        <span className="mt-1 block text-[var(--sds-text-secondary)]">
                          مرحله {summary.phaseNumber.toLocaleString("fa-IR")} از
                          ۸
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {summary && (
                        <ErpBadge tone={badgeTone(summary.status)}>
                          {
                            hiringLifecycleStatusLabel[
                              summary.status as HiringLifecycleStatus
                            ]
                          }
                        </ErpBadge>
                      )}
                      <span className="mt-2 block">
                        {row.disposition
                          ? hrDisplayLabel(row.disposition)
                          : row.outcome
                            ? hrDisplayLabel(row.outcome)
                            : "فعال"}
                      </span>
                    </td>
                    {decisionKinds.map((kind) => {
                      const decision = row.decisions?.[kind];
                      return (
                        <td key={kind} className="p-3 text-center">
                          <ErpPressable
                            type="button"
                            className={`h-8 w-8 rounded-full text-base font-black ${decision?.outcome === "POSITIVE" ? "bg-[var(--sds-success-surface)] text-[var(--sds-success)]" : decision?.outcome === "NEGATIVE" ? "bg-[var(--sds-danger-surface)] text-[var(--sds-danger)]" : "bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]"}`}
                            disabled={!decision || !row.decisionDetailsVisible}
                            title={
                              decision
                                ? row.decisionDetailsVisible
                                  ? "نمایش شرح و سابقه تصمیم"
                                  : "جزئیات فقط برای نقش‌های مجاز قابل مشاهده است"
                                : "تصمیم ثبت نشده"
                            }
                            onClick={() =>
                              decision &&
                              row.decisionDetailsVisible &&
                              setDecisionDetail({
                                ...decision,
                                kind,
                                history: row.decisionHistory?.[kind] || [],
                                applicant: `${row.candidate.firstName} ${row.candidate.lastName}`,
                              })
                            }
                          >
                            {decision?.outcome === "POSITIVE"
                              ? "✓"
                              : decision?.outcome === "NEGATIVE"
                                ? "✕"
                                : "—"}
                          </ErpPressable>
                        </td>
                      );
                    })}
                    <td className="max-w-52 p-3">
                      {summary?.actionLabel || "—"}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {dateTimeFa(row.updatedAt)}
                    </td>
                    <td className="p-3">
                      {row.archivedAt && (
                        <p className="mb-2 max-w-56 whitespace-normal text-xs text-[var(--sds-text-secondary)]">
                          بایگانی‌شده در {dateTimeFa(row.archivedAt)} توسط{" "}
                          {row.archivedByDisplayName || "کاربر نامشخص"} · دلیل:{" "}
                          {row.archiveReason || "ثبت نشده"}
                        </p>
                      )}
                      <div className="flex flex-col gap-2">
                        <Link
                          className="rounded-lg bg-[var(--sds-surface-raised)] px-3 py-2 text-center font-bold text-[var(--sds-text-primary)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-primary)]"
                          href={buildHiringCaseHref(row.id, queueHref)}
                          onClick={rememberQueuePosition}
                        >
                          بازکردن پرونده
                        </Link>
                        {!row.archivedAt && (
                          <ErpPressable
                            type="button"
                            disabled={busy || row.stage === "CLOSED"}
                            onClick={() => setInviteTarget(row)}
                            className="rounded-lg border px-3 py-2 disabled:opacity-50"
                          >
                            ارسال مجدد دعوت
                          </ErpPressable>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <div className="p-8 text-center text-sm text-[var(--sds-text-secondary)]">
              پرونده‌ای مطابق فیلترها وجود ندارد.
            </div>
          )}
        </ErpCard>
        <div className="space-y-3 md:hidden" aria-busy={loading}>
          {rows.map((row) => {
            const summary = row.lifecycleSummary;
            const decisionKinds = [
              "HR_INTERVIEW",
              "HR_PRELIMINARY_APPROVAL",
              "COMPANY_APPROVAL",
            ];
            return (
              <div key={row.id} id={`hiring-case-${row.id}`} tabIndex={-1}>
              <ErpCard className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      className="font-black text-[var(--sds-text-primary)]"
                      href={buildHiringCaseHref(row.id, queueHref)}
                      onClick={rememberQueuePosition}
                    >
                      {row.candidate.firstName} {row.candidate.lastName}
                    </Link>
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                      {row.position.job?.title || "—"} · {row.position.title}
                    </p>
                  </div>
                  {summary && (
                    <ErpBadge tone={badgeTone(summary.status)}>
                      {hiringLifecycleStatusLabel[summary.status as HiringLifecycleStatus]}
                    </ErpBadge>
                  )}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-[var(--sds-text-muted)]">مرحله</dt>
                    <dd className="mt-1 font-bold text-[var(--sds-text-primary)]">
                      {summary?.phaseTitle || hrDisplayLabel(row.stage)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--sds-text-muted)]">اقدام بعدی</dt>
                    <dd className="mt-1 font-bold text-[var(--sds-text-primary)]">
                      {summary?.actionLabel || "—"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--sds-border-subtle)] pt-3">
                  <div className="flex gap-2" aria-label="تصمیم‌های پرونده">
                    {decisionKinds.map((kind) => {
                      const decision = row.decisions?.[kind];
                      return (
                        <ErpPressable
                          key={kind}
                          type="button"
                          disabled={!decision || !row.decisionDetailsVisible}
                          title={decision ? "نمایش تصمیم" : "تصمیم ثبت نشده"}
                          onClick={() =>
                            decision &&
                            row.decisionDetailsVisible &&
                            setDecisionDetail({
                              ...decision,
                              kind,
                              history: row.decisionHistory?.[kind] || [],
                              applicant: `${row.candidate.firstName} ${row.candidate.lastName}`,
                            })
                          }
                          className={`h-9 w-9 rounded-full text-sm font-black ${decision?.outcome === "POSITIVE" ? "bg-[var(--sds-success-surface)] text-[var(--sds-success)]" : decision?.outcome === "NEGATIVE" ? "bg-[var(--sds-danger-surface)] text-[var(--sds-danger)]" : "bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]"}`}
                        >
                          {decision?.outcome === "POSITIVE"
                            ? "✓"
                            : decision?.outcome === "NEGATIVE"
                              ? "✕"
                              : "—"}
                        </ErpPressable>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <ErpButton
                      label="بازکردن پرونده"
                      href={buildHiringCaseHref(row.id, queueHref)}
                      onClick={rememberQueuePosition}
                      variant="soft"
                    />
                    {!row.archivedAt && (
                      <ErpButton
                        label="ارسال دعوت"
                        disabled={busy || row.stage === "CLOSED"}
                        onClick={() => setInviteTarget(row)}
                        variant="ghost"
                      />
                    )}
                  </div>
                </div>
              </ErpCard>
              </div>
            );
          })}
          {!rows.length && (
            <ErpCard className="p-8 text-center text-sm text-[var(--sds-text-secondary)]">
              پرونده‌ای مطابق فیلترها وجود ندارد.
            </ErpCard>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--sds-text-secondary)]">
            {meta.total.toLocaleString("fa-IR")} پرونده · صفحه{" "}
            {meta.page.toLocaleString("fa-IR")} از{" "}
            {meta.totalPages.toLocaleString("fa-IR")}
          </span>
          <div className="flex gap-2">
            <ErpPressable
              type="submit"
              className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50"
              disabled={loading || meta.page <= 1}
              onClick={() => {
                const next = { ...filters, page: meta.page - 1 };
                commitContext(next);
              }}
            >
              صفحه قبل
            </ErpPressable>
            <ErpPressable
              type="submit"
              className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50"
              disabled={loading || meta.page >= meta.totalPages}
              onClick={() => {
                const next = { ...filters, page: meta.page + 1 };
                commitContext(next);
              }}
            >
              صفحه بعد
            </ErpPressable>
          </div>
        </div>
      </ErpSection>
      <ErpSheet
        open={Boolean(decisionDetail)}
        onClose={() => setDecisionDetail(null)}
        title="شرح تصمیم پرونده"
        presentation="modal"
      >
        {decisionDetail && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black">شرح تصمیم پرونده</h3>
                <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                  {decisionDetail.applicant} · نسخه{" "}
                  {decisionDetail.version?.toLocaleString("fa-IR")}
                </p>
              </div>
              <ErpPressable
                type="submit"
                className="rounded-lg border px-3 py-1 text-xs"
                onClick={() => setDecisionDetail(null)}
              >
                بستن
              </ErpPressable>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--sds-text-secondary)]">
                  نتیجه
                </dt>
                <dd className="font-bold">
                  {decisionDetail.outcome === "POSITIVE" ? "تأیید" : "رد"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--sds-text-secondary)]">
                  توضیح
                </dt>
                <dd>{decisionDetail.explanation || "بدون توضیح"}</dd>
              </div>
              {decisionDetail.changeReason && (
                <div>
                  <dt className="text-xs text-[var(--sds-text-secondary)]">
                    دلیل تغییر نسخه
                  </dt>
                  <dd>{decisionDetail.changeReason}</dd>
                </div>
              )}
              {decisionDetail.decidedAt && (
                <div>
                  <dt className="text-xs text-[var(--sds-text-secondary)]">
                    زمان ثبت
                  </dt>
                  <dd>{dateTimeFa(decisionDetail.decidedAt)}</dd>
                </div>
              )}
            </dl>
            {decisionDetail.history?.length > 1 && (
              <div className="mt-4 border-t pt-4">
                <b className="text-sm">سابقه نسخه‌ها</b>
                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                  {decisionDetail.history.map((item: any) => (
                    <div
                      key={`${item.kind}-${item.version}`}
                      className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 text-xs dark:bg-[var(--sds-surface-raised)]"
                    >
                      <b>
                        نسخه {item.version.toLocaleString("fa-IR")} ·{" "}
                        {item.outcome === "POSITIVE" ? "تأیید" : "رد"}
                      </b>
                      <p className="mt-1">{item.explanation || "بدون توضیح"}</p>
                      {item.changeReason && (
                        <p className="mt-1 text-[var(--sds-text-secondary)]">
                          دلیل تغییر: {item.changeReason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </ErpSheet>
      <ErpSheet
        open={Boolean(inviteTarget)}
        onClose={() => setInviteTarget(null)}
        title="ارسال دوباره دعوت‌نامه"
        presentation="modal"
        dismissible={!busy}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => setInviteTarget(null)} />
            <ErpButton
              label="ارسال دعوت‌نامه جدید"
              tone="primary"
              disabled={busy}
              onClick={async () => {
                if (await invite(inviteTarget.id)) setInviteTarget(null);
              }}
            />
          </div>
        }
      >
        <ErpInlineState
          kind="stale"
          title={`کد ورود جدید برای ${inviteTarget?.candidate?.firstName || "متقاضی"} صادر می‌شود و کدهای قبلی دیگر مبنای ورود نخواهند بود.`}
        />
      </ErpSheet>
    </ErpPage>
  );
}
