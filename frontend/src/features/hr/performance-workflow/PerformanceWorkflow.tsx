"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpSummaryGrid,
  ErpTextarea,
} from "@/components/erp";
import { personnelPerformanceAPI } from "@/lib/api";
import {
  buildSupervisorDraft,
  hasCompleteEvidence,
  workflowStatusPresentation,
  type SupervisorResponseDraft,
} from "./performanceWorkflowModel";

type Surface = "supervisor" | "review" | "lifecycle" | "readiness";
type SectionRow = {
  id: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string;
  submissionDueAt: string | null;
  reviewDueAt: string | null;
  personnel: { displayName: string };
};
type ReviewRow = { id: string; sectionId: string; version: number; submittedAt: string; reviewDueAt: string | null };
type LifecycleRow = SectionRow & { evaluationId: string; evaluationStatus: string; hasAcceptedResult: boolean };
type LifecycleAction = { kind: "extend" | "not-evaluable" | "cancel" | "invalidate"; row: LifecycleRow };
type Criterion = {
  criterionVersionId: string;
  titleFa: string;
  meaningFa: string;
  kind: "JUDGMENT" | "KPI_EVIDENCE" | "EXPLANATORY" | "BINARY_GATE";
  anchorsFa: string[];
  evidence: { minimumReliableCount: number; required: boolean; allowedKinds: string[] };
};
type FormDefinition = { categories: Array<{ id: string; titleFa: string; templateTitleFa: string; criteria: Criterion[] }> };
type SupervisorDetail = {
  section: SectionRow & { evaluationId: string };
  form: FormDefinition;
  draft: null | { revision: number; status: string; content: { narrative?: string; responses?: Array<{ criterionVersionId: string; grade?: number; evidence?: Array<Record<string, string>> }> } };
  review: null | { decision: string; decidedAt: string };
};
type ReviewDetail = {
  submission: { id: string; version: number; submittedAt: string };
  section: { id: string; evaluationId: string; effectiveFrom: string; effectiveTo: string; reviewDueAt: string | null };
  content: { narrative?: string; responses?: Array<{ criterionVersionId: string; grade?: number; evidence?: Array<Record<string, string>> }> };
  form: FormDefinition;
};

const errorMessage = (cause: unknown) => {
  const response = cause && typeof cause === "object" && "response" in cause
    ? (cause as { response?: { data?: { message?: string } } }).response
    : undefined;
  return response?.data?.message || "عملیات انجام نشد. اطلاعات را بررسی و دوباره تلاش کنید.";
};

const faDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(value))
  : "ثبت نشده";

const localDateTimeValue = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const defaultResponse = (): SupervisorResponseDraft => ({
  evidenceKind: "STRUCTURED_OBSERVATION",
  evidenceQuality: "RELIABLE",
  evidenceReference: "",
  sourceVersion: "",
  occurredAt: "",
  contentHash: "",
});

