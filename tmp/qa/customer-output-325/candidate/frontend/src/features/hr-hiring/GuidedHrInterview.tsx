"use client";

import { useMemo, useState } from "react";
import { ErpBadge, ErpButton, ErpCard, ErpSegmentedControl, ErpTextarea } from "@/components/erp";
import { advanceGuidedCriterion, guidedInterviewSummary, type GuidedScore } from "./guidedInterviewState";

const scoreLabels = { 1: "بسیار ضعیف", 2: "ضعیف", 3: "قابل قبول", 4: "خوب", 5: "عالی" } as const;
const interviewCriteria = [
  ["appearance", "نوع پوشش"], ["grooming", "آراستگی"], ["resume", "رزومه"],
  ["address", "نشانی و تناسب رفت‌وآمد"], ["responsibility", "مسئولیت‌پذیری"],
  ["honesty", "صداقت"], ["teamwork", "روحیه کار تیمی"], ["resilience", "تاب‌آوری و تحمل فشار"],
  ["communication", "مهارت ارتباطی"], ["motivation", "انگیزه شغلی"], ["previousJob", "علت ترک شغل قبلی"],
  ["stability", "ثبات شغلی"], ["selfView", "نقاط قوت و ضعف"], ["workplaceValues", "ارزش‌های محیط کار مطلوب"],
  ["createdValues", "ارزش قابل ایجاد برای سازمان"], ["achievement", "دستاورد شغلی مورد انتظار"],
  ["companion", "حضور با همراه برای مصاحبه"],
].map(([id, title], index) => ({ id, title, order: index + 1 }));

export function GuidedHrInterview({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const criterionIds = useMemo(() => interviewCriteria.map(({ id }) => id), []);
  const [currentId, setCurrentId] = useState(criterionIds[0]);
  const [answers, setAnswers] = useState<Record<string, GuidedScore>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState("POSITIVE");
  const [analysis, setAnalysis] = useState("");
  const current = interviewCriteria.find(({ id }) => id === currentId) || interviewCriteria[0];
  const summary = guidedInterviewSummary(criterionIds, answers);
  const finalCriterion = interviewCriteria[interviewCriteria.length - 1];

  const score = (value: GuidedScore) => {
    setAnswers((previous) => ({ ...previous, [current.id]: value }));
    setCurrentId(advanceGuidedCriterion(criterionIds, current.id, current.id));
  };

  return (
    <ErpCard className="mb-4 space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <b>مسیر هدایت‌شده مصاحبه اولیه HR</b>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
            معیار {current.order.toLocaleString("fa-IR")} از {interviewCriteria.length.toLocaleString("fa-IR")}
          </p>
        </div>
        <ErpBadge tone={summary.completed === summary.total ? "success" : "info"}>
          {summary.completed.toLocaleString("fa-IR")} پاسخ ثبت‌شده
        </ErpBadge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="معیارهای مصاحبه">
        {interviewCriteria.map((criterion) => (
          <ErpButton
            key={criterion.id}
            label={`${criterion.order.toLocaleString("fa-IR")}. ${criterion.title}`}
            variant={criterion.id === current.id ? "solid" : "outline"}
            tone={answers[criterion.id] !== undefined ? "success" : "neutral"}
            onClick={() => setCurrentId(criterion.id)}
          />
        ))}
      </div>

      <ErpCard className="space-y-3 p-4" aria-live="polite">
        <div>
          <b>{current.title}</b>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {([1, 2, 3, 4, 5] as const).map((value) => (
            <ErpButton
              key={value}
              label={`${value.toLocaleString("fa-IR")} · ${scoreLabels[value]}`}
              variant={answers[current.id] === value ? "solid" : "outline"}
              onClick={() => score(value)}
            />
          ))}
          <ErpButton
            label="ارزیابی نشد"
            variant={answers[current.id] === "UNASSESSED" ? "solid" : "outline"}
            tone="neutral"
            onClick={() => score("UNASSESSED")}
          />
        </div>
        <ErpTextarea
          value={notes[current.id] || ""}
          onChange={(event) => setNotes({ ...notes, [current.id]: event.target.value })}
          placeholder="یادداشت این معیار (اختیاری)"
        />
      </ErpCard>

      {summary.completed === summary.total && (
        <ErpCard className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>جمع‌بندی مصاحبه</b>
            <span className="text-xs text-[var(--sds-text-secondary)]">
              معیار نهایی حفظ‌شده: {finalCriterion.title} · {String(summary.finalCriterionValue)}
            </span>
          </div>
          <ErpSegmentedControl
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: "POSITIVE", label: "نتیجه مثبت" },
              { value: "NEGATIVE", label: "نتیجه منفی" },
            ]}
          />
          <ErpTextarea value={analysis} onChange={(event) => setAnalysis(event.target.value)} placeholder="تحلیل و دلیل نتیجه مصاحبه" />
          <ErpButton
            label="ثبت نسخه مصاحبه"
            tone="success"
            disabled={busy || !analysis.trim()}
            onClick={() => onSubmit({
              outcome,
              explanation: `${analysis.trim()} | معیار نهایی: ${finalCriterion.title} = ${String(summary.finalCriterionValue)}`,
              guidedInterview: {
                version: 1,
                criteria: interviewCriteria.map((criterion) => ({
                  criterionId: criterion.id,
                  order: criterion.order,
                  score: answers[criterion.id],
                  note: notes[criterion.id]?.trim() || null,
                })),
                finalCriterionId: finalCriterion.id,
                finalCriterionScore: summary.finalCriterionValue,
              },
            })}
          />
        </ErpCard>
      )}
    </ErpCard>
  );
}
