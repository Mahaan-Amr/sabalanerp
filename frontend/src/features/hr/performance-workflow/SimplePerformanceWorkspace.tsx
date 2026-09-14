"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
} from "@/components/erp";
import { personnelPerformanceAPI } from "@/lib/api";
import { dateFa, dateTimeFa } from "@/features/hr/hrUi";
import BehaviorSurveyAdministration from "@/features/hr/performance-survey/BehaviorSurveyAdministration";
import { nextPerformancePeriodKey, type PerformancePeriodKey } from "./performancePeriod";

type Indicator = {
  id: string; code: string; categoryFa?: string | null; titleFa: string; unitFa: string;
  target: string; direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | "CAPPED_RATE"; weightPercent: string; sortOrder: number;
  familyCode?: string | null; sourceKind?: "SYSTEM" | "SUPERVISOR" | "SURVEY"; minimumSampleCount?: number;
};
type Profile = { id: string; stableKey: string; nameFa: string; version: number; effectivePeriodKey?: string | null; jobId?: string | null; indicators: Indicator[] };
type Personnel = { id: string; firstName: string; lastName: string; employeeNumber?: string | null; department?: { name: string } | null };
type Assignment = { personnelId: string; profileId: string; profile: Profile };
type Value = { indicatorId: string; actual: string; score?: string | null; sampleCount?: number | null; sourceReference?: string | null };
type Evaluation = {
  id: string; personnelId: string; evaluationDate: string; status: "DRAFT" | "PENDING_APPEAL" | "FINAL";
  createdAt: string;
  evaluatorUserId: string; evaluatorAuthority: "SUPERVISOR" | "HR_MANAGER"; score?: string | null;
  levelCode?: string | null; finalizedAt?: string | null; correctionOfId?: string | null;
  correctionReason?: string | null; supersededAt?: string | null; profile: Profile; values: Value[];
  periodLabelFa?: string | null; proposedAt?: string | null; appealDeadline?: string | null;
  appealText?: string | null; appealedAt?: string | null; appealResolution?: string | null; appealResolvedAt?: string | null;
  evaluatorNameFa: string;
};
type LegacyEvaluation = {
  id: string; levelLabelFa: string; displayScore?: string | null; measurementTo: string;
  acceptedAt: string; status: string;
};
type Workspace = {
  currentUserId: string;
  currentPeriodKey: PerformancePeriodKey;
  evaluablePersonnelIds: string[];
  latestFinalizedAtByPersonnel: Record<string, string>;
  personnel: Personnel[]; historyPersonnel: Personnel[]; profiles: Profile[]; assignments: Assignment[]; evaluations: Evaluation[];
  jobs: Array<{ id: string; title: string }>;
  capabilities: Record<string, boolean>;
};
type ProfileIndicatorDraft = Omit<Indicator, "id" | "sortOrder">;

const levelLabels: Record<string, string> = {
  COMPANION: "همراه", DILIGENT: "کوشا", WORTHY: "شایسته", CAPABLE: "توانمند",
  SUPERIOR: "برتر", EXCELLENT: "سرآمد", ROLE_MODEL: "الگو",
};
const levelTones: Record<string, "neutral" | "warning" | "success" | "primary" | "purple"> = {
  COMPANION: "neutral", DILIGENT: "warning", WORTHY: "success", CAPABLE: "success",
  SUPERIOR: "primary", EXCELLENT: "purple", ROLE_MODEL: "purple",
};
const todayInTehran = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const monthFa = (value: string) => new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric", month: "long", timeZone: "Asia/Tehran",
}).format(new Date(value));
const scoreFa = (value?: string | null) => {
  if (!value) return "—";
  const [whole, fraction = ""] = value.split(".");
  const shortFraction = fraction.slice(0, 4).replace(/0+$/, "");
  return `${whole}${shortFraction ? `٫${shortFraction}` : ""}`.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
};
const errorText = (error: unknown) => {
  const candidate = error as { response?: { data?: { message?: string } }; message?: string };
  return candidate.response?.data?.message || candidate.message || "انجام کار ممکن نشد.";
};
const emptyIndicator = (): ProfileIndicatorDraft => ({
  code: "", categoryFa: "", titleFa: "", unitFa: "", target: "", direction: "HIGHER_IS_BETTER", weightPercent: "",
  familyCode: "", sourceKind: "SYSTEM", minimumSampleCount: 1,
});
const previewPerformance = (profile: Profile | undefined, values: Record<string, string>) => {
  if (!profile || !profile.indicators.every(({ id }) => values[id]?.trim())) return null;
  const score = profile.indicators.reduce((total, indicator) => {
    const target = Number(indicator.target);
    const actual = Number(values[indicator.id]);
    let indicatorScore: number;
    if (indicator.direction === "HIGHER_IS_BETTER") {
      indicatorScore = actual <= target ? actual / target * 75 : 75 + ((actual / target - 1) / 0.2 * 25);
    } else if (indicator.direction === "CAPPED_RATE") {
      indicatorScore = actual <= target ? actual / target * 75 : 75 + ((actual - target) / (100 - target) * 25);
    } else if (target === 0) indicatorScore = actual === 0 ? 100 : 0;
    else indicatorScore = actual <= target ? 100 - actual / target * 25 : 75 - (actual / target - 1) * 75;
    indicatorScore = Math.max(0, Math.min(100, indicatorScore));
    return total + indicatorScore * Number(indicator.weightPercent) / 100;
  }, 0);
  const level = score >= 97 ? "ROLE_MODEL" : score >= 90 ? "EXCELLENT" : score >= 80 ? "SUPERIOR"
    : score >= 70 ? "CAPABLE" : score >= 60 ? "WORTHY" : score >= 50 ? "DILIGENT" : "COMPANION";
  return { score: score.toFixed(2), level };
};

