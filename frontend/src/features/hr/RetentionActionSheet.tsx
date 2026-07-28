"use client";

import { useState } from "react";
import { ErpButton, ErpSheet, ErpTextarea } from "@/components/erp";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import { HrField } from "@/features/hr/hrUi";

export default function RetentionAction({
  title,
  targetName,
  busy,
  effectiveDate,
  confirmLabel,
  confirmTone = "warning",
  onClose,
  onConfirm,
}: {
  title: string;
  targetName: string;
  busy: boolean;
  effectiveDate?: string;
  confirmLabel: string;
  confirmTone?: "warning" | "danger" | "success";
  onClose: () => void;
  onConfirm: (data: { reason: string; effectiveDate?: string }) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(effectiveDate || "");
  const ready = reason.trim().length >= 3 && (effectiveDate === undefined || Boolean(date));

  return (
    <ErpSheet
      open
      onClose={busy ? () => undefined : onClose}
      title={title}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <ErpButton label="انصراف" variant="soft" disabled={busy} onClick={onClose} />
          <ErpButton
            label={confirmLabel}
            tone={confirmTone}
            disabled={busy || !ready}
            onClick={() => onConfirm({ reason: reason.trim(), effectiveDate: date || undefined })}
          />
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-bold">{targetName}</p>
        <HrField label="دلیل" required>
          <ErpTextarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
          />
        </HrField>
        {effectiveDate !== undefined && (
          <HrField label="تاریخ اجرای بایگانی" required>
            <HrPersianCalendar value={date} onChange={setDate} />
          </HrField>
        )}
      </div>
    </ErpSheet>
  );
}
