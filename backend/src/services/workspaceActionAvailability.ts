import type { PrismaClient } from '@prisma/client';
import { getEffectiveUserAccess } from './effectiveAccessService';
import { resolveNarrowFeatureAccess } from './narrowFeatureAccess';

type Level = 'view' | 'edit' | 'admin';
type ActionRule = { workspace: string; feature: string; level: Level; narrow?: boolean };

export const WORKSPACE_ACTION_RULES = Object.freeze({
  sales: {
    CREATE_CONTRACT: { workspace: 'sales', feature: 'sales_contracts_create', level: 'edit' },
    EDIT_CONTRACT: { workspace: 'sales', feature: 'sales_contracts_edit', level: 'edit' },
  },
  crm: {
    CREATE_CUSTOMER: { workspace: 'crm', feature: 'crm_customers_create', level: 'edit' },
    EDIT_CUSTOMER: { workspace: 'crm', feature: 'crm_customers_edit', level: 'edit' },
    CREATE_FOLLOW_UP: { workspace: 'crm', feature: 'crm_follow_ups_create', level: 'edit' },
  },
  hr: {
    EDIT_PERSONNEL: { workspace: 'hr', feature: 'PERSONNEL', level: 'edit' },
    MANAGE_VEHICLE_OPERATIONS: { workspace: 'hr', feature: 'hr_vehicle_operations_manage', level: 'edit' },
  },
  accounting: {
    CREATE_CORRECTION: { workspace: 'accounting', feature: 'accounting_corrections_create', level: 'edit', narrow: true },
    APPROVE_CORRECTION: { workspace: 'accounting', feature: 'accounting_corrections_approve', level: 'edit', narrow: true },
    VERIFY_CORRECTION: { workspace: 'accounting', feature: 'accounting_corrections_verify', level: 'edit', narrow: true },
  },
  inventory: {
    VIEW_SERVICE: { workspace: 'inventory', feature: 'inventory_services_view', level: 'view' },
    CREATE_SERVICE: { workspace: 'inventory', feature: 'inventory_services_create', level: 'edit' },
    EDIT_SERVICE: { workspace: 'inventory', feature: 'inventory_services_edit', level: 'edit' },
    DELETE_SERVICE: { workspace: 'inventory', feature: 'inventory_services_delete', level: 'edit' },
    TOGGLE_SERVICE: { workspace: 'inventory', feature: 'inventory_services_toggle', level: 'edit' },
    VIEW_CUTTING_TYPES: { workspace: 'inventory', feature: 'inventory_cutting_types_view', level: 'view' },
    CREATE_CUTTING_TYPES: { workspace: 'inventory', feature: 'inventory_cutting_types_create', level: 'edit' },
    EDIT_CUTTING_TYPES: { workspace: 'inventory', feature: 'inventory_cutting_types_edit', level: 'edit' },
    DELETE_CUTTING_TYPES: { workspace: 'inventory', feature: 'inventory_cutting_types_delete', level: 'edit' },
    TOGGLE_CUTTING_TYPES: { workspace: 'inventory', feature: 'inventory_cutting_types_toggle', level: 'edit' },
    VIEW_SUB_SERVICES: { workspace: 'inventory', feature: 'inventory_sub_services_view', level: 'view' },
    CREATE_SUB_SERVICES: { workspace: 'inventory', feature: 'inventory_sub_services_create', level: 'edit' },
    EDIT_SUB_SERVICES: { workspace: 'inventory', feature: 'inventory_sub_services_edit', level: 'edit' },
    DELETE_SUB_SERVICES: { workspace: 'inventory', feature: 'inventory_sub_services_delete', level: 'edit' },
    TOGGLE_SUB_SERVICES: { workspace: 'inventory', feature: 'inventory_sub_services_toggle', level: 'edit' },
    VIEW_STAIR_LENGTHS: { workspace: 'inventory', feature: 'inventory_stair_standard_lengths_view', level: 'view' },
    CREATE_STAIR_LENGTHS: { workspace: 'inventory', feature: 'inventory_stair_standard_lengths_create', level: 'edit' },
    EDIT_STAIR_LENGTHS: { workspace: 'inventory', feature: 'inventory_stair_standard_lengths_edit', level: 'edit' },
    DELETE_STAIR_LENGTHS: { workspace: 'inventory', feature: 'inventory_stair_standard_lengths_delete', level: 'edit' },
    TOGGLE_STAIR_LENGTHS: { workspace: 'inventory', feature: 'inventory_stair_standard_lengths_toggle', level: 'edit' },
    VIEW_LAYER_TYPES: { workspace: 'inventory', feature: 'inventory_layer_types_view', level: 'view' },
    CREATE_LAYER_TYPES: { workspace: 'inventory', feature: 'inventory_layer_types_create', level: 'edit' },
    EDIT_LAYER_TYPES: { workspace: 'inventory', feature: 'inventory_layer_types_edit', level: 'edit' },
    DELETE_LAYER_TYPES: { workspace: 'inventory', feature: 'inventory_layer_types_delete', level: 'edit' },
    TOGGLE_LAYER_TYPES: { workspace: 'inventory', feature: 'inventory_layer_types_toggle', level: 'edit' },
    VIEW_STONE_FINISHINGS: { workspace: 'inventory', feature: 'inventory_stone_finishings_view', level: 'view' },
    CREATE_STONE_FINISHINGS: { workspace: 'inventory', feature: 'inventory_stone_finishings_create', level: 'edit' },
    EDIT_STONE_FINISHINGS: { workspace: 'inventory', feature: 'inventory_stone_finishings_edit', level: 'edit' },
    DELETE_STONE_FINISHINGS: { workspace: 'inventory', feature: 'inventory_stone_finishings_delete', level: 'edit' },
    TOGGLE_STONE_FINISHINGS: { workspace: 'inventory', feature: 'inventory_stone_finishings_toggle', level: 'edit' },
    CREATE_CUT_TYPE: { workspace: 'inventory', feature: 'inventory_cut_types_create', level: 'edit' },
    EDIT_CUT_TYPE: { workspace: 'inventory', feature: 'inventory_cut_types_edit', level: 'edit' },
    VIEW_CUT_TYPES: { workspace: 'inventory', feature: 'inventory_cut_types_view', level: 'view' },
    CREATE_CUT_TYPES: { workspace: 'inventory', feature: 'inventory_cut_types_create', level: 'edit' },
    EDIT_CUT_TYPES: { workspace: 'inventory', feature: 'inventory_cut_types_edit', level: 'edit' },
    DELETE_CUT_TYPES: { workspace: 'inventory', feature: 'inventory_cut_types_delete', level: 'edit' },
    VIEW_STONE_MATERIALS: { workspace: 'inventory', feature: 'inventory_stone_materials_view', level: 'view' },
    CREATE_STONE_MATERIALS: { workspace: 'inventory', feature: 'inventory_stone_materials_create', level: 'edit' },
    EDIT_STONE_MATERIALS: { workspace: 'inventory', feature: 'inventory_stone_materials_edit', level: 'edit' },
    DELETE_STONE_MATERIALS: { workspace: 'inventory', feature: 'inventory_stone_materials_delete', level: 'edit' },
    VIEW_CUT_WIDTHS: { workspace: 'inventory', feature: 'inventory_cut_widths_view', level: 'view' },
    CREATE_CUT_WIDTHS: { workspace: 'inventory', feature: 'inventory_cut_widths_create', level: 'edit' },
    EDIT_CUT_WIDTHS: { workspace: 'inventory', feature: 'inventory_cut_widths_edit', level: 'edit' },
    DELETE_CUT_WIDTHS: { workspace: 'inventory', feature: 'inventory_cut_widths_delete', level: 'edit' },
    VIEW_THICKNESSES: { workspace: 'inventory', feature: 'inventory_thicknesses_view', level: 'view' },
    CREATE_THICKNESSES: { workspace: 'inventory', feature: 'inventory_thicknesses_create', level: 'edit' },
    EDIT_THICKNESSES: { workspace: 'inventory', feature: 'inventory_thicknesses_edit', level: 'edit' },
    DELETE_THICKNESSES: { workspace: 'inventory', feature: 'inventory_thicknesses_delete', level: 'edit' },
    VIEW_MINES: { workspace: 'inventory', feature: 'inventory_mines_view', level: 'view' },
    CREATE_MINES: { workspace: 'inventory', feature: 'inventory_mines_create', level: 'edit' },
    EDIT_MINES: { workspace: 'inventory', feature: 'inventory_mines_edit', level: 'edit' },
    DELETE_MINES: { workspace: 'inventory', feature: 'inventory_mines_delete', level: 'edit' },
    VIEW_FINISH_TYPES: { workspace: 'inventory', feature: 'inventory_finish_types_view', level: 'view' },
    CREATE_FINISH_TYPES: { workspace: 'inventory', feature: 'inventory_finish_types_create', level: 'edit' },
    EDIT_FINISH_TYPES: { workspace: 'inventory', feature: 'inventory_finish_types_edit', level: 'edit' },
    DELETE_FINISH_TYPES: { workspace: 'inventory', feature: 'inventory_finish_types_delete', level: 'edit' },
    VIEW_COLORS: { workspace: 'inventory', feature: 'inventory_colors_view', level: 'view' },
    CREATE_COLORS: { workspace: 'inventory', feature: 'inventory_colors_create', level: 'edit' },
    EDIT_COLORS: { workspace: 'inventory', feature: 'inventory_colors_edit', level: 'edit' },
    DELETE_COLORS: { workspace: 'inventory', feature: 'inventory_colors_delete', level: 'edit' },
  },
  security: {
    CREATE_EXCEPTION: { workspace: 'security', feature: 'security_attendance_exception', level: 'edit' },
    REVIEW_EXCEPTION: { workspace: 'security', feature: 'security_attendance_exception', level: 'admin' },
  },
  bi: {
    VIEW_REPORTS: { workspace: 'bi', feature: 'bi_dashboard_view', level: 'view' },
  },
  logistics: {
    CREATE_LOADING: { workspace: 'logistics', feature: 'logistics_loadings_create', level: 'edit' },
    EDIT_LOADING: { workspace: 'logistics', feature: 'logistics_loadings_edit', level: 'edit' },
    FINALIZE_LOADING: { workspace: 'logistics', feature: 'logistics_loadings_finalize', level: 'edit' },
    CANCEL_LOADING: { workspace: 'logistics', feature: 'logistics_loadings_cancel', level: 'edit' },
    CREATE_CORRECTION: { workspace: 'logistics', feature: 'logistics_corrections_create', level: 'edit' },
  },
} satisfies Record<string, Record<string, ActionRule>>);

