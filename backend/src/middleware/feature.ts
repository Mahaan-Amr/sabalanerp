import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';

const prisma = new PrismaClient();

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
  SECURITY_SIGNATURE_VALIDATE: 'security_signature_validate'
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
  [FEATURES.SECURITY_SIGNATURE_VALIDATE]: 'security'
};

export const FEATURE_LABELS: Record<Feature, string> = {
  [FEATURES.CORE_DASHBOARD_STATS_VIEW]: 'Core Dashboard - Stats View',
  [FEATURES.CORE_DASHBOARD_PROFILE_VIEW]: 'Core Dashboard - Profile View',
  [FEATURES.CORE_DEPARTMENTS_VIEW]: 'Departments - View',
  [FEATURES.CORE_DEPARTMENTS_CREATE]: 'Departments - Create',
  [FEATURES.CORE_DEPARTMENTS_EDIT]: 'Departments - Edit',
  [FEATURES.CORE_DEPARTMENTS_DELETE]: 'Departments - Delete',
  [FEATURES.CORE_POSTS_VIEW]: 'Posts - View',
  [FEATURES.CORE_POSTS_CREATE]: 'Posts - Create',
  [FEATURES.CORE_POSTS_EDIT]: 'Posts - Edit',
  [FEATURES.CORE_POSTS_DELETE]: 'Posts - Delete',
  [FEATURES.CORE_ORDERS_VIEW]: 'Orders - View',
  [FEATURES.CORE_ORDERS_CREATE]: 'Orders - Create',
  [FEATURES.CORE_ORDERS_EDIT]: 'Orders - Edit',
  [FEATURES.CORE_ORDERS_DELETE]: 'Orders - Delete',
  [FEATURES.CORE_ORDERS_UPDATE_STATUS]: 'Orders - Update Status',

  [FEATURES.CRM_CUSTOMERS_VIEW]: 'CRM Customers - View',
  [FEATURES.CRM_CUSTOMERS_CREATE]: 'CRM Customers - Create',
  [FEATURES.CRM_CUSTOMERS_EDIT]: 'CRM Customers - Edit',
  [FEATURES.CRM_CUSTOMERS_DELETE]: 'CRM Customers - Delete',
  [FEATURES.CRM_CUSTOMERS_BLACKLIST]: 'CRM Customers - Blacklist',
  [FEATURES.CRM_CUSTOMERS_LOCK]: 'CRM Customers - Lock',
  [FEATURES.CRM_PROJECT_ADDRESSES_CREATE]: 'CRM Project Addresses - Create',
  [FEATURES.CRM_PROJECT_ADDRESSES_EDIT]: 'CRM Project Addresses - Edit',
  [FEATURES.CRM_PROJECT_ADDRESSES_DELETE]: 'CRM Project Addresses - Delete',
  [FEATURES.CRM_PHONE_NUMBERS_CREATE]: 'CRM Phone Numbers - Create',
  [FEATURES.CRM_PHONE_NUMBERS_EDIT]: 'CRM Phone Numbers - Edit',
  [FEATURES.CRM_PHONE_NUMBERS_DELETE]: 'CRM Phone Numbers - Delete',
  [FEATURES.CRM_CONTACTS_VIEW]: 'CRM Contacts - View',
  [FEATURES.CRM_CONTACTS_CREATE]: 'CRM Contacts - Create',
  [FEATURES.CRM_CONTACTS_EDIT]: 'CRM Contacts - Edit',
  [FEATURES.CRM_CONTACTS_DELETE]: 'CRM Contacts - Delete',
  [FEATURES.CRM_LEADS_VIEW]: 'CRM Leads - View',
  [FEATURES.CRM_LEADS_CREATE]: 'CRM Leads - Create',
  [FEATURES.CRM_LEADS_EDIT]: 'CRM Leads - Edit',
  [FEATURES.CRM_LEADS_DELETE]: 'CRM Leads - Delete',
  [FEATURES.CRM_COMMUNICATIONS_VIEW]: 'CRM Communications - View',
  [FEATURES.CRM_COMMUNICATIONS_CREATE]: 'CRM Communications - Create',
  [FEATURES.CRM_COMMUNICATIONS_EDIT]: 'CRM Communications - Edit',
  [FEATURES.CRM_COMMUNICATIONS_DELETE]: 'CRM Communications - Delete',
  [FEATURES.CRM_DASHBOARD_VIEW]: 'CRM Dashboard - View',

  [FEATURES.SALES_CONTRACTS_VIEW]: 'Sales Contracts - View',
  [FEATURES.SALES_CONTRACTS_CREATE]: 'Sales Contracts - Create',
  [FEATURES.SALES_CONTRACTS_EDIT]: 'Sales Contracts - Edit',
  [FEATURES.SALES_CONTRACTS_DELETE]: 'Sales Contracts - Delete',
  [FEATURES.SALES_CONTRACTS_CANCEL_AFTER_APPROVAL]: 'Sales Contracts - Cancel After Approval',
  [FEATURES.SALES_CONTRACTS_APPROVE]: 'Sales Contracts - Approve',
  [FEATURES.SALES_CONTRACTS_REJECT]: 'Sales Contracts - Reject',
  [FEATURES.SALES_CONTRACTS_SIGN]: 'Sales Contracts - Sign',
  [FEATURES.SALES_CONTRACTS_PRINT]: 'Sales Contracts - Print',
  [FEATURES.SALES_CONTRACT_ITEMS_CREATE]: 'Sales Contract Items - Create',
  [FEATURES.SALES_DELIVERIES_VIEW]: 'Sales Deliveries - View',
  [FEATURES.SALES_DELIVERIES_CREATE]: 'Sales Deliveries - Create',
  [FEATURES.SALES_PAYMENTS_VIEW]: 'Sales Payments - View',
  [FEATURES.SALES_PAYMENTS_CREATE]: 'Sales Payments - Create',
  [FEATURES.SALES_VERIFICATION_SEND]: 'Sales Verification - Send Code',
  [FEATURES.SALES_VERIFICATION_VERIFY]: 'Sales Verification - Verify Code',
  [FEATURES.SALES_VERIFICATION_TIME]: 'Sales Verification - Time',
  [FEATURES.SALES_DASHBOARD_VIEW]: 'Sales Dashboard - View',
  [FEATURES.SALES_CONTRACT_NUMBER_VIEW]: 'Sales Contract Number - View',
  [FEATURES.SALES_CONTRACT_TEMPLATES_VIEW]: 'Contract Templates - View',
  [FEATURES.SALES_CONTRACT_TEMPLATES_CREATE]: 'Contract Templates - Create',
  [FEATURES.SALES_CONTRACT_TEMPLATES_EDIT]: 'Contract Templates - Edit',
  [FEATURES.SALES_CONTRACT_TEMPLATES_DELETE]: 'Contract Templates - Delete',
  [FEATURES.SALES_CONTRACT_TEMPLATES_GENERATE]: 'Contract Templates - Generate',
  [FEATURES.SALES_PRODUCTS_VIEW]: 'Sales Products - View',
  [FEATURES.SALES_PRODUCTS_CREATE]: 'Sales Products - Create',
  [FEATURES.SALES_PRODUCTS_EDIT]: 'Sales Products - Edit',
  [FEATURES.SALES_PRODUCTS_DELETE]: 'Sales Products - Delete',
  [FEATURES.SALES_PRODUCTS_IMPORT]: 'Sales Products - Import',
  [FEATURES.SALES_PRODUCTS_EXPORT]: 'Sales Products - Export',
  [FEATURES.SALES_PRODUCTS_TEMPLATE]: 'Sales Products - Template',
  [FEATURES.SALES_PRODUCTS_STATS]: 'Sales Products - Stats',
  [FEATURES.SALES_PRODUCTS_ATTRIBUTES]: 'Sales Products - Attributes',
  [FEATURES.SALES_CUSTOMERS_VIEW]: 'Sales Customers - View',
  [FEATURES.SALES_CUSTOMERS_CREATE]: 'Sales Customers - Create',
  [FEATURES.SALES_CUSTOMERS_EDIT]: 'Sales Customers - Edit',
  [FEATURES.SALES_CUSTOMERS_DELETE]: 'Sales Customers - Delete',
  [FEATURES.SALES_LEGACY_CONTRACTS_VIEW]: 'Legacy Contracts - View',
  [FEATURES.SALES_LEGACY_CONTRACTS_CREATE]: 'Legacy Contracts - Create',
  [FEATURES.SALES_LEGACY_CONTRACTS_EDIT]: 'Legacy Contracts - Edit',
  [FEATURES.SALES_LEGACY_CONTRACTS_DELETE]: 'Legacy Contracts - Delete',
  [FEATURES.SALES_LEGACY_CONTRACTS_APPROVE]: 'Legacy Contracts - Approve',
  [FEATURES.SALES_LEGACY_CONTRACTS_REJECT]: 'Legacy Contracts - Reject',
  [FEATURES.SALES_LEGACY_CONTRACTS_SIGN]: 'Legacy Contracts - Sign',
  [FEATURES.SALES_LEGACY_CONTRACTS_PRINT]: 'Legacy Contracts - Print',

  [FEATURES.INVENTORY_CUT_TYPES_VIEW]: 'Inventory Cut Types - View',
  [FEATURES.INVENTORY_CUT_TYPES_CREATE]: 'Inventory Cut Types - Create',
  [FEATURES.INVENTORY_CUT_TYPES_EDIT]: 'Inventory Cut Types - Edit',
  [FEATURES.INVENTORY_CUT_TYPES_DELETE]: 'Inventory Cut Types - Delete',
  [FEATURES.INVENTORY_STONE_MATERIALS_VIEW]: 'Inventory Stone Materials - View',
  [FEATURES.INVENTORY_STONE_MATERIALS_CREATE]: 'Inventory Stone Materials - Create',
  [FEATURES.INVENTORY_STONE_MATERIALS_EDIT]: 'Inventory Stone Materials - Edit',
  [FEATURES.INVENTORY_STONE_MATERIALS_DELETE]: 'Inventory Stone Materials - Delete',
  [FEATURES.INVENTORY_CUT_WIDTHS_VIEW]: 'Inventory Cut Widths - View',
  [FEATURES.INVENTORY_CUT_WIDTHS_CREATE]: 'Inventory Cut Widths - Create',
  [FEATURES.INVENTORY_CUT_WIDTHS_EDIT]: 'Inventory Cut Widths - Edit',
  [FEATURES.INVENTORY_CUT_WIDTHS_DELETE]: 'Inventory Cut Widths - Delete',
  [FEATURES.INVENTORY_THICKNESSES_VIEW]: 'Inventory Thicknesses - View',
  [FEATURES.INVENTORY_THICKNESSES_CREATE]: 'Inventory Thicknesses - Create',
  [FEATURES.INVENTORY_THICKNESSES_EDIT]: 'Inventory Thicknesses - Edit',
  [FEATURES.INVENTORY_THICKNESSES_DELETE]: 'Inventory Thicknesses - Delete',
  [FEATURES.INVENTORY_MINES_VIEW]: 'Inventory Mines - View',
  [FEATURES.INVENTORY_MINES_CREATE]: 'Inventory Mines - Create',
  [FEATURES.INVENTORY_MINES_EDIT]: 'Inventory Mines - Edit',
  [FEATURES.INVENTORY_MINES_DELETE]: 'Inventory Mines - Delete',
  [FEATURES.INVENTORY_FINISH_TYPES_VIEW]: 'Inventory Finish Types - View',
  [FEATURES.INVENTORY_FINISH_TYPES_CREATE]: 'Inventory Finish Types - Create',
  [FEATURES.INVENTORY_FINISH_TYPES_EDIT]: 'Inventory Finish Types - Edit',
  [FEATURES.INVENTORY_FINISH_TYPES_DELETE]: 'Inventory Finish Types - Delete',
  [FEATURES.INVENTORY_COLORS_VIEW]: 'Inventory Colors - View',
  [FEATURES.INVENTORY_COLORS_CREATE]: 'Inventory Colors - Create',
  [FEATURES.INVENTORY_COLORS_EDIT]: 'Inventory Colors - Edit',
  [FEATURES.INVENTORY_COLORS_DELETE]: 'Inventory Colors - Delete',
  [FEATURES.INVENTORY_SERVICES_VIEW]: 'Inventory Services - View',
  [FEATURES.INVENTORY_SERVICES_CREATE]: 'Inventory Services - Create',
  [FEATURES.INVENTORY_SERVICES_EDIT]: 'Inventory Services - Edit',
  [FEATURES.INVENTORY_SERVICES_DELETE]: 'Inventory Services - Delete',
  [FEATURES.INVENTORY_SERVICES_TOGGLE]: 'Inventory Services - Toggle',
  [FEATURES.INVENTORY_CUTTING_TYPES_VIEW]: 'Inventory Cutting Types - View',
  [FEATURES.INVENTORY_CUTTING_TYPES_CREATE]: 'Inventory Cutting Types - Create',
  [FEATURES.INVENTORY_CUTTING_TYPES_EDIT]: 'Inventory Cutting Types - Edit',
  [FEATURES.INVENTORY_CUTTING_TYPES_DELETE]: 'Inventory Cutting Types - Delete',
  [FEATURES.INVENTORY_CUTTING_TYPES_TOGGLE]: 'Inventory Cutting Types - Toggle',
  [FEATURES.INVENTORY_SUB_SERVICES_VIEW]: 'Inventory Sub Services - View',
  [FEATURES.INVENTORY_SUB_SERVICES_CREATE]: 'Inventory Sub Services - Create',
  [FEATURES.INVENTORY_SUB_SERVICES_EDIT]: 'Inventory Sub Services - Edit',
  [FEATURES.INVENTORY_SUB_SERVICES_DELETE]: 'Inventory Sub Services - Delete',
  [FEATURES.INVENTORY_SUB_SERVICES_TOGGLE]: 'Inventory Sub Services - Toggle',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_VIEW]: 'Inventory Stair Standard Lengths - View',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_CREATE]: 'Inventory Stair Standard Lengths - Create',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_EDIT]: 'Inventory Stair Standard Lengths - Edit',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_DELETE]: 'Inventory Stair Standard Lengths - Delete',
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_TOGGLE]: 'Inventory Stair Standard Lengths - Toggle',
  [FEATURES.INVENTORY_LAYER_TYPES_VIEW]: 'Inventory Layer Types - View',
  [FEATURES.INVENTORY_LAYER_TYPES_CREATE]: 'Inventory Layer Types - Create',
  [FEATURES.INVENTORY_LAYER_TYPES_EDIT]: 'Inventory Layer Types - Edit',
  [FEATURES.INVENTORY_LAYER_TYPES_DELETE]: 'Inventory Layer Types - Delete',
  [FEATURES.INVENTORY_LAYER_TYPES_TOGGLE]: 'Inventory Layer Types - Toggle',
  [FEATURES.INVENTORY_STONE_FINISHINGS_VIEW]: 'Inventory Stone Finishings - View',
  [FEATURES.INVENTORY_STONE_FINISHINGS_CREATE]: 'Inventory Stone Finishings - Create',
  [FEATURES.INVENTORY_STONE_FINISHINGS_EDIT]: 'Inventory Stone Finishings - Edit',
  [FEATURES.INVENTORY_STONE_FINISHINGS_DELETE]: 'Inventory Stone Finishings - Delete',
  [FEATURES.INVENTORY_STONE_FINISHINGS_TOGGLE]: 'Inventory Stone Finishings - Toggle',

  [FEATURES.SECURITY_SHIFTS_VIEW]: 'Security Shifts - View',
  [FEATURES.SECURITY_SHIFTS_CREATE]: 'Security Shifts - Create',
  [FEATURES.SECURITY_SHIFTS_START]: 'Security Shifts - Start',
  [FEATURES.SECURITY_SHIFTS_END]: 'Security Shifts - End',
  [FEATURES.SECURITY_ATTENDANCE_CHECKIN]: 'Security Attendance - Check In',
  [FEATURES.SECURITY_ATTENDANCE_CHECKOUT]: 'Security Attendance - Check Out',
  [FEATURES.SECURITY_ATTENDANCE_EXCEPTION]: 'Security Attendance - Exception',
  [FEATURES.SECURITY_ATTENDANCE_DAILY_VIEW]: 'Security Attendance - Daily View',
  [FEATURES.SECURITY_DASHBOARD_VIEW]: 'Security Dashboard - View',
  [FEATURES.SECURITY_PERSONNEL_VIEW]: 'Security Personnel - View',
  [FEATURES.SECURITY_PERSONNEL_ASSIGN]: 'Security Personnel - Assign',
  [FEATURES.SECURITY_EXCEPTIONS_REQUEST]: 'Security Exceptions - Request',
  [FEATURES.SECURITY_EXCEPTIONS_VIEW]: 'Security Exceptions - View',
  [FEATURES.SECURITY_EXCEPTIONS_APPROVE]: 'Security Exceptions - Approve',
  [FEATURES.SECURITY_EXCEPTIONS_REJECT]: 'Security Exceptions - Reject',
  [FEATURES.SECURITY_MISSIONS_ASSIGN]: 'Security Missions - Assign',
  [FEATURES.SECURITY_MISSIONS_VIEW]: 'Security Missions - View',
  [FEATURES.SECURITY_MISSIONS_APPROVE]: 'Security Missions - Approve',
  [FEATURES.SECURITY_SIGNATURE_UPDATE]: 'Security Signature - Update',
  [FEATURES.SECURITY_SIGNATURE_VIEW]: 'Security Signature - View',
  [FEATURES.SECURITY_SIGNATURE_VALIDATE]: 'Security Signature - Validate'
};

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

      // Priority: Feature-specific > Workspace-level
      if (userFeaturePermission && userFeaturePermission.isActive) {
        effectivePermission = userFeaturePermission.permissionLevel as FeaturePermission;
      } else if (roleFeaturePermission && roleFeaturePermission.isActive) {
        effectivePermission = roleFeaturePermission.permissionLevel as FeaturePermission;
      } else if (userWorkspacePermission && userWorkspacePermission.isActive) {
        effectivePermission = userWorkspacePermission.permissionLevel as FeaturePermission;
      } else if (roleWorkspacePermission && roleWorkspacePermission.isActive) {
        effectivePermission = roleWorkspacePermission.permissionLevel as FeaturePermission;
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

/**
 * Middleware to check access against multiple features (OR logic)
 */
export const requireAnyFeatureAccess = (
  features: Feature[],
  requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW
) => {
  return async (req: FeatureRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      if (req.user.role === 'ADMIN') {
        req.featurePermission = FEATURE_PERMISSIONS.ADMIN;
        return next();
      }

      for (const feature of features) {
        const workspace = FEATURE_WORKSPACE_MAP[feature];

        const userFeaturePermission = await prisma.featurePermission.findUnique({
          where: {
            userId_workspace_feature: {
              userId: req.user.id,
              workspace,
              feature
            }
          }
        });

        const roleFeaturePermission = await prisma.roleFeaturePermission.findUnique({
          where: {
            role_workspace_feature: {
              role: req.user.role,
              workspace,
              feature
            }
          }
        });

        const userWorkspacePermission = await prisma.workspacePermission.findUnique({
          where: {
            userId_workspace: {
              userId: req.user.id,
              workspace
            }
          }
        });

        const roleWorkspacePermission = await prisma.roleWorkspacePermission.findUnique({
          where: {
            role_workspace: {
              role: req.user.role,
              workspace
            }
          }
        });

        let effectivePermission: FeaturePermission | null = null;

        if (userFeaturePermission && userFeaturePermission.isActive) {
          effectivePermission = userFeaturePermission.permissionLevel as FeaturePermission;
        } else if (roleFeaturePermission && roleFeaturePermission.isActive) {
          effectivePermission = roleFeaturePermission.permissionLevel as FeaturePermission;
        } else if (userWorkspacePermission && userWorkspacePermission.isActive) {
          effectivePermission = userWorkspacePermission.permissionLevel as FeaturePermission;
        } else if (roleWorkspacePermission && roleWorkspacePermission.isActive) {
          effectivePermission = roleWorkspacePermission.permissionLevel as FeaturePermission;
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
      
      const userFeaturePermission = userFeaturePermissions.find(p => p.feature === feature);
      const roleFeaturePermission = roleFeaturePermissions.find(p => p.feature === feature);
      const userWorkspacePermission = userWorkspacePermissions.find(p => p.workspace === workspace);
      const roleWorkspacePermission = roleWorkspacePermissions.find(p => p.workspace === workspace);

      let permission: FeaturePermission;
      if (userFeaturePermission) {
        permission = userFeaturePermission.permissionLevel as FeaturePermission;
      } else if (roleFeaturePermission) {
        permission = roleFeaturePermission.permissionLevel as FeaturePermission;
      } else if (userWorkspacePermission) {
        permission = userWorkspacePermission.permissionLevel as FeaturePermission;
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

