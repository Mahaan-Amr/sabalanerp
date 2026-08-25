import { prisma } from '../lib/prisma';
import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';


const isPermissionActiveAndNotExpired = (
  permission: { isActive: boolean; expiresAt?: Date | null } | null | undefined
): boolean => {
  if (!permission || !permission.isActive) return false;
  if (!permission.expiresAt) return true;
  return permission.expiresAt.getTime() > Date.now();
};

export interface FeatureRequest extends AuthRequest {
  featurePermission?: string;
}

// Feature permission levels
export const FEATURE_PERMISSIONS = {
  VIEW: 'view',
  EDIT: 'edit',
  ADMIN: 'admin'
} as const;

export type FeaturePermission = typeof FEATURE_PERMISSIONS[keyof typeof FEATURE_PERMISSIONS];

// Available features across workspaces
export const FEATURES = {
  // Core/Admin Features
  CORE_DASHBOARD_STATS_VIEW: 'core_dashboard_stats_view',
  CORE_DASHBOARD_PROFILE_VIEW: 'core_dashboard_profile_view',
  CORE_DEPARTMENTS_VIEW: 'core_departments_view',
  CORE_DEPARTMENTS_CREATE: 'core_departments_create',
  CORE_DEPARTMENTS_EDIT: 'core_departments_edit',
  CORE_DEPARTMENTS_DELETE: 'core_departments_delete',
  CORE_POSTS_VIEW: 'core_posts_view',
  CORE_POSTS_CREATE: 'core_posts_create',
  CORE_POSTS_EDIT: 'core_posts_edit',
  CORE_POSTS_DELETE: 'core_posts_delete',
  CORE_ORDERS_VIEW: 'core_orders_view',
  CORE_ORDERS_CREATE: 'core_orders_create',
  CORE_ORDERS_EDIT: 'core_orders_edit',
  CORE_ORDERS_DELETE: 'core_orders_delete',
  CORE_ORDERS_UPDATE_STATUS: 'core_orders_update_status',

  // CRM Features
  CRM_CUSTOMERS_VIEW: 'crm_customers_view',
  CRM_CUSTOMERS_CREATE: 'crm_customers_create',
  CRM_CUSTOMERS_EDIT: 'crm_customers_edit',
  CRM_CUSTOMERS_DELETE: 'crm_customers_delete',
  CRM_CUSTOMERS_BLACKLIST: 'crm_customers_blacklist',
  CRM_CUSTOMERS_LOCK: 'crm_customers_lock',
  CRM_CUSTOMERS_ASSIGN_OWNER: 'crm_customers_assign_owner',
  CRM_PROJECT_ADDRESSES_CREATE: 'crm_project_addresses_create',
  CRM_PROJECT_ADDRESSES_EDIT: 'crm_project_addresses_edit',
  CRM_PROJECT_ADDRESSES_DELETE: 'crm_project_addresses_delete',
  CRM_PHONE_NUMBERS_CREATE: 'crm_phone_numbers_create',
  CRM_PHONE_NUMBERS_EDIT: 'crm_phone_numbers_edit',
  CRM_PHONE_NUMBERS_DELETE: 'crm_phone_numbers_delete',
  CRM_CONTACTS_VIEW: 'crm_contacts_view',
  CRM_CONTACTS_CREATE: 'crm_contacts_create',
  CRM_CONTACTS_EDIT: 'crm_contacts_edit',
  CRM_CONTACTS_DELETE: 'crm_contacts_delete',
  CRM_LEADS_VIEW: 'crm_leads_view',
  CRM_LEADS_CREATE: 'crm_leads_create',
  CRM_LEADS_EDIT: 'crm_leads_edit',
  CRM_LEADS_DELETE: 'crm_leads_delete',
  CRM_COMMUNICATIONS_VIEW: 'crm_communications_view',
  CRM_COMMUNICATIONS_CREATE: 'crm_communications_create',
  CRM_COMMUNICATIONS_EDIT: 'crm_communications_edit',
  CRM_COMMUNICATIONS_DELETE: 'crm_communications_delete',
  CRM_POTENTIAL_PROJECTS_VIEW: 'crm_potential_projects_view',
  CRM_POTENTIAL_PROJECTS_CREATE: 'crm_potential_projects_create',
  CRM_POTENTIAL_PROJECTS_EDIT: 'crm_potential_projects_edit',
  CRM_POTENTIAL_PROJECTS_REASSIGN: 'crm_potential_projects_reassign',
  CRM_FOLLOW_UPS_VIEW: 'crm_follow_ups_view',
  CRM_FOLLOW_UPS_CREATE: 'crm_follow_ups_create',
  CRM_NEXT_ACTIONS_VIEW: 'crm_next_actions_view',
  CRM_NEXT_ACTIONS_EDIT: 'crm_next_actions_edit',
  CRM_DASHBOARD_VIEW: 'crm_dashboard_view',

  // Sales Features
  SALES_CONTRACTS_VIEW: 'sales_contracts_view',
  SALES_CONTRACTS_CREATE: 'sales_contracts_create',
  SALES_CONTRACTS_EDIT: 'sales_contracts_edit',
  SALES_CONTRACTS_DELETE: 'sales_contracts_delete',
  SALES_CONTRACTS_CANCEL_AFTER_APPROVAL: 'sales_contracts_cancel_after_approval',
  SALES_CONTRACTS_APPROVE: 'sales_contracts_approve',
  SALES_CONTRACTS_REJECT: 'sales_contracts_reject',
  SALES_CONTRACTS_SIGN: 'sales_contracts_sign',
  SALES_CONTRACTS_PRINT: 'sales_contracts_print',
  SALES_CONTRACT_ITEMS_CREATE: 'sales_contract_items_create',
  SALES_DELIVERIES_VIEW: 'sales_deliveries_view',
  SALES_DELIVERIES_CREATE: 'sales_deliveries_create',
  SALES_PAYMENTS_VIEW: 'sales_payments_view',
  SALES_PAYMENTS_CREATE: 'sales_payments_create',
  SALES_VERIFICATION_SEND: 'sales_verification_send',
  SALES_VERIFICATION_VERIFY: 'sales_verification_verify',
  SALES_VERIFICATION_TIME: 'sales_verification_time',
  SALES_DASHBOARD_VIEW: 'sales_dashboard_view',
  SALES_CONTRACT_NUMBER_VIEW: 'sales_contract_number_view',
  SALES_CONTRACT_TEMPLATES_VIEW: 'sales_contract_templates_view',
  SALES_CONTRACT_TEMPLATES_CREATE: 'sales_contract_templates_create',
  SALES_CONTRACT_TEMPLATES_EDIT: 'sales_contract_templates_edit',
  SALES_CONTRACT_TEMPLATES_DELETE: 'sales_contract_templates_delete',
  SALES_CONTRACT_TEMPLATES_GENERATE: 'sales_contract_templates_generate',
  SALES_PRODUCTS_VIEW: 'sales_products_view',
  SALES_PRODUCTS_CREATE: 'sales_products_create',
  SALES_PRODUCTS_EDIT: 'sales_products_edit',
  SALES_PRODUCTS_DELETE: 'sales_products_delete',
  SALES_PRODUCTS_IMPORT: 'sales_products_import',
  SALES_PRODUCTS_EXPORT: 'sales_products_export',
  SALES_PRODUCTS_TEMPLATE: 'sales_products_template',
  SALES_PRODUCTS_STATS: 'sales_products_stats',
  SALES_PRODUCTS_ATTRIBUTES: 'sales_products_attributes',
  SALES_CUSTOMERS_VIEW: 'sales_customers_view',
  SALES_CUSTOMERS_CREATE: 'sales_customers_create',
  SALES_CUSTOMERS_EDIT: 'sales_customers_edit',
  SALES_CUSTOMERS_DELETE: 'sales_customers_delete',
  SALES_CUSTOMERS_ASSIGN_OWNER: 'sales_customers_assign_owner',
  SALES_LEGACY_CONTRACTS_VIEW: 'sales_legacy_contracts_view',
  SALES_LEGACY_CONTRACTS_CREATE: 'sales_legacy_contracts_create',
  SALES_LEGACY_CONTRACTS_EDIT: 'sales_legacy_contracts_edit',
  SALES_LEGACY_CONTRACTS_DELETE: 'sales_legacy_contracts_delete',
  SALES_LEGACY_CONTRACTS_APPROVE: 'sales_legacy_contracts_approve',
  SALES_LEGACY_CONTRACTS_REJECT: 'sales_legacy_contracts_reject',
  SALES_LEGACY_CONTRACTS_SIGN: 'sales_legacy_contracts_sign',
  SALES_LEGACY_CONTRACTS_PRINT: 'sales_legacy_contracts_print',

  // Inventory Features
  INVENTORY_CUT_TYPES_VIEW: 'inventory_cut_types_view',
  INVENTORY_CUT_TYPES_CREATE: 'inventory_cut_types_create',
  INVENTORY_CUT_TYPES_EDIT: 'inventory_cut_types_edit',
  INVENTORY_CUT_TYPES_DELETE: 'inventory_cut_types_delete',
  INVENTORY_STONE_MATERIALS_VIEW: 'inventory_stone_materials_view',
  INVENTORY_STONE_MATERIALS_CREATE: 'inventory_stone_materials_create',
  INVENTORY_STONE_MATERIALS_EDIT: 'inventory_stone_materials_edit',
  INVENTORY_STONE_MATERIALS_DELETE: 'inventory_stone_materials_delete',
  INVENTORY_CUT_WIDTHS_VIEW: 'inventory_cut_widths_view',
  INVENTORY_CUT_WIDTHS_CREATE: 'inventory_cut_widths_create',
  INVENTORY_CUT_WIDTHS_EDIT: 'inventory_cut_widths_edit',
  INVENTORY_CUT_WIDTHS_DELETE: 'inventory_cut_widths_delete',
  INVENTORY_THICKNESSES_VIEW: 'inventory_thicknesses_view',
  INVENTORY_THICKNESSES_CREATE: 'inventory_thicknesses_create',
  INVENTORY_THICKNESSES_EDIT: 'inventory_thicknesses_edit',
  INVENTORY_THICKNESSES_DELETE: 'inventory_thicknesses_delete',
  INVENTORY_MINES_VIEW: 'inventory_mines_view',
  INVENTORY_MINES_CREATE: 'inventory_mines_create',
  INVENTORY_MINES_EDIT: 'inventory_mines_edit',
  INVENTORY_MINES_DELETE: 'inventory_mines_delete',
  INVENTORY_FINISH_TYPES_VIEW: 'inventory_finish_types_view',
  INVENTORY_FINISH_TYPES_CREATE: 'inventory_finish_types_create',
  INVENTORY_FINISH_TYPES_EDIT: 'inventory_finish_types_edit',
  INVENTORY_FINISH_TYPES_DELETE: 'inventory_finish_types_delete',
  INVENTORY_COLORS_VIEW: 'inventory_colors_view',
  INVENTORY_COLORS_CREATE: 'inventory_colors_create',
  INVENTORY_COLORS_EDIT: 'inventory_colors_edit',
  INVENTORY_COLORS_DELETE: 'inventory_colors_delete',
  INVENTORY_SERVICES_VIEW: 'inventory_services_view',
  INVENTORY_SERVICES_CREATE: 'inventory_services_create',
  INVENTORY_SERVICES_EDIT: 'inventory_services_edit',
  INVENTORY_SERVICES_DELETE: 'inventory_services_delete',
  INVENTORY_SERVICES_TOGGLE: 'inventory_services_toggle',
  INVENTORY_CUTTING_TYPES_VIEW: 'inventory_cutting_types_view',
  INVENTORY_CUTTING_TYPES_CREATE: 'inventory_cutting_types_create',
  INVENTORY_CUTTING_TYPES_EDIT: 'inventory_cutting_types_edit',
  INVENTORY_CUTTING_TYPES_DELETE: 'inventory_cutting_types_delete',
  INVENTORY_CUTTING_TYPES_TOGGLE: 'inventory_cutting_types_toggle',
  INVENTORY_SUB_SERVICES_VIEW: 'inventory_sub_services_view',
  INVENTORY_SUB_SERVICES_CREATE: 'inventory_sub_services_create',
  INVENTORY_SUB_SERVICES_EDIT: 'inventory_sub_services_edit',
  INVENTORY_SUB_SERVICES_DELETE: 'inventory_sub_services_delete',
  INVENTORY_SUB_SERVICES_TOGGLE: 'inventory_sub_services_toggle',
  INVENTORY_STAIR_STANDARD_LENGTHS_VIEW: 'inventory_stair_standard_lengths_view',
  INVENTORY_STAIR_STANDARD_LENGTHS_CREATE: 'inventory_stair_standard_lengths_create',
  INVENTORY_STAIR_STANDARD_LENGTHS_EDIT: 'inventory_stair_standard_lengths_edit',
  INVENTORY_STAIR_STANDARD_LENGTHS_DELETE: 'inventory_stair_standard_lengths_delete',
  INVENTORY_STAIR_STANDARD_LENGTHS_TOGGLE: 'inventory_stair_standard_lengths_toggle',
  INVENTORY_LAYER_TYPES_VIEW: 'inventory_layer_types_view',
  INVENTORY_LAYER_TYPES_CREATE: 'inventory_layer_types_create',
  INVENTORY_LAYER_TYPES_EDIT: 'inventory_layer_types_edit',
  INVENTORY_LAYER_TYPES_DELETE: 'inventory_layer_types_delete',
  INVENTORY_LAYER_TYPES_TOGGLE: 'inventory_layer_types_toggle',
  INVENTORY_STONE_FINISHINGS_VIEW: 'inventory_stone_finishings_view',
  INVENTORY_STONE_FINISHINGS_CREATE: 'inventory_stone_finishings_create',
  INVENTORY_STONE_FINISHINGS_EDIT: 'inventory_stone_finishings_edit',
  INVENTORY_STONE_FINISHINGS_DELETE: 'inventory_stone_finishings_delete',
  INVENTORY_STONE_FINISHINGS_TOGGLE: 'inventory_stone_finishings_toggle',

  // Accounting Features
  ACCOUNTING_DASHBOARD_VIEW: 'accounting_dashboard_view',
  ACCOUNTING_CONTRACTS_VIEW: 'accounting_contracts_view',
  ACCOUNTING_INVOICE_CANDIDATES_MANAGE: 'accounting_invoice_candidates_manage',
  ACCOUNTING_RECEIVABLES_MANAGE: 'accounting_receivables_manage',
  ACCOUNTING_PAYMENTS_MANAGE: 'accounting_payments_manage',
  ACCOUNTING_TAX_MANAGE: 'accounting_tax_manage',
  ACCOUNTING_CORRECTIONS_MANAGE: 'accounting_corrections_manage',
  ACCOUNTING_CORRECTIONS_CREATE: 'accounting_corrections_create',
  ACCOUNTING_CORRECTIONS_APPROVE: 'accounting_corrections_approve',
  ACCOUNTING_CORRECTIONS_VERIFY: 'accounting_corrections_verify',
  ACCOUNTING_AUDIT_VIEW: 'accounting_audit_view',
  ACCOUNTING_RECORDS_APPROVE_VOID: 'accounting_records_approve_void',
  ACCOUNTING_ACTIONS_MANAGE: 'accounting_actions_manage',
  ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW: 'accounting_biometric_diagnostics_view',
  ACCOUNTING_DISPATCH_CANDIDATES_VIEW: 'accounting_dispatch_candidates_view',
  ACCOUNTING_DISPATCH_CANDIDATES_MANAGE: 'accounting_dispatch_candidates_manage',
  ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE: 'accounting_dispatch_confirmation_manage',

  // BI Features
  BI_DASHBOARD_VIEW: 'bi_dashboard_view',

  // Logistics Features
  LOGISTICS_DASHBOARD_VIEW: 'logistics_dashboard_view',
  LOGISTICS_LOADINGS_VIEW: 'logistics_loadings_view',
  LOGISTICS_LOADINGS_CREATE: 'logistics_loadings_create',
  LOGISTICS_LOADINGS_EDIT: 'logistics_loadings_edit',
  LOGISTICS_LOADINGS_FINALIZE: 'logistics_loadings_finalize',
  LOGISTICS_LOADINGS_CANCEL: 'logistics_loadings_cancel',
  LOGISTICS_CORRECTIONS_CREATE: 'logistics_corrections_create',
  LOGISTICS_DRIVERS_VIEW: 'logistics_drivers_view',
  LOGISTICS_DRIVERS_MANAGE: 'logistics_drivers_manage',

  // HR-hosted Driver and Vehicle Operations Features
  HR_INTERNAL_DRIVERS_VIEW: 'hr_internal_drivers_view',
  HR_INTERNAL_DRIVERS_MANAGE: 'hr_internal_drivers_manage',
  HR_VEHICLE_OPERATIONS_VIEW: 'hr_vehicle_operations_view',
  HR_VEHICLE_OPERATIONS_MANAGE: 'hr_vehicle_operations_manage',
  HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE: 'hr_internal_driver_eligibility_manage',
  HR_DRIVER_BIOMETRIC_AUDIT_VIEW: 'hr_driver_biometric_audit_view',
  HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE: 'hr_driver_biometric_enrollment_manage',
  HR_DRIVER_PROFILES_MANAGE: 'hr_driver_profiles_manage',
  HR_COMPANY_VEHICLES_MANAGE: 'hr_company_vehicles_manage',
  HR_VEHICLE_PLATES_MANAGE: 'hr_vehicle_plates_manage',
  HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE: 'hr_driver_vehicle_assignments_manage',
  HR_VEHICLE_OPERATIONS_AUDIT_VIEW: 'hr_vehicle_operations_audit_view',

  // Human Resources Features
  HR_DASHBOARD_VIEW: 'hr_dashboard_view',
  HR_ORGANIZATION_VIEW: 'hr_organization_view',
  HR_ORGANIZATION_CREATE: 'hr_organization_create',
  HR_ORGANIZATION_EDIT: 'hr_organization_edit',
  HR_ORGANIZATION_ARCHIVE: 'hr_organization_archive',
  HR_ORGANIZATION_DELETE: 'hr_organization_delete',
  HR_PERSONNEL_VIEW: 'hr_personnel_view',
  HR_PERSONNEL_EDIT: 'hr_personnel_edit',
  HR_RECRUITMENT_VIEW: 'hr_recruitment_view',
  HR_RECRUITMENT_EDIT: 'hr_recruitment_edit',
  HR_ASSESSMENTS_EDIT: 'hr_assessments_edit',
  HR_WORK_MANAGEMENT_VIEW: 'hr_work_management_view',
  HR_WORK_MANAGEMENT_EDIT: 'hr_work_management_edit',
  HR_PERMISSIONS_VIEW: 'hr_permissions_view',
  HR_PERMISSIONS_EDIT: 'hr_permissions_edit',
  HR_MIGRATION_VIEW: 'hr_migration_view',
  HR_MIGRATION_EDIT: 'hr_migration_edit',
  HR_USERS_VIEW: 'hr_users_view',
  HR_USERS_CREATE: 'hr_users_create',
  HR_USERS_EDIT: 'hr_users_edit',
  HR_USERS_DELETE: 'hr_users_delete',

  // Security Features
  SECURITY_SHIFTS_VIEW: 'security_shifts_view',
  SECURITY_SHIFTS_CREATE: 'security_shifts_create',
  SECURITY_SHIFTS_START: 'security_shifts_start',
  SECURITY_SHIFTS_END: 'security_shifts_end',
  SECURITY_ATTENDANCE_CHECKIN: 'security_attendance_checkin',
  SECURITY_ATTENDANCE_CHECKOUT: 'security_attendance_checkout',
  SECURITY_ATTENDANCE_EXCEPTION: 'security_attendance_exception',
  SECURITY_ATTENDANCE_DAILY_VIEW: 'security_attendance_daily_view',
  SECURITY_DASHBOARD_VIEW: 'security_dashboard_view',
  SECURITY_PERSONNEL_VIEW: 'security_personnel_view',
  SECURITY_PERSONNEL_ASSIGN: 'security_personnel_assign',
  SECURITY_EXCEPTIONS_REQUEST: 'security_exceptions_request',
  SECURITY_EXCEPTIONS_VIEW: 'security_exceptions_view',
  SECURITY_EXCEPTIONS_APPROVE: 'security_exceptions_approve',
  SECURITY_EXCEPTIONS_REJECT: 'security_exceptions_reject',
  SECURITY_MISSIONS_ASSIGN: 'security_missions_assign',
  SECURITY_MISSIONS_VIEW: 'security_missions_view',
  SECURITY_MISSIONS_APPROVE: 'security_missions_approve',
  SECURITY_SIGNATURE_UPDATE: 'security_signature_update',
  SECURITY_SIGNATURE_VIEW: 'security_signature_view',
  SECURITY_SIGNATURE_VALIDATE: 'security_signature_validate',
  SECURITY_EXTERNAL_DRIVERS_VIEW: 'security_external_drivers_view',
  SECURITY_EXTERNAL_DRIVERS_MANAGE: 'security_external_drivers_manage',
  SECURITY_EXTERNAL_DRIVER_VEHICLE_MANAGE: 'security_external_driver_vehicle_manage',
  SECURITY_DISPATCH_EVIDENCE_VIEW: 'security_dispatch_evidence_view',
  SECURITY_DISPATCH_CONFIRMATION_APPROVE: 'security_dispatch_confirmation_approve',
  SUPPORT_SECURITY_INCIDENT_HANDLE: 'support_security_incident_handle'
} as const;

