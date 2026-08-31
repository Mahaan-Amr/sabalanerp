"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpPersianDateField,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpSummaryGrid,
  ErpTextarea,
} from "@/components/erp";
import { personnelPerformanceAPI } from "@/lib/api";
import {
  criterionDraftValidation,
  defaultCriterionDraft,
  lifecyclePresentation,
  policyKindLabel,
  summarizePreview,
  type CriterionDraft,
  type PerformanceLifecycle,
  type PerformancePolicyKind,
  type PolicyPreviewCounts,
} from "./performancePolicyAdminModel";

type Tab = "criteria" | "templates" | "policies" | "trace";
type ArtifactKind = "criteria" | "templates" | "policies";
type EditablePolicyKind = "SCORING" | "CURRENT_LEVEL" | "LEVEL_CLASSIFICATION";
type ConfirmedPolicyPreview = PolicyPreviewCounts & { resultHash: string; populationHash: string };
type TemplateCriterionDraft = { id: string; criterionVersionId: string; weightPercent: string };
type TemplateCategoryDraft = { id: string; titleFa: string; weightPercent: string; criteria: TemplateCriterionDraft[] };
type TemplateContent = {
  schemaVersion: 1;
  titleFa: string;
  categories: Array<{ id: string; titleFa: string; weightPercent: string; required: boolean; criteria: Array<{ criterionVersionId: string; weightPercent: string }> }>;
};
type VersionContent = { titleFa?: string; kind?: CriterionDraft["kind"]; categories?: TemplateContent["categories"] };
type VersionRow = {
  id: string;
  version: number;
  lifecycle: PerformanceLifecycle;
  effectiveFrom: string | null;
  publicationReason: string | null;
  content: VersionContent | null;
  conceptCode?: string;
  templateKind?: "JOB_TEMPLATE" | "POSITION_ADDENDUM";
  ownerType?: string;
  ownerId?: string;
  policyKind?: PerformancePolicyKind;
};
type PerformanceTraceExplanation = {
  reproduction: {
    exactScore: string | null;
    matchesStoredResult: boolean;
  };
  trace: {
    scoringPolicyVersionId: string;
    levelPolicyVersionId: string;
    sections: Array<{
      sectionId: string;
      exactScore: string | null;
      combinationBasis: string;
    }>;
  };
};
type EditableLevelPolicy = { schemaVersion: 1; thresholds: Array<{ code: string; titleFa: string; meaningFa: string; minimum: string; maximumExclusive?: string; maximumInclusive?: string }> };
type EditableCurrentPolicy = { schemaVersion: 1; recencyWeightsPercent: string[]; maximumResults: number; expiresAfterDays: number; expiryTimeZone: string };
type EditableScoringPolicy = { schemaVersion: 1; gradePoints: string[]; minimumOriginalCoveragePercent: string; minimumRequiredCategoryCoveragePercent: string; defaultJobSharePercent: string; defaultAddendumSharePercent: string; minimumJobSharePercent: string; maximumAddendumSharePercent: string; precisionScale: number };

const gradeLabels = [
  "به‌طور جدی پایین‌تر از انتظار",
  "پایین‌تر از انتظار",
  "مطابق انتظار",
  "بالاتر از انتظار",
  "به‌طور استثنایی بالاتر از انتظار",
];

const nextTehranDate = () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(tomorrow);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
};

const tehranDayStartIso = (date: string) => new Date(`${date}T00:00:00+03:30`).toISOString();

const errorMessage = (cause: unknown) => {
  const response = cause && typeof cause === "object" && "response" in cause
    ? (cause as { response?: { data?: { message?: string } } }).response
    : undefined;
  return response?.data?.message || "عملیات انجام نشد. اطلاعات را بررسی و دوباره تلاش کنید.";
};

const sixDecimals = (value: string) => Number(value).toFixed(6);

const isEditablePolicyKind = (kind: PerformancePolicyKind | undefined): kind is EditablePolicyKind => (
  kind === "SCORING" || kind === "CURRENT_LEVEL" || kind === "LEVEL_CLASSIFICATION"
);

const policyDefaults = (kind: EditablePolicyKind) => {
  if (kind === "LEVEL_CLASSIFICATION") return {
    schemaVersion: 1,
    thresholds: [
      ["URGENT_IMPROVEMENT", "نیازمند بهبود فوری", "عملکرد مصوب به‌طور جدی پایین‌تر از انتظارهای نقش بوده است", "0.000000", "20.000000"],
      ["IMPROVEMENT", "نیازمند بهبود", "عملکرد مصوب در بخشی از انتظارهای نقش نیازمند بهبود است", "20.000000", "40.000000"],
      ["MEETS", "مطابق انتظار", "عملکرد مصوب با انتظارهای نقش هم‌خوان است", "40.000000", "60.000000"],
      ["EXCEEDS", "فراتر از انتظار", "عملکرد مصوب در مجموع فراتر از انتظارهای نقش بوده است", "60.000000", "80.000000"],
      ["OUTSTANDING", "عملکرد برجسته", "عملکرد مصوب به‌شکلی پایدار و برجسته فراتر از انتظارهای نقش بوده است", "80.000000", "100.000000"],
    ].map(([code, titleFa, meaningFa, minimum, maximum], index) => ({
      code, titleFa, meaningFa, minimum,
      ...(index === 4 ? { maximumInclusive: maximum } : { maximumExclusive: maximum }),
    })),
  };
  if (kind === "CURRENT_LEVEL") return {
    schemaVersion: 1,
    recencyWeightsPercent: ["50.000000", "30.000000", "15.000000", "5.000000"],
    maximumResults: 4,
    expiresAfterDays: 365,
    expiryTimeZone: "Asia/Tehran",
  };
  return {
    schemaVersion: 1,
    gradePoints: ["0.000000", "25.000000", "50.000000", "75.000000", "100.000000"],
    minimumOriginalCoveragePercent: "70.000000",
    minimumRequiredCategoryCoveragePercent: "50.000000",
    defaultJobSharePercent: "80.000000",
    defaultAddendumSharePercent: "20.000000",
    minimumJobSharePercent: "70.000000",
    maximumAddendumSharePercent: "30.000000",
    precisionScale: 6,
  };
};

