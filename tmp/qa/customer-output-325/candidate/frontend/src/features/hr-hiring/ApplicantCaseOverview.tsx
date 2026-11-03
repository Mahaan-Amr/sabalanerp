"use client";

import { useEffect, useState } from "react";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpFieldView,
  ErpInlineState,
  ErpSheet,
} from "@/components/erp";
import { dateFa, dateTimeFa } from "@/features/hr/hrUi";
import { hrDisplayLabel } from "@/features/hr/hrDisplay";
import { hiringAPI, hiringError } from "@/lib/hiringApi";

const groupLabels: Record<string, string> = {
  PROFILE_IDENTITY: "هویت، تماس، سکونت و خانواده",
  EXPERIENCE_QUALIFICATIONS: "تجربه و صلاحیت‌ها",
  APPLICATION_ANSWERS: "پاسخ‌های فرم درخواست",
  DOCUMENT_EVIDENCE: "مدارک و شواهد",
};

export function ApplicantCaseOverview({ applicationId, returnTo }: { applicationId: string; returnTo?: string }) {
  const [overview, setOverview] = useState<any>();
  const [closure, setClosure] = useState<any>();
  const [closureOpen, setClosureOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    hiringAPI.getOverview(applicationId, returnTo)
      .then((response) => setOverview(response.data.data))
      .catch((cause) => setError(hiringError(cause)));
  }, [applicationId, returnTo]);

  const openClosure = async () => {
    try {
      setError("");
      const response = await hiringAPI.getClosureSummary(applicationId);
      setClosure(response.data.data);
      setClosureOpen(true);
    } catch (cause) {
      setError(hiringError(cause));
    }
  };

  return (
    <ErpCard className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-[var(--sds-text-secondary)]">نمای کلی پرونده متقاضی</p>
          <h2 className="mt-1 text-lg font-black text-[var(--sds-text-primary)]">
            {overview?.candidateName || "در حال بارگذاری…"}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {overview?.outcome && (
            <ErpButton label="جزئیات پایان پرونده" variant="soft" tone="warning" onClick={openClosure} />
          )}
          <ErpButton
            label="اطلاعات کامل متقاضی"
            href={`/dashboard/hr/hiring/${applicationId}/information${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
            variant="outline"
          />
        </div>
      </div>
      {error && <ErpInlineState kind="error" title={error} />}
      {overview && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ErpFieldView label="جایگاه" value={overview.position?.title || "—"} />
            <ErpFieldView label="مرحله" value={hrDisplayLabel(overview.stage)} />
            <ErpFieldView label="نتیجه" value={overview.outcome ? hrDisplayLabel(overview.outcome) : "پرونده فعال"} />
            <ErpFieldView
              label="شماره تماس"
              value={overview.contact?.restricted ? "محدود به مجوز گروه اطلاعات" : overview.contact?.mobile || "—"}
              tone={overview.contact?.restricted ? "neutral" : "info"}
            />
          </div>
          <div className="flex flex-wrap gap-2" aria-label="دسترسی گروه‌های اطلاعات متقاضی">
            {overview.informationGroups.map((group: any) => (
              <ErpBadge key={group.key} tone={group.status === "AVAILABLE" ? "success" : "neutral"}>
                {groupLabels[group.key]} · {group.status === "AVAILABLE" ? "قابل مشاهده" : "محدود"}
              </ErpBadge>
            ))}
          </div>
        </>
      )}
      <ErpSheet open={closureOpen} onClose={() => setClosureOpen(false)} title="جزئیات پایان پرونده" presentation="modal">
        {!closure?.available ? (
          <ErpInlineState kind="empty" title="شاهد بسته‌شدن برای این پرونده ثبت نشده است." />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ErpFieldView label="نتیجه نهایی" value={hrDisplayLabel(closure.outcome)} />
              {closure.outcome === "HIRED" ? (
                <>
                  <ErpFieldView label="نوع پایان" value="تبدیل متقاضی به پرسنل" />
                  <ErpFieldView label="ثبت‌کننده تبدیل" value={closure.closedBy} />
                  <ErpFieldView label="زمان تبدیل" value={dateTimeFa(closure.closedAt)} />
                  <ErpFieldView label="پرسنل متصل‌شده" value={closure.personnel?.displayName || "—"} />
                  <ErpFieldView label="تاریخ برنامه‌ریزی‌شده شروع" value={closure.scheduledStartDate ? dateFa(closure.scheduledStartDate) : "—"} />
                  <ErpFieldView label="وضعیت رابطه استخدامی" value={hrDisplayLabel(closure.relationshipStatus)} />
                  {closure.previousStage && <ErpFieldView label="مرحله پیش از تبدیل" value={hrDisplayLabel(closure.previousStage)} />}
                  {closure.activatedAt && (
                    <>
                      <ErpFieldView label="زمان فعال‌سازی" value={dateTimeFa(closure.activatedAt)} />
                      <ErpFieldView label="فعال‌کننده" value={closure.activatedBy} />
                    </>
                  )}
                </>
              ) : (
                <>
                  <ErpFieldView label="مرحله پیش از بسته‌شدن" value={hrDisplayLabel(closure.previousStage)} />
                  <ErpFieldView label="ثبت‌کننده" value={closure.closedBy} />
                  <ErpFieldView label="زمان ثبت" value={dateTimeFa(closure.closedAt)} />
                </>
              )}
            </div>
            {closure.outcome === "HIRED" ? (
              closure.personnel?.href && <ErpButton label="مشاهده پرونده پرسنلی" href={closure.personnel.href} tone="success" variant="outline" />
            ) : closure.explanationRestricted ? (
              <ErpInlineState kind="permission" title="شرح تصمیم برای مجوز فعلی قابل مشاهده نیست." />
            ) : (
              <ErpFieldView label="شرح تصمیم" value={closure.explanation || "بدون شرح"} />
            )}
          </div>
        )}
      </ErpSheet>
    </ErpCard>
  );
}