export type Feature = typeof FEATURES[keyof typeof FEATURES];

const permissionLevels: FeaturePermission[] = [
  FEATURE_PERMISSIONS.VIEW,
  FEATURE_PERMISSIONS.EDIT,
  FEATURE_PERMISSIONS.ADMIN
];

const hasRequiredPermissionLevel = (
  currentPermission: FeaturePermission,
  requiredPermission: FeaturePermission
): boolean => {
  const userLevel = permissionLevels.indexOf(currentPermission);
  const requiredLevel = permissionLevels.indexOf(requiredPermission);
  return userLevel >= requiredLevel;
};

// Feature to workspace mapping
export const FEATURE_WORKSPACE_MAP: Record<Feature, string> = {
  // Core/Admin Features
  [FEATURES.CORE_DASHBOARD_STATS_VIEW]: 'sales',
  [FEATURES.CORE_DASHBOARD_PROFILE_VIEW]: 'sales',
  [FEATURES.CORE_DEPARTMENTS_VIEW]: 'sales',
  [FEATURES.CORE_DEPARTMENTS_CREATE]: 'sales',
  [FEATURES.CORE_DEPARTMENTS_EDIT]: 'sales',
  [FEATURES.CORE_DEPARTMENTS_DELETE]: 'sales',
  [FEATURES.CORE_POSTS_VIEW]: 'sales',
  [FEATURES.CORE_POSTS_CREATE]: 'sales',
  [FEATURES.CORE_POSTS_EDIT]: 'sales',
  [FEATURES.CORE_POSTS_DELETE]: 'sales',
  [FEATURES.CORE_ORDERS_VIEW]: 'sales',
  [FEATURES.CORE_ORDERS_CREATE]: 'sales',
  [FEATURES.CORE_ORDERS_EDIT]: 'sales',
  [FEATURES.CORE_ORDERS_DELETE]: 'sales',
  [FEATURES.CORE_ORDERS_UPDATE_STATUS]: 'sales',

  // CRM Features
  [FEATURES.CRM_CUSTOMERS_VIEW]: 'crm',
  [FEATURES.CRM_CUSTOMERS_CREATE]: 'crm',
  [FEATURES.CRM_CUSTOMERS_EDIT]: 'crm',
  [FEATURES.CRM_CUSTOMERS_DELETE]: 'crm',
  [FEATURES.CRM_CUSTOMERS_BLACKLIST]: 'crm',
  [FEATURES.CRM_CUSTOMERS_LOCK]: 'crm',
  [FEATURES.CRM_CUSTOMERS_ASSIGN_OWNER]: 'crm',
  [FEATURES.CRM_PROJECT_ADDRESSES_CREATE]: 'crm',
  [FEATURES.CRM_PROJECT_ADDRESSES_EDIT]: 'crm',
  [FEATURES.CRM_PROJECT_ADDRESSES_DELETE]: 'crm',
  [FEATURES.CRM_PHONE_NUMBERS_CREATE]: 'crm',
  [FEATURES.CRM_PHONE_NUMBERS_EDIT]: 'crm',
  [FEATURES.CRM_PHONE_NUMBERS_DELETE]: 'crm',
  [FEATURES.CRM_CONTACTS_VIEW]: 'crm',
  [FEATURES.CRM_CONTACTS_CREATE]: 'crm',
  [FEATURES.CRM_CONTACTS_EDIT]: 'crm',
  [FEATURES.CRM_CONTACTS_DELETE]: 'crm',
  [FEATURES.CRM_LEADS_VIEW]: 'crm',
  [FEATURES.CRM_LEADS_CREATE]: 'crm',
  [FEATURES.CRM_LEADS_EDIT]: 'crm',
  [FEATURES.CRM_LEADS_DELETE]: 'crm',
  [FEATURES.CRM_COMMUNICATIONS_VIEW]: 'crm',
  [FEATURES.CRM_COMMUNICATIONS_CREATE]: 'crm',
  [FEATURES.CRM_COMMUNICATIONS_EDIT]: 'crm',
  [FEATURES.CRM_COMMUNICATIONS_DELETE]: 'crm',
  [FEATURES.CRM_POTENTIAL_PROJECTS_VIEW]: 'crm',
  [FEATURES.CRM_POTENTIAL_PROJECTS_CREATE]: 'crm',
  [FEATURES.CRM_POTENTIAL_PROJECTS_EDIT]: 'crm',
  [FEATURES.CRM_POTENTIAL_PROJECTS_REASSIGN]: 'crm',
  [FEATURES.CRM_FOLLOW_UPS_VIEW]: 'crm',
  [FEATURES.CRM_FOLLOW_UPS_CREATE]: 'crm',
  [FEATURES.CRM_NEXT_ACTIONS_VIEW]: 'crm',
  [FEATURES.CRM_NEXT_ACTIONS_EDIT]: 'crm',
  [FEATURES.CRM_DASHBOARD_VIEW]: 'crm',

  // Sales Features
  [FEATURES.SALES_CONTRACTS_VIEW]: 'sales',
  [FEATURES.SALES_CONTRACTS_CREATE]: 'sales',
  [FEATURES.SALES_CONTRACTS_EDIT]: 'sales',
  [FEATURES.SALES_CONTRACTS_DELETE]: 'sales',
  [FEATURES.SALES_CONTRACTS_CANCEL_AFTER_APPROVAL]: 'sales',
  [FEATURES.SALES_CONTRACTS_APPROVE]: 'sales',
  [FEATURES.SALES_CONTRACTS_REJECT]: 'sales',
  [FEATURES.SALES_CONTRACTS_SIGN]: 'sales',
  [FEATURES.SALES_CONTRACTS_PRINT]: 'sales',
  [FEATURES.SALES_CONTRACT_ITEMS_CREATE]: 'sales',
  [FEATURES.SALES_DELIVERIES_VIEW]: 'sales',
  [FEATURES.SALES_DELIVERIES_CREATE]: 'sales',
  [FEATURES.SALES_PAYMENTS_VIEW]: 'sales',
  [FEATURES.SALES_PAYMENTS_CREATE]: 'sales',
  [FEATURES.SALES_VERIFICATION_SEND]: 'sales',
  [FEATURES.SALES_VERIFICATION_VERIFY]: 'sales',
  [FEATURES.SALES_VERIFICATION_TIME]: 'sales',
  [FEATURES.SALES_DASHBOARD_VIEW]: 'sales',
  [FEATURES.SALES_CONTRACT_NUMBER_VIEW]: 'sales',
  [FEATURES.SALES_CONTRACT_TEMPLATES_VIEW]: 'sales',
  [FEATURES.SALES_CONTRACT_TEMPLATES_CREATE]: 'sales',
  [FEATURES.SALES_CONTRACT_TEMPLATES_EDIT]: 'sales',
  [FEATURES.SALES_CONTRACT_TEMPLATES_DELETE]: 'sales',
  [FEATURES.SALES_CONTRACT_TEMPLATES_GENERATE]: 'sales',
  [FEATURES.SALES_PRODUCTS_VIEW]: 'sales',
  [FEATURES.SALES_PRODUCTS_CREATE]: 'sales',
  [FEATURES.SALES_PRODUCTS_EDIT]: 'sales',
  [FEATURES.SALES_PRODUCTS_DELETE]: 'sales',
  [FEATURES.SALES_PRODUCTS_IMPORT]: 'sales',
  [FEATURES.SALES_PRODUCTS_EXPORT]: 'sales',
  [FEATURES.SALES_PRODUCTS_TEMPLATE]: 'sales',
  [FEATURES.SALES_PRODUCTS_STATS]: 'sales',
  [FEATURES.SALES_PRODUCTS_ATTRIBUTES]: 'sales',
  [FEATURES.SALES_CUSTOMERS_VIEW]: 'sales',
  [FEATURES.SALES_CUSTOMERS_CREATE]: 'sales',
  [FEATURES.SALES_CUSTOMERS_EDIT]: 'sales',
  [FEATURES.SALES_CUSTOMERS_DELETE]: 'sales',
  [FEATURES.SALES_CUSTOMERS_ASSIGN_OWNER]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_VIEW]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_CREATE]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_EDIT]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_DELETE]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_APPROVE]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_REJECT]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_SIGN]: 'sales',
  [FEATURES.SALES_LEGACY_CONTRACTS_PRINT]: 'sales',

  // Inventory Features
  [FEATURES.INVENTORY_CUT_TYPES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_CUT_TYPES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_CUT_TYPES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_CUT_TYPES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_STONE_MATERIALS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_STONE_MATERIALS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_STONE_MATERIALS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_STONE_MATERIALS_DELETE]: 'inventory',
  [FEATURES.INVENTORY_CUT_WIDTHS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_CUT_WIDTHS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_CUT_WIDTHS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_CUT_WIDTHS_DELETE]: 'inventory',
  [FEATURES.INVENTORY_THICKNESSES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_THICKNESSES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_THICKNESSES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_THICKNESSES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_MINES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_MINES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_MINES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_MINES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_FINISH_TYPES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_FINISH_TYPES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_FINISH_TYPES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_FINISH_TYPES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_COLORS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_COLORS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_COLORS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_COLORS_DELETE]: 'inventory',
  [FEATURES.INVENTORY_SERVICES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_SERVICES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_SERVICES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_SERVICES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_SERVICES_TOGGLE]: 'inventory',
  [FEATURES.INVENTORY_CUTTING_TYPES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_CUTTING_TYPES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_CUTTING_TYPES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_CUTTING_TYPES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_CUTTING_TYPES_TOGGLE]: 'inventory',
  [FEATURES.INVENTORY_SUB_SERVICES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_SUB_SERVICES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_SUB_SERVICES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_SUB_SERVICES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_SUB_SERVICES_TOGGLE]: 'inventory',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_DELETE]: 'inventory',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_TOGGLE]: 'inventory',
  [FEATURES.INVENTORY_LAYER_TYPES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_LAYER_TYPES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_LAYER_TYPES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_LAYER_TYPES_DELETE]: 'inventory',
  [FEATURES.INVENTORY_LAYER_TYPES_TOGGLE]: 'inventory',
  [FEATURES.INVENTORY_STONE_FINISHINGS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_STONE_FINISHINGS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_STONE_FINISHINGS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_STONE_FINISHINGS_DELETE]: 'inventory',
  [FEATURES.INVENTORY_STONE_FINISHINGS_TOGGLE]: 'inventory',

  // Accounting Features
  [FEATURES.ACCOUNTING_DASHBOARD_VIEW]: 'accounting',
  [FEATURES.ACCOUNTING_CONTRACTS_VIEW]: 'accounting',
  [FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE]: 'accounting',
  [FEATURES.ACCOUNTING_RECEIVABLES_MANAGE]: 'accounting',
  [FEATURES.ACCOUNTING_PAYMENTS_MANAGE]: 'accounting',
  [FEATURES.ACCOUNTING_TAX_MANAGE]: 'accounting',
  [FEATURES.ACCOUNTING_CORRECTIONS_MANAGE]: 'accounting',
  [FEATURES.ACCOUNTING_CORRECTIONS_CREATE]: 'accounting',
  [FEATURES.ACCOUNTING_CORRECTIONS_APPROVE]: 'accounting',
  [FEATURES.ACCOUNTING_CORRECTIONS_VERIFY]: 'accounting',
  [FEATURES.ACCOUNTING_AUDIT_VIEW]: 'accounting',
  [FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID]: 'accounting',
  [FEATURES.ACCOUNTING_ACTIONS_MANAGE]: 'accounting',
  [FEATURES.ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW]: 'accounting',
  [FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_VIEW]: 'accounting',
  [FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE]: 'accounting',
  [FEATURES.ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE]: 'accounting',

  // BI Features
  [FEATURES.BI_DASHBOARD_VIEW]: 'bi',

  // Logistics Features
  [FEATURES.LOGISTICS_DASHBOARD_VIEW]: 'logistics',
  [FEATURES.LOGISTICS_LOADINGS_VIEW]: 'logistics',
  [FEATURES.LOGISTICS_LOADINGS_CREATE]: 'logistics',
  [FEATURES.LOGISTICS_LOADINGS_EDIT]: 'logistics',
  [FEATURES.LOGISTICS_LOADINGS_FINALIZE]: 'logistics',
  [FEATURES.LOGISTICS_LOADINGS_CANCEL]: 'logistics',
  [FEATURES.LOGISTICS_CORRECTIONS_CREATE]: 'logistics',
  [FEATURES.LOGISTICS_DRIVERS_VIEW]: 'logistics',
  [FEATURES.LOGISTICS_DRIVERS_MANAGE]: 'logistics',

  [FEATURES.HR_INTERNAL_DRIVERS_VIEW]: 'hr',
  [FEATURES.HR_INTERNAL_DRIVERS_MANAGE]: 'hr',
  [FEATURES.HR_VEHICLE_OPERATIONS_VIEW]: 'hr',
  [FEATURES.HR_VEHICLE_OPERATIONS_MANAGE]: 'hr',
  [FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE]: 'hr',
  [FEATURES.HR_DRIVER_BIOMETRIC_AUDIT_VIEW]: 'hr',
  [FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE]: 'hr',
  [FEATURES.HR_DRIVER_PROFILES_MANAGE]: 'hr',
  [FEATURES.HR_COMPANY_VEHICLES_MANAGE]: 'hr',
  [FEATURES.HR_VEHICLE_PLATES_MANAGE]: 'hr',
  [FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE]: 'hr',
  [FEATURES.HR_VEHICLE_OPERATIONS_AUDIT_VIEW]: 'hr',

  // Human Resources Features
  [FEATURES.HR_DASHBOARD_VIEW]: 'hr',
  [FEATURES.HR_ORGANIZATION_VIEW]: 'hr',
  [FEATURES.HR_ORGANIZATION_CREATE]: 'hr',
  [FEATURES.HR_ORGANIZATION_EDIT]: 'hr',
  [FEATURES.HR_ORGANIZATION_ARCHIVE]: 'hr',
  [FEATURES.HR_ORGANIZATION_DELETE]: 'hr',
  [FEATURES.HR_PERSONNEL_VIEW]: 'hr',
  [FEATURES.HR_PERSONNEL_EDIT]: 'hr',
  [FEATURES.HR_RECRUITMENT_VIEW]: 'hr',
  [FEATURES.HR_RECRUITMENT_EDIT]: 'hr',
  [FEATURES.HR_ASSESSMENTS_EDIT]: 'hr',
  [FEATURES.HR_WORK_MANAGEMENT_VIEW]: 'hr',
  [FEATURES.HR_WORK_MANAGEMENT_EDIT]: 'hr',
  [FEATURES.HR_PERMISSIONS_VIEW]: 'hr',
  [FEATURES.HR_PERMISSIONS_EDIT]: 'hr',
  [FEATURES.HR_MIGRATION_VIEW]: 'hr',
  [FEATURES.HR_MIGRATION_EDIT]: 'hr',
  [FEATURES.HR_USERS_VIEW]: 'hr',
  [FEATURES.HR_USERS_CREATE]: 'hr',
  [FEATURES.HR_USERS_EDIT]: 'hr',
  [FEATURES.HR_USERS_DELETE]: 'hr',

  // Security Features
  [FEATURES.SECURITY_SHIFTS_VIEW]: 'security',
  [FEATURES.SECURITY_SHIFTS_CREATE]: 'security',
  [FEATURES.SECURITY_SHIFTS_START]: 'security',
  [FEATURES.SECURITY_SHIFTS_END]: 'security',
  [FEATURES.SECURITY_ATTENDANCE_CHECKIN]: 'security',
  [FEATURES.SECURITY_ATTENDANCE_CHECKOUT]: 'security',
  [FEATURES.SECURITY_ATTENDANCE_EXCEPTION]: 'security',
  [FEATURES.SECURITY_ATTENDANCE_DAILY_VIEW]: 'security',
  [FEATURES.SECURITY_DASHBOARD_VIEW]: 'security',
  [FEATURES.SECURITY_PERSONNEL_VIEW]: 'security',
  [FEATURES.SECURITY_PERSONNEL_ASSIGN]: 'security',
  [FEATURES.SECURITY_EXCEPTIONS_REQUEST]: 'security',
  [FEATURES.SECURITY_EXCEPTIONS_VIEW]: 'security',
  [FEATURES.SECURITY_EXCEPTIONS_APPROVE]: 'security',
  [FEATURES.SECURITY_EXCEPTIONS_REJECT]: 'security',
  [FEATURES.SECURITY_MISSIONS_ASSIGN]: 'security',
  [FEATURES.SECURITY_MISSIONS_VIEW]: 'security',
  [FEATURES.SECURITY_MISSIONS_APPROVE]: 'security',
  [FEATURES.SECURITY_SIGNATURE_UPDATE]: 'security',
  [FEATURES.SECURITY_SIGNATURE_VIEW]: 'security',
  [FEATURES.SECURITY_SIGNATURE_VALIDATE]: 'security',
  [FEATURES.SECURITY_EXTERNAL_DRIVERS_VIEW]: 'security',
  [FEATURES.SECURITY_EXTERNAL_DRIVERS_MANAGE]: 'security',
  [FEATURES.SECURITY_EXTERNAL_DRIVER_VEHICLE_MANAGE]: 'security',
  [FEATURES.SECURITY_DISPATCH_EVIDENCE_VIEW]: 'security',
  [FEATURES.SECURITY_DISPATCH_CONFIRMATION_APPROVE]: 'security',
  [FEATURES.SUPPORT_SECURITY_INCIDENT_HANDLE]: 'security'
};

