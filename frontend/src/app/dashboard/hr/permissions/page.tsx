'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpCombobox,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpTextarea,
} from '@/components/erp';
import { authAPI, hrAuthorizationAPI, permissionsAPI, usersAPI, workspacePermissionsAPI } from '@/lib/api';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import { toIsoDateTime } from '@/features/hr/hrUi';
import {
  createAccessDraft,
  deselectAllInWorkspace,
  selectAllInWorkspace,
  setFeatureSelection,
  type AccessDraft,
  type AccessFeatureDefinition,
  type AccessLevel,
} from '@/features/access-management/accessEditorState';

type User = { id: string; firstName: string; lastName: string; email: string; username: string; role: string };
type DirectPermission = { id: string; workspace: string; permissionLevel: AccessLevel; feature?: string; expiresAt?: string | null; isActive: boolean };
type RolePermission = { id: string; role: string; workspace: string; permissionLevel: AccessLevel; feature?: string; isActive: boolean };
type HrGrant = { id: string; userId: string; level: 'VIEW' | 'EDIT' | 'ADMIN'; status: string; effectiveFrom: string; effectiveTo?: string | null; workspaceCode?: string; featureCode?: string };
type FeatureDefinition = AccessFeatureDefinition & { source: 'legacy' | 'hr' };
type Feedback = { kind: 'success' | 'error' | 'stale'; title: string; description?: string };

const WORKSPACES = [
  { key: 'crm', label: 'CRM' },
  { key: 'sales', label: 'فروش' },
  { key: 'inventory', label: 'انبار' },
  { key: 'hr', label: 'منابع انسانی' },
  { key: 'security', label: 'امنیت' },
  { key: 'accounting', label: 'حسابداری' },
  { key: 'bi', label: 'هوش تجاری' },
  { key: 'logistics', label: 'لجستیک' },
] as const;
const ROLES = ['USER', 'SALES', 'MODERATOR', 'MANAGER', 'ADMIN'] as const;
const LEVEL_LABELS: Record<AccessLevel, string> = { view: 'مشاهده', edit: 'ویرایش', admin: 'مدیریت' };
const HR_LEVEL: Record<AccessLevel, 'VIEW' | 'EDIT' | 'ADMIN'> = { view: 'VIEW', edit: 'EDIT', admin: 'ADMIN' };
const FROM_HR_LEVEL: Record<'VIEW' | 'EDIT' | 'ADMIN', AccessLevel> = { VIEW: 'view', EDIT: 'edit', ADMIN: 'admin' };
const HR_BASE_FEATURE_LABELS_FA: Record<string, string> = {
  DASHBOARD: 'مشاهده داشبورد منابع انسانی',
  ORGANIZATIONAL_STRUCTURE: 'مشاهده ساختار سازمانی',
  PERSONNEL: 'مشاهده پرسنل',
  RECRUITMENT_CASES: 'مشاهده پرونده‌های جذب',
  HR_WORK_MANAGEMENT: 'مدیریت کارهای منابع انسانی',
  AUTHORITY_RESPONSIBILITY_ADMINISTRATION: 'مدیریت اختیار و مسئولیت',
  DATA_MIGRATION_RECONCILIATION: 'مدیریت مهاجرت و تطبیق داده‌ها',
  USER_ADMINISTRATION: 'مدیریت کاربران',
};

