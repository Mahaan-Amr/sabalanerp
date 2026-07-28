"use client";

import { useState } from "react";
import { ErpButton, ErpCard } from "@/components/erp";

type Preview = {
  displayName: string;
  counts?: Record<string, number>;
  totalFiles?: number;
  fileCounts?: Record<string, number>;
  backupNotice?: string;
  fingerprint: string;
};

export default function PermanentDeletionDialog({
  title,
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  preview: Preview;
  busy: boolean;
  onClose: () => void;
  onConfirm: (data: { reason: string; fullName: string; adminPassword: string; fingerprint: string; confirmed: true }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [fullName, setFullName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const counts = Object.entries(preview.counts || {}).filter(([, count]) => count > 0);
  const totalFiles = preview.totalFiles ?? Object.values(preview.fileCounts || {}).reduce((sum, count) => sum + Number(count), 0);
  const ready = reason.trim().length >= 3 && fullName.trim() === preview.displayName.trim() && adminPassword.length > 0 && confirmed;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="permanent-delete-title">
      <ErpCard className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5">
        <h2 id="permanent-delete-title" className="text-lg font-black text-rose-700">{title}</h2>
        <p className="mt-2 text-sm">این عملیات برگشت‌پذیر نیست. پیش‌نمایش زیر باید پیش از اجرا دوباره در سرور اعتبارسنجی شود.</p>
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm dark:bg-rose-950/30">
          <p className="font-bold">نام هدف: {preview.displayName}</p>
          <p className="mt-1">تعداد فایل‌های زنده: {totalFiles.toLocaleString("fa-IR")}</p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {counts.map(([category, count]) => <span key={category}>{category}: {count.toLocaleString("fa-IR")}</span>)}
          </div>
          {preview.backupNotice && <p className="mt-2 text-xs text-amber-800">{preview.backupNotice}</p>}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-bold">دلیل حذف دائمی
            <textarea className="mt-1 w-full rounded-xl border p-3 font-normal dark:bg-slate-900" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
          <label className="block text-sm font-bold">برای تأیید، نام «{preview.displayName}» را دقیق وارد کنید
            <input className="mt-1 w-full rounded-xl border p-3 font-normal dark:bg-slate-900" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="off" />
          </label>
          <label className="block text-sm font-bold">رمز عبور مدیر سامانه
            <input type="password" className="mt-1 w-full rounded-xl border p-3 font-normal dark:bg-slate-900" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <label className="flex items-start gap-2 rounded-xl border border-rose-300 p-3 text-sm font-bold text-rose-700">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
            پیامدهای پیش‌نمایش را بررسی کردم و حذف دائمی را تأیید می‌کنم.
          </label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <ErpButton label="انصراف" variant="soft" disabled={busy} onClick={onClose} />
          <ErpButton label="حذف دائمی" tone="danger" disabled={busy || !ready} onClick={() => onConfirm({ reason: reason.trim(), fullName, adminPassword, fingerprint: preview.fingerprint, confirmed: true })} />
        </div>
      </ErpCard>
    </div>
  );
}