const FEATURE_SUBJECT_LABELS_FA: Record<string, string> = {
  core_dashboard: 'داشبورد سامانه',
  core_departments: 'بخش‌ها',
  core_posts: 'سمت‌ها',
  core_orders: 'سفارش‌ها',
  crm_customers: 'مشتریان',
  crm_project_addresses: 'نشانی‌های پروژه',
  crm_phone_numbers: 'شماره‌های تماس',
  crm_contacts: 'مخاطبان',
  crm_leads: 'سرنخ‌ها',
  crm_communications: 'ارتباطات مشتری',
  crm_potential_projects: 'پروژه‌های احتمالی',
  crm_follow_ups: 'پیگیری‌ها',
  crm_next_actions: 'اقدام‌های بعدی',
  crm_dashboard: 'داشبورد ارتباط با مشتری',
  sales_contracts: 'قراردادهای فروش',
  sales_contract_items: 'اقلام قرارداد فروش',
  sales_deliveries: 'تحویل‌های فروش',
  sales_payments: 'پرداخت‌های فروش',
  sales_verification: 'تأیید فروش',
  sales_dashboard: 'داشبورد فروش',
  sales_contract_number: 'شماره قرارداد فروش',
  sales_contract_templates: 'الگوهای قرارداد',
  sales_products: 'محصولات فروش',
  sales_customers: 'مشتریان فروش',
  sales_legacy_contracts: 'قراردادهای قدیمی',
  inventory_cut_types: 'انواع برش',
  inventory_stone_materials: 'جنس‌های سنگ',
  inventory_cut_widths: 'عرض‌های برش',
  inventory_thicknesses: 'ضخامت‌ها',
  inventory_mines: 'معادن',
  inventory_finish_types: 'انواع پرداخت',
  inventory_colors: 'رنگ‌ها',
  inventory_services: 'خدمات انبار',
  inventory_cutting_types: 'روش‌های برش',
  inventory_sub_services: 'زیرخدمت‌ها',
  inventory_stair_standard_lengths: 'طول‌های استاندارد پله',
  inventory_layer_types: 'انواع لایه',
  inventory_stone_finishings: 'پرداخت‌های سنگ',
  accounting_dashboard: 'داشبورد حسابداری',
  accounting_contracts: 'قراردادهای حسابداری',
  accounting_invoice_candidates: 'گزینه‌های صدور صورت‌حساب',
  accounting_receivables: 'دریافتنی‌ها',
  accounting_payments: 'پرداخت‌ها',
  accounting_tax: 'مالیات',
  accounting_corrections: 'اصلاحات حسابداری',
  accounting_audit: 'ممیزی حسابداری',
  accounting_records: 'اسناد حسابداری',
  accounting_actions: 'عملیات حسابداری',
  accounting_biometric_diagnostics: 'عیب‌یابی اتصال زیست‌سنجی حسابداری',
  accounting_dispatch_candidates: 'گزینه‌های ارسال اسناد حسابداری',
  accounting_dispatch_confirmation: 'تأیید ارسال اسناد حسابداری',
  bi_dashboard: 'داشبورد هوش تجاری',
  logistics_dashboard: 'داشبورد لجستیک',
  logistics_loadings: 'بارگیری‌ها',
  logistics_corrections: 'اصلاحات لجستیک',
  logistics_drivers: 'رانندگان لجستیک',
  hr_internal_drivers: 'رانندگان داخلی',
  hr_vehicle_operations: 'عملیات خودرو',
  hr_internal_driver_eligibility: 'صلاحیت رانندگان داخلی',
  hr_driver_biometric_audit: 'ممیزی زیست‌سنجی رانندگان',
  hr_driver_biometric_enrollment: 'ثبت زیست‌سنجی رانندگان',
  hr_driver_profiles: 'نمایه‌های رانندگان',
  hr_company_vehicles: 'خودروهای شرکت',
  hr_vehicle_plates: 'پلاک خودروها',
  hr_driver_vehicle_assignments: 'تخصیص راننده و خودرو',
  hr_vehicle_operations_audit: 'ممیزی عملیات خودرو',
  hr_dashboard: 'داشبورد منابع انسانی',
  hr_organization: 'ساختار سازمانی',
  hr_personnel: 'پرسنل',
  hr_recruitment: 'پرونده‌های جذب',
  hr_assessments: 'مصاحبه و ارزیابی استخدام',
  hr_work_management: 'وظایف منابع انسانی',
  hr_permissions: 'اختیار و مسئولیت',
  hr_migration: 'مهاجرت و تطبیق',
  hr_users: 'کاربران',
  security_shifts: 'شیفت‌های امنیت',
  security_attendance: 'حضور و غیاب امنیت',
  security_dashboard: 'داشبورد امنیت',
  security_personnel: 'پرسنل امنیت',
  security_exceptions: 'استثناهای حضور',
  security_missions: 'مأموریت‌ها',
  security_signature: 'امضا',
  security_external_drivers: 'رانندگان بیرونی',
  security_external_driver_vehicle: 'خودروی راننده بیرونی',
  security_dispatch_evidence: 'شواهد ارسال',
  security_dispatch_confirmation: 'تأیید ارسال',
  support_security_incident: 'رخداد امنیتی پشتیبانی',
};