export type WorkspaceActionAvailability = Record<string, { visible: boolean; enabled: boolean; reason: string | null }>;
const rank: Record<Level, number> = { view: 1, edit: 2, admin: 3 };

export const resolveWorkspaceActionAvailability = async (
  prisma: PrismaClient,
  input: { userId: string; role: string; workspace: keyof typeof WORKSPACE_ACTION_RULES },
): Promise<WorkspaceActionAvailability> => {
  const rules = WORKSPACE_ACTION_RULES[input.workspace];
  if (input.role === 'ADMIN') return Object.fromEntries(Object.keys(rules).map((action) => [action, {
    visible: true, enabled: true, reason: null,
  }]));
  const effective = await getEffectiveUserAccess(prisma, { userId: input.userId, userRole: input.role });
  const workspaceLevel = effective.workspaces.find(({ workspace }) => workspace === input.workspace)?.permission;
  const decisions = await Promise.all(Object.entries(rules).map(async ([action, rule]) => {
    const workspaceAllowed = Boolean(workspaceLevel && rank[workspaceLevel] >= rank[rule.level]);
    const featureAllowed = rule.narrow
      ? (await resolveNarrowFeatureAccess(prisma, {
        userId: input.userId, role: input.role, workspace: rule.workspace,
        feature: rule.feature, requiredPermission: rule.level,
      })).allowed
      : effective.features.some(({ feature, permission }) => feature === rule.feature && rank[permission] >= rank[rule.level]);
    const enabled = workspaceAllowed && featureAllowed;
    return [action, {
      visible: enabled,
      enabled,
      reason: enabled ? null : 'این اقدام متوقف شد چون مجوز فعال لازم در فضای کاری ثبت نشده است. مدیر همان فضای کاری باید مجوز را بررسی کند.',
    }] as const;
  }));
  return Object.fromEntries(decisions);
};
