"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
} from "@/components/erp";
import { authorityLabel } from "@/features/hr/hrDisplay";
import { apiError } from "@/features/hr/hrUi";
import RetentionAction from "@/features/hr/RetentionActionSheet";
import { hrAuthorizationAPI } from "@/lib/api";

type Dialog = "AUTHORITY" | "RESPONSIBILITY" | "FEATURE" | null;

const levelLabels: Record<string, string> = { VIEW: "مشاهده", EDIT: "ویرایش", ADMIN: "مدیریت" };
const featureLabels: Record<string, string> = {
  DASHBOARD: "داشبورد",
  ORGANIZATIONAL_STRUCTURE: "ساختار سازمانی",
  PERSONNEL: "پرسنل",
  RECRUITMENT_CASES: "پرونده‌های جذب",
  HR_WORK_MANAGEMENT: "مدیریت کار منابع انسانی",
  AUTHORITY_RESPONSIBILITY_ADMINISTRATION: "اختیار و مسئولیت",
  DATA_MIGRATION_RECONCILIATION: "مهاجرت و تطبیق",
  USER_ADMINISTRATION: "مدیریت کاربران",
};
const assignmentLabels: Record<string, string> = { PRIMARY: "اصلی", ACTING: "سرپرست موقت", SUBSTITUTE: "جانشین" };

const activeNow = (row: any) => row.status === "ACTIVE"
  && new Date(row.effectiveFrom).getTime() <= Date.now()
  && (!row.effectiveTo || new Date(row.effectiveTo).getTime() > Date.now());

