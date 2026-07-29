"use client";

import { useEffect, useState } from "react";
import {
  ErpButton,
  ErpCard,
  ErpPage,
  ErpSection,
  ErpSelect,
} from "@/components/erp";
import { authorityLabel } from "@/features/hr/hrDisplay";
import RetentionAction from "@/features/hr/RetentionActionSheet";
import { authAPI } from "@/lib/api";
import { hiringAPI, hiringError } from "@/lib/hiringApi";

const authorityTypes = [
  "HR_PROCESSOR",
  "HR_MANAGER",
  "COMPANY_MANAGER",
  "HR_PAYROLL_PROCESSOR",
  "HR_PAYROLL_MANAGER",
  "FINANCE_RECORDER",
  "FINANCE_MANAGER",
  "HIRING_MANAGER",
];

export default function HiringAuthoritiesPage() {
  const [user, setUser] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [userId, setUserId] = useState("");
  const [authority, setAuthority] = useState("HR_PROCESSOR");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<any>(null);
  const availableAuthorities =
    user?.role === "ADMIN"
      ? authorityTypes
      : authorityTypes.filter((item) => item !== "COMPANY_MANAGER");

  const load = async () => {
    try {
      setError("");
      const [currentUserResponse, userResponse, authorityResponse] = await Promise.all([
        authAPI.getMe(),
        hiringAPI.authorityUsers(),
        hiringAPI.authorities(),
      ]);
      setUser(currentUserResponse.data.data);
      setUsers(userResponse.data.data || []);
      setRows(authorityResponse.data.data || []);
    } catch (cause) {
      setError(hiringError(cause));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      setBusy(true);
      setError("");
      await hiringAPI.setAuthority({ userId, authority });
      setMessage("اختیار سازمانی ثبت شد.");
      await load();
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async ({ reason }: { reason: string }) => {
    if (!revokeTarget) return;
    try {
      setBusy(true);
      setError("");
      await hiringAPI.revokeAuthority(revokeTarget.id, reason);
      setRevokeTarget(null);
      setMessage("اختیار سازمانی سلب شد.");
      await load();
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };

  const displayName = (targetUserId: string) => {
    const target = users.find((item) => item.id === targetUserId);
    return target
      ? `${target.firstName} ${target.lastName}`.trim() || target.username
      : targetUserId;
  };

  return (
    <ErpPage
      eyebrow="منابع انسانی · تنظیمات استخدام"
      title="اختیارهای تأیید استخدام"
      description="اختیار کسب‌وکاری مستقل از دسترسی عمومی سامانه است."
      backHref="/dashboard/hr/hiring"
    >
      {message && (
        <p className="sds-tone-success sds-tone-surface rounded-xl p-3">{message}</p>
      )}
      {error && (
        <p className="sds-tone-danger sds-tone-surface rounded-xl p-3">{error}</p>
      )}
      <ErpSection title="واگذاری اختیار">
        <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
          <ErpSelect aria-label="کاربر دریافت‌کننده اختیار" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">انتخاب کاربر</option>
            {users.map((item) => (
              <option key={item.id} value={item.id}>
                {item.firstName} {item.lastName} · {item.username}
              </option>
            ))}
          </ErpSelect>
          <ErpSelect aria-label="نوع اختیار استخدام" value={authority} onChange={(event) => setAuthority(event.target.value)}>
            {availableAuthorities.map((item) => (
              <option key={item} value={item}>
                {authorityLabel(item)}
              </option>
            ))}
          </ErpSelect>
          <ErpButton
            label="ثبت اختیار"
            disabled={busy || !userId}
            onClick={save}
          />
        </ErpCard>
      </ErpSection>
      <ErpSection title="اختیارهای فعال">
        <div className="grid gap-2 md:grid-cols-2">
          {rows.map((row) => {
            const canRevoke =
              user?.role === "ADMIN" ||
              (row.authority !== "COMPANY_MANAGER" && row.userId !== user?.id);
            return (
              <ErpCard key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <span>{displayName(row.userId)}</span>
                <div className="flex items-center gap-2">
                  <b>{authorityLabel(row.authority)}</b>
                  {canRevoke && (
                    <ErpButton
                      label="سلب اختیار"
                      tone="danger"
                      variant="soft"
                      disabled={busy}
                      onClick={() => setRevokeTarget(row)}
                    />
                  )}
                </div>
              </ErpCard>
            );
          })}
        </div>
      </ErpSection>
      {revokeTarget && (
        <RetentionAction
          title="سلب اختیار"
          targetName={`${displayName(revokeTarget.userId)} · ${authorityLabel(revokeTarget.authority)}`}
          busy={busy}
          confirmLabel="سلب اختیار"
          confirmTone="danger"
          onClose={() => setRevokeTarget(null)}
          onConfirm={revoke}
        />
      )}
    </ErpPage>
  );
}
