"use client";

import { useState } from "react";
import { ErpBadge, ErpButton, ErpCard, ErpField, ErpInput, ErpSection, ErpTextarea } from "@/components/erp";
import { applicantHiringAPI } from "@/lib/hiringApi";
import { normalizeNumericText } from "@/lib/numberFormat";
import { parseLocalizedAssessmentScore } from "./assessmentScore";

type AssessmentKind = "DISC" | "EQ" | "BIG_FIVE";
type Draft = Record<string, string> & { notes: string };

const labels: Record<AssessmentKind, string> = {
  DISC: "DISC (الگوی رفتاری)",
  EQ: "EQ (هوش هیجانی)",
  BIG_FIVE: "BIG FIVE (پنج عامل شخصیت)",
};

const fields: Record<AssessmentKind, Array<{ key: string; label: string }>> = {
  DISC: [
    { key: "dominance", label: "تسلط‌گرایی (D)" },
    { key: "influence", label: "تأثیرگذاری (I)" },
    { key: "steadiness", label: "ثبات (S)" },
    { key: "conscientiousness", label: "وظیفه‌شناسی (C)" },
  ],
  EQ: [{ key: "score", label: "امتیاز کل هوش هیجانی" }],
  BIG_FIVE: [
    { key: "openness", label: "پذیرش تجربه‌های جدید" },
    { key: "conscientiousness", label: "وظیفه‌شناسی" },
    { key: "extraversion", label: "برون‌گرایی" },
    { key: "agreeableness", label: "توافق‌پذیری" },
    { key: "neuroticism", label: "روان‌رنجوری" },
  ],
};

const emptyDraft = (): Draft => ({ notes: "" });

export function ApplicantFormalAssessments({
  assessments,
  busy,
  run,
  showValidationErrors = false,
  onAssessmentValid,
}: {
  assessments?: {
    planVersion: number;
    selections: Array<{ assessmentKind: AssessmentKind; completed: boolean }>;
  } | null;
  busy: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void | boolean>;
  showValidationErrors?: boolean;
  onAssessmentValid?: (kind: AssessmentKind) => void;
}) {
  const [drafts, setDrafts] = useState<Partial<Record<AssessmentKind, Draft>>>({});
  const [attachments, setAttachments] = useState<Partial<Record<AssessmentKind, File[]>>>({});
  if (!assessments?.selections.length) return null;

  const update = (kind: AssessmentKind, key: string, value: string) => {
    setDrafts((current) => {
      const next = { ...(current[kind] || emptyDraft()), [key]: value };
      if (fields[kind].every((field) => !parseLocalizedAssessmentScore(next[field.key]).error)) onAssessmentValid?.(kind);
      return { ...current, [kind]: next };
    });
  };
  const complete = (kind: AssessmentKind) => fields[kind].every(({ key }) => !parseLocalizedAssessmentScore(drafts[kind]?.[key]).error);

  const submit = async (kind: AssessmentKind) => {
    await applicantHiringAPI.submitFormalAssessmentResult(kind, drafts[kind] || {});
    const files = attachments[kind] || [];
    if (files.length) await applicantHiringAPI.uploadFormalAssessmentEvidence(kind, files);
  };

  return (
    <ErpSection
      title="ارزیابی‌های رسمی"
      description={`برنامه ارزیابی نسخه ${assessments.planVersion.toLocaleString("fa-IR")} · همه امتیازها بین ۰ تا ۱۰۰ هستند.`}
    >
      <div className="space-y-3">
        {assessments.selections.map((selection) => (
          <ErpCard key={selection.assessmentKind} className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{labels[selection.assessmentKind]}</b>
              <ErpBadge tone={selection.completed ? "success" : "warning"}>
                {selection.completed ? "تکمیل‌شده" : "نیازمند تکمیل"}
              </ErpBadge>
            </div>
            {!selection.completed && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {fields[selection.assessmentKind].map((item, index) => {
                    const value = drafts[selection.assessmentKind]?.[item.key] || "";
                    const scoreError = parseLocalizedAssessmentScore(value).error;
                    return (
                    <ErpField key={item.key} label={item.label} error={(showValidationErrors || value.trim().length > 0) ? scoreError : undefined}>
                      <ErpInput
                        id={index === 0 ? `applicant-field-assessment-${selection.assessmentKind}` : `applicant-field-assessment-${selection.assessmentKind}-${item.key}`}
                        inputMode="decimal"
                        value={value}
                        onChange={(event) => update(selection.assessmentKind, item.key, normalizeNumericText(event.target.value))}
                        aria-label={`امتیاز ${item.label}`}
                        placeholder="۰ تا ۱۰۰"
                      />
                    </ErpField>
                  );})}
                </div>
                <ErpTextarea
                  value={drafts[selection.assessmentKind]?.notes || ""}
                  onChange={(event) => update(selection.assessmentKind, "notes", event.target.value)}
                  placeholder="یادداشت اختیاری"
                  aria-label={`یادداشت ${labels[selection.assessmentKind]}`}
                />
                <label className="block space-y-1 text-sm font-semibold">
                  <span>نمودارها و گزارش‌ها (اختیاری، حداکثر ۵ فایل)</span>
                  <ErpInput
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={(event) => setAttachments((current) => ({
                      ...current,
                      [selection.assessmentKind]: Array.from(event.target.files || []).slice(0, 5),
                    }))}
                  />
                </label>
                <ErpButton
                  label="ثبت نهایی نتیجه"
                  tone="success"
                  disabled={busy || !complete(selection.assessmentKind)}
                  onClick={() => run(
                    () => submit(selection.assessmentKind),
                    "نتیجه ارزیابی ثبت شد.",
                  )}
                />
              </>
            )}
          </ErpCard>
        ))}
      </div>
    </ErpSection>
  );
}
