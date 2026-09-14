"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpSection,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
} from "@/components/erp";
import { personnelPerformanceAPI } from "@/lib/api";

type Personnel = { id: string; firstName: string; lastName: string; employeeNumber?: string | null };
type Question = { sectionCode: string; promptFa: string };
type Campaign = {
  id: string; titleFa: string; periodKey: string; version: number; status: string;
  questions: Array<Question & { id: string }>;
  targets: Array<{ personnelId: string }>;
  respondents: Array<{ personnelId: string }>;
};

const sections = [
  ["RESPECT", "احترام و رفتار حرفه‌ای"], ["TEAMWORK", "همکاری و کار تیمی"],
  ["ACCOUNTABILITY", "مسئولیت‌پذیری و پیگیری"], ["COMMUNICATION", "ارتباط روشن و مؤثر"],
  ["LEARNING", "یادگیری و پذیرش بازخورد"], ["WORKPLACE_STANDARD", "استاندارد مصوب محیط کار"],
] as const;
const initialQuestions: Question[] = [
  { sectionCode: "RESPECT", promptFa: "این همکار با مشتریان و همکاران محترمانه و آرام رفتار می‌کند." },
  { sectionCode: "RESPECT", promptFa: "این همکار هنگام اختلاف‌نظر از رفتار نامناسب خودداری می‌کند." },
  { sectionCode: "TEAMWORK", promptFa: "این همکار اطلاعات لازم را به‌موقع با اعضای مرتبط تیم به اشتراک می‌گذارد." },
  { sectionCode: "TEAMWORK", promptFa: "این همکار در انجام تعهدهای مشترک با تیم همکاری می‌کند." },
  { sectionCode: "ACCOUNTABILITY", promptFa: "این همکار کاری را که پذیرفته است تا رسیدن به نتیجه پیگیری می‌کند." },
  { sectionCode: "ACCOUNTABILITY", promptFa: "این همکار تأخیر، اشتباه یا مانع را به‌موقع اعلام می‌کند." },
  { sectionCode: "COMMUNICATION", promptFa: "این همکار منظور و اطلاعات لازم را روشن و قابل‌فهم بیان می‌کند." },
  { sectionCode: "COMMUNICATION", promptFa: "این همکار به صحبت دیگران گوش می‌دهد و از درک درست موضوع مطمئن می‌شود." },
  { sectionCode: "LEARNING", promptFa: "این همکار بازخورد حرفه‌ای را می‌پذیرد و برای اصلاح عملکرد استفاده می‌کند." },
  { sectionCode: "LEARNING", promptFa: "این همکار برای یادگیری روش‌ها و جلوگیری از تکرار اشتباه تلاش می‌کند." },
  { sectionCode: "WORKPLACE_STANDARD", promptFa: "این همکار استاندارد مصوب پوشش و آراستگی محیط کار را رعایت می‌کند." },
  { sectionCode: "WORKPLACE_STANDARD", promptFa: "این همکار نظافت شخصی و نظم فضای کاری مرتبط با مسئولیتش را رعایت می‌کند." },
];

const campaignStatusPresentation: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  ACTIVE: { label: "فعال", tone: "success" },
  CLOSED: { label: "بسته", tone: "neutral" },
  DRAFT: { label: "پیش‌نویس", tone: "warning" },
};