export default function PerformanceWorkflow({ initialSectionId, initialSubmissionId }: {
  initialSectionId?: string;
  initialSubmissionId?: string;
}) {
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [surface, setSurface] = useState<Surface>(initialSubmissionId ? "review" : initialSectionId ? "supervisor" : "supervisor");
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [lifecycleSections, setLifecycleSections] = useState<LifecycleRow[]>([]);
  const [supervisorDetail, setSupervisorDetail] = useState<SupervisorDetail>();
  const [reviewDetail, setReviewDetail] = useState<ReviewDetail>();
  const [responses, setResponses] = useState<Record<string, SupervisorResponseDraft>>({});
  const [narrative, setNarrative] = useState("");
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED" | "NOT_EVALUABLE">();
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionCategory, setDecisionCategory] = useState("");
  const [measurementFrom, setMeasurementFrom] = useState("");
  const [measurementTo, setMeasurementTo] = useState("");
  const [readinessRun, setReadinessRun] = useState<Record<string, unknown>>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction>();
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleDueAt, setLifecycleDueAt] = useState("");
  const [lifecycleCategory, setLifecycleCategory] = useState("SUBMISSION_IMPOSSIBLE");

  const canSubmit = Boolean(capabilities.SUBMIT_PERFORMANCE_EVALUATION);
  const canReview = Boolean(capabilities.REVIEW_PERFORMANCE_EVALUATION);
  const canManage = Boolean(capabilities.MANAGE_PERFORMANCE_CYCLE);
  const canPause = Boolean(capabilities.PAUSE_PERFORMANCE_EVALUATION);
  const canUseLifecycle = canManage || canReview || canPause;

  const loadDetail = useCallback(async (sectionId?: string, submissionId?: string) => {
    if (sectionId) {
      const response = await personnelPerformanceAPI.supervisorSection(sectionId);
      const detail = response.data as SupervisorDetail;
      setSupervisorDetail(detail);
      setNarrative(detail.draft?.content.narrative ?? "");
      const next: Record<string, SupervisorResponseDraft> = {};
      for (const category of detail.form.categories) for (const criterion of category.criteria) next[criterion.criterionVersionId] = defaultResponse();
      for (const saved of detail.draft?.content.responses ?? []) {
        const evidence = saved.evidence?.[0];
        next[saved.criterionVersionId] = {
          ...defaultResponse(),
          ...(saved.grade ? { grade: saved.grade as 1 | 2 | 3 | 4 | 5 } : {}),
          evidenceKind: (evidence?.kind as SupervisorResponseDraft["evidenceKind"]) || "STRUCTURED_OBSERVATION",
          evidenceQuality: (evidence?.quality as SupervisorResponseDraft["evidenceQuality"]) || "RELIABLE",
          evidenceReference: evidence?.referenceId || "",
          sourceVersion: evidence?.sourceVersion || "",
          occurredAt: localDateTimeValue(evidence?.occurredAt),
          contentHash: evidence?.contentHash || "",
        };
      }
      setResponses(next);
    }
    if (submissionId) {
      const response = await personnelPerformanceAPI.review(submissionId);
      setReviewDetail(response.data as ReviewDetail);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const capabilityResponse = await personnelPerformanceAPI.capabilities();
      const nextCapabilities = capabilityResponse.data.capabilities ?? {};
      setCapabilities(nextCapabilities);
      const requests: Promise<unknown>[] = [];
      if (nextCapabilities.SUBMIT_PERFORMANCE_EVALUATION) requests.push(personnelPerformanceAPI.supervisorSections().then((response) => setSections(response.data.sections ?? [])));
      if (nextCapabilities.REVIEW_PERFORMANCE_EVALUATION) requests.push(personnelPerformanceAPI.reviews().then((response) => setReviews(response.data.reviews ?? [])));
      if (nextCapabilities.MANAGE_PERFORMANCE_CYCLE || nextCapabilities.REVIEW_PERFORMANCE_EVALUATION || nextCapabilities.PAUSE_PERFORMANCE_EVALUATION) requests.push(personnelPerformanceAPI.lifecycleSections().then((response) => setLifecycleSections(response.data.sections ?? [])));
      await Promise.all(requests);
      await loadDetail(initialSectionId, initialSubmissionId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [initialSectionId, initialSubmissionId, loadDetail]);

  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<unknown>, message: string, reload = true) => {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await work();
      setSuccess(message);
      if (reload) await load();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  };

  const criteria = useMemo(() => supervisorDetail?.form.categories.flatMap((category) => category.criteria) ?? [], [supervisorDetail]);
  const draftComplete = criteria.every((criterion) => criterion.kind !== "JUDGMENT" || responses[criterion.criterionVersionId]?.grade)
    && criteria.every((criterion) => !criterion.evidence.required || hasCompleteEvidence(responses[criterion.criterionVersionId] ?? defaultResponse()));

  if (loading && !Object.keys(capabilities).length) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · ارزیابی محرمانه عملکرد"
      title="گردش ارزیابی عملکرد"
      description="هر بخش فقط برای سرپرست مسئول و بررسی‌کننده مجاز نمایش داده می‌شود."
      backHref="/dashboard/hr/personnel"
      actions={[{ label: 'تحلیل و خروجی', href: '/dashboard/hr/personnel/performance/insights', tone: 'neutral' }]}
      metrics={[
        { label: "وظیفه سرپرست", value: sections.filter(({ status }) => ["DRAFT", "REJECTED"].includes(status)).length.toLocaleString("fa-IR"), tone: "warning" },
        { label: "آماده بررسی", value: reviews.length.toLocaleString("fa-IR"), tone: "info" },
        { label: "پرونده باز", value: (sections.length + reviews.length).toLocaleString("fa-IR"), tone: "neutral" },
      ]}
    >
      {error && <ErpInlineState kind="error" title={error} action={{ label: "تلاش دوباره", onClick: () => void load() }} />}
      {success && <ErpInlineState kind="success" title={success} />}
      {!canSubmit && !canReview && !canManage && !canPause && <ErpInlineState kind="permission" title="هیچ مجوز فعال برای گردش ارزیابی عملکرد ندارید." />}
      <ErpSegmentedControl value={surface} onChange={setSurface} options={[
        { value: "supervisor", label: "ارزیابی‌های من", count: sections.length, disabled: !canSubmit },
        { value: "review", label: "صف بررسی", count: reviews.length, disabled: !canReview },
        { value: "lifecycle", label: "اقدام‌های منابع انسانی", count: lifecycleSections.length, disabled: !canUseLifecycle },
        { value: "readiness", label: "آمادگی و چرخه", disabled: !canManage },
      ]} />

      {surface === "supervisor" && canSubmit && !supervisorDetail && <ErpSection title="بخش‌های مسئولیت من">
        <div className="space-y-3">
          {!sections.length && <ErpInlineState kind="empty" title="بخش ارزیابی فعالی برای شما وجود ندارد." />}
          {sections.map((section) => {
            const status = workflowStatusPresentation(section.status);
            return <ErpCard key={section.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{section.personnel.displayName}</p><ErpBadge tone={status.tone}>{status.label}</ErpBadge></div>
                  <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">بازه {faDate(section.effectiveFrom)} تا {faDate(section.effectiveTo)} · مهلت {faDate(section.submissionDueAt)}</p>
                </div>
                <ErpButton label={section.status === "REJECTED" ? "اصلاح ارزیابی" : "بازکردن ارزیابی"} href={`/dashboard/hr/personnel/performance/supervisor/${section.id}`} />
              </div>
            </ErpCard>;
          })}
        </div>
      </ErpSection>}

      {surface === "supervisor" && canSubmit && supervisorDetail && <>
        <ErpSection title="ثبت قضاوت سرپرست" description={`بازه ${faDate(supervisorDetail.section.effectiveFrom)} تا ${faDate(supervisorDetail.section.effectiveTo)}`} actions={[{ label: "بازگشت به فهرست", href: "/dashboard/hr/personnel/performance" }] }>
          {supervisorDetail.review?.decision === "REJECTED" && <ErpInlineState kind="stale" title="این ارسال برای اصلاح بازگردانده شده است." />}
          <div className="space-y-4">
            {supervisorDetail.form.categories.map((category) => <ErpCard key={category.id} className="p-4">
              <p className="font-semibold">{category.titleFa}</p>
              <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{category.templateTitleFa}</p>
              <div className="mt-4 space-y-5">{category.criteria.map((criterion) => {
                const current = responses[criterion.criterionVersionId] ?? defaultResponse();
                return <div key={criterion.criterionVersionId} className="space-y-3 border-t border-[var(--sds-border-subtle)] pt-4 first:border-0 first:pt-0">
                  <div><p className="font-medium">{criterion.titleFa}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{criterion.meaningFa}</p></div>
                  {criterion.kind === "JUDGMENT" && <ErpField label="درجه توصیفی عملکرد" required>
                    <ErpSegmentedControl value={current.grade ? String(current.grade) : ""} onChange={(value) => setResponses((items) => ({ ...items, [criterion.criterionVersionId]: { ...current, grade: Number(value) as 1 | 2 | 3 | 4 | 5 } }))} options={criterion.anchorsFa.map((anchor, index) => ({ value: String(index + 1), label: anchor }))} />
                  </ErpField>}
                  <div className="grid gap-3 md:grid-cols-2">
                    <ErpField label="نوع شاهد" required={criterion.evidence.required}><ErpSelect value={current.evidenceKind} onChange={(event) => setResponses((items) => ({ ...items, [criterion.criterionVersionId]: { ...current, evidenceKind: event.target.value as SupervisorResponseDraft["evidenceKind"] } }))}><option value="STRUCTURED_OBSERVATION">مشاهده ساختاریافته</option><option value="OPERATIONAL_REFERENCE">مرجع عملیاتی</option><option value="CONTROLLED_DOCUMENT">سند کنترل‌شده</option></ErpSelect></ErpField>
                    <ErpField label="کیفیت شاهد"><ErpSelect value={current.evidenceQuality} onChange={(event) => setResponses((items) => ({ ...items, [criterion.criterionVersionId]: { ...current, evidenceQuality: event.target.value as SupervisorResponseDraft["evidenceQuality"] } }))}><option value="RELIABLE">قابل اتکا</option><option value="INCOMPLETE">ناقص</option><option value="DISPUTED">مورد اختلاف</option><option value="MISSING">در دسترس نیست</option></ErpSelect></ErpField>
                    <ErpField label="مرجع شاهد" required={criterion.evidence.required}><ErpInput value={current.evidenceReference} onChange={(event) => setResponses((items) => ({ ...items, [criterion.criterionVersionId]: { ...current, evidenceReference: event.target.value } }))} /></ErpField>
                    <ErpField label="نسخه منبع" required={criterion.evidence.required}><ErpInput value={current.sourceVersion} onChange={(event) => setResponses((items) => ({ ...items, [criterion.criterionVersionId]: { ...current, sourceVersion: event.target.value } }))} /></ErpField>
                    <ErpField label="زمان شاهد" required={criterion.evidence.required}><ErpInput type="datetime-local" value={current.occurredAt} onChange={(event) => setResponses((items) => ({ ...items, [criterion.criterionVersionId]: { ...current, occurredAt: event.target.value } }))} /></ErpField>
                    <ErpField label="هش شاهد" hint="هش ۶۴ نویسه‌ای ثبت منبع" required={criterion.evidence.required}><ErpInput dir="ltr" value={current.contentHash} onChange={(event) => setResponses((items) => ({ ...items, [criterion.criterionVersionId]: { ...current, contentHash: event.target.value.toLowerCase() } }))} /></ErpField>
                  </div>
                </div>;
              })}</div>
            </ErpCard>)}
            <ErpField label="جمع‌بندی سرپرست"><ErpTextarea rows={4} value={narrative} onChange={(event) => setNarrative(event.target.value)} /></ErpField>
            <div className="flex flex-wrap justify-end gap-2">
              <ErpButton label="ذخیره پیش‌نویس" variant="outline" disabled={pending} onClick={() => void run(
                () => personnelPerformanceAPI.saveSupervisorDraft(supervisorDetail.section.id, buildSupervisorDraft({ narrative, responses })), "پیش‌نویس ارزیابی ذخیره شد.", false,
              )} />
              <ErpButton label="ذخیره و ارسال" variant="solid" disabled={pending || !draftComplete} onClick={() => void run(async () => {
                await personnelPerformanceAPI.saveSupervisorDraft(supervisorDetail.section.id, buildSupervisorDraft({ narrative, responses }));
                await personnelPerformanceAPI.submitSupervisorSection(supervisorDetail.section.id, crypto.randomUUID());
              }, "ارزیابی برای بررسی منابع انسانی ارسال شد.")} />
            </div>
          </div>
        </ErpSection>
      </>}

      {surface === "review" && canReview && !reviewDetail && <ErpSection title="ارسال‌های آماده تصمیم">
        <div className="space-y-3">{!reviews.length && <ErpInlineState kind="empty" title="ارسال آماده بررسی وجود ندارد." />}{reviews.map((review) => <ErpCard key={review.id} className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">ارسال نسخه {review.version.toLocaleString("fa-IR")}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">ارسال {faDate(review.submittedAt)} · مهلت بررسی {faDate(review.reviewDueAt)}</p></div><ErpButton label="بررسی پرونده" href={`/dashboard/hr/personnel/performance/reviews/${review.id}`} /></div>
        </ErpCard>)}</div>
      </ErpSection>}

      {surface === "review" && canReview && reviewDetail && <ErpSection title="تصمیم منابع انسانی" actions={[{ label: "بازگشت به صف", href: "/dashboard/hr/personnel/performance" }]}>
        <ErpSummaryGrid items={[
          { label: "نسخه ارسال", value: reviewDetail.submission.version.toLocaleString("fa-IR") },
          { label: "زمان ارسال", value: faDate(reviewDetail.submission.submittedAt) },
          { label: "بازه بخش", value: `${faDate(reviewDetail.section.effectiveFrom)} تا ${faDate(reviewDetail.section.effectiveTo)}` },
          { label: "مهلت بررسی", value: faDate(reviewDetail.section.reviewDueAt), tone: "warning" },
        ]} />
        <div className="mt-4 space-y-4">{reviewDetail.form.categories.map((category) => <ErpCard key={category.id} className="p-4"><p className="font-semibold">{category.titleFa}</p><div className="mt-3 space-y-3">{category.criteria.map((criterion) => {
          const response = reviewDetail.content.responses?.find(({ criterionVersionId }) => criterionVersionId === criterion.criterionVersionId);
          const gradeLabel = response?.grade ? criterion.anchorsFa[response.grade - 1] : "بدون قضاوت توصیفی";
          return <div key={criterion.criterionVersionId} className="flex flex-col gap-1 border-t border-[var(--sds-border-subtle)] pt-3 first:border-0 first:pt-0"><span className="font-medium">{criterion.titleFa}</span><span className="text-sm text-[var(--sds-text-secondary)]">قضاوت: {gradeLabel} · شاهد: {response?.evidence?.length.toLocaleString("fa-IR") ?? "۰"}</span></div>;
        })}</div></ErpCard>)}
          {reviewDetail.content.narrative && <ErpCard className="p-4"><p className="font-semibold">جمع‌بندی سرپرست</p><p className="mt-2 whitespace-pre-wrap text-sm text-[var(--sds-text-secondary)]">{reviewDetail.content.narrative}</p></ErpCard>}
          <div className="flex flex-wrap justify-end gap-2"><ErpButton label="تصاحب ۱۵ دقیقه‌ای" variant="outline" onClick={() => void run(() => personnelPerformanceAPI.claimReview(reviewDetail.submission.id), "پرونده تا پانزده دقیقه برای شما نگه داشته شد.", false)} /><ErpButton label="غیرقابل‌ارزیابی" tone="warning" variant="outline" onClick={() => { setDecision("NOT_EVALUABLE"); setDecisionReason(""); setDecisionCategory("NO_VALID_SUPERVISOR"); }} /><ErpButton label="بازگرداندن" tone="danger" variant="outline" onClick={() => { setDecision("REJECTED"); setDecisionReason(""); setDecisionCategory("EVIDENCE_INSUFFICIENT"); }} /><ErpButton label="پذیرش مطابق سیاست" variant="solid" onClick={() => { setDecision("ACCEPTED"); setDecisionReason("مطابق سیاست"); setDecisionCategory(""); }} /></div>
        </div>
      </ErpSection>}

      {surface === "lifecycle" && canUseLifecycle && <ErpSection title="اقدام‌های چرخه ارزیابی" description="هر اقدام با مجوز مستقل و دلیل ممیزی ثبت می‌شود.">
        <div className="space-y-3">{!lifecycleSections.length && <ErpInlineState kind="empty" title="پرونده بازی برای اقدام وجود ندارد." />}{lifecycleSections.map((row) => {
          const status = workflowStatusPresentation(row.status);
          return <ErpCard key={row.id} className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{row.personnel.displayName}</p><ErpBadge tone={status.tone}>{status.label}</ErpBadge></div><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">بازه {faDate(row.effectiveFrom)} تا {faDate(row.effectiveTo)} · مهلت ارسال {faDate(row.submissionDueAt)}</p></div><div className="flex flex-wrap gap-2">
            {canManage && row.submissionDueAt && ["DRAFT", "REJECTED"].includes(row.status) && <ErpButton label="تمدید مهلت" variant="outline" onClick={() => { setLifecycleAction({ kind: "extend", row }); setLifecycleReason(""); setLifecycleDueAt(localDateTimeValue(row.submissionDueAt)); }} />}
            {canReview && ["DRAFT", "REJECTED"].includes(row.status) && <ErpButton label="ثبت غیرقابل‌ارزیابی" tone="warning" variant="outline" onClick={() => { setLifecycleAction({ kind: "not-evaluable", row }); setLifecycleReason(""); setLifecycleCategory("SUBMISSION_IMPOSSIBLE"); }} />}
            {canManage && !row.hasAcceptedResult && ["DRAFT", "SUBMITTED", "REJECTED"].includes(row.evaluationStatus) && <ErpButton label="لغو پرونده" tone="danger" variant="ghost" onClick={() => { setLifecycleAction({ kind: "cancel", row }); setLifecycleReason(""); }} />}
            {canPause && row.hasAcceptedResult && <ErpButton label="تعلیق اثر نتیجه" tone="danger" variant="outline" onClick={() => { setLifecycleAction({ kind: "invalidate", row }); setLifecycleReason(""); }} />}
          </div></div></ErpCard>;
        })}</div>
      </ErpSection>}

      {surface === "readiness" && canManage && <ErpSection title="بازسازی آمادگی داده" description="اجرا با شمار و هش منبع ثبت می‌شود؛ مغایرت یا مانع ساختاری به‌صورت رکوردی باقی می‌ماند.">
        <div className="grid gap-3 md:grid-cols-2"><ErpField label="آغاز بازه" required><ErpInput type="datetime-local" value={measurementFrom} onChange={(event) => setMeasurementFrom(event.target.value)} /></ErpField><ErpField label="پایان بازه" required><ErpInput type="datetime-local" value={measurementTo} onChange={(event) => setMeasurementTo(event.target.value)} /></ErpField></div>
        <div className="mt-3 flex flex-wrap justify-end gap-2"><ErpButton label="اجرای یادآوری‌ها" variant="outline" disabled={pending} onClick={() => void run(() => personnelPerformanceAPI.runReminders(), "یادآوری‌های موعد بررسی شد.", false)} /><ErpButton label="شروع بازسازی" variant="solid" disabled={pending || !measurementFrom || !measurementTo} onClick={() => void run(async () => {
          const response = await personnelPerformanceAPI.reconstructReadiness({ measurementFrom: new Date(measurementFrom).toISOString(), measurementTo: new Date(measurementTo).toISOString(), batchSize: 100 }, crypto.randomUUID());
          setReadinessRun(response.data.run);
        }, "یک بخش از بازسازی آمادگی اجرا شد.", false)} /></div>
        {readinessRun && <div className="mt-4"><ErpSummaryGrid items={[
          { label: "وضعیت اجرا", value: workflowStatusPresentation(String(readinessRun.status ?? "")).label },
          { label: "شمار منبع", value: Number(readinessRun.sourceCount ?? 0).toLocaleString("fa-IR") },
          { label: "ساخته‌شده", value: Number(readinessRun.appliedCount ?? 0).toLocaleString("fa-IR"), tone: "success" },
          { label: "مانع ساختاری", value: Number(readinessRun.blockedCount ?? 0).toLocaleString("fa-IR"), tone: "warning" },
        ]} /></div>}
      </ErpSection>}

      <ErpSheet open={Boolean(lifecycleAction)} onClose={() => !pending && setLifecycleAction(undefined)} title={lifecycleAction?.kind === "extend" ? "تمدید مهلت ارسال" : lifecycleAction?.kind === "not-evaluable" ? "ثبت غیرقابل‌ارزیابی" : lifecycleAction?.kind === "invalidate" ? "تعلیق اثر نتیجه" : "لغو پرونده ارزیابی"} presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={() => setLifecycleAction(undefined)} /><ErpButton label="ثبت اقدام" tone={lifecycleAction?.kind === "extend" ? "primary" : "danger"} variant="solid" disabled={!lifecycleAction || lifecycleReason.trim().length < 8 || (lifecycleAction.kind === "extend" && !lifecycleDueAt)} onClick={() => lifecycleAction && void (async () => {
        const { kind, row } = lifecycleAction;
        const succeeded = await run(() => kind === "extend"
          ? personnelPerformanceAPI.extendSection(row.id, { dueAt: new Date(lifecycleDueAt).toISOString(), reason: lifecycleReason })
          : kind === "not-evaluable"
            ? personnelPerformanceAPI.markSectionNotEvaluable(row.id, { reasonCategory: lifecycleCategory, reason: lifecycleReason }, crypto.randomUUID())
            : kind === "cancel"
              ? personnelPerformanceAPI.cancelEvaluation(row.evaluationId, lifecycleReason)
              : personnelPerformanceAPI.invalidateEvaluation(row.evaluationId, lifecycleReason), "اقدام چرخه با ثبت ممیزی انجام شد.");
        if (succeeded) setLifecycleAction(undefined);
      })()} /></div>}>
        {lifecycleAction?.kind === "extend" && <ErpField label="مهلت تازه" required><ErpInput type="datetime-local" value={lifecycleDueAt} onChange={(event) => setLifecycleDueAt(event.target.value)} /></ErpField>}
        {lifecycleAction?.kind === "not-evaluable" && <ErpField label="دسته دلیل" required><ErpSelect value={lifecycleCategory} onChange={(event) => setLifecycleCategory(event.target.value)}><option value="NO_VALID_SUPERVISOR">نبود سرپرست معتبر</option><option value="SUBMISSION_IMPOSSIBLE">ناممکن‌شدن ارسال</option><option value="INSUFFICIENT_COVERAGE">پوشش ناکافی</option><option value="CONTEXT_UNAVAILABLE">زمینه در دسترس نیست</option><option value="OTHER">سایر</option></ErpSelect></ErpField>}
        <ErpField label="دلیل ممیزی" required hint="حداقل هشت نویسه؛ متن محرمانه ارزیابی را وارد نکنید."><ErpTextarea rows={4} value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} /></ErpField>
      </ErpSheet>

      <ErpSheet open={Boolean(decision)} onClose={() => !pending && setDecision(undefined)} title={decision === "ACCEPTED" ? "پذیرش ارسال" : decision === "REJECTED" ? "بازگرداندن برای اصلاح" : "ثبت غیرقابل‌ارزیابی"} presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={() => setDecision(undefined)} /><ErpButton label="ثبت تصمیم" tone={decision === "REJECTED" ? "danger" : decision === "NOT_EVALUABLE" ? "warning" : "success"} variant="solid" disabled={!decision || (decision !== "ACCEPTED" && decisionReason.trim().length < 8)} onClick={() => decision && reviewDetail && void run(async () => {
        await personnelPerformanceAPI.decideReview(reviewDetail.submission.id, { decision, reason: decisionReason, reasonCategory: decisionCategory || undefined }, crypto.randomUUID());
        setDecision(undefined);
      }, "نخستین تصمیم معتبر ثبت شد.")} /></div>}>
        {decision && decision !== "ACCEPTED" && <ErpField label="دسته دلیل" required><ErpSelect value={decisionCategory} onChange={(event) => setDecisionCategory(event.target.value)}>
          {decision === "REJECTED" ? <><option value="EVIDENCE_INSUFFICIENT">شاهد ناکافی</option><option value="JUDGMENT_UNCLEAR">قضاوت نیازمند توضیح</option><option value="APPLICABILITY_DISPUTE">اختلاف کاربردپذیری</option><option value="CONTEXT_CORRECTION">نیاز به اصلاح زمینه</option><option value="OTHER">سایر</option></> : <><option value="NO_VALID_SUPERVISOR">نبود سرپرست معتبر</option><option value="SUBMISSION_IMPOSSIBLE">ناممکن‌شدن ارسال</option><option value="INSUFFICIENT_COVERAGE">پوشش ناکافی</option><option value="CONTEXT_UNAVAILABLE">زمینه در دسترس نیست</option><option value="OTHER">سایر</option></>}
        </ErpSelect></ErpField>}
        <ErpField label="توضیح تصمیم" required={decision !== "ACCEPTED"} hint="این متن در دامنه محرمانه گردش بررسی نگهداری می‌شود."><ErpTextarea rows={4} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></ErpField>
      </ErpSheet>
    </ErpPage>
  );
}