const FEATURE_ACTION_LABELS_FA: ReadonlyArray<readonly [string, string]> = [
  ['cancel_after_approval', 'لغو پس از تأیید'],
  ['stats_view', 'مشاهده آمار'],
  ['profile_view', 'مشاهده نمایه'],
  ['daily_view', 'مشاهده روزانه'],
  ['assign_owner', 'تخصیص مسئول'],
  ['update_status', 'تغییر وضعیت'],
  ['approve_void', 'تأیید یا ابطال'],
  ['checkin', 'ثبت ورود'],
  ['checkout', 'ثبت خروج'],
  ['blacklist', 'افزودن به فهرست مسدود'],
  ['reassign', 'تخصیص دوباره'],
  ['attributes', 'مدیریت ویژگی‌های'],
  ['template', 'دریافت الگوی'],
  ['stats', 'مشاهده آمار'],
  ['create', 'ایجاد'],
  ['delete', 'حذف'],
  ['edit', 'ویرایش'],
  ['view', 'مشاهده'],
  ['manage', 'مدیریت'],
  ['approve', 'تأیید'],
  ['reject', 'رد'],
  ['sign', 'امضای'],
  ['print', 'چاپ'],
  ['send', 'ارسال کد'],
  ['verify', 'بررسی کد'],
  ['time', 'مشاهده زمان اعتبار'],
  ['generate', 'تولید'],
  ['import', 'درون‌ریزی'],
  ['export', 'برون‌ریزی'],
  ['toggle', 'فعال یا غیرفعال‌کردن'],
  ['finalize', 'نهایی‌کردن'],
  ['cancel', 'لغو'],
  ['archive', 'بایگانی'],
  ['start', 'شروع'],
  ['end', 'پایان'],
  ['exception', 'ثبت استثنای'],
  ['request', 'درخواست'],
  ['assign', 'تخصیص'],
  ['update', 'به‌روزرسانی'],
  ['validate', 'اعتبارسنجی'],
  ['lock', 'قفل‌کردن'],
  ['handle', 'رسیدگی به'],
];