export default function HiringAuthoritiesPage() {
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [authorityCode, setAuthorityCode] = useState("HR_PROCESSOR");
  const [responsibilityTypeCode, setResponsibilityTypeCode] = useState("HR_PROCESSOR");
  const [assignmentKind, setAssignmentKind] = useState<"PRIMARY" | "ACTING" | "SUBSTITUTE">("PRIMARY");
  const [principalResponsibilityId, setPrincipalResponsibilityId] = useState("");
  const [featureCode, setFeatureCode] = useState("DASHBOARD");
  const [level, setLevel] = useState<"VIEW" | "EDIT" | "ADMIN">("VIEW");
  const [reason, setReason] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<any>(null);
  const [endTarget, setEndTarget] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const response = await hrAuthorizationAPI.getContext();
      setContext(response.data.data);
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const users = useMemo(() => context?.users || [], [context]);
  const userName = useCallback((targetUserId: string) => {
    const user = users.find((candidate: any) => candidate.id === targetUserId);
    return user ? `${user.firstName} ${user.lastName}`.trim() || user.username : targetUserId;
  }, [users]);
  const activeAuthorities = useMemo(() => (context?.authorityGrants || []).filter(activeNow), [context]);
  const activeResponsibilities = useMemo(() => (context?.responsibilities || []).filter((row: any) => (
    new Date(row.effectiveFrom).getTime() <= Date.now()
    && (!row.effectiveTo || new Date(row.effectiveTo).getTime() > Date.now())
  )), [context]);
  const activeFeatures = useMemo(() => (context?.featureGrants || []).filter(activeNow), [context]);

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setReason("");
  };

  const submit = async () => {
    if (!userId || reason.trim().length < 3 || !dialog) return;
    try {
      setBusy(true);
      setError("");
      if (dialog === "AUTHORITY") await hrAuthorizationAPI.grantAuthority({ userId, authorityCode, reason });
      if (dialog === "RESPONSIBILITY") await hrAuthorizationAPI.assignResponsibility({
        assignedUserId: userId,
        responsibilityTypeCode,
        scopeType: "GLOBAL",
        assignmentKind,
        principalResponsibilityId: assignmentKind === "PRIMARY" ? undefined : principalResponsibilityId,
        reason,
      });
      if (dialog === "FEATURE") await hrAuthorizationAPI.grantFeature({ userId, featureCode, level, reason });
      setMessage(dialog === "AUTHORITY" ? "اختیار ثبت شد." : dialog === "RESPONSIBILITY" ? "مسئولیت ثبت شد." : "دسترسی قابلیت ثبت شد.");
      setDialog(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async ({ reason: revokeReason }: { reason: string }) => {
    if (!revokeTarget) return;
    try {
      setBusy(true);
      await hrAuthorizationAPI.revokeAuthority(revokeTarget.id, revokeReason);
      setRevokeTarget(null);
      setMessage("اختیار بلافاصله سلب شد.");
      await load();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setBusy(false);
    }
  };

  const endResponsibility = async ({ reason: endReason }: { reason: string }) => {
    if (!endTarget) return;
    try {
      setBusy(true);
      await hrAuthorizationAPI.endResponsibility(endTarget.id, endReason);
      setEndTarget(null);
      setMessage("مسئولیت پایان یافت؛ سابقه آن حفظ شد.");
      await load();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · کنترل دسترسی"
      title="اختیار و مسئولیت"
      description="دسترسی قابلیت، اختیار کسب‌وکار و مالکیت نام‌دار مستقل‌اند؛ هیچ‌کدام دیگری را ایجاد نمی‌کند."
      backHref="/dashboard/hr"
      metrics={[
        { label: "اختیار فعال", value: activeAuthorities.length.toLocaleString("fa-IR"), tone: "primary" },
        { label: "مسئولیت مؤثر", value: activeResponsibilities.length.toLocaleString("fa-IR"), tone: "info" },
        { label: "دسترسی قابلیت", value: activeFeatures.length.toLocaleString("fa-IR"), tone: "neutral" },
      ]}
      actions={[
        { label: "اعطای اختیار", onClick: () => setDialog("AUTHORITY") },
        { label: "انتساب مسئولیت", variant: "soft", onClick: () => setDialog("RESPONSIBILITY") },
        { label: "دسترسی قابلیت", variant: "outline", onClick: () => setDialog("FEATURE") },
      ]}
    >
      {message && <p role="status" className="sds-tone-success sds-tone-surface rounded-xl p-3">{message}</p>}
      {error && <p role="alert" className="sds-tone-danger sds-tone-surface rounded-xl p-3">{error}</p>}

      <ErpSection title="اختیارهای فعال">
        {activeAuthorities.length === 0 ? <ErpEmptyState title="اختیار فعالی ثبت نشده است" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {activeAuthorities.map((row: any) => (
              <ErpCard key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><b>{userName(row.userId)}</b><p className="mt-1 text-sm text-[var(--sds-text-muted)]">{authorityLabel(row.authorityCode)}</p></div>
                <ErpButton label="سلب اختیار" tone="danger" variant="soft" disabled={busy} onClick={() => setRevokeTarget(row)} />
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSection title="مسئولیت‌های مؤثر">
        {activeResponsibilities.length === 0 ? <ErpEmptyState title="مسئولیت مؤثری ثبت نشده است" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {activeResponsibilities.map((row: any) => (
              <ErpCard key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <b>{userName(row.assignedUserId)}</b>
                  <p className="mt-1 text-sm text-[var(--sds-text-muted)]">{authorityLabel(row.responsibilityTypeCode)} · {assignmentLabels[row.assignmentKind] || row.assignmentKind}</p>
                </div>
                <ErpButton label="پایان مسئولیت" tone="warning" variant="soft" disabled={busy} onClick={() => setEndTarget(row)} />
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSection title="دسترسی قابلیت‌های فعال">
        {activeFeatures.length === 0 ? <ErpEmptyState title="دسترسی قابلیتی ثبت نشده است" /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {activeFeatures.map((row: any) => (
              <ErpCard key={row.id} className="p-4 text-sm">
                <b>{userName(row.userId)}</b>
                <p className="mt-2 text-[var(--sds-text-muted)]">{featureLabels[row.featureCode] || row.featureCode} · {levelLabels[row.level] || row.level}</p>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSheet open={Boolean(dialog)} onClose={closeDialog} title={dialog === "AUTHORITY" ? "اعطای اختیار" : dialog === "RESPONSIBILITY" ? "انتساب مسئولیت" : "دسترسی قابلیت"} presentation="modal" dismissible={!busy}>
        <div className="grid gap-4">
          <ErpSelect aria-label="کاربر" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">انتخاب کاربر</option>
            {users.map((user: any) => <option key={user.id} value={user.id}>{userName(user.id)} · {user.username}</option>)}
          </ErpSelect>
          {dialog === "AUTHORITY" && (
            <ErpSelect aria-label="اختیار کسب‌وکار" value={authorityCode} onChange={(event) => setAuthorityCode(event.target.value)}>
              {(context?.authorityCatalog || []).map((item: any) => <option key={item.code} value={item.code}>{authorityLabel(item.code)}</option>)}
            </ErpSelect>
          )}
          {dialog === "RESPONSIBILITY" && <>
            <ErpSelect aria-label="نوع مسئولیت" value={responsibilityTypeCode} onChange={(event) => setResponsibilityTypeCode(event.target.value)}>
              {(context?.responsibilityTypes || []).map((item: any) => <option key={item.code} value={item.code}>{authorityLabel(item.code)}</option>)}
            </ErpSelect>
            <ErpSelect aria-label="نوع انتساب" value={assignmentKind} onChange={(event) => setAssignmentKind(event.target.value as typeof assignmentKind)}>
              {Object.entries(assignmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </ErpSelect>
            {assignmentKind !== "PRIMARY" && (
              <ErpSelect aria-label="مسئولیت اصلی" value={principalResponsibilityId} onChange={(event) => setPrincipalResponsibilityId(event.target.value)}>
                <option value="">انتخاب مسئولیت اصلی</option>
                {activeResponsibilities.filter((row: any) => row.assignmentKind === "PRIMARY" && row.responsibilityTypeCode === responsibilityTypeCode).map((row: any) => (
                  <option key={row.id} value={row.id}>{userName(row.assignedUserId)}</option>
                ))}
              </ErpSelect>
            )}
          </>}
          {dialog === "FEATURE" && <>
            <ErpSelect aria-label="قابلیت منابع انسانی" value={featureCode} onChange={(event) => setFeatureCode(event.target.value)}>
              {(context?.featureCatalog || []).map((item: any) => <option key={item.code} value={item.code}>{featureLabels[item.code] || item.code}</option>)}
            </ErpSelect>
            <ErpSelect aria-label="سطح دسترسی" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
              {Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </ErpSelect>
          </>}
          <ErpTextarea aria-label="دلیل" placeholder="دلیل مستند" value={reason} onChange={(event) => setReason(event.target.value)} />
          <ErpButton label="ثبت" disabled={busy || !userId || reason.trim().length < 3 || (dialog === "RESPONSIBILITY" && assignmentKind !== "PRIMARY" && !principalResponsibilityId)} onClick={submit} />
        </div>
      </ErpSheet>

      {revokeTarget && <RetentionAction title="سلب اختیار" targetName={`${userName(revokeTarget.userId)} · ${authorityLabel(revokeTarget.authorityCode)}`} busy={busy} confirmLabel="سلب اختیار" confirmTone="danger" onClose={() => setRevokeTarget(null)} onConfirm={revoke} />}
      {endTarget && <RetentionAction title="پایان مسئولیت" targetName={`${userName(endTarget.assignedUserId)} · ${authorityLabel(endTarget.responsibilityTypeCode)}`} busy={busy} confirmLabel="پایان مسئولیت" confirmTone="warning" onClose={() => setEndTarget(null)} onConfirm={endResponsibility} />}
    </ErpPage>
  );
}
