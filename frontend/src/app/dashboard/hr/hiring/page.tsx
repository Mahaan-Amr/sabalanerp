"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  FaCog,
  FaArchive,
  FaFilter,
  FaPlus,
  FaSync,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpLoading,
  ErpPage,
  ErpSection,
} from "@/components/erp";
import { hrAPI } from "@/lib/api";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
import { dateTimeFa } from "@/features/hr/hrUi";
import { hrDisplayLabel } from "@/features/hr/hrDisplay";
import PermanentDeletionDialog from "@/features/hr/PermanentDeletionDialog";
import {
  hiringLifecyclePhaseOptions,
  hiringLifecycleStatusLabel,
  type HiringLifecycleStatus,
} from "@/features/hr-hiring/hiringLifecycleViewModel";
import {
  buildHiringQueueParams,
  type HiringQueueFilters,
} from "@/features/hr-hiring/hiringQueueViewModel";

const blank = {
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
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900";
const badgeTone = (status: HiringLifecycleStatus) => {
  if (status === "COMPLETED") return "success";
  if (status === "ACTION_REQUIRED") return "info";
  if (status === "WAITING") return "warning";
  if (status === "BLOCKED") return "danger";
  return "neutral";
};

export default function HiringCasesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [form, setForm] = useState(blank);
  const [filters, setFilters] = useState<HiringQueueFilters>(blankFilters);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [decisionDetail, setDecisionDetail] = useState<any>(null);
  const [archiveView, setArchiveView] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<any>(null);

  const load = async (nextFilters: HiringQueueFilters = filters) => {
    try {
      setLoading(true);
      setError("");
      const [cases, foundation] = await Promise.all([
        hiringAPI.list({ ...buildHiringQueueParams(nextFilters), archived: String(archiveView) }),
        hrAPI.getFoundation(),
      ]);
      setRows(cases.data.data);
      setMeta(cases.data.meta || { page: 1, totalPages: 1, total: cases.data.data.length });
      setPositions(foundation.data.data.positions || []);
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(blankFilters);
    // Initial queue load intentionally uses the stable empty filter set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveView]);

  const create = async () => {
    try {
      setBusy(true);
      setError("");
      const result = await hiringAPI.create(form);
      const invitation = await hiringAPI.invite(result.data.data.id);
      setMessage(
        `پرونده و دعوت‌نامه ساخته شد.${invitation.data.data.debugOtp ? ` کد محیط آزمایشی: ${invitation.data.data.debugOtp}` : ""}`,
      );
      setForm(blank);
      await load();
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };

  const invite = async (id: string) => {
    try {
      setBusy(true);
      const result = await hiringAPI.invite(id);
      setMessage(
        `دعوت‌نامه ارسال شد.${result.data.data.debugOtp ? ` کد محیط آزمایشی: ${result.data.data.debugOtp}` : ""}`,
      );
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeArchiveState = async (row: any) => {
    const reason = window.prompt(row.archivedAt ? "دلیل بازیابی از بایگانی" : "دلیل بایگانی پرونده");
    if (!reason?.trim()) return;
    try {
      setBusy(true);
      setError("");
      if (row.archivedAt) await hiringAPI.restore(row.id, reason.trim());
      else await hiringAPI.archive(row.id, reason.trim());
      setMessage(row.archivedAt ? "پرونده از بایگانی بازیابی شد." : "پرونده بایگانی شد.");
      await load();
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };

  const permanentlyDelete = async (row: any) => {
    try {
      setBusy(true);
      setError("");
      const preview = (await hiringAPI.getDeletionPreview(row.id)).data.data;
      setDeletionTarget({ row, preview });
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmPermanentDeletion = async (payload: any) => {
    if (!deletionTarget) return;
    try {
      setBusy(true); setError("");
      await hiringAPI.permanentlyDelete(deletionTarget.row.id, payload);
      setDeletionTarget(null);
      setMessage("پرونده به‌صورت دائمی حذف شد.");
      await load();
    } catch (cause) { setError(hiringError(cause)); }
    finally { setBusy(false); }
  };

  if (loading && !rows.length) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · جذب"
      title="جذب و پرونده‌های متقاضیان"
      description="جریان یکپارچه متقاضی، بررسی، پیشنهاد همکاری، تبدیل به پرسنل و فعال‌سازی"
      backHref="/dashboard/hr"
      actions={[
        {
          label: archiveView ? "فهرست فعال" : "بایگانی متقاضیان",
          icon: archiveView ? FaUndo : FaArchive,
          onClick: () => setArchiveView((value) => !value),
        },
        {
          label: "اختیارها",
          icon: FaCog,
          href: "/dashboard/hr/hiring/authorities",
        },
        { label: "به‌روزرسانی", icon: FaSync, onClick: () => load() },
      ]}
    >
      {error && (
        <p className="rounded-xl bg-rose-50 p-3 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-xl bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
          {message}
        </p>
      )}

      <ErpSection
        title="ایجاد متقاضی و ارسال دعوت"
        description="کد ورود شش‌رقمی و نشانی ثابت sabalanerp.com/apply برای شماره همراه ثبت‌شده ارسال می‌شود و هفت روز اعتبار دارد."
      >
        <ErpCard className="grid gap-3 p-4 md:grid-cols-5">
          <input
            className={field}
            placeholder="نام"
            value={form.firstName}
            onChange={(event) =>
              setForm({ ...form, firstName: event.target.value })
            }
          />
          <input
            className={field}
            placeholder="نام خانوادگی"
            value={form.lastName}
            onChange={(event) =>
              setForm({ ...form, lastName: event.target.value })
            }
          />
          <input
            className={field}
            placeholder="شماره همراه"
            value={form.mobile}
            onChange={(event) =>
              setForm({ ...form, mobile: event.target.value })
            }
          />
          <input
            className={field}
            placeholder="کد ملی (اختیاری در دعوت)"
            value={form.nationalCode}
            onChange={(event) =>
              setForm({ ...form, nationalCode: event.target.value })
            }
          />
          <select
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
          </select>
          <div className="md:col-span-5">
            <ErpButton
              label="ساخت پرونده و ارسال دعوت"
              icon={FaPlus}
              disabled={
                busy ||
                !form.firstName ||
                !form.lastName ||
                !form.mobile ||
                !form.positionId
              }
              onClick={create}
              tone="success"
            />
          </div>
        </ErpCard>
      </ErpSection>

      <ErpSection
        title="صف جذب"
        description="فیلترها از همان وضعیت محاسبه‌شده در پرونده استفاده می‌کنند."
      >
        <ErpCard className="mb-4 grid gap-3 p-4 md:grid-cols-4">
          <input
            className={field}
            placeholder="جست‌وجوی نام، نام خانوادگی، موبایل یا کد ملی"
            value={filters.search || ""}
            onChange={(event) =>
              setFilters({ ...filters, search: event.target.value, page: 1 })
            }
          />
          <select
            className={field}
            value={filters.positionId || ""}
            onChange={(event) =>
              setFilters({ ...filters, positionId: event.target.value, page: 1 })
            }
          >
            <option value="">همه شغل‌ها و جایگاه‌ها</option>
            {positions.map((position: any) => (
              <option key={position.id} value={position.id}>
                {position.title}
              </option>
            ))}
          </select>
          <select
            className={field}
            value={filters.disposition || ""}
            onChange={(event) =>
              setFilters({ ...filters, disposition: event.target.value, page: 1 })
            }
          >
            <option value="">همه برچسب‌ها</option>
            <option value="INITIAL_REJECTED">رد اولیه</option>
            <option value="RESERVE">رد/ذخیره</option>
          </select>
          <div className="flex gap-2">
            <select
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
              <option value="priority">اقدام‌های من، مسدود و آخرین تغییر</option>
              <option value="updatedAt">آخرین تغییر</option>
              <option value="candidateName">نام متقاضی</option>
              <option value="position">شغل و جایگاه</option>
              <option value="status">وضعیت پرونده</option>
            </select>
            <select
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
            </select>
          </div>
          <select
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
          </select>
          <select
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
          </select>
          <select
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
          </select>
          <div className="flex gap-2">
            <ErpButton
              label="اعمال فیلتر"
              icon={FaFilter}
              onClick={() => load(filters)}
              disabled={loading}
            />
            <button
              type="button"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-700"
              onClick={() => {
                setFilters(blankFilters);
                void load(blankFilters);
              }}
            >
              پاک‌کردن
            </button>
          </div>
        </ErpCard>

        <ErpCard className="overflow-x-auto" aria-busy={loading}>
          <table className="min-w-[1250px] w-full text-right text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800">
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
                  <tr key={row.id} className="border-t align-top dark:border-slate-800">
                    <td className="p-3">
                      <Link className="font-black hover:text-emerald-600" href={`/dashboard/hr/hiring/${row.id}`}>
                        {row.candidate.firstName} {row.candidate.lastName}
                      </Link>
                      <span className="mt-1 block font-mono text-slate-500" dir="ltr">
                        {row.candidate.mobile}
                      </span>
                    </td>
                    <td className="p-3">
                      <b>{row.position.job?.title || "—"}</b>
                      <span className="mt-1 block text-slate-500">{row.position.title}</span>
                    </td>
                    <td className="p-3">
                      <b>{summary?.phaseTitle || hrDisplayLabel(row.stage)}</b>
                      {summary && <span className="mt-1 block text-slate-500">مرحله {summary.phaseNumber.toLocaleString("fa-IR")} از ۸</span>}
                    </td>
                    <td className="p-3">
                      {summary && <ErpBadge tone={badgeTone(summary.status)}>{hiringLifecycleStatusLabel[summary.status as HiringLifecycleStatus]}</ErpBadge>}
                      <span className="mt-2 block">{row.disposition ? hrDisplayLabel(row.disposition) : row.outcome ? hrDisplayLabel(row.outcome) : "فعال"}</span>
                    </td>
                    {decisionKinds.map((kind) => {
                      const decision = row.decisions?.[kind];
                      return (
                        <td key={kind} className="p-3 text-center">
                          <button
                            type="button"
                            className={`h-8 w-8 rounded-full text-base font-black ${decision?.outcome === "POSITIVE" ? "bg-emerald-100 text-emerald-700" : decision?.outcome === "NEGATIVE" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-400"}`}
                            disabled={!decision || !row.decisionDetailsVisible}
                            title={decision ? row.decisionDetailsVisible ? "نمایش شرح و سابقه تصمیم" : "جزئیات فقط برای نقش‌های مجاز قابل مشاهده است" : "تصمیم ثبت نشده"}
                            onClick={() => decision && row.decisionDetailsVisible && setDecisionDetail({ ...decision, kind, history: row.decisionHistory?.[kind] || [], applicant: `${row.candidate.firstName} ${row.candidate.lastName}` })}
                          >
                            {decision?.outcome === "POSITIVE" ? "✓" : decision?.outcome === "NEGATIVE" ? "✕" : "—"}
                          </button>
                        </td>
                      );
                    })}
                    <td className="max-w-52 p-3">
                      {summary?.actionLabel || "—"}
                    </td>
                    <td className="whitespace-nowrap p-3">{dateTimeFa(row.updatedAt)}</td>
                    <td className="p-3">
                      {row.archivedAt && (
                        <p className="mb-2 max-w-56 whitespace-normal text-xs text-slate-500">
                          بایگانی‌شده در {dateTimeFa(row.archivedAt)} توسط {row.archivedByDisplayName || "کاربر نامشخص"} · دلیل: {row.archiveReason || "ثبت نشده"}
                        </p>
                      )}
                      <div className="flex flex-col gap-2">
                        <Link className="rounded-lg bg-slate-900 px-3 py-2 text-center font-bold text-white dark:bg-slate-100 dark:text-slate-900" href={`/dashboard/hr/hiring/${row.id}`}>
                          بازکردن پرونده
                        </Link>
                        {!row.archivedAt && <button
                          disabled={busy || row.stage === "CLOSED"}
                          onClick={() => invite(row.id)}
                          className="rounded-lg border px-3 py-2 disabled:opacity-50"
                        >
                          ارسال مجدد دعوت
                        </button>}
                        {(row.retentionCapabilities?.canArchive || row.retentionCapabilities?.canRestore) && (
                          <button
                            disabled={busy}
                            onClick={() => changeArchiveState(row)}
                            className="rounded-lg border border-amber-500 px-3 py-2 font-bold text-amber-700 disabled:opacity-50"
                          >
                            {row.archivedAt ? "بازیابی از بایگانی" : "بایگانی"}
                          </button>
                        )}
                        {row.retentionCapabilities?.canPermanentlyDelete && (
                          <button
                            disabled={busy}
                            onClick={() => permanentlyDelete(row)}
                            className="rounded-lg border border-rose-600 px-3 py-2 font-bold text-rose-700 disabled:opacity-50"
                          >
                            <FaTrash className="ml-1 inline" /> حذف دائمی
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <div className="p-8 text-center text-sm text-slate-500">پرونده‌ای مطابق فیلترها وجود ندارد.</div>
          )}
        </ErpCard>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {meta.total.toLocaleString("fa-IR")} پرونده · صفحه {meta.page.toLocaleString("fa-IR")} از {meta.totalPages.toLocaleString("fa-IR")}
          </span>
          <div className="flex gap-2">
            <button className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50" disabled={loading || meta.page <= 1} onClick={() => { const next = { ...filters, page: meta.page - 1 }; setFilters(next); void load(next); }}>صفحه قبل</button>
            <button className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50" disabled={loading || meta.page >= meta.totalPages} onClick={() => { const next = { ...filters, page: meta.page + 1 }; setFilters(next); void load(next); }}>صفحه بعد</button>
          </div>
        </div>

      </ErpSection>
      {decisionDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <ErpCard className="w-full max-w-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black">شرح تصمیم پرونده</h3>
                <p className="mt-1 text-xs text-slate-500">{decisionDetail.applicant} · نسخه {decisionDetail.version?.toLocaleString("fa-IR")}</p>
              </div>
              <button className="rounded-lg border px-3 py-1 text-xs" onClick={() => setDecisionDetail(null)}>بستن</button>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-xs text-slate-500">نتیجه</dt><dd className="font-bold">{decisionDetail.outcome === "POSITIVE" ? "تأیید" : "رد"}</dd></div>
              <div><dt className="text-xs text-slate-500">توضیح</dt><dd>{decisionDetail.explanation || "بدون توضیح"}</dd></div>
              {decisionDetail.changeReason && <div><dt className="text-xs text-slate-500">دلیل تغییر نسخه</dt><dd>{decisionDetail.changeReason}</dd></div>}
              {decisionDetail.decidedAt && <div><dt className="text-xs text-slate-500">زمان ثبت</dt><dd>{dateTimeFa(decisionDetail.decidedAt)}</dd></div>}
            </dl>
            {decisionDetail.history?.length > 1 && (
              <div className="mt-4 border-t pt-4">
                <b className="text-sm">سابقه نسخه‌ها</b>
                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                  {decisionDetail.history.map((item: any) => (
                    <div key={`${item.kind}-${item.version}`} className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">
                      <b>نسخه {item.version.toLocaleString("fa-IR")} · {item.outcome === "POSITIVE" ? "تأیید" : "رد"}</b>
                      <p className="mt-1">{item.explanation || "بدون توضیح"}</p>
                      {item.changeReason && <p className="mt-1 text-slate-500">دلیل تغییر: {item.changeReason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ErpCard>
        </div>
      )}
      {deletionTarget && (
        <PermanentDeletionDialog
          title="حذف دائمی پرونده متقاضی"
          preview={deletionTarget.preview}
          busy={busy}
          onClose={() => setDeletionTarget(null)}
          onConfirm={confirmPermanentDeletion}
        />
      )}
    </ErpPage>
  );
}
