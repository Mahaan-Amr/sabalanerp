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
  ErpTextarea,
} from "@/components/erp";
import { personnelPerformanceAPI } from "@/lib/api";
import { dateFa, dateTimeFa } from "@/features/hr/hrUi";

type Indicator = {
  id: string; code: string; categoryFa?: string | null; titleFa: string; unitFa: string;
  target: string; direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER"; weightPercent: string; sortOrder: number;
};
type Profile = { id: string; stableKey: string; nameFa: string; version: number; indicators: Indicator[] };
type Personnel = { id: string; firstName: string; lastName: string; employeeNumber?: string | null; department?: { name: string } | null };
type Assignment = { personnelId: string; profileId: string; profile: Profile };
type Value = { indicatorId: string; actual: string; score?: string | null };
type Evaluation = {
  id: string; personnelId: string; evaluationDate: string; status: "DRAFT" | "FINAL";
  evaluatorUserId: string; evaluatorAuthority: "SUPERVISOR" | "HR_MANAGER"; score?: string | null;
  levelCode?: string | null; finalizedAt?: string | null; correctionOfId?: string | null;
  correctionReason?: string | null; supersededAt?: string | null; profile: Profile; values: Value[];
  evaluatorNameFa: string;
};
type LegacyEvaluation = {
  id: string; levelLabelFa: string; displayScore?: string | null; measurementTo: string;
  acceptedAt: string; status: string;
};
type Workspace = {
  currentUserId: string;
  evaluablePersonnelIds: string[];
  personnel: Personnel[]; historyPersonnel: Personnel[]; profiles: Profile[]; assignments: Assignment[]; evaluations: Evaluation[];
  capabilities: Record<string, boolean>;
};
type ProfileIndicatorDraft = Omit<Indicator, "id" | "sortOrder">;

const levelLabels: Record<string, string> = {
  URGENT_IMPROVEMENT: "نیازمند بهبود فوری",
  NEEDS_IMPROVEMENT: "نیازمند بهبود",
  MEETS_EXPECTATIONS: "مطابق انتظار",
  EXCEEDS_EXPECTATIONS: "فراتر از انتظار",
  OUTSTANDING: "عملکرد برجسته",
};
const levelTones: Record<string, "danger" | "warning" | "success" | "primary" | "purple"> = {
  URGENT_IMPROVEMENT: "danger", NEEDS_IMPROVEMENT: "warning", MEETS_EXPECTATIONS: "success",
  EXCEEDS_EXPECTATIONS: "primary", OUTSTANDING: "purple",
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
});

