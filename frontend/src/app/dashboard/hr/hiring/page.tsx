"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  FaCog,
  FaFilter,
  FaPaperPlane,
  FaPlus,
  FaSync,
  FaUserPlus,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpLoading,
  ErpPage,
  ErpSection,
} from "@/components/erp";
import { hrAPI } from "@/lib/api";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
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

  const load = async (nextFilters: HiringQueueFilters = filters) => {
    try {
      setLoading(true);
      setError("");
      const [cases, foundation] = await Promise.all([
        hiringAPI.list(buildHiringQueueParams(nextFilters)),
        hrAPI.getFoundation(),
      ]);
      setRows(cases.data.data);
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
  }, []);

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

  if (loading && !rows.length) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · جذب"
      title="جذب و پرونده‌های متقاضیان"
      description="جریان یکپارچه متقاضی، بررسی، پیشنهاد همکاری، تبدیل به پرسنل و فعال‌سازی"
      backHref="/dashboard/hr"
      actions={[
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
            <option value="">همه نتایج</option>
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

        <div className="grid gap-3 xl:grid-cols-2" aria-busy={loading}>
          {rows.map((row) => {
            const summary = row.lifecycleSummary;
            return (
              <ErpCard key={row.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/dashboard/hr/hiring/${row.id}`}
                      className="font-black hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      {row.candidate.firstName} {row.candidate.lastName}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.position.title} · {row.candidate.mobile}
                    </p>
                  </div>
                  {summary && (
                    <ErpBadge tone={badgeTone(summary.status)}>
                      {
                        hiringLifecycleStatusLabel[
                          summary.status as HiringLifecycleStatus
                        ]
                      }
                    </ErpBadge>
                  )}
                </div>
                {summary && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-black">{summary.phaseTitle}</p>
                      <span className="text-xs text-slate-500">
                        مرحله{" "}
                        {Number(summary.phaseNumber).toLocaleString("fa-IR")} از
                        ۷
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                      {summary.requiredComplete.toLocaleString("fa-IR")} از{" "}
                      {summary.requiredTotal.toLocaleString("fa-IR")} مورد
                      الزامی
                    </p>
                    {summary.actionLabel && (
                      <p className="mt-2 text-xs font-bold text-teal-700 dark:text-teal-300">
                        اقدام بعدی: {summary.actionLabel}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900"
                    href={`/dashboard/hr/hiring/${row.id}`}
                  >
                    باز کردن پرونده
                  </Link>
                  <button
                    disabled={busy || row.stage === "CLOSED"}
                    onClick={() => invite(row.id)}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
                  >
                    <FaPaperPlane /> ارسال مجدد دعوت
                  </button>
                </div>
              </ErpCard>
            );
          })}
          {!rows.length && (
            <ErpEmptyState
              icon={FaUserPlus}
              title="پرونده‌ای مطابق فیلتر وجود ندارد"
              description="فیلترها را تغییر دهید یا اولین متقاضی را ثبت کنید."
            />
          )}
        </div>
      </ErpSection>
    </ErpPage>
  );
}
