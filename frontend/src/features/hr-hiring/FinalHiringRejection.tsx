"use client";

import { useState } from "react";
import { ErpButton, ErpSheet, ErpTextarea } from "@/components/erp";
import { hiringAPI } from "@/lib/hiringApi";

export function FinalHiringRejection({
  applicationId,
  busy,
  run,
}: {
  applicationId: string;
  busy: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<void | boolean>;
}) {
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="flex justify-end">
        <ErpButton
          label="رد نهایی پرونده"
          tone="danger"
          variant="outline"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
        />
      </div>
      <ErpSheet
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        title="رد نهایی پرونده"
        presentation="modal"
        dismissible={!busy}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)} />
            <ErpButton
              label="بستن پرونده و دسترسی"
              tone="danger"
              disabled={busy || !reason.trim()}
              onClick={() => {
                setConfirmOpen(false);
                void run(
                  () => hiringAPI.finallyReject(applicationId, { reason: reason.trim() }),
                  "رد نهایی ثبت و پرونده بسته شد.",
                );
              }}
            />
          </div>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--sds-text-secondary)]">
            دعوت‌نامه‌های فعال لغو می‌شوند و متقاضی دیگر به پرونده دسترسی نخواهد داشت. آخرین نتایج تکمیل‌شده آزمون‌ها به‌صورت خودکار در سابقه تصمیم ثبت می‌شوند و بازگشت فقط از مسیر رسمی بازگشایی ممکن است.
          </p>
          <ErpTextarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="دلیل رد نهایی (الزامی)"
            aria-label="دلیل رد نهایی پرونده"
          />
        </div>
      </ErpSheet>
    </>
  );
}
