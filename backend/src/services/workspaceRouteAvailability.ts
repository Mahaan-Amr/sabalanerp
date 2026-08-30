import type { PrismaClient } from '@prisma/client';
import { resolveNarrowFeatureAccess } from './narrowFeatureAccess';
import { getEffectiveUserAccess } from './effectiveAccessService';
import { resolveScopedActions } from './effectiveAccessService';

type Rule = { pattern: RegExp; workspace: string; features: string[]; level?: 'view' | 'edit' | 'admin'; narrow?: boolean;
  partnerPurposes?: readonly string[] };

// Backend-owned route contract. Clients consume only the resulting decision.
const rules: Rule[] = [
  // Partner entry points require an explicit Partner-domain grant in addition
  // to workspace admission. Legacy workspace membership never opts an actor in.
  { pattern: /^\/dashboard\/sales\/partners(?:\/|$)/, workspace: 'sales', features: [],
    partnerPurposes: ['ONBOARDING', 'MANAGEMENT', 'ACCOUNTING', 'CRM'] },
  { pattern: /^\/dashboard\/sales\/partner-inquiries(?:\/|$)/, workspace: 'sales', features: [],
    partnerPurposes: ['RESPONDER'] },
  { pattern: /^\/dashboard\/hr\/permissions/, workspace: 'hr', features: ['AUTHORITY_RESPONSIBILITY_ADMINISTRATION'] },
  { pattern: /^\/dashboard\/hr\/users/, workspace: 'hr', features: ['USER_ADMINISTRATION'] },
  { pattern: /^\/dashboard\/hr\/migration/, workspace: 'hr', features: ['DATA_MIGRATION_RECONCILIATION'] },
  { pattern: /^\/dashboard\/hr\/(?:tasks|duties)/, workspace: 'hr', features: ['HR_WORK_MANAGEMENT'] },
  { pattern: /^\/dashboard\/hr\/vehicle-operations/, workspace: 'hr', features: ['hr_internal_drivers_view', 'hr_vehicle_operations_view', 'hr_driver_biometric_audit_view'] },
  { pattern: /^\/dashboard\/hr\/personnel/, workspace: 'hr', features: ['PERSONNEL'] },
  { pattern: /^\/dashboard\/hr\/(?:hiring|interview-criteria)/, workspace: 'hr', features: ['RECRUITMENT_CASES'] },
  { pattern: /^\/dashboard\/hr\//, workspace: 'hr', features: ['ORGANIZATIONAL_STRUCTURE'] },
  { pattern: /^\/dashboard\/accounting\/settings\/biometric-connector/, workspace: 'accounting', features: ['accounting_biometric_diagnostics_view'], narrow: true },
  { pattern: /^\/dashboard\/accounting\/settings/, workspace: 'accounting', features: ['accounting_actions_manage'], level: 'edit', narrow: true },
  { pattern: /^\/dashboard\/accounting\/correction-requests/, workspace: 'accounting', features: ['accounting_corrections_manage', 'accounting_corrections_approve', 'accounting_corrections_verify'], narrow: true },
  { pattern: /^\/dashboard\/accounting\/invoice-candidates/, workspace: 'accounting', features: ['accounting_invoice_candidates_manage'] },
  { pattern: /^\/dashboard\/accounting\/receivables/, workspace: 'accounting', features: ['accounting_receivables_manage'] },
  { pattern: /^\/dashboard\/accounting\/payments/, workspace: 'accounting', features: ['accounting_payments_manage'] },
  { pattern: /^\/dashboard\/accounting\/tax/, workspace: 'accounting', features: ['accounting_tax_manage'] },
  { pattern: /^\/dashboard\/accounting\/(?:audit|performance)/, workspace: 'accounting', features: ['accounting_audit_view'] },
  { pattern: /^\/dashboard\/accounting\/dispatch/, workspace: 'accounting', features: ['accounting_dispatch_candidates_view', 'accounting_dispatch_candidates_manage'] },
  { pattern: /^\/dashboard\/accounting\/contracts/, workspace: 'accounting', features: ['accounting_contracts_view'] },
  { pattern: /^\/dashboard\/sales\/contracts\/(?:collaboration\/)?create/, workspace: 'sales', features: ['sales_contracts_create'], level: 'edit' },
  { pattern: /^\/dashboard\/sales\/contracts\/[^/]+\/edit/, workspace: 'sales', features: ['sales_contracts_edit'], level: 'edit' },
  { pattern: /^\/dashboard\/sales\/contracts/, workspace: 'sales', features: ['sales_contracts_view'] },
  { pattern: /^\/dashboard\/sales\/products\/create/, workspace: 'sales', features: ['sales_products_create'], level: 'edit' },
  { pattern: /^\/dashboard\/sales\/products/, workspace: 'sales', features: ['sales_products_view'] },
  { pattern: /^\/dashboard\/sales\/reports/, workspace: 'sales', features: ['sales_dashboard_view'] },
  { pattern: /^\/dashboard\/crm\/customers\/create/, workspace: 'crm', features: ['crm_customers_create', 'sales_customers_create'], level: 'edit' },
  { pattern: /^\/dashboard\/crm\/customers\/[^/]+\/edit/, workspace: 'crm', features: ['crm_customers_edit', 'sales_customers_edit'], level: 'edit' },
  { pattern: /^\/dashboard\/crm\/customers/, workspace: 'crm', features: ['crm_customers_view', 'sales_customers_view'] },
  { pattern: /^\/dashboard\/crm\/potential-projects\/create/, workspace: 'crm', features: ['crm_potential_projects_create'], level: 'edit' },
  { pattern: /^\/dashboard\/crm\/potential-projects/, workspace: 'crm', features: ['crm_potential_projects_view'] },
  { pattern: /^\/dashboard\/crm\/follow-ups\/create/, workspace: 'crm', features: ['crm_follow_ups_create'], level: 'edit' },
  { pattern: /^\/dashboard\/crm\/follow-ups/, workspace: 'crm', features: ['crm_follow_ups_view'] },
  { pattern: /^\/dashboard\/inventory\/services\/(?:cutting-types|stone-finishings|sub-services|services)\/create/, workspace: 'inventory', features: ['inventory_services_create', 'inventory_cutting_types_create', 'inventory_stone_finishings_create', 'inventory_sub_services_create'], level: 'edit' },
  { pattern: /^\/dashboard\/inventory\/services\/(?:cutting-types|stone-finishings|sub-services|services)\/edit/, workspace: 'inventory', features: ['inventory_services_edit', 'inventory_cutting_types_edit', 'inventory_stone_finishings_edit', 'inventory_sub_services_edit'], level: 'edit' },
  { pattern: /^\/dashboard\/inventory\/services/, workspace: 'inventory', features: ['inventory_services_view', 'inventory_cutting_types_view', 'inventory_stone_finishings_view', 'inventory_sub_services_view'] },
  { pattern: /^\/dashboard\/inventory\/master-data/, workspace: 'inventory', features: ['inventory_cut_types_view', 'inventory_stone_materials_view', 'inventory_mines_view'] },
  { pattern: /^\/dashboard\/logistics\/loadings\/new/, workspace: 'logistics', features: ['logistics_loadings_create'], level: 'edit' },
  { pattern: /^\/dashboard\/logistics\/loadings/, workspace: 'logistics', features: ['logistics_loadings_view'] },
  { pattern: /^\/dashboard\/security\/shifts/, workspace: 'security', features: ['security_shifts_view'] },
  { pattern: /^\/dashboard\/security\/attendance/, workspace: 'security', features: ['security_attendance_daily_view'] },
  { pattern: /^\/dashboard\/security\/exceptions/, workspace: 'security', features: ['security_exceptions_view'] },
  { pattern: /^\/dashboard\/security\/(?:external-registry|vehicles)/, workspace: 'security', features: ['security_external_drivers_view'] },
  { pattern: /^\/dashboard\/security\/(?:personnel|reports|supervisor-reports|settings)/, workspace: 'security', features: ['security_personnel_view'] },
  { pattern: /^\/dashboard\/bi\//, workspace: 'bi', features: ['bi_dashboard_view'] },
];

export const resolveWorkspaceRouteAvailability = async (
  prisma: PrismaClient,
  input: { userId: string; role: string; path: string },
  scopedResolver = resolveScopedActions,
) => {
  if (input.role === 'ADMIN' || /\/duties(?:\/|$)/.test(input.path)) return { allowed: true, reason: null };
  const rule = rules.find((candidate) => candidate.pattern.test(input.path));
  if (!rule) {
    const workspace = input.path.match(/^\/dashboard\/(sales|crm|hr|accounting|inventory|security|bi|logistics)(?:\/|$)/)?.[1];
    if (!workspace) return { allowed: true, reason: null };
    const effective = await getEffectiveUserAccess(prisma, { userId: input.userId, userRole: input.role });
    const allowed = effective.workspaces.some((grant) => grant.workspace === workspace);
    return { allowed, reason: allowed ? null : 'دسترسی فعال به این فضای کاری ثبت نشده است. مدیر همان فضای کاری باید مجوز را بررسی کند.' };
  }
  const requiredRank = { view: 1, edit: 2, admin: 3 }[rule.level || 'view'];
  const effective = await getEffectiveUserAccess(prisma, { userId: input.userId, userRole: input.role });
  const workspaceAllowed = effective.workspaces.some((grant) => grant.workspace === rule.workspace);
  const partnerAllowed = rule.partnerPurposes
    ? (await prisma.$transaction(tx => scopedResolver(tx, input.userId, 'PARTNER'))).grants
      .some(grant => rule.partnerPurposes!.includes(grant.purpose))
    : true;
  const allowed = rule.partnerPurposes
    ? workspaceAllowed && partnerAllowed
    : rule.narrow
    ? (await Promise.all(rule.features.map((feature) => resolveNarrowFeatureAccess(prisma, {
      userId: input.userId, role: input.role, workspace: rule.workspace, feature,
      requiredPermission: rule.level || 'view',
    })))).some((decision) => decision.allowed)
    : effective.features.some(
      (grant) => rule.features.includes(grant.feature) && ({ view: 1, edit: 2, admin: 3 }[grant.permission] >= requiredRank),
    );
  return { allowed, reason: allowed ? null : 'مجوز فعال لازم برای این بخش ثبت نشده است. مدیر همان فضای کاری باید مجوز مرتبط را بررسی کند.' };
};