export default function BehaviorSurveyAdministration({ personnel, currentPeriodKey }: { personnel: Personnel[]; currentPeriodKey: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [editingId, setEditingId] = useState("");
  const [titleFa, setTitleFa] = useState("");
  const [periodKey, setPeriodKey] = useState(currentPeriodKey);
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [targets, setTargets] = useState<string[]>([]);
  const [respondents, setRespondents] = useState<string[]>([]);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activationCampaignId, setActivationCampaignId] = useState("");

  const load = useCallback(async () => {
    try { setCampaigns((await personnelPerformanceAPI.behaviorSurveys()).data.campaigns); }
    catch (requestError: any) { setError(requestError.response?.data?.message || "دریافت نظرسنجی‌ها انجام نشد."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const reset = () => {
    setEditingId(""); setTitleFa(""); setPeriodKey(currentPeriodKey); setQuestions(initialQuestions);
    setTargets([]); setRespondents([]); setOpensAt(""); setClosesAt("");
  };
  const edit = (campaign: Campaign) => {
    setEditingId(campaign.id); setTitleFa(campaign.titleFa); setPeriodKey(campaign.periodKey);
    setQuestions(campaign.questions.map(({ sectionCode, promptFa }) => ({ sectionCode, promptFa })));
    setTargets(campaign.targets.map(({ personnelId }) => personnelId));
    setRespondents(campaign.respondents.map(({ personnelId }) => personnelId));
  };
  const save = async () => {
    setPending(true); setError(""); setMessage("");
    try {
      const input = { titleFa, periodKey, questions, targetPersonnelIds: targets, respondentPersonnelIds: respondents };
      if (editingId) await personnelPerformanceAPI.updateBehaviorSurvey(editingId, input);
      else await personnelPerformanceAPI.createBehaviorSurvey(input);
      setMessage("پیش‌نویس نظرسنجی ذخیره شد."); reset(); await load();
    } catch (requestError: any) { setError(requestError.response?.data?.message || "ذخیره نظرسنجی انجام نشد."); }
    finally { setPending(false); }
  };
  const activate = async (campaignId: string) => {
    setPending(true); setError(""); setMessage("");
    try {
      await personnelPerformanceAPI.activateBehaviorSurvey(campaignId, { opensAt: new Date(opensAt).toISOString(), closesAt: new Date(closesAt).toISOString() });
      setMessage("نسخه نظرسنجی فعال و قفل شد."); setActivationCampaignId(""); await load();
    } catch (requestError: any) { setError(requestError.response?.data?.message || "فعال‌سازی انجام نشد."); }
    finally { setPending(false); }
  };

  return <div className="space-y-4" dir="rtl">
    {error && <ErpInlineState kind="error" title={error} />}{message && <ErpInlineState kind="success" title={message} />}
    <ErpSection title={editingId ? "ویرایش پیش‌نویس نظرسنجی" : "نظرسنجی رفتاری جدید"} description="شش بخش رفتاری ثابت‌اند؛ پرسش‌های هر بخش را می‌توانید آزادانه ویرایش، جابه‌جا، حذف یا اضافه کنید.">
      <div className="grid gap-3 md:grid-cols-2"><ErpField label="عنوان" required><ErpInput value={titleFa} onChange={(event) => setTitleFa(event.target.value)} /></ErpField><ErpField label="دوره" required><ErpInput value={periodKey} onChange={(event) => setPeriodKey(event.target.value)} placeholder="1405-H2" /></ErpField></div>
      <div className="mt-4 space-y-3">{questions.map((question, index) => <ErpCard key={index} className="p-4">
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]"><ErpField label="بخش"><ErpSelect value={question.sectionCode} onChange={(event) => setQuestions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, sectionCode: event.target.value } : item))}>{sections.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</ErpSelect></ErpField><ErpField label="متن پرسش" required><ErpTextarea rows={2} value={question.promptFa} onChange={(event) => setQuestions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, promptFa: event.target.value } : item))} /></ErpField></div>
        <div className="mt-3 flex flex-wrap gap-2"><ErpButton label="بالاتر" variant="ghost" disabled={index === 0} onClick={() => setQuestions((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} /><ErpButton label="پایین‌تر" variant="ghost" disabled={index === questions.length - 1} onClick={() => setQuestions((items) => { const next = [...items]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })} /><ErpButton label="حذف" tone="danger" variant="ghost" onClick={() => setQuestions((items) => items.filter((_, itemIndex) => itemIndex !== index))} /></div>
      </ErpCard>)}</div>
      <div className="mt-3"><ErpButton label="افزودن پرسش" variant="soft" onClick={() => setQuestions((items) => [...items, { sectionCode: "RESPECT", promptFa: "" }])} /></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2"><ErpCard className="p-4"><p className="font-bold">افراد مورد ارزیابی</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{personnel.map((person) => <ErpCheckbox key={person.id} label={`${person.firstName} ${person.lastName}`} checked={targets.includes(person.id)} onChange={(event) => setTargets((items) => event.target.checked ? [...items, person.id] : items.filter((id) => id !== person.id))} />)}</div></ErpCard><ErpCard className="p-4"><p className="font-bold">پاسخ‌دهندگان</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{personnel.map((person) => <ErpCheckbox key={person.id} label={`${person.firstName} ${person.lastName}`} checked={respondents.includes(person.id)} onChange={(event) => setRespondents((items) => event.target.checked ? [...items, person.id] : items.filter((id) => id !== person.id))} />)}</div></ErpCard></div>
      <div className="mt-4 flex flex-wrap gap-2"><ErpButton label="ذخیره پیش‌نویس" disabled={pending} onClick={() => void save()} />{editingId && <ErpButton label="انصراف" variant="ghost" onClick={reset} />}</div>
    </ErpSection>
    <ErpSection title="نسخه‌های نظرسنجی"><div className="space-y-3">{campaigns.map((campaign) => {
      const presentation = campaignStatusPresentation[campaign.status] ?? campaignStatusPresentation.DRAFT;
      return <ErpCard key={campaign.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{campaign.titleFa}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{campaign.periodKey} · نسخه {campaign.version.toLocaleString("fa-IR")} · {campaign.questions.length.toLocaleString("fa-IR")} پرسش</p></div><ErpBadge tone={presentation.tone}>{presentation.label}</ErpBadge></div>{campaign.status === "DRAFT" && <><div className="mt-4 grid gap-3 md:grid-cols-2"><ErpField label="شروع"><ErpInput type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} /></ErpField><ErpField label="پایان"><ErpInput type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} /></ErpField></div><div className="mt-3 flex flex-wrap gap-2"><ErpButton label="ویرایش" variant="soft" onClick={() => edit(campaign)} /><ErpButton label="فعال‌سازی و قفل نسخه" disabled={pending || !opensAt || !closesAt} onClick={() => setActivationCampaignId(campaign.id)} /></div></>}</ErpCard>;
    })}</div></ErpSection>
    <ErpSheet open={Boolean(activationCampaignId)} onClose={() => !pending && setActivationCampaignId("")} title="فعال‌سازی و قفل نسخه؟" presentation="modal" pending={pending} footer={<div className="flex justify-end gap-2"><ErpButton label="بازگشت" variant="ghost" disabled={pending} onClick={() => setActivationCampaignId("")} /><ErpButton label="تأیید و فعال‌سازی" disabled={pending} onClick={() => void activate(activationCampaignId)} /></div>}>
      <p className="text-sm text-[var(--sds-text-secondary)]">پس از فعال‌سازی، متن و ترتیب پرسش‌ها و فهرست شرکت‌کنندگان این نسخه قابل ویرایش نیست. برای تغییرات بعدی باید نسخه تازه‌ای بسازید.</p>
    </ErpSheet>
  </div>;
}
