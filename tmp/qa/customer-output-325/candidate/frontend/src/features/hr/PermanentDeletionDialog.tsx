"use client";

import { useState } from "react";
import {
  ErpButton,
  ErpCheckbox,
  ErpInput,
  ErpSheet,
  ErpTextarea,
} from "@/components/erp";

type Preview = {
  displayName: string;
  counts?: Record<string, number>;
  totalFiles?: number;
  fileCounts?: Record<string, number>;
  backupNotice?: string;
  fingerprint: string;
};

const impactCategoryLabel = (category: string) => {
  const direct: Record<string, string> = {
    invitations: "دعوت‌نامه‌ها",
    formRevisions: "نسخه‌های فرم",
    documents: "اسناد استخدامی",
    identityChecks: "بررسی‌های هویتی",
    collateralItems: "تضمین‌ها",
    compensationSnapshots: "سوابق جبران خدمات",
    contracts: "قراردادها",
    insuranceEnrollment: "ثبت بیمه",
    payrollParticipation: "مشارکت حقوق و دستمزد",
    onboardingTasks: "وظایف شروع همکاری",
    audits: "رویدادهای ممیزی",
    assessments: "ارزیابی‌ها",
    preIdentityChecklistItems: "الزامات پیش از احراز هویت",
    hiringDecisions: "تصمیم‌های استخدامی",
    reopenings: "بازگشایی‌ها",
    collateralRequirements: "الزامات تضمین",
  };
  if (direct[category]) return direct[category];
  if (/^(User|Auth|Recognized|Authentication|Workspace|Feature)/.test(category))
    return "حساب کاربری، دسترسی و نشست‌ها";
  if (/^(Personnel|Hr)/.test(category)) return "سوابق منابع انسانی";
  if (/^(Attendance|Exception|Mission)/.test(category))
    return "حضور، مأموریت و مرخصی";
  if (/^Security/.test(category)) return "سوابق انتظامات و امنیت";
  if (/^Crm/.test(category)) return "سوابق مدیریت ارتباط با مشتری";
  if (/^(Sales|Contract|Order|Delivery)/.test(category))
    return "سوابق فروش، قرارداد و تحویل";
  if (/^(Accounting|Journal|Payment)/.test(category))
    return "سوابق مالی و حسابداری";
  if (/^Logistics/.test(category)) return "سوابق لجستیک";
  return "سایر سوابق مرتبط";
};

export default function PermanentDeletionWorkflow({
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
  onConfirm: (data: {
    reason: string;
    fullName: string;
    adminPassword: string;
    fingerprint: string;
    confirmed: true;
  }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [fullName, setFullName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const groupedCounts = Object.entries(preview.counts || {}).reduce(
    (groups, [category, count]) => {
      if (count <= 0) return groups;
      const label = impactCategoryLabel(category);
      groups.set(label, (groups.get(label) || 0) + count);
      return groups;
    },
    new Map<string, number>(),
  );
  const counts = Array.from(groupedCounts.entries());
  const totalFiles =
    preview.totalFiles ??
    Object.values(preview.fileCounts || {}).reduce(
      (sum, count) => sum + Number(count),
      0,
    );
  const ready =
    reason.trim().length >= 3 &&
    fullName.trim() === preview.displayName.trim() &&
    adminPassword.length > 0 &&
    confirmed;

  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      <ErpButton
        label="انصراف"
        variant="soft"
        disabled={busy}
        onClick={onClose}
      />
      <ErpButton
        label="حذف دائمی"
        tone="danger"
        disabled={busy || !ready}
        onClick={() =>
          onConfirm({
            reason: reason.trim(),
            fullName,
            adminPassword,
            fingerprint: preview.fingerprint,
            confirmed: true,
          })
        }
      />
    </div>
  );

  return (
    <ErpSheet open presentation="modal" onClose={busy ? () => undefined : onClose} title={title} footer={footer}>
      <div className="space-y-4">
        <p className="mt-2 text-sm">
          این عملیات برگشت‌پذیر نیست. پیش‌نمایش زیر باید پیش از اجرا دوباره در
          سرور اعتبارسنجی شود.
        </p>
        <div className="sds-tone-danger sds-tone-surface rounded-xl border p-3 text-sm">
          <p className="font-bold">نام هدف: {preview.displayName}</p>
          <p className="mt-1">
            تعداد فایل‌های زنده: {totalFiles.toLocaleString("fa-IR")}
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {counts.map(([category, count]) => (
              <span key={category}>
                {category}: {count.toLocaleString("fa-IR")}
              </span>
            ))}
          </div>
          {preview.backupNotice && (
            <p className="sds-text-secondary mt-2 text-xs">
              {preview.backupNotice}
            </p>
          )}
        </div>
        <div className="space-y-3">
          <label className="sds-text-primary block text-sm font-bold">
            دلیل حذف دائمی
            <ErpTextarea
              className="mt-1 font-normal"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
            />
          </label>
          <label className="sds-text-primary block text-sm font-bold">
            برای تأیید، نام «{preview.displayName}» را دقیق وارد کنید
            <ErpInput
              className="mt-1 font-normal"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="sds-text-primary block text-sm font-bold">
            رمز عبور مدیر سامانه
            <ErpInput
              type="password"
              className="mt-1 font-normal"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <ErpCheckbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="sds-tone-danger sds-tone-surface w-full rounded-xl border p-3 font-bold"
            label="پیامدهای پیش‌نمایش را بررسی کردم و حذف دائمی را تأیید می‌کنم."
          />
        </div>
      </div>
    </ErpSheet>
  );
}