const activeNow = (permission: { isActive?: boolean; status?: string; expiresAt?: string | null; effectiveFrom?: string; effectiveTo?: string | null }) => {
  const now = Date.now();
  if (permission.isActive === false || (permission.status && permission.status !== 'ACTIVE')) return false;
  if (permission.expiresAt && new Date(permission.expiresAt).getTime() <= now) return false;
  if (permission.effectiveFrom && new Date(permission.effectiveFrom).getTime() > now) return false;
  return !permission.effectiveTo || new Date(permission.effectiveTo).getTime() > now;
};
const userName = (user: User) => `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
const recommendedLevel = (feature: string): AccessLevel => /_(create|edit|delete|approve|reject|sign|import|export|update|toggle|start|end|assign|verify|validate|send)$/.test(feature) ? 'edit' : 'view';
const normalizeLegacyDefinition = (definition: any): FeatureDefinition => ({
  key: definition.key,
  workspace: definition.workspace,
  label: definition.label || definition.key,
  requiredLevel: recommendedLevel(definition.key),
  prerequisites: definition.prerequisites || [],
  source: 'legacy',
});

export default function PermissionsPage() {
  const requestedUserId = useSearchParams().get('userId');
  const [actor, setActor] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [definitions, setDefinitions] = useState<FeatureDefinition[]>([]);
  const [roleWorkspacePermissions, setRoleWorkspacePermissions] = useState<RolePermission[]>([]);
  const [roleFeaturePermissions, setRoleFeaturePermissions] = useState<RolePermission[]>([]);
  const [hrContext, setHrContext] = useState<any>();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [directWorkspaces, setDirectWorkspaces] = useState<DirectPermission[]>([]);
  const [directFeatures, setDirectFeatures] = useState<DirectPermission[]>([]);
  const [hrWorkspaces, setHrWorkspaces] = useState<HrGrant[]>([]);
  const [hrFeatures, setHrFeatures] = useState<HrGrant[]>([]);
  const [draft, setDraft] = useState<AccessDraft>(() => createAccessDraft());
  const [draftRole, setDraftRole] = useState('USER');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [loading, setLoading] = useState(true);
  const [loadingUser, setLoadingUser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [roleForm, setRoleForm] = useState({ role: 'USER', workspace: 'sales', feature: '', permissionLevel: 'view' as AccessLevel });

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [profileResponse, usersResponse, definitionsResponse, roleWorkspaceResponse, roleFeatureResponse, hrResponse] = await Promise.all([
        authAPI.getMe(), usersAPI.getUsers(1, 1000), permissionsAPI.getFeatureDefinitions(),
        workspacePermissionsAPI.getRolePermissions(), permissionsAPI.getRoleFeaturePermissions({ limit: 1000 }), hrAuthorizationAPI.getContext(),
      ]);
      const currentActor = profileResponse.data.data as User;
      const availableUsers = (usersResponse.data.data || []).filter((user: User) => currentActor.role !== 'MANAGER' || user.role !== 'ADMIN');
      const actionDefinitions = (hrResponse.data.data.actionPermissionGroups || []).flatMap((group: any) => group.permissions).map((permission: any): FeatureDefinition => ({
        key: permission.code, workspace: 'hr', label: permission.labelFa, requiredLevel: FROM_HR_LEVEL[permission.level as 'VIEW' | 'EDIT' | 'ADMIN'], prerequisites: permission.prerequisites || [], source: 'hr',
      }));
      const actionKeys = new Set(actionDefinitions.map(({ key }: FeatureDefinition) => key));
      const hrBaseDefinitions = (hrResponse.data.data.featureCatalog || []).filter((feature: any) => !actionKeys.has(feature.code)).map((feature: any): FeatureDefinition => ({
        key: feature.code, workspace: 'hr', label: HR_BASE_FEATURE_LABELS_FA[feature.code] || feature.labelFa || feature.namePersian || feature.name || 'مجوز منابع انسانی', requiredLevel: 'view', prerequisites: [], source: 'hr',
      }));
      setActor(currentActor);
      setUsers(availableUsers);
      setDefinitions([...(definitionsResponse.data.data || []).map(normalizeLegacyDefinition).filter((definition: FeatureDefinition) => definition.workspace !== 'hr'), ...hrBaseDefinitions, ...actionDefinitions]);
      setRoleWorkspacePermissions(roleWorkspaceResponse.data.data || []);
      setRoleFeaturePermissions(roleFeatureResponse.data.data || []);
      setHrContext(hrResponse.data.data);
      setSelectedUserId((current) => {
        const requested = availableUsers.some((user: User) => user.id === requestedUserId) ? requestedUserId! : '';
        return current && availableUsers.some((user: User) => user.id === current) ? current : requested || availableUsers[0]?.id || '';
      });
    } catch (error: any) {
      setFeedback({ kind: 'error', title: error.response?.data?.error || 'بارگذاری مرکز مدیریت دسترسی ناموفق بود.' });
    } finally { setLoading(false); }
  }, [requestedUserId]);

  useEffect(() => { void loadBase(); }, [loadBase]);

  const loadUser = useCallback(async (userId: string, authorizationContext = hrContext) => {
    if (!userId || !authorizationContext) return;
    setLoadingUser(true);
    setFeedback(undefined);
    try {
      const user = users.find((candidate) => candidate.id === userId) || null;
      const [workspaceResponse, featureResponse] = await Promise.all([
        workspacePermissionsAPI.getUserPermissions({ userId, limit: 100 }),
        permissionsAPI.getUserFeaturePermissions(userId),
      ]);
      const workspaces = (workspaceResponse.data.data || []).filter(activeNow);
      const features = (featureResponse.data.data || []).filter(activeNow);
      const activeHrWorkspaces = (authorizationContext.workspaceGrants || []).filter((grant: HrGrant) => grant.userId === userId && activeNow(grant));
      const activeHrFeatures = (authorizationContext.featureGrants || []).filter((grant: HrGrant) => grant.userId === userId && activeNow(grant));
      const levels = Object.fromEntries(WORKSPACES.map(({ key }) => [key, workspaces.find((permission: DirectPermission) => permission.workspace === key)?.permissionLevel || null])) as Record<string, AccessLevel | null>;
      const newestHrWorkspace = activeHrWorkspaces[0];
      if (newestHrWorkspace) levels.hr = FROM_HR_LEVEL[newestHrWorkspace.level as 'VIEW' | 'EDIT' | 'ADMIN'];
      setSelectedUser(user);
      setDraftRole(user?.role || 'USER');
      setDirectWorkspaces(workspaces);
      setDirectFeatures(features);
      setHrWorkspaces(activeHrWorkspaces);
      setHrFeatures(activeHrFeatures);
      setDraft(createAccessDraft({
        workspaceLevels: levels,
        explicitlySelectedFeatures: [...features.map((permission: DirectPermission) => permission.feature!), ...activeHrFeatures.map((permission: HrGrant) => permission.featureCode!)],
      }, definitions));
      setExpiresAt('');
      setReason('');
    } catch (error: any) {
      setFeedback({ kind: 'error', title: error.response?.data?.error || 'خواندن دسترسی‌های کاربر ناموفق بود.' });
    } finally { setLoadingUser(false); }
  }, [definitions, hrContext, users]);

  useEffect(() => { void loadUser(selectedUserId); }, [loadUser, selectedUserId]);

  const maxLevel: AccessLevel = actor?.role === 'MANAGER' ? 'edit' : 'admin';
  const isAdminTarget = selectedUser?.role === 'ADMIN';
  const canEdit = !!selectedUser && !isAdminTarget;
  const filteredDefinitions = useMemo(() => definitions.filter((definition) => !permissionSearch.trim() || definition.label.includes(permissionSearch.trim()) || definition.key.toLowerCase().includes(permissionSearch.trim().toLowerCase())), [definitions, permissionSearch]);
  const roleWorkspaceForSelected = roleWorkspacePermissions.filter((permission) => permission.role === draftRole && permission.isActive);
  const roleFeatureForSelected = roleFeaturePermissions.filter((permission) => permission.role === draftRole && permission.isActive);

  const save = async () => {
    if (!selectedUser || !canEdit || reason.trim().length < 3) {
      setFeedback({ kind: 'error', title: 'برای ذخیره، دلیل مستند با حداقل سه نویسه الزامی است.' }); return;
    }
    setSaving(true); setFeedback(undefined);
    try {
      await hrAuthorizationAPI.saveUserAccess(selectedUser.id, {
        role: draftRole,
        workspaceLevels: draft.workspaceLevels,
        features: definitions.filter(({ key }) => draft.selectedFeatures.has(key)).map((definition) => ({
          key: definition.key,
          level: definition.requiredLevel === 'admin' ? maxLevel : definition.requiredLevel,
        })),
        expiresAt: expiresAt ? toIsoDateTime(expiresAt) : undefined,
        reason: reason.trim(),
      });
      const contextResponse = await hrAuthorizationAPI.getContext();
      const refreshedContext = contextResponse.data.data;
      setHrContext(refreshedContext);
      await loadUser(selectedUser.id, refreshedContext);
      setReason('');
      setFeedback({ kind: 'success', title: `دسترسی‌های ${userName(selectedUser)} ذخیره شد.`, description: 'تغییرات در سرور ثبت شد و هیچ کاربر دیگری تغییر نکرد.' });
    } catch (error: any) {
      setFeedback({
        kind: 'error',
        title: error.response?.data?.error || error.message || 'ذخیره دسترسی‌ها ناموفق بود.',
        description: 'انتخاب‌ها حفظ شده‌اند؛ پس از رفع خطا دوباره ذخیره کنید.',
      });
    } finally { setSaving(false); }
  };

  const saveRoleDefault = async () => {
    if (actor?.role !== 'ADMIN') return;
    try {
      if (roleForm.feature) await permissionsAPI.createRoleFeaturePermission(roleForm);
      else await workspacePermissionsAPI.createRolePermission(roleForm);
      setFeedback({ kind: 'success', title: 'پیش‌فرض نقش ثبت شد.' });
      await loadBase();
    } catch (error: any) { setFeedback({ kind: 'error', title: error.response?.data?.error || 'ثبت پیش‌فرض نقش ناموفق بود.' }); }
  };

  const removeRoleDefault = async (permission: RolePermission) => {
    if (actor?.role !== 'ADMIN') return;
    try {
      if (permission.feature) await permissionsAPI.deleteRoleFeaturePermission(permission.id);
      else await workspacePermissionsAPI.deleteRolePermission(permission.id);
      setFeedback({ kind: 'success', title: 'پیش‌فرض نقش حذف شد.' });
      await loadBase();
    } catch (error: any) { setFeedback({ kind: 'error', title: error.response?.data?.error || 'حذف پیش‌فرض نقش ناموفق بود.' }); }
  };

  if (loading) return <ErpLoading />;
  return (
    <ErpPage eyebrow="منابع انسانی" title="مدیریت دسترسی کاربران" description="نقش، دسترسی فضای کاری و مجوزهای جزئی تمام سامانه را از یک محل مدیریت کنید.">
      {feedback && <ErpInlineState kind={feedback.kind} title={<span>{feedback.title}{feedback.description && <small className="mt-1 block font-normal">{feedback.description}</small>}</span>} />}
      <ErpSegmentedControl options={[{ value: 'users', label: 'دسترسی کاربران' }, { value: 'roles', label: 'پیش‌فرض‌های نقش', disabled: actor?.role !== 'ADMIN' }]} value={tab} onChange={setTab} />
      {tab === 'roles' ? (
        <ErpSection title="پیش‌فرض‌های نقش" description="این دسترسی‌ها ارثی هستند و فقط مدیر سامانه می‌تواند آن‌ها را تغییر دهد.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">نقش</span><ErpSelect value={roleForm.role} onChange={(event) => setRoleForm((current) => ({ ...current, role: event.target.value }))}>{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</ErpSelect></label>
            <label><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">فضای کاری</span><ErpSelect value={roleForm.workspace} onChange={(event) => setRoleForm((current) => ({ ...current, workspace: event.target.value, feature: '' }))}>{WORKSPACES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</ErpSelect></label>
            <label><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">مجوز جزئی (اختیاری)</span><ErpSelect value={roleForm.feature} onChange={(event) => setRoleForm((current) => ({ ...current, feature: event.target.value }))}><option value="">سطح کلی فضای کاری</option>{definitions.filter((definition) => definition.workspace === roleForm.workspace).map((definition) => <option key={definition.key} value={definition.key}>{definition.label}</option>)}</ErpSelect></label>
            <label><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">سطح</span><ErpSelect value={roleForm.permissionLevel} onChange={(event) => setRoleForm((current) => ({ ...current, permissionLevel: event.target.value as AccessLevel }))}><option value="view">مشاهده</option><option value="edit">ویرایش</option><option value="admin">مدیریت</option></ErpSelect></label>
          </div>
          <div className="mt-4 flex justify-end"><ErpButton label="ثبت پیش‌فرض" variant="solid" onClick={saveRoleDefault} /></div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {[...roleWorkspacePermissions, ...roleFeaturePermissions].map((permission) => <ErpCard key={`${permission.feature || 'workspace'}-${permission.id}`} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><strong className="text-sm text-[var(--sds-text-primary)]">{permission.role} · {WORKSPACES.find(({ key }) => key === permission.workspace)?.label || permission.workspace}</strong><p className="mt-1 text-xs text-[var(--sds-text-muted)]">{permission.feature ? definitions.find(({ key }) => key === permission.feature)?.label || permission.feature : 'سطح کلی فضای کاری'} · {LEVEL_LABELS[permission.permissionLevel]}</p></div><div className="flex items-center gap-2"><ErpBadge tone="info">ارثی از نقش</ErpBadge><ErpButton label="حذف" tone="danger" variant="ghost" onClick={() => removeRoleDefault(permission)} /></div></ErpCard>)}
          </div>
        </ErpSection>
      ) : (
        <>
          <ErpSection title="انتخاب کاربر">
            <div className="grid gap-3 md:grid-cols-2">
              <ErpCombobox
                label="کاربر"
                placeholder="جست‌وجو و انتخاب کاربر"
                value={selectedUserId}
                onChange={setSelectedUserId}
                options={users.map((user) => ({ value: user.id, label: `${userName(user)} · ${user.email || user.username}` }))}
                noOptionsText="کاربری با این مشخصات پیدا نشد"
              />
              <label>
                <span className="mb-1 block text-xs font-semibold text-[var(--sds-text-secondary)]">مجوز</span>
                <ErpInput
                  value={permissionSearch}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPermissionSearch(value);
                    if (!value.trim()) setExpanded({});
                  }}
                  placeholder="جست‌وجوی مجوز در فضاهای کاری"
                  aria-label="جست‌وجوی مجوز"
                />
              </label>
            </div>
          </ErpSection>
          {loadingUser ? <ErpLoading /> : !selectedUser ? <ErpEmptyState title="کاربری برای مدیریت دسترسی پیدا نشد." /> : (
            <>
              <ErpSection title={userName(selectedUser)} description={`${selectedUser.email} · ${selectedUser.username}`}>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">نقش سامانه</span><ErpSelect disabled={!canEdit} value={draftRole} onChange={(event) => setDraftRole(event.target.value)}>{ROLES.filter((role) => actor?.role === 'ADMIN' || role !== 'ADMIN').map((role) => <option key={role} value={role}>{role}</option>)}</ErpSelect></label>
                  <label><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">انقضای تغییرات جدید</span><HrPersianCalendar disabled={!canEdit} value={expiresAt} onChange={setExpiresAt} showTime clearable /></label>
                  <div><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">دسترسی مؤثر</span><div className="flex min-h-11 flex-wrap items-center gap-2">{selectedUser.role === 'ADMIN' ? <ErpBadge tone="success">کامل · ضمنی مدیر سامانه</ErpBadge> : <><ErpBadge tone="primary">مستقیم: {directWorkspaces.length + directFeatures.length + hrFeatures.length}</ErpBadge><ErpBadge tone="info">از نقش: {roleWorkspaceForSelected.length + roleFeatureForSelected.length}</ErpBadge></>}</div></div>
                </div>
              </ErpSection>
              <div className="space-y-4">
                {WORKSPACES.map(({ key, label }) => {
                  const workspaceDefinitions = filteredDefinitions.filter((definition) => definition.workspace === key);
                  const searchingPermissions = Boolean(permissionSearch.trim());
                  if (searchingPermissions && workspaceDefinitions.length === 0) return null;
                  const workspaceExpanded = searchingPermissions || Boolean(expanded[key]);
                  const selectableDefinitions = definitions.filter((definition) => actor?.role === 'ADMIN' || definition.requiredLevel !== 'admin');
                  const inheritedLevel = roleWorkspaceForSelected.find((permission) => permission.workspace === key)?.permissionLevel;
                  const directLevel = draft.workspaceLevels[key];
                  const effectiveLevel = directLevel || inheritedLevel;
                  const automatic = definitions.filter((definition) => definition.workspace === key && draft.automaticallyAddedFeatures.has(definition.key));
                  return <ErpSection key={key} title={label} description={effectiveLevel ? `دسترسی مؤثر: ${LEVEL_LABELS[effectiveLevel]} · منشأ: ${directLevel ? 'مستقیم' : 'از نقش'}` : 'بدون دسترسی مؤثر'} actions={searchingPermissions ? [] : [{ label: workspaceExpanded ? 'بستن مجوزها' : 'نمایش مجوزها', variant: 'ghost', onClick: () => setExpanded((current) => ({ ...current, [key]: !current[key] })) }]}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                      <label className="w-full lg:max-w-xs"><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">سطح مستقیم فضای کاری</span><ErpSelect disabled={!canEdit} value={draft.workspaceLevels[key] || ''} onChange={(event) => setDraft((current) => ({ ...current, workspaceLevels: { ...current.workspaceLevels, [key]: event.target.value ? event.target.value as AccessLevel : null } }))}><option value="">بدون دسترسی مستقیم</option><option value="view">مشاهده</option><option value="edit">ویرایش</option>{actor?.role === 'ADMIN' && <option value="admin">مدیریت</option>}</ErpSelect></label>
                      <div className="flex flex-wrap gap-2"><ErpButton label="انتخاب همه" variant="outline" disabled={!canEdit} onClick={() => setDraft((current) => selectAllInWorkspace(current, selectableDefinitions, key, maxLevel))} /><ErpButton label="لغو انتخاب همه" tone="danger" variant="ghost" disabled={!canEdit} onClick={() => setDraft((current) => deselectAllInWorkspace(current, definitions, key))} /></div>
                    </div>
                    {workspaceExpanded && <div className="mt-4 border-t border-[var(--sds-border-default)] pt-4"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{workspaceDefinitions.map((definition) => {
                      const inherited = roleFeatureForSelected.some((permission) => permission.workspace === key && permission.feature === definition.key);
                      const isAutomatic = draft.automaticallyAddedFeatures.has(definition.key);
                      const direct = draft.explicitlySelectedFeatures.has(definition.key);
                      return <div key={`${definition.source}-${definition.key}`} className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3"><ErpCheckbox checked={draft.selectedFeatures.has(definition.key) || inherited || selectedUser.role === 'ADMIN'} disabled={!canEdit || inherited || isAutomatic || (actor?.role === 'MANAGER' && definition.requiredLevel === 'admin')} onChange={(event) => setDraft((current) => setFeatureSelection(current, definitions, definition.key, event.target.checked))} label={<span>{definition.label} {direct && <ErpBadge tone="primary">مستقیم · {LEVEL_LABELS[definition.requiredLevel]}</ErpBadge>} {inherited && <ErpBadge tone="info">از نقش · مؤثر</ErpBadge>} {isAutomatic && <ErpBadge tone="purple">پیش‌نیاز</ErpBadge>}</span>} /></div>;
                    })}</div>{automatic.length > 0 && <ErpCard tone="info" className="mt-4 p-3"><strong className="text-sm">پیش‌نیازهای افزوده‌شده</strong><div className="mt-2 flex flex-wrap gap-2">{automatic.map((definition) => <ErpBadge key={definition.key} tone="info">{definition.label}</ErpBadge>)}</div></ErpCard>}</div>}
                  </ErpSection>;
                })}
              </div>
              <ErpSection title="ثبت تغییرات" description="فقط دسترسی‌های همین کاربر پس از ذخیره تغییر می‌کند.">
                <label><span className="mb-2 block text-sm text-[var(--sds-text-secondary)]">دلیل تغییر</span><ErpTextarea disabled={!canEdit} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                <div className="mt-4 flex justify-end"><ErpButton label={saving ? 'در حال ذخیره…' : 'ذخیره دسترسی‌های کاربر'} variant="solid" disabled={!canEdit || saving} onClick={save} /></div>
              </ErpSection>
            </>
          )}
        </>
      )}
    </ErpPage>
  );
}