const featureLabelFa = (feature: Feature): string => {
  const action = FEATURE_ACTION_LABELS_FA.find(([suffix]) => feature.endsWith(`_${suffix}`));
  if (!action) throw new Error(`Missing Persian action label for feature: ${feature}`);
  const [suffix, actionLabel] = action;
  const subjectKey = feature.slice(0, -(suffix.length + 1));
  const subjectLabel = FEATURE_SUBJECT_LABELS_FA[subjectKey];
  if (!subjectLabel) throw new Error(`Missing Persian subject label for feature: ${feature}`);
  return `${actionLabel} ${subjectLabel}`;
};

export const FEATURE_LABELS = Object.fromEntries(
  Object.values(FEATURES).map((feature) => [feature, featureLabelFa(feature)]),
) as Record<Feature, string>;


/**
 * Middleware to check feature-level access
 */
export const requireFeatureAccess = (feature: Feature, requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW) => {
  return async (req: FeatureRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Super admin has access to all features
      if (req.user.role === 'ADMIN') {
        req.featurePermission = FEATURE_PERMISSIONS.ADMIN;
        return next();
      }

      const workspace = FEATURE_WORKSPACE_MAP[feature];

      // Check user-specific feature permissions
      const userFeaturePermission = await prisma.featurePermission.findUnique({
        where: {
          userId_workspace_feature: {
            userId: req.user.id,
            workspace: workspace,
            feature: feature
          }
        }
      });

      // Check role-based feature permissions
      const roleFeaturePermission = await prisma.roleFeaturePermission.findUnique({
        where: {
          role_workspace_feature: {
            role: req.user.role,
            workspace: workspace,
            feature: feature
          }
        }
      });

      // Check if user has workspace-level access (fallback)
      const userWorkspacePermission = await prisma.workspacePermission.findUnique({
        where: {
          userId_workspace: {
            userId: req.user.id,
            workspace: workspace
          }
        }
      });

      const roleWorkspacePermission = await prisma.roleWorkspacePermission.findUnique({
        where: {
          role_workspace: {
            role: req.user.role,
            workspace: workspace
          }
        }
      });

      // Determine effective permission level
      let effectivePermission: FeaturePermission | null = null;

      // Priority: user-specific overrides > role defaults.
      if (isPermissionActiveAndNotExpired(userFeaturePermission)) {
        effectivePermission = userFeaturePermission!.permissionLevel as FeaturePermission;
      } else if (isPermissionActiveAndNotExpired(userWorkspacePermission)) {
        effectivePermission = userWorkspacePermission!.permissionLevel as FeaturePermission;
      } else if (isPermissionActiveAndNotExpired(roleFeaturePermission)) {
        effectivePermission = roleFeaturePermission!.permissionLevel as FeaturePermission;
      } else if (isPermissionActiveAndNotExpired(roleWorkspacePermission)) {
        effectivePermission = roleWorkspacePermission!.permissionLevel as FeaturePermission;
      }

      if (!effectivePermission) {
        return res.status(403).json({
          success: false,
          error: `Access denied to feature: ${feature}`
        });
      }

      if (!hasRequiredPermissionLevel(effectivePermission, requiredPermission)) {
        return res.status(403).json({
          success: false,
          error: `Insufficient permissions for feature: ${feature}. Required: ${requiredPermission}, Current: ${effectivePermission}`
        });
      }

      req.featurePermission = effectivePermission;
      next();
    } catch (error) {
      console.error('Feature access check error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };
};

// Sensitive and independently owned features do not inherit ordinary workspace view/edit.
// Explicit feature grants are accepted; workspace admin and global ADMIN/MANAGER retain oversight.
export const requireNarrowFeatureAccess = (feature: Feature, requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW) => {
  return async (req: FeatureRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const workspace = FEATURE_WORKSPACE_MAP[feature];
      const access = await resolveNarrowFeatureAccess(prisma, { userId: req.user.id, role: req.user.role, workspace, feature, requiredPermission });
      if (!access.allowed) {
        return res.status(403).json({ success: false, error: `Access denied to independently scoped feature: ${feature}` });
      }
      req.featurePermission = access.permissionLevel!;
      return next();
    } catch (error) {
      console.error('Narrow feature access check error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
};

export const requireAnyNarrowFeatureAccess = (
  features: Feature[],
  requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW,
) => async (req: FeatureRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'برای ادامه وارد سامانه شوید.' });
    for (const feature of features) {
      const workspace = FEATURE_WORKSPACE_MAP[feature];
      const access = await resolveNarrowFeatureAccess(prisma, {
        userId: req.user.id,
        role: req.user.role,
        workspace,
        feature,
        requiredPermission,
      });
      if (access.allowed) {
        req.featurePermission = access.permissionLevel!;
        return next();
      }
    }
    return res.status(403).json({
      success: false,
      message: 'مجوز انجام این عملیات برای شما فعال نیست. از مدیر همان فضای کاری درخواست دسترسی کنید.',
    });
  } catch (error) {
    const trackingId = `AUTH-${Date.now().toString(36).toUpperCase()}`;
    console.error('Narrow feature access resolution failed:', { trackingId, error });
    return res.status(500).json({
      success: false,
      message: `بررسی مجوز انجام نشد. دوباره تلاش کنید یا کد پیگیری ${trackingId} را به پشتیبانی اعلام کنید.`,
      trackingId,
    });
  }
};

/**
 * Middleware to check access against multiple features (OR logic)
 */
export const requireAnyFeatureAccess = (
  features: Feature[],
  requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW
) => requireAnyFeatureAccessWithClient(prisma, features, requiredPermission);

type FeaturePermissionClient = Pick<PrismaClient, 'featurePermission' | 'roleFeaturePermission' | 'workspacePermission' | 'roleWorkspacePermission'>;

export const requireAnyFeatureAccessWithClient = (
  permissionClient: FeaturePermissionClient,
  features: Feature[],
  requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW,
  globallyEligibleRoles: readonly string[] = ['ADMIN'],
) => {
  return async (req: FeatureRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      if (globallyEligibleRoles.includes(req.user.role)) {
        req.featurePermission = FEATURE_PERMISSIONS.ADMIN;
        return next();
      }

      for (const feature of features) {
        const workspace = FEATURE_WORKSPACE_MAP[feature];

        const userFeaturePermission = await permissionClient.featurePermission.findUnique({
          where: {
            userId_workspace_feature: {
              userId: req.user.id,
              workspace,
              feature
            }
          }
        });

        const roleFeaturePermission = await permissionClient.roleFeaturePermission.findUnique({
          where: {
            role_workspace_feature: {
              role: req.user.role,
              workspace,
              feature
            }
          }
        });

        const userWorkspacePermission = await permissionClient.workspacePermission.findUnique({
          where: {
            userId_workspace: {
              userId: req.user.id,
              workspace
            }
          }
        });

        const roleWorkspacePermission = await permissionClient.roleWorkspacePermission.findUnique({
          where: {
            role_workspace: {
              role: req.user.role,
              workspace
            }
          }
        });

        let effectivePermission: FeaturePermission | null = null;

        if (isPermissionActiveAndNotExpired(userFeaturePermission)) {
          effectivePermission = userFeaturePermission!.permissionLevel as FeaturePermission;
        } else if (isPermissionActiveAndNotExpired(userWorkspacePermission)) {
          effectivePermission = userWorkspacePermission!.permissionLevel as FeaturePermission;
        } else if (isPermissionActiveAndNotExpired(roleFeaturePermission)) {
          effectivePermission = roleFeaturePermission!.permissionLevel as FeaturePermission;
        } else if (isPermissionActiveAndNotExpired(roleWorkspacePermission)) {
          effectivePermission = roleWorkspacePermission!.permissionLevel as FeaturePermission;
        }

        if (effectivePermission && hasRequiredPermissionLevel(effectivePermission, requiredPermission)) {
          req.featurePermission = effectivePermission;
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        error: `Access denied to required features: ${features.join(', ')}`
      });
    } catch (error) {
      console.error('Feature access check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error during feature access validation'
      });
    }
  };
};