export default function SimplePerformanceWorkspace() {
  const searchParams = useSearchParams();
  const requestedPersonnelId = searchParams.get("personnelId") || "";
  const directEvaluationOpened = useRef(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<"evaluate" | "profiles" | "surveys" | "history">("evaluate");
  const [personnelId, setPersonnelId] = useState("");
  const [evaluationId, setEvaluationId] = useState("");
  const [newEvaluationOpen, setNewEvaluationOpen] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmedSeriousViolation, setConfirmedSeriousViolation] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [evaluationDate, setEvaluationDate] = useState(todayInTehran());
  const [values, setValues] = useState<Record<string, string>>({});
  const [valueMetadata, setValueMetadata] = useState<Record<string, { sampleCount: string; sourceReference: string }>>({});
  const [evidenceChangeReason, setEvidenceChangeReason] = useState("");
  const [savedValuesSignature, setSavedValuesSignature] = useState("{}");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileStableKey, setProfileStableKey] = useState<string | undefined>();
  const [profileEffectivePeriodKey, setProfileEffectivePeriodKey] = useState("");
  const [profileJobId, setProfileJobId] = useState("");
  const [profileIndicators, setProfileIndicators] = useState<ProfileIndicatorDraft[]>([emptyIndicator()]);
  const [correctionReason, setCorrectionReason] = useState<Record<string, string>>({});
  const [appealResolution, setAppealResolution] = useState<Record<string, string>>({});
  const [publishEvaluationId, setPublishEvaluationId] = useState("");
  const [resolveAppealId, setResolveAppealId] = useState("");
  const [history, setHistory] = useState<Evaluation[]>([]);
  const [legacyHistory, setLegacyHistory] = useState<LegacyEvaluation[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasMore, setHistoryHasMore] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await personnelPerformanceAPI.simpleWorkspace();
      const next = response.data as Workspace;
      setWorkspace(next);
      setPersonnelId((current) => current || (next.personnel.some(({ id }) => id === requestedPersonnelId) ? requestedPersonnelId : "") || next.personnel[0]?.id || next.historyPersonnel[0]?.id || "");
      if (!directEvaluationOpened.current && requestedPersonnelId
        && next.evaluablePersonnelIds.includes(requestedPersonnelId)
        && next.assignments.some(({ personnelId }) => personnelId === requestedPersonnelId)) {
        directEvaluationOpened.current = true;
        setNewEvaluationOpen(true);
      }
    } catch (cause) { setError(errorText(cause)); }
  }, [requestedPersonnelId]);
  useEffect(() => { void load(); }, [load]);

  const loadHistory = useCallback(async (selectedPersonnelId: string, page = 1) => {
    if (!selectedPersonnelId) return;
    try {
      const response = await personnelPerformanceAPI.simpleHistory(selectedPersonnelId, page);
      const data = response.data as { evaluations: Evaluation[]; legacyEvaluations: LegacyEvaluation[]; hasMore: boolean; legacyHasMore: boolean };
      setHistory((current) => page === 1 ? data.evaluations : [...current, ...data.evaluations]);
      setLegacyHistory((current) => page === 1 ? data.legacyEvaluations : [...current, ...data.legacyEvaluations]);
      setHistoryPage(page); setHistoryHasMore(data.hasMore || data.legacyHasMore);
    } catch (cause) { setError(errorText(cause)); }
  }, []);
  useEffect(() => {
    if (tab === "history" && workspace?.capabilities.VIEW_PERFORMANCE_EVALUATIONS) void loadHistory(personnelId);
  }, [loadHistory, personnelId, tab, workspace?.capabilities.VIEW_PERFORMANCE_EVALUATIONS]);

  const selectedEvaluation = workspace?.evaluations.find(({ id }) => id === evaluationId);
  useEffect(() => {
    if (!selectedEvaluation) return;
    const nextValues = Object.fromEntries(selectedEvaluation.values.map((value) => [value.indicatorId, String(value.actual)]));
    const nextMetadata = Object.fromEntries(selectedEvaluation.values.map((value) => [value.indicatorId, {
      sampleCount: String(value.sampleCount ?? 1), sourceReference: value.sourceReference || "",
    }]));
    setValues(nextValues); setValueMetadata(nextMetadata); setSavedValuesSignature(JSON.stringify({ values: nextValues, metadata: nextMetadata }));
  }, [selectedEvaluation]);
  const selectedPersonnel = workspace?.personnel.find(({ id }) => id === personnelId);
  const assignment = workspace?.assignments.find((item) => item.personnelId === personnelId);
  const activeProfile = selectedEvaluation?.profile ?? (newEvaluationOpen ? assignment?.profile : undefined);
  const historyGroups = useMemo(() => {
    const groups = new Map<string, Evaluation[]>();
    for (const evaluation of history.filter(({ status }) => status === "FINAL")) {
      const month = monthFa(evaluation.evaluationDate);
      groups.set(month, [...(groups.get(month) ?? []), evaluation]);
    }
    return Array.from(groups.entries());
  }, [history]);
  const openDrafts = (workspace?.evaluations ?? []).filter(({ status, evaluatorUserId }) => status === "DRAFT"
    && (evaluatorUserId === workspace?.currentUserId || workspace?.capabilities.FINALIZE_PERFORMANCE_RESULTS));
  const pendingResults = (workspace?.evaluations ?? []).filter(({ status }) => status === "PENDING_APPEAL");
  const canEvaluate = Boolean(workspace?.capabilities.EVALUATE_DIRECT_REPORTS || workspace?.capabilities.EVALUATE_ALL_PERSONNEL
    || workspace?.capabilities.ENTER_PERFORMANCE_EVIDENCE);
  const canEvaluateSelected = Boolean(workspace?.evaluablePersonnelIds.includes(personnelId));
  const canManageProfiles = Boolean(workspace?.capabilities.MANAGE_PERFORMANCE_PROFILES);
  const canManageSurveys = Boolean(workspace?.capabilities.MANAGE_PERFORMANCE_SURVEYS);
  const canViewHistory = Boolean(workspace?.capabilities.VIEW_PERFORMANCE_EVALUATIONS);
  const canFinalize = Boolean(workspace?.capabilities.FINALIZE_PERFORMANCE_RESULTS);
  const canEditSelected = canEvaluateSelected;
  const canEditIndicator = (indicator: Indicator) => canEditSelected && indicator.sourceKind !== "SURVEY" && (
    Boolean(workspace?.capabilities.EVALUATE_ALL_PERSONNEL)
    || (indicator.sourceKind === "SYSTEM" && Boolean(workspace?.capabilities.ENTER_PERFORMANCE_EVIDENCE))
    || (indicator.sourceKind === "SUPERVISOR" && Boolean(workspace?.capabilities.EVALUATE_DIRECT_REPORTS))
  );
  const enteredValues = activeProfile?.indicators.flatMap((indicator) => {
    if (indicator.sourceKind === "SURVEY") return [];
    const actual = values[indicator.id]?.trim();
    const metadata = valueMetadata[indicator.id];
    return actual ? [{ indicatorId: indicator.id, actual, sampleCount: Number(metadata?.sampleCount || 1), sourceReference: metadata?.sourceReference || "" }] : [];
  }) ?? [];
  const draftComplete = Boolean(activeProfile?.indicators.every((indicator) => indicator.sourceKind === "SURVEY" || values[indicator.id]?.trim()));
  const preview = useMemo(() => previewPerformance(activeProfile, values), [activeProfile, values]);
  const newerFinalExists = Boolean(selectedEvaluation
    && workspace?.latestFinalizedAtByPersonnel[selectedEvaluation.personnelId]
    && workspace.latestFinalizedAtByPersonnel[selectedEvaluation.personnelId] > selectedEvaluation.createdAt);
  const valuesSignature = JSON.stringify({ values, metadata: valueMetadata });
  const dirty = enteredValues.length > 0 && valuesSignature !== savedValuesSignature;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const run = async (work: () => Promise<void>, message: string) => {
    setPending(true); setError(""); setSuccess("");
    try { await work(); setSuccess(message); await load(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setPending(false); }
  };

  const beginEvaluation = () => {
    setEvaluationId(""); setValues({}); setValueMetadata({}); setEvidenceChangeReason(""); setSavedValuesSignature("{}"); setNewEvaluationOpen(true); setError(""); setSuccess("");
  };
  const closeEvaluation = () => {
    if (dirty) return setConfirmDiscard(true);
    setEvaluationId(""); setNewEvaluationOpen(false); setValues({}); setValueMetadata({}); setEvidenceChangeReason(""); setSavedValuesSignature("{}");
  };
  const discardEvaluation = () => {
    setConfirmDiscard(false); setEvaluationId(""); setNewEvaluationOpen(false); setValues({}); setValueMetadata({}); setEvidenceChangeReason(""); setSavedValuesSignature("{}");
  };

  const saveDraft = () => dirty && run(async () => {
    let id = selectedEvaluation?.id ?? "";
    if (!id) {
      const response = await personnelPerformanceAPI.createSimpleEvaluation({ personnelId, evaluationDate });
      id = response.data.evaluation.id;
      setEvaluationId(id); setNewEvaluationOpen(false);
    }
    await personnelPerformanceAPI.saveSimpleEvaluation(id, enteredValues, evidenceChangeReason);
    setEvidenceChangeReason("");
    setSavedValuesSignature(valuesSignature);
  }, "پیش‌نویس ذخیره شد.");

  const finalize = () => run(async () => {
    let id = selectedEvaluation?.id ?? "";
    if (!id) {
      const response = await personnelPerformanceAPI.createSimpleEvaluation({ personnelId, evaluationDate });
      id = response.data.evaluation.id;
    }
    if (!selectedEvaluation || selectedEvaluation.evaluatorUserId === workspace?.currentUserId) {
      await personnelPerformanceAPI.saveSimpleEvaluation(id, enteredValues, evidenceChangeReason);
      setEvidenceChangeReason("");
    }
    await personnelPerformanceAPI.finalizeSimpleEvaluation(id, { confirmedSeriousViolation });
    setEvaluationId(""); setNewEvaluationOpen(false); setValues({}); setValueMetadata({}); setSavedValuesSignature("{}"); setConfirmFinalize(false); setConfirmedSeriousViolation(false);
  }, "نتیجه پیشنهادی ثبت شد و پس از فرصت اعتراض قابل انتشار رسمی است.");

  const resolveAppeal = (evaluationId: string) => run(async () => {
    await personnelPerformanceAPI.resolveSimpleEvaluationAppeal(evaluationId, appealResolution[evaluationId] || "");
    setResolveAppealId("");
  }, "رسیدگی به اعتراض ثبت شد.");

  const publishResult = () => run(async () => {
    await personnelPerformanceAPI.publishSimpleEvaluation(publishEvaluationId);
    setPublishEvaluationId("");
  }, "نتیجه رسمی منتشر و Badge به‌روزرسانی شد.");

  const saveProfile = () => run(async () => {
    await personnelPerformanceAPI.createSimpleProfile({
      ...(profileStableKey ? { stableKey: profileStableKey } : {}), nameFa: profileName,
      effectivePeriodKey: profileEffectivePeriodKey || undefined,
      jobId: profileJobId || undefined,
      indicators: profileIndicators,
    });
    setProfileName(""); setProfileStableKey(undefined); setProfileEffectivePeriodKey(""); setProfileJobId(""); setProfileIndicators([emptyIndicator()]);
  }, "الگو ذخیره شد.");

  const beginProfileVersion = (profile: Profile) => {
    setProfileStableKey(profile.stableKey); setProfileName(profile.nameFa);
    setProfileEffectivePeriodKey(nextPerformancePeriodKey(workspace?.currentPeriodKey || "1405-H1"));
    setProfileJobId(profile.jobId || "");
    setProfileIndicators(profile.indicators.map(({ code, categoryFa, titleFa, unitFa, target, direction, weightPercent, familyCode, sourceKind, minimumSampleCount }) => ({
      code, categoryFa, titleFa, unitFa, target: String(target), direction, weightPercent: String(weightPercent),
      familyCode, sourceKind: sourceKind ?? "SYSTEM", minimumSampleCount: minimumSampleCount ?? 1,
    })));
  };

  const loadSellerTemplate = () => run(async () => {
    const response = await personnelPerformanceAPI.sellerPerformancePolicy();
    const existing = workspace?.profiles.find(({ stableKey }) => stableKey === "sales-seven-level");
    setProfileStableKey("sales-seven-level"); setProfileName("فروشندگان ـ ارزیابی هفت‌سطحی");
    setProfileEffectivePeriodKey(existing ? nextPerformancePeriodKey(workspace!.currentPeriodKey) : workspace?.currentPeriodKey || "");
    setProfileJobId(existing?.jobId || "");
    setProfileIndicators(response.data.factors.map((factor: any) => ({
      code: factor.code, categoryFa: factor.familyCode, familyCode: factor.familyCode,
      titleFa: factor.titleFa, unitFa: factor.unitFa, direction: factor.direction,
      weightPercent: String(factor.weightPercent), sourceKind: factor.sourceKind,
      minimumSampleCount: factor.minimumSampleCount, target: ["SUPERVISOR", "SURVEY"].includes(factor.sourceKind) ? "75" : "",
    })));
  }, "عوامل مصوب فروشندگان بارگذاری شد؛ هدف‌های کمی را پیش از ذخیره تعیین کنید.");

  const beginCorrection = (evaluation: Evaluation) => run(async () => {
    const response = await personnelPerformanceAPI.correctSimpleEvaluation(evaluation.id, correctionReason[evaluation.id] || "");
    setEvaluationId(response.data.evaluation.id); setTab("evaluate");
  }, "نسخه اصلاحی ساخته شد.");

  if (!workspace && !error) return <ErpLoading />;
  return <ErpPage
    eyebrow="منابع انسانی"
    title="ارزیابی عملکرد"
    description="مقدار واقعی را وارد کنید. امتیاز خودکار محاسبه می‌شود."
    backHref="/dashboard/hr/personnel"
  >
    {error && <ErpInlineState kind="error" title={error} action={{ label: "تلاش دوباره", onClick: () => void load() }} />}
    {success && <ErpInlineState kind="success" title={success} />}
    {workspace && <>
      <ErpSegmentedControl value={tab} onChange={setTab} options={[
        { value: "evaluate", label: "ارزیابی" },
        { value: "profiles", label: "فرم‌ها", disabled: !canManageProfiles },
        { value: "surveys", label: "نظرسنجی", disabled: !canManageSurveys },
        { value: "history", label: "سابقه", disabled: !canViewHistory },
      ]} />

      {tab === "evaluate" && <div className="space-y-4">
        <ErpSection title="انتخاب پرسنل">
          <div className="grid gap-3 md:grid-cols-2">
            <ErpField label="پرسنل"><ErpSelect value={personnelId} onChange={(event) => { setPersonnelId(event.target.value); setEvaluationId(""); setNewEvaluationOpen(false); setValues({}); setValueMetadata({}); setSavedValuesSignature("{}"); }}>
              {workspace.personnel.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}
            </ErpSelect></ErpField>
            <ErpField label="تاریخ ارزیابی"><ErpInput type="date" max={todayInTehran()} value={evaluationDate} onChange={(event) => setEvaluationDate(event.target.value)} /></ErpField>
          </div>
          {selectedPersonnel && <p className="mt-3 text-sm text-[var(--sds-text-secondary)]">فرم: {assignment?.profile.nameFa || "آماده نیست"}</p>}
          {canEvaluateSelected && assignment && !activeProfile && <div className="mt-4"><ErpButton label="ثبت ارزیابی" onClick={beginEvaluation} disabled={pending || !personnelId} /></div>}
          {!assignment && <ErpInlineState kind="empty" title="فرم ارزیابی آماده نیست." action={canManageProfiles ? { label: "آماده‌سازی فرم", onClick: () => setTab("profiles") } : undefined} />}
          {!canEvaluate && <ErpInlineState kind="permission" title="اجازه ثبت ارزیابی ندارید." />}
        </ErpSection>

        {openDrafts.length > 0 && !selectedEvaluation && <ErpSection title="پیش‌نویس‌ها"><div className="space-y-2">
          {openDrafts.map((evaluation) => <ErpCard key={evaluation.id} className="flex items-center justify-between gap-3 p-3">
            <span>{workspace.personnel.find(({ id }) => id === evaluation.personnelId)?.firstName} {workspace.personnel.find(({ id }) => id === evaluation.personnelId)?.lastName} · {dateFa(evaluation.evaluationDate)} · {evaluation.profile.nameFa}</span>
            <ErpButton label="ادامه" variant="soft" onClick={() => { setPersonnelId(evaluation.personnelId); setEvaluationId(evaluation.id); }} />
          </ErpCard>)}
        </div></ErpSection>}

        {canFinalize && pendingResults.length > 0 && <ErpSection title="نتیجه‌های پیشنهادی و اعتراض‌ها"><div className="space-y-3">
          {pendingResults.map((evaluation) => <ErpCard key={evaluation.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{workspace?.personnel.find(({ id }) => id === evaluation.personnelId)?.firstName} {workspace?.personnel.find(({ id }) => id === evaluation.personnelId)?.lastName}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{evaluation.periodLabelFa || dateFa(evaluation.evaluationDate)} · امتیاز {scoreFa(evaluation.score)} · {levelLabels[evaluation.levelCode || ""] || "—"}</p>{evaluation.appealDeadline && <p className="mt-1 text-xs text-[var(--sds-text-muted)]">مهلت اعتراض: {dateTimeFa(evaluation.appealDeadline)}</p>}</div><ErpBadge tone={evaluation.appealedAt ? "warning" : "neutral"}>{evaluation.appealedAt ? "دارای اعتراض" : "در مهلت بازبینی"}</ErpBadge></div>
            {evaluation.appealText && <div className="mt-3 space-y-2"><p className="text-sm leading-7">متن اعتراض: {evaluation.appealText}</p>{!evaluation.appealResolvedAt && <><ErpField label="نتیجه رسیدگی" required><ErpTextarea rows={3} value={appealResolution[evaluation.id] || ""} onChange={(event) => setAppealResolution((items) => ({ ...items, [evaluation.id]: event.target.value }))} /></ErpField><ErpButton label="ثبت رسیدگی" variant="soft" disabled={pending || (appealResolution[evaluation.id] || "").trim().length < 8} onClick={() => setResolveAppealId(evaluation.id)} /></>}</div>}
            <div className="mt-3"><ErpButton label="انتشار نتیجه رسمی" disabled={pending || Boolean(evaluation.appealedAt && !evaluation.appealResolvedAt)} onClick={() => setPublishEvaluationId(evaluation.id)} /></div>
          </ErpCard>)}
        </div></ErpSection>}

        {activeProfile && <ErpSection title={`ارزیابی ${activeProfile.nameFa}`} actions={[{ label: "بستن", onClick: closeEvaluation }]}>
          <div className="space-y-3">{activeProfile.indicators.map((indicator) => <ErpCard key={indicator.id} className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_12rem_10rem] md:items-end">
              <div><p className="font-semibold">{indicator.titleFa}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">هدف: {String(indicator.target)} {indicator.unitFa} · وزن: {String(indicator.weightPercent)}٪ · حداقل نمونه: {(indicator.minimumSampleCount || 1).toLocaleString("fa-IR")}</p></div>
              <ErpField label={`مقدار واقعی (${indicator.unitFa})`} required={indicator.sourceKind !== "SURVEY"}><ErpInput type="number" min="0" inputMode="decimal" disabled={!canEditIndicator(indicator)} value={values[indicator.id] || ""} placeholder={indicator.sourceKind === "SURVEY" ? "از نظرسنجی محاسبه می‌شود" : undefined} onChange={(event) => setValues((current) => ({ ...current, [indicator.id]: event.target.value }))} /></ErpField>
              <ErpField label="تعداد نمونه"><ErpInput type="number" min="0" disabled={!canEditIndicator(indicator)} value={valueMetadata[indicator.id]?.sampleCount || (indicator.sourceKind === "SURVEY" ? "" : "1")} onChange={(event) => setValueMetadata((current) => ({ ...current, [indicator.id]: { sampleCount: event.target.value, sourceReference: current[indicator.id]?.sourceReference || "" } }))} /></ErpField>
            </div>
            <div className="mt-3"><ErpField label="مرجع داده"><ErpInput disabled={!canEditIndicator(indicator)} value={valueMetadata[indicator.id]?.sourceReference || ""} placeholder={indicator.sourceKind === "SURVEY" ? "کمپین‌های معتبر همین دوره" : "شناسه گزارش یا رکورد مبنا"} onChange={(event) => setValueMetadata((current) => ({ ...current, [indicator.id]: { sampleCount: current[indicator.id]?.sampleCount || "1", sourceReference: event.target.value } }))} /></ErpField></div>
          </ErpCard>)}</div>
          {selectedEvaluation?.values.length ? <div className="mt-4"><ErpField label="دلیل اصلاح شواهد" required><ErpTextarea rows={2} value={evidenceChangeReason} onChange={(event) => setEvidenceChangeReason(event.target.value)} placeholder="علت تغییر مقدار، تعداد نمونه یا مرجع داده را ثبت کنید." /></ErpField></div> : null}
          <div className="mt-4 flex flex-wrap gap-2">{canEditSelected && <ErpButton label="ذخیره" variant="soft" onClick={() => void saveDraft()} disabled={pending || !dirty || Boolean(selectedEvaluation?.values.length && !evidenceChangeReason.trim())} />}{canFinalize && <ErpButton label="ثبت نتیجه پیشنهادی" onClick={() => setConfirmFinalize(true)} disabled={pending || !draftComplete || Boolean(dirty && selectedEvaluation?.values.length && !evidenceChangeReason.trim())} />}</div>
        </ErpSection>}
      </div>}

      {tab === "profiles" && canManageProfiles && <div className="space-y-4">
        <ErpSection title={profileStableKey ? "نسخه جدید الگو" : "الگوی تازه"}>
          <div className="mb-4"><ErpButton label="بارگذاری عوامل مصوب فروشندگان" variant="soft" onClick={() => void loadSellerTemplate()} disabled={pending} /></div>
          <ErpField label="نام الگو" required><ErpInput value={profileName} onChange={(event) => setProfileName(event.target.value)} /></ErpField>
          <div className="mt-3"><ErpField label="شغل" required><ErpSelect value={profileJobId} onChange={(event) => setProfileJobId(event.target.value)}><option value="">انتخاب شغل</option>{workspace.jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</ErpSelect></ErpField></div>
          <div className="mt-3"><ErpField label="دوره شروع اثر هدف‌ها" required><ErpSelect value={profileEffectivePeriodKey} onChange={(event) => setProfileEffectivePeriodKey(event.target.value)}><option value={profileStableKey ? nextPerformancePeriodKey(workspace.currentPeriodKey) : workspace.currentPeriodKey}>{profileStableKey ? nextPerformancePeriodKey(workspace.currentPeriodKey) : workspace.currentPeriodKey}</option></ErpSelect></ErpField>{profileStableKey && <p className="mt-1 text-xs text-[var(--sds-text-muted)]">نسخه جدید فقط برای یک دوره آینده پذیرفته می‌شود و هدف‌های دوره آغازشده را تغییر نمی‌دهد.</p>}</div>
          <div className="mt-4 space-y-3">{profileIndicators.map((indicator, index) => <ErpCard key={index} className="p-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <ErpField label="کد" required><ErpInput value={indicator.code} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /></ErpField>
              <ErpField label="عنوان" required><ErpInput value={indicator.titleFa} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, titleFa: event.target.value } : item))} /></ErpField>
              <ErpField label="واحد" required><ErpInput value={indicator.unitFa} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, unitFa: event.target.value } : item))} /></ErpField>
              <ErpField label="هدف" required><ErpInput type="number" min="0" value={indicator.target} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))} /></ErpField>
              <ErpField label="جهت"><ErpSelect value={indicator.direction} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, direction: event.target.value as ProfileIndicatorDraft["direction"] } : item))}><option value="HIGHER_IS_BETTER">بالاتر بهتر</option><option value="LOWER_IS_BETTER">پایین‌تر بهتر</option><option value="CAPPED_RATE">نرخ هدف تا سقف صد</option></ErpSelect></ErpField>
              <ErpField label="وزن (درصد)" required><ErpInput type="number" min="0" max="100" value={indicator.weightPercent} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, weightPercent: event.target.value } : item))} /></ErpField>
              <ErpField label="منبع"><ErpSelect value={indicator.sourceKind || "SYSTEM"} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, sourceKind: event.target.value as ProfileIndicatorDraft["sourceKind"] } : item))}><option value="SYSTEM">داده سیستمی / ورود منابع انسانی</option><option value="SUPERVISOR">قضاوت سرپرست</option><option value="SURVEY">تجمیع نظرسنجی</option></ErpSelect></ErpField>
              <ErpField label="حداقل نمونه"><ErpInput type="number" min="1" value={String(indicator.minimumSampleCount || 1)} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, minimumSampleCount: Number(event.target.value) } : item))} /></ErpField>
            </div>
            {profileIndicators.length > 1 && <div className="mt-3"><ErpButton label="حذف معیار" tone="danger" variant="ghost" onClick={() => setProfileIndicators((items) => items.filter((_, itemIndex) => itemIndex !== index))} /></div>}
          </ErpCard>)}</div>
          <div className="mt-4 flex flex-wrap gap-2"><ErpButton label="افزودن معیار" variant="soft" onClick={() => setProfileIndicators((items) => [...items, emptyIndicator()])} /><ErpButton label="ذخیره الگو" onClick={() => void saveProfile()} disabled={pending} /></div>
        </ErpSection>
        <ErpSection title="الگوهای فعال"><div className="space-y-3">{workspace.profiles.map((profile) => <ErpCard key={profile.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{profile.nameFa}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">نسخه {profile.version.toLocaleString("fa-IR")} · {profile.indicators.length.toLocaleString("fa-IR")} معیار</p></div><ErpButton label="نسخه جدید" variant="soft" onClick={() => beginProfileVersion(profile)} /></div>
        </ErpCard>)}</div></ErpSection>
      </div>}

      {tab === "surveys" && canManageSurveys && <BehaviorSurveyAdministration personnel={workspace.personnel} currentPeriodKey={workspace.currentPeriodKey} />}

      {tab === "history" && canViewHistory && <ErpSection title="سابقه ارزیابی">
        <ErpField label="پرسنل"><ErpSelect value={personnelId} onChange={(event) => setPersonnelId(event.target.value)}>{workspace.historyPersonnel.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</ErpSelect></ErpField>
        <div className="mt-4 space-y-5">{!historyGroups.length && <ErpInlineState kind="empty" title="ارزیابی نهایی ثبت نشده است." />}
          {historyGroups.map(([month, evaluations]) => <div key={month} className="space-y-3">
            <p className="font-semibold">{month}</p>
            {evaluations.map((evaluation) => <ErpCard key={evaluation.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{dateFa(evaluation.evaluationDate)}</p>{evaluation.levelCode && <ErpBadge tone={levelTones[evaluation.levelCode] || "neutral"}>{levelLabels[evaluation.levelCode] || evaluation.levelCode}</ErpBadge>}{evaluation.supersededAt && <ErpBadge tone="neutral">اصلاح‌شده</ErpBadge>}</div><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">امتیاز: {scoreFa(evaluation.score)} · ارزیاب: {evaluation.evaluatorNameFa} ({evaluation.evaluatorAuthority === "HR_MANAGER" ? "منابع انسانی" : "سرپرست"})</p>{evaluation.finalizedAt && <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">نهایی‌شده: {dateTimeFa(evaluation.finalizedAt)}</p>}</div></div>
              {!evaluation.supersededAt && canEvaluateSelected && (workspace.capabilities.EVALUATE_ALL_PERSONNEL || evaluation.evaluatorUserId === workspace.currentUserId) && <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"><ErpField label="دلیل اصلاح"><ErpTextarea rows={2} value={correctionReason[evaluation.id] || ""} onChange={(event) => setCorrectionReason((items) => ({ ...items, [evaluation.id]: event.target.value }))} /></ErpField><div className="md:self-end"><ErpButton label="اصلاح نتیجه" variant="soft" onClick={() => void beginCorrection(evaluation)} disabled={pending} /></div></div>}
            </ErpCard>)}
          </div>)}
          {historyHasMore && <ErpButton label="نمایش بیشتر" variant="soft" onClick={() => void loadHistory(personnelId, historyPage + 1)} />}
          {legacyHistory.length > 0 && <div className="space-y-3"><p className="font-semibold">سابقه قدیمی</p>
            {legacyHistory.map((evaluation) => <ErpCard key={evaluation.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{dateFa(evaluation.measurementTo)}</p><ErpBadge tone="neutral">{evaluation.levelLabelFa}</ErpBadge></div>
              <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">نتیجه قدیمی · فقط برای مشاهده</p>
            </ErpCard>)}
          </div>}
        </div>
      </ErpSection>}
      <ErpSheet open={confirmFinalize} onClose={() => setConfirmFinalize(false)} title="ثبت نتیجه پیشنهادی؟" presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2"><ErpButton label="بازگشت" variant="ghost" onClick={() => setConfirmFinalize(false)} /><ErpButton label="تأیید و ارسال برای بازبینی" onClick={() => void finalize()} disabled={pending} /></div>}>
        <div className="space-y-2 text-sm text-[var(--sds-text-secondary)]">
          <p>{selectedPersonnel?.firstName} {selectedPersonnel?.lastName}</p>
          <p>تاریخ: {dateFa(selectedEvaluation?.evaluationDate || evaluationDate)}</p>
          {preview && <p>امتیاز: {scoreFa(preview.score)} · نشان: {levelLabels[preview.level]}</p>}
          <ErpCheckbox checked={confirmedSeriousViolation} onChange={(event) => setConfirmedSeriousViolation(event.target.checked)} label="تخلف جدی این دوره پس از تکمیل رسیدگی و حق اعتراض، قطعی شده است." />
          {newerFinalExists && <p className="text-[var(--sds-warning)]">بعد از این پیش‌نویس، نتیجه جدیدتری ثبت شده است. با ثبت این ارزیابی، جدیدترین نتیجه نشان داده می‌شود.</p>}
        </div>
      </ErpSheet>
      <ErpSheet open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="بستن بدون ذخیره؟" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="ادامه ویرایش" variant="ghost" onClick={() => setConfirmDiscard(false)} /><ErpButton label="بستن" tone="danger" onClick={discardEvaluation} /></div>}>
        <p className="text-sm text-[var(--sds-text-secondary)]">مقدارهای واردشده ذخیره نشده‌اند.</p>
      </ErpSheet>
      <ErpSheet open={Boolean(publishEvaluationId)} onClose={() => !pending && setPublishEvaluationId("")} title="انتشار نتیجه رسمی؟" presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2"><ErpButton label="بازگشت" variant="ghost" disabled={pending} onClick={() => setPublishEvaluationId("")} /><ErpButton label="تأیید و انتشار" disabled={pending} onClick={() => void publishResult()} /></div>}>
        <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">پس از انتشار، نتیجه در Badge و تصمیم‌های رسمی قابل استفاده است. اگر مهلت اعتراض باز باشد یا اعتراض رسیدگی‌نشده وجود داشته باشد، سامانه انتشار را متوقف می‌کند.</p>
      </ErpSheet>
      <ErpSheet open={Boolean(resolveAppealId)} onClose={() => !pending && setResolveAppealId("")} title="ثبت نتیجه رسیدگی به اعتراض؟" presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2"><ErpButton label="بازگشت" variant="ghost" disabled={pending} onClick={() => setResolveAppealId("")} /><ErpButton label="تأیید و ثبت رسیدگی" disabled={pending} onClick={() => void resolveAppeal(resolveAppealId)} /></div>}>
        <div className="space-y-2 text-sm leading-7 text-[var(--sds-text-secondary)]"><p>این پاسخ در سابقه رسمی اعتراض ثبت می‌شود و پس از آن نتیجه برای انتشار رسمی آماده خواهد بود.</p><p>{appealResolution[resolveAppealId]}</p></div>
      </ErpSheet>
    </>}
  </ErpPage>;
}