export default function SimplePerformanceWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<"evaluate" | "profiles" | "history">("evaluate");
  const [personnelId, setPersonnelId] = useState("");
  const [evaluationId, setEvaluationId] = useState("");
  const [evaluationDate, setEvaluationDate] = useState(todayInTehran());
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileStableKey, setProfileStableKey] = useState<string | undefined>();
  const [profileIndicators, setProfileIndicators] = useState<ProfileIndicatorDraft[]>([emptyIndicator()]);
  const [correctionReason, setCorrectionReason] = useState<Record<string, string>>({});
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
      setPersonnelId((current) => current || next.personnel[0]?.id || next.historyPersonnel[0]?.id || "");
    } catch (cause) { setError(errorText(cause)); }
  }, []);
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
    setValues(Object.fromEntries(selectedEvaluation.values.map((value) => [value.indicatorId, String(value.actual)])));
  }, [selectedEvaluation]);
  const selectedPersonnel = workspace?.personnel.find(({ id }) => id === personnelId);
  const assignment = workspace?.assignments.find((item) => item.personnelId === personnelId);
  const historyGroups = useMemo(() => {
    const groups = new Map<string, Evaluation[]>();
    for (const evaluation of history.filter(({ status }) => status === "FINAL")) {
      const month = monthFa(evaluation.evaluationDate);
      groups.set(month, [...(groups.get(month) ?? []), evaluation]);
    }
    return Array.from(groups.entries());
  }, [history]);
  const openDrafts = (workspace?.evaluations ?? []).filter(({ status, evaluatorUserId }) => status === "DRAFT" && evaluatorUserId === workspace?.currentUserId);
  const canEvaluate = Boolean(workspace?.capabilities.EVALUATE_DIRECT_REPORTS || workspace?.capabilities.EVALUATE_ALL_PERSONNEL);
  const canEvaluateSelected = Boolean(workspace?.evaluablePersonnelIds.includes(personnelId));
  const canManageProfiles = Boolean(workspace?.capabilities.MANAGE_PERFORMANCE_PROFILES);
  const canViewHistory = Boolean(workspace?.capabilities.VIEW_PERFORMANCE_EVALUATIONS);
  const draftComplete = Boolean(selectedEvaluation?.profile.indicators.every((indicator) => values[indicator.id]?.trim()));

  const run = async (work: () => Promise<void>, message: string) => {
    setPending(true); setError(""); setSuccess("");
    try { await work(); setSuccess(message); await load(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setPending(false); }
  };

  const beginEvaluation = () => run(async () => {
    const response = await personnelPerformanceAPI.createSimpleEvaluation({ personnelId, evaluationDate });
    setEvaluationId(response.data.evaluation.id);
  }, "ارزیابی تازه ساخته شد.");

  const saveDraft = () => selectedEvaluation && run(async () => {
    await personnelPerformanceAPI.saveSimpleEvaluation(selectedEvaluation.id, selectedEvaluation.profile.indicators.flatMap((indicator) => {
      const actual = values[indicator.id]?.trim();
      return actual ? [{ indicatorId: indicator.id, actual }] : [];
    }));
  }, "پیش‌نویس ذخیره شد.");

  const finalize = () => selectedEvaluation && run(async () => {
    await personnelPerformanceAPI.saveSimpleEvaluation(selectedEvaluation.id, selectedEvaluation.profile.indicators.flatMap((indicator) => {
      const actual = values[indicator.id]?.trim();
      return actual ? [{ indicatorId: indicator.id, actual }] : [];
    }));
    await personnelPerformanceAPI.finalizeSimpleEvaluation(selectedEvaluation.id);
    setEvaluationId("");
  }, "ارزیابی نهایی شد.");

  const assignProfile = () => run(async () => {
    await personnelPerformanceAPI.assignSimpleProfile({ personnelId, profileId });
  }, "الگو انتخاب شد.");

  const saveProfile = () => run(async () => {
    await personnelPerformanceAPI.createSimpleProfile({
      ...(profileStableKey ? { stableKey: profileStableKey } : {}), nameFa: profileName,
      indicators: profileIndicators,
    });
    setProfileName(""); setProfileStableKey(undefined); setProfileIndicators([emptyIndicator()]);
  }, "الگو ذخیره شد.");

  const beginProfileVersion = (profile: Profile) => {
    setProfileStableKey(profile.stableKey); setProfileName(profile.nameFa);
    setProfileIndicators(profile.indicators.map(({ code, categoryFa, titleFa, unitFa, target, direction, weightPercent }) => ({
      code, categoryFa, titleFa, unitFa, target: String(target), direction, weightPercent: String(weightPercent),
    })));
  };

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
        { value: "profiles", label: "الگوها", disabled: !canManageProfiles },
        { value: "history", label: "سابقه", disabled: !canViewHistory },
      ]} />

      {tab === "evaluate" && <div className="space-y-4">
        <ErpSection title="انتخاب پرسنل">
          <div className="grid gap-3 md:grid-cols-2">
            <ErpField label="پرسنل"><ErpSelect value={personnelId} onChange={(event) => { setPersonnelId(event.target.value); setEvaluationId(""); }}>
              {workspace.personnel.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}
            </ErpSelect></ErpField>
            <ErpField label="تاریخ ارزیابی"><ErpInput type="date" max={todayInTehran()} value={evaluationDate} onChange={(event) => setEvaluationDate(event.target.value)} /></ErpField>
          </div>
          {selectedPersonnel && <p className="mt-3 text-sm text-[var(--sds-text-secondary)]">الگو: {assignment?.profile.nameFa || "انتخاب نشده"}</p>}
          {canEvaluateSelected && assignment && <div className="mt-4"><ErpButton label="ارزیابی تازه" onClick={() => void beginEvaluation()} disabled={pending || !personnelId} /></div>}
          {!assignment && <ErpInlineState kind="empty" title="برای این پرسنل الگو انتخاب نشده است." />}
          {!canEvaluate && <ErpInlineState kind="permission" title="اجازه ثبت ارزیابی ندارید." />}
        </ErpSection>

        {openDrafts.length > 0 && !selectedEvaluation && <ErpSection title="پیش‌نویس‌ها"><div className="space-y-2">
          {openDrafts.map((evaluation) => <ErpCard key={evaluation.id} className="flex items-center justify-between gap-3 p-3">
            <span>{workspace.personnel.find(({ id }) => id === evaluation.personnelId)?.firstName} {workspace.personnel.find(({ id }) => id === evaluation.personnelId)?.lastName} · {dateFa(evaluation.evaluationDate)} · {evaluation.profile.nameFa}</span>
            <ErpButton label="ادامه" variant="soft" onClick={() => { setPersonnelId(evaluation.personnelId); setEvaluationId(evaluation.id); }} />
          </ErpCard>)}
        </div></ErpSection>}

        {selectedEvaluation?.status === "DRAFT" && <ErpSection title={`ارزیابی ${selectedEvaluation.profile.nameFa}`} actions={[{ label: "بستن", onClick: () => setEvaluationId("") }]}>
          <div className="space-y-3">{selectedEvaluation.profile.indicators.map((indicator) => <ErpCard key={indicator.id} className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_12rem] md:items-end">
              <div><p className="font-semibold">{indicator.titleFa}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">هدف: {String(indicator.target)} {indicator.unitFa} · وزن: {String(indicator.weightPercent)}٪</p></div>
              <ErpField label={`مقدار واقعی (${indicator.unitFa})`} required><ErpInput type="number" min="0" inputMode="decimal" value={values[indicator.id] || ""} onChange={(event) => setValues((current) => ({ ...current, [indicator.id]: event.target.value }))} /></ErpField>
            </div>
          </ErpCard>)}</div>
          <div className="mt-4 flex flex-wrap gap-2"><ErpButton label="ذخیره پیش‌نویس" variant="soft" onClick={() => void saveDraft()} disabled={pending} /><ErpButton label="نهایی‌کردن" onClick={() => void finalize()} disabled={pending || !draftComplete} /></div>
        </ErpSection>}
      </div>}

      {tab === "profiles" && canManageProfiles && <div className="space-y-4">
        <ErpSection title="انتخاب الگو برای پرسنل">
          <div className="grid gap-3 md:grid-cols-2"><ErpField label="پرسنل"><ErpSelect value={personnelId} onChange={(event) => setPersonnelId(event.target.value)}>{workspace.personnel.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</ErpSelect></ErpField>
          <ErpField label="الگو"><ErpSelect value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">انتخاب کنید</option>{workspace.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.nameFa}</option>)}</ErpSelect></ErpField></div>
          <div className="mt-4"><ErpButton label="ثبت الگو" onClick={() => void assignProfile()} disabled={pending || !personnelId || !profileId} /></div>
        </ErpSection>
        <ErpSection title={profileStableKey ? "نسخه جدید الگو" : "الگوی تازه"}>
          <ErpField label="نام الگو" required><ErpInput value={profileName} onChange={(event) => setProfileName(event.target.value)} /></ErpField>
          <div className="mt-4 space-y-3">{profileIndicators.map((indicator, index) => <ErpCard key={index} className="p-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <ErpField label="کد" required><ErpInput value={indicator.code} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /></ErpField>
              <ErpField label="عنوان" required><ErpInput value={indicator.titleFa} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, titleFa: event.target.value } : item))} /></ErpField>
              <ErpField label="واحد" required><ErpInput value={indicator.unitFa} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, unitFa: event.target.value } : item))} /></ErpField>
              <ErpField label="هدف" required><ErpInput type="number" min="0" value={indicator.target} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))} /></ErpField>
              <ErpField label="جهت"><ErpSelect value={indicator.direction} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, direction: event.target.value as ProfileIndicatorDraft["direction"] } : item))}><option value="HIGHER_IS_BETTER">بالاتر بهتر</option><option value="LOWER_IS_BETTER">پایین‌تر بهتر</option></ErpSelect></ErpField>
              <ErpField label="وزن (درصد)" required><ErpInput type="number" min="0" max="100" value={indicator.weightPercent} onChange={(event) => setProfileIndicators((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, weightPercent: event.target.value } : item))} /></ErpField>
            </div>
            {profileIndicators.length > 1 && <div className="mt-3"><ErpButton label="حذف معیار" tone="danger" variant="ghost" onClick={() => setProfileIndicators((items) => items.filter((_, itemIndex) => itemIndex !== index))} /></div>}
          </ErpCard>)}</div>
          <div className="mt-4 flex flex-wrap gap-2"><ErpButton label="افزودن معیار" variant="soft" onClick={() => setProfileIndicators((items) => [...items, emptyIndicator()])} /><ErpButton label="ذخیره الگو" onClick={() => void saveProfile()} disabled={pending} /></div>
        </ErpSection>
        <ErpSection title="الگوهای فعال"><div className="space-y-3">{workspace.profiles.map((profile) => <ErpCard key={profile.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{profile.nameFa}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">نسخه {profile.version.toLocaleString("fa-IR")} · {profile.indicators.length.toLocaleString("fa-IR")} معیار</p></div><ErpButton label="نسخه جدید" variant="soft" onClick={() => beginProfileVersion(profile)} /></div>
        </ErpCard>)}</div></ErpSection>
      </div>}

      {tab === "history" && canViewHistory && <ErpSection title="سابقه ارزیابی">
        <ErpField label="پرسنل"><ErpSelect value={personnelId} onChange={(event) => setPersonnelId(event.target.value)}>{workspace.historyPersonnel.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</ErpSelect></ErpField>
        <div className="mt-4 space-y-5">{!historyGroups.length && <ErpInlineState kind="empty" title="ارزیابی نهایی ثبت نشده است." />}
          {historyGroups.map(([month, evaluations]) => <div key={month} className="space-y-3">
            <p className="font-semibold">{month}</p>
            {evaluations.map((evaluation) => <ErpCard key={evaluation.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{dateFa(evaluation.evaluationDate)}</p>{evaluation.levelCode && <ErpBadge tone={levelTones[evaluation.levelCode] || "neutral"}>{levelLabels[evaluation.levelCode] || evaluation.levelCode}</ErpBadge>}{evaluation.supersededAt && <ErpBadge tone="neutral">اصلاح‌شده</ErpBadge>}</div><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">امتیاز: {scoreFa(evaluation.score)} · ارزیاب: {evaluation.evaluatorNameFa} ({evaluation.evaluatorAuthority === "HR_MANAGER" ? "منابع انسانی" : "سرپرست"})</p>{evaluation.finalizedAt && <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">نهایی‌شده: {dateTimeFa(evaluation.finalizedAt)}</p>}</div></div>
              {!evaluation.supersededAt && canEvaluateSelected && <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"><ErpField label="دلیل اصلاح"><ErpTextarea rows={2} value={correctionReason[evaluation.id] || ""} onChange={(event) => setCorrectionReason((items) => ({ ...items, [evaluation.id]: event.target.value }))} /></ErpField><div className="md:self-end"><ErpButton label="اصلاح نتیجه" variant="soft" onClick={() => void beginCorrection(evaluation)} disabled={pending} /></div></div>}
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
    </>}
  </ErpPage>;
}
