export type FormalAssessmentResultReference = {
  id: string;
  assessmentKind: string;
  resultVersion: number;
  status: string;
};

type FormalAssessmentPlanWithResults = {
  results?: FormalAssessmentResultReference[];
};

const FORMAL_ASSESSMENT_LABELS: Record<string, string> = {
  DISC: "DISC (الگوی رفتاری دیسک)",
  EQ: "EQ (هوش هیجانی)",
  BIG_FIVE: "BIG FIVE (پنج عامل بزرگ شخصیت)",
};

export const FINAL_REJECTION_EVIDENCE_HELP =
  "فقط آزمون‌هایی را انتخاب کنید که در تصمیم رد به آن‌ها استناد کرده‌اید. انتخاب هر مورد، همان نسخه نتیجه را به سابقه ممیزی تصمیم پیوند می‌دهد و نتیجه آزمون را تغییر یا حذف نمی‌کند.";

export function formalAssessmentLabel(kind: string) {
  return FORMAL_ASSESSMENT_LABELS[kind] || kind;
}

export function latestCompletedAssessmentResults(plans: FormalAssessmentPlanWithResults[]) {
  const latest = new Map<string, FormalAssessmentResultReference>();
  for (const result of plans.flatMap((plan) => plan.results || [])) {
    const current = latest.get(result.assessmentKind);
    if (result.status === "COMPLETED" && (!current || result.resultVersion > current.resultVersion)) {
      latest.set(result.assessmentKind, result);
    }
  }
  return Array.from(latest.values());
}

export function buildFinalRejectionResultReferences(
  completedResults: FormalAssessmentResultReference[],
  selectedResultIds: string[],
) {
  return completedResults
    .filter((result) => selectedResultIds.includes(result.id))
    .map((result) => ({ assessmentKind: result.assessmentKind, resultVersion: result.resultVersion }));
}