/**
 * Get user's accessible features
 */
export const getUserFeatures = async (userId: string, userRole: string): Promise<{ feature: Feature; permission: FeaturePermission; workspace: string }[]> => {
  try {
    const features: { feature: Feature; permission: FeaturePermission; workspace: string }[] = [];

    // Super admin has access to all features
    if (userRole === 'ADMIN') {
      return Object.entries(FEATURE_WORKSPACE_MAP).map(([feature, workspace]) => ({
        feature: feature as Feature,
        permission: FEATURE_PERMISSIONS.ADMIN,
        workspace
      }));
    }

    // Get user-specific feature permissions
    const userFeaturePermissions = await prisma.featurePermission.findMany({
      where: {
        userId,
        isActive: true
      }
    });

    // Get role-based feature permissions
    const roleFeaturePermissions = await prisma.roleFeaturePermission.findMany({
      where: {
        role: userRole,
        isActive: true
      }
    });

    // Get workspace permissions (fallback)
    const userWorkspacePermissions = await prisma.workspacePermission.findMany({
      where: {
        userId,
        isActive: true
      }
    });

    const roleWorkspacePermissions = await prisma.roleWorkspacePermission.findMany({
      where: {
        role: userRole,
        isActive: true
      }
    });

    // Combine all permissions
    const allFeatures = new Set([
      ...userFeaturePermissions.map(p => p.feature),
      ...roleFeaturePermissions.map(p => p.feature),
      ...Object.keys(FEATURE_WORKSPACE_MAP).filter(feature => {
        const workspace = FEATURE_WORKSPACE_MAP[feature as Feature];
        return userWorkspacePermissions.some(p => p.workspace === workspace) ||
               roleWorkspacePermissions.some(p => p.workspace === workspace);
      })
    ]);

    for (const feature of allFeatures) {
      const workspace = FEATURE_WORKSPACE_MAP[feature as Feature];
      
      const userFeaturePermission = userFeaturePermissions.find(
        (p) => p.feature === feature && isPermissionActiveAndNotExpired(p)
      );
      const roleFeaturePermission = roleFeaturePermissions.find(
        (p) => p.feature === feature && isPermissionActiveAndNotExpired(p)
      );
      const userWorkspacePermission = userWorkspacePermissions.find(
        (p) => p.workspace === workspace && isPermissionActiveAndNotExpired(p)
      );
      const roleWorkspacePermission = roleWorkspacePermissions.find(
        (p) => p.workspace === workspace && isPermissionActiveAndNotExpired(p)
      );

      let permission: FeaturePermission;
      if (userFeaturePermission) {
        permission = userFeaturePermission.permissionLevel as FeaturePermission;
      } else if (userWorkspacePermission) {
        permission = userWorkspacePermission.permissionLevel as FeaturePermission;
      } else if (roleFeaturePermission) {
        permission = roleFeaturePermission.permissionLevel as FeaturePermission;
      } else if (roleWorkspacePermission) {
        permission = roleWorkspacePermission.permissionLevel as FeaturePermission;
      } else {
        continue;
      }

      features.push({ 
        feature: feature as Feature, 
        permission, 
        workspace 
      });
    }

    return features;
  } catch (error) {
    console.error('Get user features error:', error);
    return [];
  }
};
