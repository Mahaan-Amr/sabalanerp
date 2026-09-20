"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ErpButton,
  ErpCard,
  ErpField,
  ErpInlineState,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpTextarea,
} from "@/components/erp";
import { personnelPerformanceAPI } from "@/lib/api";
import { dateTimeFa } from "@/features/hr/hrUi";

type Question = { id: string; sectionCode: string; promptFa: string; sortOrder: number };
type Answer = { questionId: string; optionCode: string };
type Response = { targetPersonnelId: string; status: "DRAFT" | "FINAL"; commentText?: string | null; answers: Answer[] };
type Campaign = {
  id: string; titleFa: string; closesAt: string; questions: Question[];
  targets: Array<{ personnelId: string; personnel: { firstName: string; lastName: string; employeeNumber?: string | null } | null }>;
  responses: Response[];
};

const options = [
  { value: "STRONGLY_DISAGREE", label: "کاملاً مخالفم" },
  { value: "DISAGREE", label: "مخالفم" },
  { value: "NEUTRAL", label: "نه موافقم نه مخالف" },
  { value: "AGREE", label: "موافقم" },
  { value: "STRONGLY_AGREE", label: "کاملاً موافقم" },
  { value: "INSUFFICIENT_INFORMATION", label: "اطلاعات کافی ندارم" },
] as const;

const responseKey = (campaignId: string, targetId: string, questionId: string) => `${campaignId}:${targetId}:${questionId}`;
const targetKey = (campaignId: string, targetId: string) => `${campaignId}:${targetId}`;

export default function PersonalBehaviorSurveys() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await personnelPerformanceAPI.assignedBehaviorSurveys();
      const next = response.data.campaigns as Campaign[];
      const loadedAnswers: Record<string, string> = {};
      const loadedComments: Record<string, string> = {};
      for (const campaign of next) for (const saved of campaign.responses) {
        loadedComments[targetKey(campaign.id, saved.targetPersonnelId)] = saved.commentText || "";
        for (const answer of saved.answers) loadedAnswers[responseKey(campaign.id, saved.targetPersonnelId, answer.questionId)] = answer.optionCode;
      }
      setAnswers(loadedAnswers); setComments(loadedComments); setCampaigns(next);
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || "دریافت نظرسنجی‌ها انجام نشد.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalTargets = useMemo(() => campaigns?.reduce((sum, campaign) => sum + campaign.targets.length, 0) ?? 0, [campaigns]);

  const save = async (campaign: Campaign, targetPersonnelId: string, submit: boolean) => {
    const key = targetKey(campaign.id, targetPersonnelId);
    setPendingKey(key); setError(""); setMessage("");
    try {
      await personnelPerformanceAPI.saveBehaviorSurveyResponse(campaign.id, targetPersonnelId, {
        submit,
        commentText: comments[key] || "",
        answers: campaign.questions.flatMap((question) => {
          const optionCode = answers[responseKey(campaign.id, targetPersonnelId, question.id)];
          return optionCode ? [{ questionId: question.id, optionCode }] : [];
        }),
      });
      setMessage(submit ? "پاسخ محرمانه ثبت شد و تا پایان مهلت قابل اصلاح است." : "پیش‌نویس ذخیره شد.");
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || "ذخیره پاسخ انجام نشد.");
    } finally { setPendingKey(""); }
  };

  if (!campaigns && !error) return <ErpLoading />;
  return <ErpPage eyebrow="امور شخصی" title="نظرسنجی رفتاری همکاران" description="پاسخ‌ها و توضیحات شما محرمانه است و امتیاز هر همکار بدون نمایش هویت پاسخ‌دهندگان محاسبه می‌شود." backHref="/dashboard/personal">
    <div className="space-y-4" dir="rtl">
      {error && <ErpInlineState kind="error" title={error} action={{ label: "تلاش دوباره", onClick: () => void load() }} />}
      {message && <ErpInlineState kind="success" title={message} />}
      {campaigns && totalTargets === 0 && <ErpInlineState kind="empty" title="در حال حاضر نظرسنجی بازی برای شما وجود ندارد." />}
      {campaigns?.map((campaign) => <ErpSection key={campaign.id} title={campaign.titleFa} description={`مهلت پاسخ: ${dateTimeFa(campaign.closesAt)}`}>
        <div className="space-y-5">{campaign.targets.map((target) => {
          const key = targetKey(campaign.id, target.personnelId);
          const complete = campaign.questions.every((question) => answers[responseKey(campaign.id, target.personnelId, question.id)]);
          return <ErpCard key={target.personnelId} className="p-4">
            <h2 className="font-black">{target.personnel ? `${target.personnel.firstName} ${target.personnel.lastName}` : "همکار انتخاب‌شده"}</h2>
            <div className="mt-4 space-y-5">{campaign.questions.map((question) => <ErpField key={question.id} label={question.promptFa} required>
              <ErpSegmentedControl
                value={answers[responseKey(campaign.id, target.personnelId, question.id)] || ""}
                onChange={(value) => setAnswers((current) => ({ ...current, [responseKey(campaign.id, target.personnelId, question.id)]: value }))}
                options={[...options]}
              />
            </ErpField>)}</div>
            <div className="mt-5"><ErpField label="توضیح محرمانه (اختیاری)"><ErpTextarea rows={3} maxLength={4000} value={comments[key] || ""} onChange={(event) => setComments((current) => ({ ...current, [key]: event.target.value }))} /></ErpField></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <ErpButton label="ذخیره پیش‌نویس" variant="soft" disabled={Boolean(pendingKey)} onClick={() => void save(campaign, target.personnelId, false)} />
              <ErpButton label="ثبت پاسخ" disabled={Boolean(pendingKey) || !complete} onClick={() => void save(campaign, target.personnelId, true)} />
            </div>
          </ErpCard>;
        })}</div>
      </ErpSection>)}
    </div>
  </ErpPage>;
}
