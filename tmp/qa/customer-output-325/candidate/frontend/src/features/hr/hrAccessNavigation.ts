export type EffectiveFeaturePermission = {
  feature: string;
  permissionLevel: string;
  workspace?: string;
};

export type HrBaseFeature =
  | 'DASHBOARD'
  | 'ORGANIZATIONAL_STRUCTURE'
  | 'PERSONNEL'
  | 'RECRUITMENT_CASES'
  | 'HR_WORK_MANAGEMENT'
  | 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION'
  | 'DATA_MIGRATION_RECONCILIATION'
  | 'USER_ADMINISTRATION';

export type HrNavigationDefinition = {
  id: string;
  label: string;
  href: string;
  feature: HrBaseFeature;
};

export const HR_NAVIGATION_DEFINITIONS: HrNavigationDefinition[] = [
  { id: 'dashboard', label: 'داشبورد منابع انسانی', href: '/dashboard/hr', feature: 'DASHBOARD' },
  { id: 'structure', label: 'ساختار سازمانی', href: '/dashboard/hr/structure', feature: 'ORGANIZATIONAL_STRUCTURE' },
  { id: 'hiring', label: 'جذب و پرونده‌های متقاضیان', href: '/dashboard/hr/hiring', feature: 'RECRUITMENT_CASES' },
  { id: 'tasks', label: 'وظایف منابع انسانی', href: '/dashboard/hr/tasks', feature: 'HR_WORK_MANAGEMENT' },
  { id: 'personnel', label: 'پرسنل و روابط استخدامی', href: '/dashboard/hr/personnel', feature: 'PERSONNEL' },
  { id: 'authority', label: 'اختیار و مسئولیت', href: '/dashboard/hr/permissions', feature: 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION' },
  { id: 'migration', label: 'مهاجرت و تطبیق', href: '/dashboard/hr/migration', feature: 'DATA_MIGRATION_RECONCILIATION' },
  { id: 'users', label: 'مدیریت کاربران', href: '/dashboard/hr/users', feature: 'USER_ADMINISTRATION' },
];

const hrFeatureCodes = (features: EffectiveFeaturePermission[]) => new Set(
  features
    .filter(({ workspace }) => !workspace || workspace === 'hr')
    .map(({ feature }) => feature),
);

export const hasHrFeature = (
  features: EffectiveFeaturePermission[],
  feature: HrBaseFeature,
) => hrFeatureCodes(features).has(feature);

export const canAdministerHrAccess = (systemRole?: string) => (
  systemRole === 'ADMIN' || systemRole === 'MANAGER'
);

const passesSystemRoleBoundary = (feature: HrBaseFeature, systemRole?: string) => (
  feature !== 'USER_ADMINISTRATION' || systemRole === 'ADMIN' || systemRole === 'MANAGER'
);

export const projectHrNavigation = (features: EffectiveFeaturePermission[], systemRole?: string) => {
  const available = hrFeatureCodes(features);
  return HR_NAVIGATION_DEFINITIONS.filter(({ feature }) => (
    available.has(feature) && passesSystemRoleBoundary(feature, systemRole)
  ));
};

export const projectHrWorkspaceLanding = (features: EffectiveFeaturePermission[], systemRole?: string) => {
  const navigation = projectHrNavigation(features, systemRole);
  const links = navigation
    .filter(({ feature }) => feature !== 'DASHBOARD')
    .map(({ id, label, href }) => ({ id, label, href }));
  if (hasHrFeature(features, 'DASHBOARD')) return { kind: 'dashboard' as const, links };
  return { kind: links.length ? 'limited' as const : 'empty' as const, links };
};

export const resolveHrRouteFeature = (pathname: string): HrBaseFeature => {
  if (pathname === '/dashboard/hr') return 'DASHBOARD';
  if (pathname.startsWith('/dashboard/hr/permissions')) return 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION';
  if (pathname.startsWith('/dashboard/hr/users')) return 'USER_ADMINISTRATION';
  if (pathname.startsWith('/dashboard/hr/migration')) return 'DATA_MIGRATION_RECONCILIATION';
  if (pathname.startsWith('/dashboard/hr/tasks') || pathname.startsWith('/dashboard/hr/duties')) return 'HR_WORK_MANAGEMENT';
  if (pathname.startsWith('/dashboard/hr/personnel') || pathname.startsWith('/dashboard/hr/vehicle-operations')) return 'PERSONNEL';
  if (pathname.startsWith('/dashboard/hr/hiring') || pathname.startsWith('/dashboard/hr/interview-criteria')) return 'RECRUITMENT_CASES';
  return 'ORGANIZATIONAL_STRUCTURE';
};

export const canAccessHrRoute = (
  features: EffectiveFeaturePermission[],
  pathname: string,
  systemRole?: string,
) => {
  if (pathname.startsWith('/dashboard/hr/vehicle-operations')) return canAdministerHrAccess(systemRole);
  const feature = resolveHrRouteFeature(pathname);
  return hasHrFeature(features, feature) && passesSystemRoleBoundary(feature, systemRole);
};
