"use client";

import { useState } from "react";
import { ErpBadge, ErpButton, ErpCard, ErpSection, ErpTextarea } from "@/components/erp";
import { applicantHiringAPI } from "@/lib/hiringApi";

type AssessmentKind = "DISC" | "EQ" | "BIG_FIVE";

const labels: Record<AssessmentKind, string> = {
  DISC: "DISC (الگوی رفتاری)",
  EQ: "EQ (هوش هیجانی)",
  BIG_FIVE: "BIG FIVE (پنج عامل شخصیت)",
};

export function ApplicantFormalAssessments({
  assessments,
  busy,
  run,
}: {
  assessments?: { planVersion: number; selections: Array<{ assessmentKind: AssessmentKind; completed: boolean }> } | null;
  busy: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Partial<Record<AssessmentKind, string>>>({});
  if (!assessments?.selections.length) return null;

  return (
    <ErpSection title="ارزیابی‌های رسمی" description={`برنامه ارزیابی نسخه ${assessments.planVersion.toLocaleString("fa-IR")}`}>
      <div className="space-y-3">
        {assessments.selections.map((selection) => (
          <ErpCard key={selection.assessmentKind} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{labels[selection.assessmentKind]}</b>
              <ErpBadge tone={selection.completed ? "success" : "warning"}>
                {selection.completed ? "تکمیل‌شده" : "در انتظار پاسخ شما"}
              </ErpBadge>
            </div>
            {!selection.completed && (
              <>
                <ErpTextarea
                  value={drafts[selection.assessmentKind] || ""}
                  onChange={(event) => setDrafts({ ...drafts, [selection.assessmentKind]: event.target.value })}
                  placeholder="نتیجه ساختاریافته ارزیابی را ثبت کنید"
                  aria-label={`نتیجه ${labels[selection.assessmentKind]}`}
                />
                <ErpButton
                  label="ثبت نهایی نتیجه"
                  tone="success"
                  disabled={busy || !(drafts[selection.assessmentKind] || "").trim()}
                  onClick={() => run(
                    () => applicantHiringAPI.submitFormalAssessmentResult(selection.assessmentKind, {
                      summary: drafts[selection.assessmentKind]!.trim(),
                    }),
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