export default function PerformancePolicyAdministration() {
  const [tab, setTab] = useState<Tab>("criteria");
  const [criteria, setCriteria] = useState<VersionRow[]>([]);
  const [templates, setTemplates] = useState<VersionRow[]>([]);
  const [policies, setPolicies] = useState<VersionRow[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [criterionDraft, setCriterionDraft] = useState<CriterionDraft>();
  const [criterionEditId, setCriterionEditId] = useState<string>();
  const [policyKind, setPolicyKind] = useState<EditablePolicyKind>("LEVEL_CLASSIFICATION");
  const [policyContentText, setPolicyContentText] = useState(() => JSON.stringify(policyDefaults("LEVEL_CLASSIFICATION"), null, 2));
  const [policyDialog, setPolicyDialog] = useState(false);
  const [policyEditId, setPolicyEditId] = useState<string>();
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateEditId, setTemplateEditId] = useState<string>();
  const [templateKind, setTemplateKind] = useState<"JOB_TEMPLATE" | "POSITION_ADDENDUM">("JOB_TEMPLATE");
  const [templateOwnerId, setTemplateOwnerId] = useState("");
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateCriterionId, setTemplateCriterionId] = useState("");
  const [templateCriterionWeight, setTemplateCriterionWeight] = useState("100.00");
  const [templateAdditionalCriteria, setTemplateAdditionalCriteria] = useState<Array<{ id: string; criterionVersionId: string; weightPercent: string }>>([]);
  const [templateCategoryWeight, setTemplateCategoryWeight] = useState("100.00");
  const [templateExtraCategories, setTemplateExtraCategories] = useState<TemplateCategoryDraft[]>([]);
  const [scheduleTarget, setScheduleTarget] = useState<{ kind: ArtifactKind; row: VersionRow }>();
  const [effectiveDate, setEffectiveDate] = useState(nextTehranDate());
  const [publicationReason, setPublicationReason] = useState("");
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [preview, setPreview] = useState<ConfirmedPolicyPreview>();
  const [lifecycleAction, setLifecycleAction] = useState<{ action: "cancel" | "retire"; kind: ArtifactKind; row: VersionRow }>();
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [pending, setPending] = useState(false);
  const [traceId, setTraceId] = useState("");
  const [trace, setTrace] = useState<PerformanceTraceExplanation>();

  const canManage = Boolean(capabilities?.MANAGE_PERFORMANCE_POLICY);
  const canViewTrace = Boolean(capabilities?.VIEW_PERFORMANCE_HISTORY);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const capabilityResponse = await personnelPerformanceAPI.capabilities();
      const nextCapabilities = capabilityResponse.data.capabilities ?? {};
      setCapabilities(nextCapabilities);
      if (!nextCapabilities.MANAGE_PERFORMANCE_POLICY) return;
      const [criterionResponse, templateResponse, policyResponse] = await Promise.all([
        personnelPerformanceAPI.criteria(),
        personnelPerformanceAPI.templates(),
        personnelPerformanceAPI.policies(),
      ]);
      setCriteria(criterionResponse.data.criteria ?? []);
      setTemplates(templateResponse.data.templates ?? []);
      setPolicies(policyResponse.data.policies ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<unknown>, message: string) => {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await work();
      setSuccess(message);
      await load();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  };

  const openSchedule = async (kind: ArtifactKind, row: VersionRow) => {
    const initialDate = nextTehranDate();
    setScheduleTarget({ kind, row });
    setEffectiveDate(initialDate);
    setPublicationReason("");
    setImpactConfirmed(false);
    setPreview(undefined);
    if (kind === "policies") {
      setPending(true);
      try {
        const response = await personnelPerformanceAPI.previewPolicy(row.id, tehranDayStartIso(initialDate));
        setPreview({
          ...response.data.preview.preview.counts,
          resultHash: response.data.preview.preview.resultHash,
          populationHash: response.data.preview.sourcePopulationHash,
        });
      } catch (cause) {
        setError(errorMessage(cause));
        setScheduleTarget(undefined);
      } finally {
        setPending(false);
      }
    }
  };

  const rows = tab === "criteria" ? criteria : tab === "templates" ? templates : policies;
  const parseJson = (value: string) => {
    try { return { value: JSON.parse(value) as unknown, error: "" }; }
    catch { return { value: undefined, error: "ساختار داده واردشده معتبر نیست." }; }
  };
  const parsedPolicyContent = parseJson(policyContentText);
  const policyContentInvalid = (() => {
    if (!parsedPolicyContent.value) return true;
    if (policyKind === "LEVEL_CLASSIFICATION") {
      const thresholds = (parsedPolicyContent.value as EditableLevelPolicy).thresholds;
      return thresholds.length !== 5 || thresholds.some((threshold, index) => (
        !threshold.titleFa.trim() || !threshold.meaningFa.trim() || !Number.isFinite(Number(threshold.minimum))
        || Number(threshold.minimum) < 0 || Number(threshold.minimum) > 100
        || (index > 0 && Number(threshold.minimum) <= Number(thresholds[index - 1].minimum))
      ));
    }
    if (policyKind === "CURRENT_LEVEL") {
      const policy = parsedPolicyContent.value as EditableCurrentPolicy;
      return policy.recencyWeightsPercent.length !== 4
        || policy.recencyWeightsPercent.some((weight) => !Number.isFinite(Number(weight)) || Number(weight) < 0)
        || Math.abs(policy.recencyWeightsPercent.reduce((sum, weight) => sum + Number(weight), 0) - 100) > 0.000001
        || policy.maximumResults !== 4 || policy.expiresAfterDays !== 365;
    }
    const policy = parsedPolicyContent.value as EditableScoringPolicy;
    return policy.gradePoints.length !== 5
      || policy.gradePoints.some((point) => !Number.isFinite(Number(point)) || Number(point) < 0 || Number(point) > 100)
      || Math.abs(Number(policy.defaultJobSharePercent) + Number(policy.defaultAddendumSharePercent) - 100) > 0.000001
      || Number(policy.defaultJobSharePercent) < Number(policy.minimumJobSharePercent)
      || Number(policy.defaultAddendumSharePercent) > Number(policy.maximumAddendumSharePercent);
  })();
  const updatePolicyContent = (mutate: (draft: Record<string, unknown>) => void) => {
    const draft = structuredClone(parsedPolicyContent.value) as Record<string, unknown>;
    mutate(draft);
    setPolicyContentText(JSON.stringify(draft, null, 2));
  };
  const normalizedPolicyContent = () => {
    const content = structuredClone(parsedPolicyContent.value) as Record<string, unknown>;
    if (policyKind === "LEVEL_CLASSIFICATION") {
      const thresholds = content.thresholds as EditableLevelPolicy["thresholds"];
      thresholds.forEach((threshold, index) => {
        threshold.minimum = sixDecimals(threshold.minimum);
        if (index < thresholds.length - 1) threshold.maximumExclusive = sixDecimals(thresholds[index + 1].minimum);
      });
    }
    return content;
  };
  const criterionKind = (id: string) => criteria.find((row) => row.id === id)?.content?.kind;
  const mainCriterionWeightTotal = Number(templateCriterionWeight) + templateAdditionalCriteria.reduce((sum, item) => (
    criterionKind(item.criterionVersionId) === "JUDGMENT" ? sum + Number(item.weightPercent) : sum
  ), 0);
  const invalidNonScoringWeight = templateAdditionalCriteria.some((item) => (
    item.criterionVersionId && criterionKind(item.criterionVersionId) !== "JUDGMENT" && Number(item.weightPercent) !== 0
  ));
  const invalidExtraCategoryCriteria = templateExtraCategories.some((category) => {
    const scoringTotal = category.criteria.reduce((sum, item) => (
      criterionKind(item.criterionVersionId) === "JUDGMENT" ? sum + Number(item.weightPercent) : sum
    ), 0);
    return category.criteria.length === 0
      || category.criteria.some((item) => !item.criterionVersionId
        || (criterionKind(item.criterionVersionId) !== "JUDGMENT" && Number(item.weightPercent) !== 0))
      || Math.abs(scoringTotal - 100) > 0.001;
  });
  const activeCount = useMemo(() => [...criteria, ...templates, ...policies].filter((row) => row.lifecycle === "ACTIVE").length, [criteria, templates, policies]);
  const scheduledCount = useMemo(() => [...criteria, ...templates, ...policies].filter((row) => row.lifecycle === "SCHEDULED").length, [criteria, templates, policies]);

  if (loading && !capabilities) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · ارزیابی محرمانه عملکرد"
      title="معیارها و سیاست‌های عملکرد"
      description="نسخه‌ها پس از انتشار تغییرناپذیرند و فقط از تاریخ اثر خود استفاده می‌شوند."
      backHref="/dashboard/hr/personnel"
      metrics={[
        { label: "نسخه فعال", value: activeCount.toLocaleString("fa-IR"), tone: "success" },
        { label: "زمان‌بندی‌شده", value: scheduledCount.toLocaleString("fa-IR"), tone: "info" },
        { label: "پیش‌نویس", value: [...criteria, ...templates, ...policies].filter((row) => row.lifecycle === "DRAFT").length.toLocaleString("fa-IR"), tone: "warning" },
      ]}
    >
      {error && <ErpInlineState kind="error" title={error} action={{ label: "تلاش دوباره", onClick: () => void load() }} />}
      {success && <ErpInlineState kind="success" title={success} />}
      {!canManage && <ErpInlineState kind="permission" title="مجوز مستقل مدیریت سیاست عملکرد برای این صفحه فعال نیست." />}
      <ErpSegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "criteria", label: "کتابخانه معیار", count: criteria.length, countTone: "neutral" },
          { value: "templates", label: "الگو و افزوده", count: templates.length, countTone: "neutral" },
          { value: "policies", label: "سیاست‌های سازمانی", count: policies.length, countTone: "neutral" },
          { value: "trace", label: "توضیح محاسبه", disabled: !canViewTrace },
        ]}
      />

      {tab !== "trace" && canManage && (
        <ErpSection
          title={tab === "criteria" ? "نسخه‌های معیار" : tab === "templates" ? "نسخه‌های الگو" : "نسخه‌های سیاست"}
          actions={[{
            label: tab === "criteria" ? "معیار جدید" : tab === "templates" ? "الگوی جدید" : "نسخه سیاست جدید",
            onClick: () => {
              if (tab === "criteria") setCriterionDraft(defaultCriterionDraft());
              else if (tab === "templates") {
                setTemplateEditId(undefined);
                setTemplateDialog(true);
              }
              else {
                setPolicyEditId(undefined);
                setPolicyKind("LEVEL_CLASSIFICATION");
                setPolicyContentText(JSON.stringify(policyDefaults("LEVEL_CLASSIFICATION"), null, 2));
                setPolicyDialog(true);
              }
            },
            variant: "solid",
          }]}
        >
          <div className="space-y-3">
            {rows.length === 0 && <ErpInlineState kind="empty" title="هنوز نسخه‌ای در این بخش ثبت نشده است." />}
            {rows.map((row) => {
              const status = lifecyclePresentation(row.lifecycle);
              const editablePolicyKind = isEditablePolicyKind(row.policyKind) ? row.policyKind : undefined;
              const title = tab === "criteria"
                ? row.content?.titleFa || row.conceptCode
                : tab === "templates"
                  ? row.content?.titleFa || `${row.ownerType} · ${row.ownerId}`
                  : policyKindLabel(row.policyKind!);
              return (
                <ErpCard key={row.id} className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold">{title}</p>
                        <ErpBadge tone={status.tone}>{status.label}</ErpBadge>
                        <ErpBadge variant="outline">نسخه {row.version.toLocaleString("fa-IR")}</ErpBadge>
                      </div>
                      <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
                        {row.publicationReason || (row.lifecycle === "DRAFT" ? "هنوز منتشر نشده" : "دلیل انتشار ثبت شده است")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.lifecycle === "DRAFT" && tab === "criteria" && <ErpButton label="ویرایش پیش‌نویس" variant="outline" onClick={() => {
                        setCriterionEditId(row.id);
                        setCriterionDraft(row.content as CriterionDraft);
                      }} />}
                      {row.lifecycle === "DRAFT" && tab === "policies" && editablePolicyKind && <ErpButton label="ویرایش پیش‌نویس" variant="outline" onClick={() => {
                        setPolicyKind(editablePolicyKind);
                        setPolicyContentText(JSON.stringify(row.content ?? policyDefaults(editablePolicyKind), null, 2));
                        setPolicyEditId(row.id);
                        setPolicyDialog(true);
                      }} />}
                      {row.lifecycle === "DRAFT" && tab === "templates" && <ErpButton label="ویرایش پیش‌نویس" variant="outline" onClick={() => {
                        const content = row.content as TemplateContent;
                        const [main, ...extra] = content.categories;
                        setTemplateKind(row.templateKind!);
                        setTemplateOwnerId(row.ownerId ?? "");
                        setTemplateTitle(content.titleFa);
                        setTemplateCategoryWeight(main?.weightPercent ?? "100.00");
                        setTemplateCriterionId(main?.criteria[0]?.criterionVersionId ?? "");
                        setTemplateCriterionWeight(main?.criteria[0]?.weightPercent ?? "100.00");
                        setTemplateAdditionalCriteria((main?.criteria.slice(1) ?? []).map((criterion, index) => ({ id: `main-criterion-${index + 2}`, ...criterion })));
                        setTemplateExtraCategories(extra.map((category) => ({
                          id: category.id, titleFa: category.titleFa, weightPercent: category.weightPercent,
                          criteria: category.criteria.map((criterion, index) => ({ id: `${category.id}-criterion-${index + 1}`, ...criterion })),
                        })));
                        setTemplateEditId(row.id);
                        setTemplateDialog(true);
                      }} />}
                      {row.lifecycle === "DRAFT" && <ErpButton label="پیش‌نمایش و انتشار" onClick={() => void openSchedule(tab, row)} />}
                      {row.lifecycle === "SCHEDULED" && tab === "policies" && row.effectiveFrom
                        && new Date(row.effectiveFrom).getTime() <= Date.now()
                        && <ErpButton label="بازپیش‌نمایش و تأیید" onClick={() => void openSchedule("policies", row)} />}
                      {row.lifecycle === "SCHEDULED" && <ErpButton label="لغو زمان‌بندی" tone="danger" variant="outline" onClick={() => {
                        setLifecycleReason("");
                        setLifecycleAction({ action: "cancel", kind: tab as ArtifactKind, row });
                      }} />}
                      {row.lifecycle === "ACTIVE" && tab !== "policies" && <ErpButton label="بازنشسته‌کردن" tone="warning" variant="outline" onClick={() => {
                        setLifecycleReason("");
                        setLifecycleAction({ action: "retire", kind: tab as ArtifactKind, row });
                      }} />}
                    </div>
                  </div>
                </ErpCard>
              );
            })}
          </div>
        </ErpSection>
      )}

      {tab === "trace" && canViewTrace && (
        <ErpSection title="بازسازی نتیجه بدون سیاست زنده" description="شناسه ردپای مجاز را وارد کنید؛ محاسبه فقط از Snapshot تغییرناپذیر خودش بازسازی می‌شود.">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <ErpField label="شناسه ردپای محاسبه" className="flex-1">
              <ErpInput value={traceId} onChange={(event) => setTraceId(event.target.value)} dir="ltr" />
            </ErpField>
            <ErpButton label="بازسازی و توضیح" disabled={!traceId.trim() || pending} onClick={() => void run(async () => {
              const response = await personnelPerformanceAPI.trace(traceId.trim());
              setTrace(response.data.explanation);
            }, "ردپای محاسبه با موفقیت بازسازی شد.")} />
          </div>
          {trace && <div className="mt-4 space-y-4">
            <ErpSummaryGrid items={[
              { label: "امتیاز دقیق بازسازی‌شده", value: trace.reproduction.exactScore ?? "بدون امتیاز" },
              { label: "انطباق با نتیجه ذخیره‌شده", value: trace.reproduction.matchesStoredResult ? "منطبق" : "مغایرت", tone: trace.reproduction.matchesStoredResult ? "success" : "danger" },
              { label: "نسخه سیاست امتیازدهی", value: trace.trace.scoringPolicyVersionId },
              { label: "نسخه سیاست سطح‌بندی", value: trace.trace.levelPolicyVersionId },
            ]} />
            <ErpCard className="p-4">
              <p className="font-bold">سهم بخش‌های مأموریت</p>
              <div className="mt-3 space-y-2">
                {trace.trace.sections.map((section) => <div key={section.sectionId} className="flex justify-between gap-3 text-sm">
                  <span>{section.sectionId}</span><span>امتیاز {section.exactScore} · مبنا {section.combinationBasis}</span>
                </div>)}
              </div>
            </ErpCard>
          </div>}
        </ErpSection>
      )}

      <ErpSheet open={Boolean(criterionDraft)} onClose={() => !pending && (setCriterionDraft(undefined), setCriterionEditId(undefined))} title={criterionEditId ? "ویرایش پیش‌نویس معیار" : "ساخت نسخه معیار"} presentation="modal" size="wide" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" onClick={() => { setCriterionDraft(undefined); setCriterionEditId(undefined); }} />
        <ErpButton label="ذخیره پیش‌نویس" variant="solid" disabled={!criterionDraft || criterionDraftValidation(criterionDraft).length > 0 || pending} onClick={() => criterionDraft && void run(
          () => criterionEditId ? personnelPerformanceAPI.updateCriterion(criterionEditId, criterionDraft) : personnelPerformanceAPI.createCriterion(criterionDraft), criterionEditId ? "پیش‌نویس معیار ویرایش شد." : "پیش‌نویس معیار ساخته شد.",
        ).then((ok) => { if (ok) { setCriterionDraft(undefined); setCriterionEditId(undefined); } })} />
      </div>}>
        {criterionDraft && <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <ErpField label="عنوان فارسی" required error={!criterionDraft.titleFa.trim() ? "عنوان فارسی معیار الزامی است." : undefined}><ErpInput value={criterionDraft.titleFa} onChange={(event) => setCriterionDraft({ ...criterionDraft, titleFa: event.target.value })} /></ErpField>
            <ErpField label="کد مفهوم پایدار" required><ErpInput value={criterionDraft.conceptCode} onChange={(event) => setCriterionDraft({ ...criterionDraft, conceptCode: event.target.value.toUpperCase() })} dir="ltr" /></ErpField>
          </div>
          <ErpField label="معنای کسب‌وکاری" required error={!criterionDraft.meaningFa.trim() ? "معنای کسب‌وکاری معیار الزامی است." : undefined}><ErpTextarea value={criterionDraft.meaningFa} onChange={(event) => setCriterionDraft({ ...criterionDraft, meaningFa: event.target.value })} /></ErpField>
          <ErpField label="نوع معیار"><ErpSelect value={criterionDraft.kind} onChange={(event) => {
            const kind = event.target.value as CriterionDraft["kind"];
            setCriterionDraft({ ...criterionDraft, kind, anchorsFa: kind === "JUDGMENT" ? ["", "", "", "", ""] : [] });
          }}><option value="JUDGMENT">قضاوت پنج‌درجه‌ای</option><option value="KPI_EVIDENCE">شاهد شاخص عملیاتی</option><option value="EXPLANATORY">متن توضیحی</option><option value="BINARY_GATE">کنترل الزامی بله/خیر</option></ErpSelect></ErpField>
          {criterionDraft.kind === "JUDGMENT" && <div className="space-y-3">
            {gradeLabels.map((label, index) => <ErpField key={label} label={`درجه ${(index + 1).toLocaleString("fa-IR")} · ${label}`} required error={!criterionDraft.anchorsFa[index]?.trim() ? "توضیح رفتاری این درجه الزامی است." : undefined}>
              <ErpTextarea rows={2} value={criterionDraft.anchorsFa[index]} onChange={(event) => {
                const anchors = [...criterionDraft.anchorsFa] as CriterionDraft["anchorsFa"];
                anchors[index] = event.target.value;
                setCriterionDraft({ ...criterionDraft, anchorsFa: anchors });
              }} />
            </ErpField>)}
          </div>}
          <ErpCheckbox label="وجود شاهد قابل اتکا برای امتیازدهی الزامی است" checked={criterionDraft.evidence.required} onChange={(event) => setCriterionDraft({ ...criterionDraft, evidence: { ...criterionDraft.evidence, required: event.target.checked } })} />
          <ErpField label="حداقل شاهد قابل اتکا" error={criterionDraft.evidence.required && criterionDraft.evidence.minimumReliableCount < 1 ? "حداقل یک شاهد قابل اتکا لازم است." : undefined}><ErpInput type="number" min={0} max={10} value={criterionDraft.evidence.minimumReliableCount} onChange={(event) => setCriterionDraft({ ...criterionDraft, evidence: { ...criterionDraft.evidence, minimumReliableCount: Number(event.target.value) } })} /></ErpField>
          <ErpField label="واقعیت کنترل‌شده کاربردپذیری" hint="در صورت انتخاب، معیار فقط برای رابطه‌هایی که با این واقعیت منطبق‌اند اعمال می‌شود."><ErpSelect value={criterionDraft.applicability?.fact ?? ""} onChange={(event) => setCriterionDraft({ ...criterionDraft, applicability: event.target.value ? { fact: event.target.value, operator: "IN", values: [] } : null })}>
            <option value="">برای همه</option><option value="jobId">شغل</option><option value="positionId">جایگاه</option><option value="organizationalUnitId">واحد سازمانی</option><option value="locationId">محل کار</option><option value="shiftType">نوع شیفت</option><option value="assignmentType">نوع مأموریت</option><option value="responsibilityCodes">کد مسئولیت</option><option value="hasSafetyDuty">مسئولیت ایمنی</option>
          </ErpSelect></ErpField>
          {criterionDraft.applicability && <ErpField label="مقادیر مجاز" required error={criterionDraft.applicability.values.length === 0 ? "حداقل یک مقدار کاربردپذیری وارد کنید." : undefined} hint="چند مقدار را با ویرگول جدا کنید."><ErpInput value={criterionDraft.applicability.values.join(", ")} onChange={(event) => setCriterionDraft({ ...criterionDraft, applicability: { ...criterionDraft.applicability!, values: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })} /></ErpField>}
          <fieldset aria-describedby="criterion-evidence-error" className="space-y-2">
            <legend className="text-sm font-semibold">گونه‌های شاهد مجاز <span aria-hidden="true">*</span></legend>
            <div className="grid gap-2 sm:grid-cols-3">{([
              ["STRUCTURED_OBSERVATION", "مشاهده ساختاریافته"], ["OPERATIONAL_REFERENCE", "ارجاع عملیاتی"], ["CONTROLLED_DOCUMENT", "سند کنترل‌شده"],
            ] as const).map(([kind, label]) => <ErpCheckbox key={kind} label={label} checked={criterionDraft.evidence.allowedKinds.includes(kind)} onChange={(event) => setCriterionDraft({ ...criterionDraft, evidence: { ...criterionDraft.evidence, allowedKinds: event.target.checked ? [...criterionDraft.evidence.allowedKinds, kind] : criterionDraft.evidence.allowedKinds.filter((value) => value !== kind) } })} />)}</div>
            {criterionDraft.evidence.allowedKinds.length === 0 && <p id="criterion-evidence-error" role="alert" className="text-sm text-[var(--sds-danger)]">حداقل یک گونه شاهد انتخاب کنید.</p>}
          </fieldset>
        </div>}
      </ErpSheet>

      <ErpSheet open={policyDialog} onClose={() => !pending && setPolicyDialog(false)} title={policyEditId ? "ویرایش پیش‌نویس سیاست" : "ساخت پیش‌نویس سیاست"} presentation="modal" size="wide" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" onClick={() => setPolicyDialog(false)} />
        <ErpButton label={policyEditId ? "ذخیره تغییرات" : "ساخت نسخه"} variant="solid" disabled={pending || policyContentInvalid} onClick={() => void run(
          () => policyEditId
            ? personnelPerformanceAPI.updatePolicy(policyEditId, normalizedPolicyContent())
            : personnelPerformanceAPI.createPolicy({ policyKind, content: normalizedPolicyContent() }),
          policyEditId ? "تغییرات سیاست ذخیره شد." : "پیش‌نویس سیاست ساخته شد.",
        ).then((ok) => ok && (setPolicyDialog(false), setPolicyEditId(undefined)))} />
      </div>}>
        <ErpField label="نوع سیاست"><ErpSelect disabled={Boolean(policyEditId)} value={policyKind} onChange={(event) => {
          const nextKind = event.target.value as typeof policyKind;
          setPolicyKind(nextKind);
          setPolicyContentText(JSON.stringify(policyDefaults(nextKind), null, 2));
        }}>
          <option value="LEVEL_CLASSIFICATION">آستانه‌های پنج سطح</option>
          <option value="CURRENT_LEVEL">تجمیع چهار نتیجه اخیر</option>
          <option value="SCORING">نگاشت درجه، پوشش و سهم الگو</option>
        </ErpSelect></ErpField>
        <div className="mt-4 space-y-4">
          {policyKind === "LEVEL_CLASSIFICATION" && (parsedPolicyContent.value as EditableLevelPolicy).thresholds.map((threshold, index) => <ErpCard key={threshold.code} className="grid gap-3 p-3 md:grid-cols-2">
            <ErpField label={`عنوان سطح ${(index + 1).toLocaleString("fa-IR")}`}><ErpInput disabled value={threshold.titleFa} /></ErpField>
            <ErpField label="مرز پایین امتیاز"><ErpInput disabled={index === 0} type="number" min={0} max={100} step={0.000001} value={threshold.minimum} onChange={(event) => updatePolicyContent((draft) => {
              const thresholds = draft.thresholds as EditableLevelPolicy["thresholds"];
              thresholds[index].minimum = event.target.value;
              if (index > 0) thresholds[index - 1].maximumExclusive = event.target.value;
            })} /></ErpField>
            <ErpField className="md:col-span-2" label="معنای فارسی سطح"><ErpTextarea rows={2} value={threshold.meaningFa} onChange={(event) => updatePolicyContent((draft) => { (draft.thresholds as EditableLevelPolicy["thresholds"])[index].meaningFa = event.target.value; })} /></ErpField>
          </ErpCard>)}
          {policyKind === "CURRENT_LEVEL" && <div className="grid gap-3 md:grid-cols-2">{(parsedPolicyContent.value as EditableCurrentPolicy).recencyWeightsPercent.map((weight, index) => <ErpField key={index} label={`وزن نتیجه ${(index + 1).toLocaleString("fa-IR")}`}><ErpInput disabled type="number" value={weight} /></ErpField>)}
            <ErpField label="حداکثر تعداد نتیجه"><ErpInput disabled type="number" value={(parsedPolicyContent.value as EditableCurrentPolicy).maximumResults} /></ErpField>
            <ErpField label="مدت اعتبار نتیجه (روز)"><ErpInput disabled type="number" value={(parsedPolicyContent.value as EditableCurrentPolicy).expiresAfterDays} /></ErpField>
          </div>}
          {policyKind === "SCORING" && <div className="grid gap-3 md:grid-cols-2">{(parsedPolicyContent.value as EditableScoringPolicy).gradePoints.map((point, index) => <ErpField key={index} label={`امتیاز درجه ${(index + 1).toLocaleString("fa-IR")}`}><ErpInput type="number" min={0} max={100} step={0.000001} value={point} onChange={(event) => updatePolicyContent((draft) => { (draft.gradePoints as string[])[index] = event.target.value; })} /></ErpField>)}
            {([ ["minimumOriginalCoveragePercent", "حداقل پوشش کل"], ["minimumRequiredCategoryCoveragePercent", "حداقل پوشش دسته الزامی"], ["defaultJobSharePercent", "سهم پیش‌فرض الگوی شغل"], ["defaultAddendumSharePercent", "سهم پیش‌فرض افزوده جایگاه"], ["minimumJobSharePercent", "حداقل سهم شغل"], ["maximumAddendumSharePercent", "حداکثر سهم افزوده"] ] as const).map(([key, label]) => <ErpField key={key} label={label}><ErpInput type="number" min={0} max={100} step={0.000001} value={(parsedPolicyContent.value as EditableScoringPolicy)[key]} onChange={(event) => updatePolicyContent((draft) => { draft[key] = event.target.value; })} /></ErpField>)}
          </div>}
          {policyContentInvalid && <ErpInlineState kind="error" title="مقادیر سیاست با قواعد انتشار سازگار نیست؛ وزن‌ها، مرزها و فیلدهای الزامی را بررسی کنید." />}
        </div>
      </ErpSheet>

      <ErpSheet open={templateDialog} onClose={() => !pending && setTemplateDialog(false)} title={templateEditId ? "ویرایش پیش‌نویس الگو" : "ساخت پیش‌نویس الگو"} presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="انصراف" variant="ghost" onClick={() => setTemplateDialog(false)} />
        <ErpButton label={templateEditId ? "ذخیره تغییرات" : "ساخت الگو"} variant="solid" disabled={pending || !templateOwnerId.trim() || !templateTitle.trim() || !templateCriterionId || templateAdditionalCriteria.some((item) => !item.criterionVersionId) || invalidNonScoringWeight || invalidExtraCategoryCriteria || Math.abs(mainCriterionWeightTotal - 100) > 0.001 || templateExtraCategories.some((category) => !category.titleFa.trim()) || [templateCategoryWeight, ...templateExtraCategories.map((category) => category.weightPercent)].reduce((sum, value) => sum + Number(value), 0) !== 100} onClick={() => void run(
          () => {
            const content = { schemaVersion: 1, titleFa: templateTitle.trim(), categories: [
              { id: "main", titleFa: "معیارهای اصلی", weightPercent: templateCategoryWeight, required: true, criteria: [
                { criterionVersionId: templateCriterionId, weightPercent: templateCriterionWeight },
                ...templateAdditionalCriteria.map((item) => ({ criterionVersionId: item.criterionVersionId, weightPercent: item.weightPercent })),
              ] },
              ...templateExtraCategories.map((category) => ({ id: category.id, titleFa: category.titleFa.trim(), weightPercent: category.weightPercent, required: true, criteria: category.criteria.map((item) => ({ criterionVersionId: item.criterionVersionId, weightPercent: item.weightPercent })) })),
            ] };
            return templateEditId ? personnelPerformanceAPI.updateTemplate(templateEditId, content) : personnelPerformanceAPI.createTemplate({
            templateKind,
            ownerType: templateKind === "JOB_TEMPLATE" ? "JOB" : "POSITION",
            ownerId: templateOwnerId.trim(),
            content,
          }); }, templateEditId ? "تغییرات الگو ذخیره شد." : "پیش‌نویس الگو ساخته شد.",
        ).then((ok) => ok && (setTemplateDialog(false), setTemplateEditId(undefined)))} />
      </div>}>
        <div className="space-y-4">
          <ErpField label="نوع الگو"><ErpSelect disabled={Boolean(templateEditId)} value={templateKind} onChange={(event) => setTemplateKind(event.target.value as typeof templateKind)}><option value="JOB_TEMPLATE">الگوی ارزیابی شغل</option><option value="POSITION_ADDENDUM">افزوده جایگاه سازمانی</option></ErpSelect></ErpField>
          <ErpField label={templateKind === "JOB_TEMPLATE" ? "شناسه شغل" : "شناسه جایگاه"} required error={!templateOwnerId.trim() ? "شناسه مالک الگو الزامی است." : undefined}><ErpInput disabled={Boolean(templateEditId)} value={templateOwnerId} onChange={(event) => setTemplateOwnerId(event.target.value)} dir="ltr" /></ErpField>
          <ErpField label="عنوان فارسی الگو" required error={!templateTitle.trim() ? "عنوان الگو الزامی است." : undefined}><ErpInput value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} /></ErpField>
          <ErpField label="معیار امتیازآور آغازین" required error={!templateCriterionId ? "یک معیار قضاوتی منتشرشده انتخاب کنید." : undefined}><ErpSelect value={templateCriterionId} onChange={(event) => setTemplateCriterionId(event.target.value)}><option value="">انتخاب کنید</option>{criteria.filter((row) => (row.lifecycle === "ACTIVE" || row.lifecycle === "SCHEDULED") && row.content?.kind === "JUDGMENT").map((row) => <option key={row.id} value={row.id}>{row.content?.titleFa} · نسخه {row.version.toLocaleString("fa-IR")}</option>)}</ErpSelect></ErpField>
          <ErpField label="وزن معیار آغازین" required><ErpInput type="number" min={0} max={100} step={0.01} value={templateCriterionWeight} onChange={(event) => setTemplateCriterionWeight(event.target.value)} /></ErpField>
          {templateAdditionalCriteria.map((item, index) => <ErpCard key={item.id} className="space-y-3 p-3">
            <ErpField label={`معیار اصلی ${(index + 2).toLocaleString("fa-IR")}`} required error={!item.criterionVersionId ? "یک معیار منتشرشده انتخاب کنید." : undefined}><ErpSelect value={item.criterionVersionId} onChange={(event) => {
              const criterionVersionId = event.target.value;
              setTemplateAdditionalCriteria((items) => items.map((candidate) => candidate.id === item.id ? {
                ...candidate,
                criterionVersionId,
                weightPercent: criterionKind(criterionVersionId) === "JUDGMENT" ? candidate.weightPercent : "0.00",
              } : candidate));
            }}><option value="">انتخاب کنید</option>{criteria.filter((row) => row.lifecycle === "ACTIVE" || row.lifecycle === "SCHEDULED").map((row) => <option key={row.id} value={row.id}>{row.content?.titleFa}</option>)}</ErpSelect></ErpField>
            <ErpField label="وزن معیار" required><ErpInput type="number" min={0} max={100} step={0.01} value={item.weightPercent} onChange={(event) => setTemplateAdditionalCriteria((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, weightPercent: event.target.value } : candidate))} /></ErpField>
            <ErpButton label="حذف معیار" tone="danger" variant="ghost" onClick={() => setTemplateAdditionalCriteria((items) => items.filter((candidate) => candidate.id !== item.id))} />
          </ErpCard>)}
          <ErpButton label="افزودن معیار به دسته اصلی" variant="outline" onClick={() => setTemplateAdditionalCriteria((items) => [...items, { id: `main-criterion-${items.length + 2}`, criterionVersionId: "", weightPercent: "0.00" }])} />
          <ErpInlineState kind={Math.abs(mainCriterionWeightTotal - 100) < 0.001 ? "success" : "error"} title={`جمع وزن معیارهای دسته اصلی: ${mainCriterionWeightTotal.toLocaleString("fa-IR")}٪`} />
          <ErpField label="وزن دسته اصلی" required error={Number(templateCategoryWeight) <= 0 || Number(templateCategoryWeight) > 100 ? "وزن باید بین صفر و صد باشد." : undefined}><ErpInput type="number" min={0.01} max={100} step={0.01} value={templateCategoryWeight} onChange={(event) => setTemplateCategoryWeight(event.target.value)} /></ErpField>
          {templateExtraCategories.map((category, index) => <ErpCard key={category.id} className="space-y-3 p-3">
            <ErpField label={`عنوان دسته ${(index + 2).toLocaleString("fa-IR")}`} required error={!category.titleFa.trim() ? "عنوان دسته الزامی است." : undefined}><ErpInput value={category.titleFa} onChange={(event) => setTemplateExtraCategories((items) => items.map((item) => item.id === category.id ? { ...item, titleFa: event.target.value } : item))} /></ErpField>
            <ErpField label="وزن دسته" required error={Number(category.weightPercent) <= 0 || Number(category.weightPercent) > 100 ? "وزن باید بین صفر و صد باشد." : undefined}><ErpInput type="number" min={0.01} max={100} step={0.01} value={category.weightPercent} onChange={(event) => setTemplateExtraCategories((items) => items.map((item) => item.id === category.id ? { ...item, weightPercent: event.target.value } : item))} /></ErpField>
            {category.criteria.map((criterion, criterionIndex) => <div key={criterion.id} className="grid gap-3 md:grid-cols-[1fr_10rem_auto]">
              <ErpField label={`معیار ${(criterionIndex + 1).toLocaleString("fa-IR")}`} required error={!criterion.criterionVersionId ? "معیار را انتخاب کنید." : undefined}><ErpSelect value={criterion.criterionVersionId} onChange={(event) => {
                const criterionVersionId = event.target.value;
                setTemplateExtraCategories((items) => items.map((item) => item.id === category.id ? { ...item, criteria: item.criteria.map((candidate) => candidate.id === criterion.id ? { ...candidate, criterionVersionId, weightPercent: criterionKind(criterionVersionId) === "JUDGMENT" ? candidate.weightPercent : "0.00" } : candidate) } : item));
              }}><option value="">انتخاب کنید</option>{criteria.filter((row) => row.lifecycle === "ACTIVE" || row.lifecycle === "SCHEDULED").map((row) => <option key={row.id} value={row.id}>{row.content?.titleFa}</option>)}</ErpSelect></ErpField>
              <ErpField label="وزن معیار"><ErpInput type="number" min={0} max={100} step={0.01} value={criterion.weightPercent} onChange={(event) => setTemplateExtraCategories((items) => items.map((item) => item.id === category.id ? { ...item, criteria: item.criteria.map((candidate) => candidate.id === criterion.id ? { ...candidate, weightPercent: event.target.value } : candidate) } : item))} /></ErpField>
              <ErpButton label="حذف معیار" tone="danger" variant="ghost" onClick={() => setTemplateExtraCategories((items) => items.map((item) => item.id === category.id ? { ...item, criteria: item.criteria.filter((candidate) => candidate.id !== criterion.id) } : item))} />
            </div>)}
            <ErpButton label="افزودن معیار به دسته" variant="outline" onClick={() => setTemplateExtraCategories((items) => items.map((item) => item.id === category.id ? { ...item, criteria: [...item.criteria, { id: `${category.id}-criterion-${item.criteria.length + 1}`, criterionVersionId: "", weightPercent: "0.00" }] } : item))} />
            <ErpButton label="حذف دسته" tone="danger" variant="ghost" onClick={() => setTemplateExtraCategories((items) => items.filter((item) => item.id !== category.id))} />
          </ErpCard>)}
          <ErpButton label="افزودن دسته وزنی" variant="outline" onClick={() => setTemplateExtraCategories((items) => [...items, { id: `category-${items.length + 2}`, titleFa: "", weightPercent: "0.00", criteria: [{ id: `category-${items.length + 2}-criterion-1`, criterionVersionId: "", weightPercent: "100.00" }] }])} />
          <ErpInlineState kind={Math.abs([templateCategoryWeight, ...templateExtraCategories.map((category) => category.weightPercent)].reduce((sum, value) => sum + Number(value), 0) - 100) < 0.001 ? "success" : "error"} title={`جمع وزن دسته‌ها: ${[templateCategoryWeight, ...templateExtraCategories.map((category) => category.weightPercent)].reduce((sum, value) => sum + Number(value), 0).toLocaleString("fa-IR")}٪`} />
        </div>
      </ErpSheet>

      <ErpSheet open={Boolean(scheduleTarget)} onClose={() => !pending && setScheduleTarget(undefined)} title="پیش‌نمایش و زمان‌بندی انتشار" presentation="modal" size="wide" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="بازگشت" variant="ghost" onClick={() => setScheduleTarget(undefined)} />
        <ErpButton label="تأیید و زمان‌بندی" variant="solid" disabled={pending || !effectiveDate || publicationReason.trim().length < 8 || !impactConfirmed || (scheduleTarget?.kind === "policies" && !preview) || (preview?.errors ?? 0) > 0} onClick={() => scheduleTarget && void run(async () => {
          const payload = { effectiveFrom: tehranDayStartIso(effectiveDate), reason: publicationReason.trim() };
          if (scheduleTarget.kind === "criteria") await personnelPerformanceAPI.scheduleCriterion(scheduleTarget.row.id, payload);
          else if (scheduleTarget.kind === "templates") await personnelPerformanceAPI.scheduleTemplate(scheduleTarget.row.id, payload);
          else await personnelPerformanceAPI.schedulePolicy(scheduleTarget.row.id, { ...payload, confirmedPreviewHash: preview!.resultHash, confirmedPopulationHash: preview!.populationHash });
        }, "نسخه با پیش‌نمایش تأییدشده زمان‌بندی شد.").then((ok) => ok && setScheduleTarget(undefined))} />
      </div>}>
        <div className="space-y-4">
          {preview && <ErpSummaryGrid columns={3} items={summarizePreview(preview).map((item) => ({ ...item, value: item.value.toLocaleString("fa-IR") }))} />}
          <ErpPersianDateField label="تاریخ اثر" value={effectiveDate} onChange={(value) => { setEffectiveDate(value); if (scheduleTarget?.kind === "policies") setPreview(undefined); }} required />
          {scheduleTarget?.kind === "policies" && !preview && <ErpButton label="به‌روزرسانی پیش‌نمایش این تاریخ" variant="outline" disabled={!effectiveDate || pending} onClick={() => void run(async () => {
            const response = await personnelPerformanceAPI.previewPolicy(scheduleTarget.row.id, tehranDayStartIso(effectiveDate));
            setPreview({ ...response.data.preview.preview.counts, resultHash: response.data.preview.preview.resultHash, populationHash: response.data.preview.sourcePopulationHash });
          }, "پیش‌نمایش جمعیت برای تاریخ اثر به‌روز شد.")} />}
          <ErpField label="دلیل انتشار" required error={publicationReason.trim().length < 8 ? "دلیل قابل حسابرسی باید دست‌کم ۸ نویسه باشد." : undefined}><ErpTextarea value={publicationReason} onChange={(event) => setPublicationReason(event.target.value)} /></ErpField>
          <ErpCheckbox checked={impactConfirmed} onChange={(event) => setImpactConfirmed(event.target.checked)} label="اثر این نسخه و نتیجه پیش‌نمایش جمعیت را بررسی و صریحاً تأیید می‌کنم." />
        </div>
      </ErpSheet>

      <ErpSheet open={Boolean(lifecycleAction)} onClose={() => !pending && setLifecycleAction(undefined)} title={lifecycleAction?.action === "cancel" ? "لغو نسخه زمان‌بندی‌شده" : "بازنشسته‌کردن نسخه فعال"} presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2">
        <ErpButton label="بازگشت" variant="ghost" onClick={() => setLifecycleAction(undefined)} />
        <ErpButton label={lifecycleAction?.action === "cancel" ? "تأیید لغو" : "تأیید بازنشستگی"} tone={lifecycleAction?.action === "cancel" ? "danger" : "warning"} variant="solid" disabled={pending || lifecycleReason.trim().length < 8} onClick={() => lifecycleAction && void run(
          () => lifecycleAction.action === "cancel"
            ? personnelPerformanceAPI.cancelVersion(lifecycleAction.kind, lifecycleAction.row.id, lifecycleReason.trim())
            : personnelPerformanceAPI.retireVersion(lifecycleAction.kind as "criteria" | "templates", lifecycleAction.row.id, lifecycleReason.trim()),
          lifecycleAction.action === "cancel" ? "زمان‌بندی نسخه لغو شد." : "نسخه بازنشسته شد.",
        ).then((ok) => ok && setLifecycleAction(undefined))} />
      </div>}>
        <ErpField label="دلیل قابل حسابرسی" required error={lifecycleReason.trim().length < 8 ? "دلیل قابل حسابرسی باید دست‌کم ۸ نویسه باشد." : undefined}>
          <ErpTextarea value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} />
        </ErpField>
      </ErpSheet>
    </ErpPage>
  );
}
