"use client";

import { useMemo, useState } from "react";
import { ErpButton, ErpCard, ErpCheckbox, ErpSection, ErpSheet, ErpTextarea } from "@/components/erp";
import { hiringAPI } from "@/lib/hiringApi";
import {
  FINAL_REJECTION_EVIDENCE_HELP,
  buildFinalRejectionResultReferences,
  formalAssessmentLabel,
  latestCompletedAssessmentResults,
} from "./finalHiringRejectionEvidence";

export function FinalHiringRejection({
  applicationId,
  plans,
  busy,
  run,
}: {
  applicationId: string;
  plans: any[];
  busy: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const completedResults = useMemo(() => latestCompletedAssessmentResults(plans), [plans]);

  return (
    <ErpSection title="رد نهایی پرونده" description="این تصمیم دسترسی متقاضی را می‌بندد و فقط با فرایند رسمی بازگشایی قابل برگشت است.">
      <ErpCard className="space-y-4 p-4">
        <ErpTextarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="دلیل رد نهایی (الزامی)"
          aria-label="دلیل رد نهایی پرونده"
        />
        {completedResults.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">نتایج آزمون‌های مورد استناد در رد نهایی (اختیاری)</legend>
            <p className="sds-text-muted text-xs leading-5">{FINAL_REJECTION_EVIDENCE_HELP}</p>
            {completedResults.map((result) => (
              <ErpCheckbox
                key={result.id}
                checked={selectedResultIds.includes(result.id)}
                onChange={(event) => setSelectedResultIds(event.target.checked
                  ? [...selectedResultIds, result.id]
                  : selectedResultIds.filter((id) => id !== result.id))}
                label={`${formalAssessmentLabel(result.assessmentKind)} · نسخه ${result.resultVersion.toLocaleString("fa-IR")}`}
              />
            ))}
          </fieldset>
        )}
        <ErpButton
          label="ثبت رد نهایی و بستن دسترسی"
          tone="danger"
          disabled={busy || !reason.trim()}
          onClick={() => setConfirmOpen(true)}
        />
      </ErpCard>
      <ErpSheet
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        title="تأیید رد نهایی"
        presentation="modal"
        dismissible={!busy}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)} />
            <ErpButton
              label="بستن پرونده و دسترسی"
              tone="danger"
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                void run(
                  () => hiringAPI.finallyReject(applicationId, {
                    reason: reason.trim(),
                    resultVersions: buildFinalRejectionResultReferences(completedResults, selectedResultIds),
                  }),
                  "رد نهایی ثبت و پرونده بسته شد.",
                );
              }}
            />
          </div>
        )}
      >
        <p className="text-sm text-[var(--sds-text-secondary)]">
          دعوت‌نامه‌های فعال لغو می‌شوند و متقاضی دیگر به پرونده دسترسی نخواهد داشت. بازگشت فقط از مسیر رسمی بازگشایی ممکن است.
        </p>
      </ErpSheet>
    </ErpSection>
  );
}
