"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSelect,
  ErpTextarea,
} from "@/components/erp";
import { hrAuthorizationAPI } from "@/lib/api";

type Permission = { code: string; labelFa: string; level: "VIEW" | "EDIT" | "ADMIN"; prerequisites: string[] };
type Group = { code: string; labelFa: string; permissions: Permission[] };

export default function HrPermissionsPage() {
  const [context, setContext] = useState<any>();
  const [userId, setUserId] = useState("");
  const [workspaceLevel, setWorkspaceLevel] = useState<"VIEW" | "EDIT" | "ADMIN">("VIEW");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; title: string }>();
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const load = () => hrAuthorizationAPI.getContext().then(({ data }) => {
    setContext(data.data);
    setUserId((current) => current || data.data.users[0]?.id || "");
  }).catch((error) => setFeedback({ kind: "error", title: error.response?.data?.error || "بارگذاری مجوزها ناموفق بود." }));
  useEffect(() => { void load(); }, []);

  const groups: Group[] = useMemo(() => context?.actionPermissionGroups || [], [context]);
  const definitions = useMemo(() => new Map(groups.flatMap((group) => group.permissions).map((permission) => [permission.code, permission])), [groups]);
  const expanded = useMemo(() => {
    const result = new Set<string>();
    const include = (code: string) => {
      const definition = definitions.get(code);
      (definition?.prerequisites || []).forEach(include);
      result.add(code);
    };
    selected.forEach(include);
    return Array.from(result);
  }, [definitions, selected]);
  const automatic = expanded.filter((code) => !selected.includes(code));

  const validateGrant = () => {
    if (!userId || reason.trim().length < 3) {
      setFeedback({ kind: "error", title: "کاربر و دلیل مستند حداقل سه‌حرفی الزامی است." });
      return false;
    }
    return true;
  };
  const saveWorkspace = async () => {
    if (!validateGrant()) return;
    setSaving(true);
    setFeedback(undefined);
    try {
      await hrAuthorizationAPI.grantWorkspace({ userId, level: workspaceLevel, reason: reason.trim() });
      setFeedback({ kind: "success", title: "مجوز فضای کاری ثبت شد." });
      setReason("");
      await load();
    } catch (error: any) {
      setFeedback({ kind: "error", title: error.response?.data?.error || "ثبت مجوز ناموفق بود." });
    } finally {
      setSaving(false);
    }
  };
  const saveActions = async () => {
    if (!validateGrant() || !selected.length) return;
    setSaving(true);
    setFeedback(undefined);
    try {
      for (const featureCode of expanded) {
        await hrAuthorizationAPI.grantFeature({
          userId,
          featureCode,
          level: definitions.get(featureCode)?.level || "VIEW",
          reason: reason.trim(),
        });
      }
      setFeedback({ kind: "success", title: "مجوزهای عملیاتی و پیش‌نیازهای آن‌ها ثبت شد." });
      setSelected([]);
      setReason("");
      await load();
    } catch (error: any) {
      setFeedback({ kind: "error", title: error.response?.data?.error || "ثبت مجوز ناموفق بود." });
    } finally {
      setSaving(false);
    }
  };

  if (!context && !feedback) return <ErpLoading />;
  return (
    <ErpPage eyebrow="منابع انسانی" title="مجوزهای منابع انسانی" description="دسترسی فضای کاری و مجوزهای کسب‌وکاری از همین صفحه مدیریت می‌شوند.">
      {feedback && <ErpInlineState kind={feedback.kind} title={feedback.title} />}
      <ErpSection title="افزودن مجوز فضای کاری">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm text-[var(--sds-text-secondary)]"><span>کاربر</span><ErpSelect value={userId} onChange={(event) => setUserId(event.target.value)}>{context?.users.map((user: any) => <option key={user.id} value={user.id}>{`${user.firstName} ${user.lastName}`.trim() || user.username}</option>)}</ErpSelect></label>
          <label className="space-y-2 text-sm text-[var(--sds-text-secondary)]"><span>سطح فضای کاری</span><ErpSelect value={workspaceLevel} onChange={(event) => setWorkspaceLevel(event.target.value as typeof workspaceLevel)}><option value="VIEW">مشاهده</option><option value="EDIT">ویرایش</option><option value="ADMIN">دسترسی کامل</option></ErpSelect></label>
        </div>
      </ErpSection>
      <div className="flex justify-end"><ErpButton label={saving ? "در حال ثبت…" : "ثبت مجوز فضای کاری"} variant="outline" disabled={saving} onClick={saveWorkspace} /></div>
      <ErpSection title="افزودن مجوز جدید" description="مجوزها بر اساس مرحله گردش کار گروه‌بندی شده‌اند. پیش‌نیازهای شواهد به‌صورت خودکار همراه انتخاب ثبت می‌شوند.">
        <ErpInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی مجوز" aria-label="جست‌وجوی مجوز" />
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => ({ ...group, permissions: group.permissions.filter((permission) => permission.labelFa.includes(search.trim())) })).filter((group) => group.permissions.length).map((group) => <ErpCard key={group.code} className="p-4"><h3 className="mb-2 font-semibold text-[var(--sds-text-primary)]">{group.labelFa}</h3><div className="space-y-1">{group.permissions.map((permission) => <ErpCheckbox key={permission.code} checked={selected.includes(permission.code)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))} label={permission.labelFa} />)}</div></ErpCard>)}
        </div>
        {automatic.length > 0 && <ErpCard tone="info" className="mt-4 p-4"><div className="mb-2 text-sm font-semibold">پیش‌نیازهای افزوده‌شده</div><div className="flex flex-wrap gap-2">{automatic.map((code) => <ErpBadge key={code} tone="info">{definitions.get(code)?.labelFa || ({ RECRUITMENT_CASES: "پرونده‌های استخدام", HR_WORK_MANAGEMENT: "مدیریت کار منابع انسانی", PERSONNEL: "پرسنل" } as Record<string, string>)[code] || "دسترسی پایه"}</ErpBadge>)}</div></ErpCard>}
        <label className="mt-4 block space-y-2 text-sm text-[var(--sds-text-secondary)]"><span>دلیل ثبت مجوز</span><ErpTextarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="mt-4 flex justify-end"><ErpButton label={saving ? "در حال ثبت…" : "ثبت مجوزها"} variant="solid" disabled={saving || !selected.length} onClick={saveActions} /></div>
      </ErpSection>
    </ErpPage>
  );
}
