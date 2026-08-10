"use client";

import { useMemo, useState } from "react";
import { ErpButton, ErpCard, ErpCheckbox, ErpSection, ErpSheet, ErpTextarea } from "@/components/erp";
import { hiringAPI } from "@/lib/hiringApi";

const labels: Record<string, string> = { DISC: "DISC", EQ: "EQ", BIG_FIVE: "BIG FIVE" };

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
  const completedResults = useMemo(() => {
    const latest = new Map<string, any>();
    for (const result of plans.flatMap((plan) => plan.results || [])) {
      const current = latest.get(result.assessmentKind);
      if (result.status === "COMPLETED" && (!current || result.resultVersion > current.resultVersion)) {
        latest.set(result.assessmentKind, result);
      }
    }
    return Array.from(latest.values());
  }, [plans]);

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
            <legend className="text-sm font-bold">نسخه‌های نتیجه مرتبط (اختیاری)</legend>
            {completedResults.map((result) => (
              <ErpCheckbox
                key={result.id}
                checked={selectedResultIds.includes(result.id)}
                onChange={(event) => setSelectedResultIds(event.target.checked
                  ? [...selectedResultIds, result.id]
                  : selectedResultIds.filter((id) => id !== result.id))}
                label={`${labels[result.assessmentKind] || result.assessmentKind} · نسخه ${result.resultVersion.toLocaleString("fa-IR")}`}
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
                    resultVersions: completedResults
                      .filter((result) => selectedResultIds.includes(result.id))
                      .map((result) => ({ assessmentKind: result.assessmentKind, resultVersion: result.resultVersion })),
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
