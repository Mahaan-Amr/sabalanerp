var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../reports/qa/server-response-20261011/latest-accounting-bridge.ts
var import_strict = __toESM(require("node:assert/strict"));
var import_node_crypto2 = require("node:crypto");
var import_client2 = require("@prisma/client");

// src/services/partnerSales/authorization/centralAuthority.ts
var import_partner_sales_contracts = require("@sabalanerp/partner-sales-contracts");

// src/lib/prisma.ts
var import_client = require("@prisma/client");
var globalDatabaseClient = globalThis;
var prisma = globalDatabaseClient.sabalanPrismaClient ?? new import_client.PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalDatabaseClient.sabalanPrismaClient = prisma;
}

// src/services/narrowFeatureAccess.ts
var levels = ["view", "edit", "admin"];
var activeAt = (permission2, at) => Boolean(
  permission2?.isActive && (!permission2.expiresAt || permission2.expiresAt.getTime() > at.getTime())
);
var evaluateNarrowFeatureAccess = (input, at = /* @__PURE__ */ new Date()) => {
  if (input.role === "ADMIN") return { allowed: true, permissionLevel: "admin" };
  const directFeature = activeAt(input.userFeature, at) ? input.userFeature : null;
  const directWorkspace = activeAt(input.userWorkspace, at) ? input.userWorkspace : null;
  const roleFeature = activeAt(input.roleFeature, at) ? input.roleFeature : null;
  const roleWorkspace = activeAt(input.roleWorkspace, at) ? input.roleWorkspace : null;
  const permissionLevelValue = directWorkspace?.permissionLevel === "admin" ? "admin" : directFeature?.permissionLevel ?? (!directWorkspace ? roleFeature?.permissionLevel : void 0) ?? (!directWorkspace && roleWorkspace?.permissionLevel === "admin" ? "admin" : void 0);
  const permissionLevel = levels.includes(permissionLevelValue) ? permissionLevelValue : void 0;
  const allowed = Boolean(permissionLevel && levels.indexOf(permissionLevel) >= levels.indexOf(input.requiredPermission));
  return { allowed, permissionLevel: allowed ? permissionLevel : null };
};
var resolveNarrowFeatureAccess = async (prisma2, input, at = /* @__PURE__ */ new Date()) => {
  const [userFeature, roleFeature, userWorkspace, roleWorkspace] = await Promise.all([
    prisma2.featurePermission.findUnique({ where: { userId_workspace_feature: { userId: input.userId, workspace: input.workspace, feature: input.feature } } }),
    prisma2.roleFeaturePermission.findUnique({ where: { role_workspace_feature: { role: input.role, workspace: input.workspace, feature: input.feature } } }),
    prisma2.workspacePermission.findUnique({ where: { userId_workspace: { userId: input.userId, workspace: input.workspace } } }),
    prisma2.roleWorkspacePermission.findUnique({ where: { role_workspace: { role: input.role, workspace: input.workspace } } })
  ]);
  return evaluateNarrowFeatureAccess({ role: input.role, requiredPermission: input.requiredPermission, userFeature, roleFeature, userWorkspace, roleWorkspace }, at);
};

// src/middleware/feature.ts
var FEATURE_PERMISSIONS = {
  VIEW: "view",
  EDIT: "edit",
  ADMIN: "admin"
};
var FEATURES = {
  // Core/Admin Features
  CORE_DASHBOARD_STATS_VIEW: "core_dashboard_stats_view",
  CORE_DASHBOARD_PROFILE_VIEW: "core_dashboard_profile_view",
  CORE_DEPARTMENTS_VIEW: "core_departments_view",
  CORE_DEPARTMENTS_CREATE: "core_departments_create",
  CORE_DEPARTMENTS_EDIT: "core_departments_edit",
  CORE_DEPARTMENTS_DELETE: "core_departments_delete",
  CORE_POSTS_VIEW: "core_posts_view",
  CORE_POSTS_CREATE: "core_posts_create",
  CORE_POSTS_EDIT: "core_posts_edit",
  CORE_POSTS_DELETE: "core_posts_delete",
  CORE_ORDERS_VIEW: "core_orders_view",
  CORE_ORDERS_CREATE: "core_orders_create",
  CORE_ORDERS_EDIT: "core_orders_edit",
  CORE_ORDERS_DELETE: "core_orders_delete",
  CORE_ORDERS_UPDATE_STATUS: "core_orders_update_status",
  // CRM Features
  CRM_CUSTOMERS_VIEW: "crm_customers_view",
  CRM_CUSTOMERS_VIEW_ALL: "crm_customers_view_all",
  CRM_CUSTOMERS_CREATE: "crm_customers_create",
  CRM_CUSTOMERS_EDIT: "crm_customers_edit",
  CRM_CUSTOMERS_DELETE: "crm_customers_delete",
  CRM_CUSTOMERS_BLACKLIST: "crm_customers_blacklist",
  CRM_CUSTOMERS_LOCK: "crm_customers_lock",
  CRM_CUSTOMERS_ASSIGN_OWNER: "crm_customers_assign_owner",
  CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE: "crm_partner_customer_transfers_manage",
  CRM_PROJECT_ADDRESSES_CREATE: "crm_project_addresses_create",
  CRM_PROJECT_ADDRESSES_EDIT: "crm_project_addresses_edit",
  CRM_PROJECT_ADDRESSES_DELETE: "crm_project_addresses_delete",
  CRM_PHONE_NUMBERS_CREATE: "crm_phone_numbers_create",
  CRM_PHONE_NUMBERS_EDIT: "crm_phone_numbers_edit",
  CRM_PHONE_NUMBERS_DELETE: "crm_phone_numbers_delete",
  CRM_CONTACTS_VIEW: "crm_contacts_view",
  CRM_CONTACTS_CREATE: "crm_contacts_create",
  CRM_CONTACTS_EDIT: "crm_contacts_edit",
  CRM_CONTACTS_DELETE: "crm_contacts_delete",
  CRM_LEADS_VIEW: "crm_leads_view",
  CRM_LEADS_CREATE: "crm_leads_create",
  CRM_LEADS_EDIT: "crm_leads_edit",
  CRM_LEADS_DELETE: "crm_leads_delete",
  CRM_COMMUNICATIONS_VIEW: "crm_communications_view",
  CRM_COMMUNICATIONS_CREATE: "crm_communications_create",
  CRM_COMMUNICATIONS_EDIT: "crm_communications_edit",
  CRM_COMMUNICATIONS_DELETE: "crm_communications_delete",
  CRM_POTENTIAL_PROJECTS_VIEW: "crm_potential_projects_view",
  CRM_POTENTIAL_PROJECTS_CREATE: "crm_potential_projects_create",
  CRM_POTENTIAL_PROJECTS_EDIT: "crm_potential_projects_edit",
  CRM_POTENTIAL_PROJECTS_REASSIGN: "crm_potential_projects_reassign",
  CRM_FOLLOW_UPS_VIEW: "crm_follow_ups_view",
  CRM_FOLLOW_UPS_CREATE: "crm_follow_ups_create",
  CRM_NEXT_ACTIONS_VIEW: "crm_next_actions_view",
  CRM_NEXT_ACTIONS_EDIT: "crm_next_actions_edit",
  CRM_DASHBOARD_VIEW: "crm_dashboard_view",
  // Sales Features
  SALES_CONTRACTS_VIEW: "sales_contracts_view",
  SALES_CONTRACTS_CREATE: "sales_contracts_create",
  SALES_CONTRACTS_EDIT: "sales_contracts_edit",
  SALES_CONTRACTS_DELETE: "sales_contracts_delete",
  SALES_CONTRACTS_CANCEL_AFTER_APPROVAL: "sales_contracts_cancel_after_approval",
  SALES_CONTRACTS_APPROVE: "sales_contracts_approve",
  SALES_CONTRACTS_REJECT: "sales_contracts_reject",
  SALES_CONTRACTS_SIGN: "sales_contracts_sign",
  SALES_CONTRACTS_PRINT: "sales_contracts_print",
  SALES_CONTRACT_ITEMS_CREATE: "sales_contract_items_create",
  SALES_DELIVERIES_VIEW: "sales_deliveries_view",
  SALES_DELIVERIES_CREATE: "sales_deliveries_create",
  SALES_PAYMENTS_VIEW: "sales_payments_view",
  SALES_PAYMENTS_CREATE: "sales_payments_create",
  SALES_VERIFICATION_SEND: "sales_verification_send",
  SALES_VERIFICATION_VERIFY: "sales_verification_verify",
  SALES_VERIFICATION_TIME: "sales_verification_time",
  SALES_DASHBOARD_VIEW: "sales_dashboard_view",
  SALES_CONTRACT_NUMBER_VIEW: "sales_contract_number_view",
  SALES_CONTRACT_TEMPLATES_VIEW: "sales_contract_templates_view",
  SALES_CONTRACT_TEMPLATES_CREATE: "sales_contract_templates_create",
  SALES_CONTRACT_TEMPLATES_EDIT: "sales_contract_templates_edit",
  SALES_CONTRACT_TEMPLATES_DELETE: "sales_contract_templates_delete",
  SALES_CONTRACT_TEMPLATES_GENERATE: "sales_contract_templates_generate",
  SALES_PRODUCTS_VIEW: "sales_products_view",
  SALES_PRODUCTS_CREATE: "sales_products_create",
  SALES_PRODUCTS_EDIT: "sales_products_edit",
  SALES_PRODUCTS_DELETE: "sales_products_delete",
  SALES_PRODUCTS_IMPORT: "sales_products_import",
  SALES_PRODUCTS_EXPORT: "sales_products_export",
  SALES_PRODUCTS_TEMPLATE: "sales_products_template",
  SALES_PRODUCTS_STATS: "sales_products_stats",
  SALES_PRODUCTS_ATTRIBUTES: "sales_products_attributes",
  SALES_CUSTOMERS_VIEW: "sales_customers_view",
  SALES_CUSTOMERS_CREATE: "sales_customers_create",
  SALES_CUSTOMERS_EDIT: "sales_customers_edit",
  SALES_CUSTOMERS_DELETE: "sales_customers_delete",
  SALES_CUSTOMERS_ASSIGN_OWNER: "sales_customers_assign_owner",
  SALES_LEGACY_CONTRACTS_VIEW: "sales_legacy_contracts_view",
  SALES_LEGACY_CONTRACTS_CREATE: "sales_legacy_contracts_create",
  SALES_LEGACY_CONTRACTS_EDIT: "sales_legacy_contracts_edit",
  SALES_LEGACY_CONTRACTS_DELETE: "sales_legacy_contracts_delete",
  SALES_LEGACY_CONTRACTS_APPROVE: "sales_legacy_contracts_approve",
  SALES_LEGACY_CONTRACTS_REJECT: "sales_legacy_contracts_reject",
  SALES_LEGACY_CONTRACTS_SIGN: "sales_legacy_contracts_sign",
  SALES_LEGACY_CONTRACTS_PRINT: "sales_legacy_contracts_print",
  SALES_PARTNER_INQUIRIES_VIEW: "sales_partner_inquiries_view",
  SALES_PARTNER_INQUIRIES_RESPOND: "sales_partner_inquiries_respond",
  SALES_PARTNER_SELLERS_MANAGE: "sales_partner_sellers_manage",
  // Inventory Features
  INVENTORY_CUT_TYPES_VIEW: "inventory_cut_types_view",
  INVENTORY_CUT_TYPES_CREATE: "inventory_cut_types_create",
  INVENTORY_CUT_TYPES_EDIT: "inventory_cut_types_edit",
  INVENTORY_CUT_TYPES_DELETE: "inventory_cut_types_delete",
  INVENTORY_STONE_MATERIALS_VIEW: "inventory_stone_materials_view",
  INVENTORY_STONE_MATERIALS_CREATE: "inventory_stone_materials_create",
  INVENTORY_STONE_MATERIALS_EDIT: "inventory_stone_materials_edit",
  INVENTORY_STONE_MATERIALS_DELETE: "inventory_stone_materials_delete",
  INVENTORY_CUT_WIDTHS_VIEW: "inventory_cut_widths_view",
  INVENTORY_CUT_WIDTHS_CREATE: "inventory_cut_widths_create",
  INVENTORY_CUT_WIDTHS_EDIT: "inventory_cut_widths_edit",
  INVENTORY_CUT_WIDTHS_DELETE: "inventory_cut_widths_delete",
  INVENTORY_THICKNESSES_VIEW: "inventory_thicknesses_view",
  INVENTORY_THICKNESSES_CREATE: "inventory_thicknesses_create",
  INVENTORY_THICKNESSES_EDIT: "inventory_thicknesses_edit",
  INVENTORY_THICKNESSES_DELETE: "inventory_thicknesses_delete",
  INVENTORY_MINES_VIEW: "inventory_mines_view",
  INVENTORY_MINES_CREATE: "inventory_mines_create",
  INVENTORY_MINES_EDIT: "inventory_mines_edit",
  INVENTORY_MINES_DELETE: "inventory_mines_delete",
  INVENTORY_FINISH_TYPES_VIEW: "inventory_finish_types_view",
  INVENTORY_FINISH_TYPES_CREATE: "inventory_finish_types_create",
  INVENTORY_FINISH_TYPES_EDIT: "inventory_finish_types_edit",
  INVENTORY_FINISH_TYPES_DELETE: "inventory_finish_types_delete",
  INVENTORY_COLORS_VIEW: "inventory_colors_view",
  INVENTORY_COLORS_CREATE: "inventory_colors_create",
  INVENTORY_COLORS_EDIT: "inventory_colors_edit",
  INVENTORY_COLORS_DELETE: "inventory_colors_delete",
  INVENTORY_SERVICES_VIEW: "inventory_services_view",
  INVENTORY_SERVICES_CREATE: "inventory_services_create",
  INVENTORY_SERVICES_EDIT: "inventory_services_edit",
  INVENTORY_SERVICES_DELETE: "inventory_services_delete",
  INVENTORY_SERVICES_TOGGLE: "inventory_services_toggle",
  INVENTORY_CUTTING_TYPES_VIEW: "inventory_cutting_types_view",
  INVENTORY_CUTTING_TYPES_CREATE: "inventory_cutting_types_create",
  INVENTORY_CUTTING_TYPES_EDIT: "inventory_cutting_types_edit",
  INVENTORY_CUTTING_TYPES_DELETE: "inventory_cutting_types_delete",
  INVENTORY_CUTTING_TYPES_TOGGLE: "inventory_cutting_types_toggle",
  INVENTORY_SUB_SERVICES_VIEW: "inventory_sub_services_view",
  INVENTORY_SUB_SERVICES_CREATE: "inventory_sub_services_create",
  INVENTORY_SUB_SERVICES_EDIT: "inventory_sub_services_edit",
  INVENTORY_SUB_SERVICES_DELETE: "inventory_sub_services_delete",
  INVENTORY_SUB_SERVICES_TOGGLE: "inventory_sub_services_toggle",
  INVENTORY_STAIR_STANDARD_LENGTHS_VIEW: "inventory_stair_standard_lengths_view",
  INVENTORY_STAIR_STANDARD_LENGTHS_CREATE: "inventory_stair_standard_lengths_create",
  INVENTORY_STAIR_STANDARD_LENGTHS_EDIT: "inventory_stair_standard_lengths_edit",
  INVENTORY_STAIR_STANDARD_LENGTHS_DELETE: "inventory_stair_standard_lengths_delete",
  INVENTORY_STAIR_STANDARD_LENGTHS_TOGGLE: "inventory_stair_standard_lengths_toggle",
  INVENTORY_LAYER_TYPES_VIEW: "inventory_layer_types_view",
  INVENTORY_LAYER_TYPES_CREATE: "inventory_layer_types_create",
  INVENTORY_LAYER_TYPES_EDIT: "inventory_layer_types_edit",
  INVENTORY_LAYER_TYPES_DELETE: "inventory_layer_types_delete",
  INVENTORY_LAYER_TYPES_TOGGLE: "inventory_layer_types_toggle",
  INVENTORY_STONE_FINISHINGS_VIEW: "inventory_stone_finishings_view",
  INVENTORY_STONE_FINISHINGS_CREATE: "inventory_stone_finishings_create",
  INVENTORY_STONE_FINISHINGS_EDIT: "inventory_stone_finishings_edit",
  INVENTORY_STONE_FINISHINGS_DELETE: "inventory_stone_finishings_delete",
  INVENTORY_STONE_FINISHINGS_TOGGLE: "inventory_stone_finishings_toggle",
  INVENTORY_COST_EVIDENCE_MANAGE: "inventory_cost_evidence_manage",
  // Accounting Features
  ACCOUNTING_DASHBOARD_VIEW: "accounting_dashboard_view",
  ACCOUNTING_CONTRACTS_VIEW: "accounting_contracts_view",
  ACCOUNTING_INVOICE_CANDIDATES_MANAGE: "accounting_invoice_candidates_manage",
  ACCOUNTING_RECEIVABLES_MANAGE: "accounting_receivables_manage",
  ACCOUNTING_PAYMENTS_MANAGE: "accounting_payments_manage",
  ACCOUNTING_TAX_MANAGE: "accounting_tax_manage",
  ACCOUNTING_CORRECTIONS_MANAGE: "accounting_corrections_manage",
  ACCOUNTING_CORRECTIONS_CREATE: "accounting_corrections_create",
  ACCOUNTING_CORRECTIONS_APPROVE: "accounting_corrections_approve",
  ACCOUNTING_CORRECTIONS_VERIFY: "accounting_corrections_verify",
  ACCOUNTING_AUDIT_VIEW: "accounting_audit_view",
  ACCOUNTING_RECORDS_APPROVE_VOID: "accounting_records_approve_void",
  ACCOUNTING_ACTIONS_MANAGE: "accounting_actions_manage",
  ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW: "accounting_biometric_diagnostics_view",
  ACCOUNTING_DISPATCH_CANDIDATES_VIEW: "accounting_dispatch_candidates_view",
  ACCOUNTING_DISPATCH_CANDIDATES_MANAGE: "accounting_dispatch_candidates_manage",
  ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE: "accounting_dispatch_confirmation_manage",
  ACCOUNTING_PARTNER_TERMS_MANAGE: "accounting_partner_terms_manage",
  ACCOUNTING_CUSTOMER_POSTING_MANAGE: "accounting_customer_posting_manage",
  ACCOUNTING_TREASURY_MANAGE: "accounting_treasury_manage",
  ACCOUNTING_EVIDENCE_MANAGE: "accounting_evidence_manage",
  ACCOUNTING_TAX_SUBMISSIONS_MANAGE: "accounting_tax_submissions_manage",
  ACCOUNTING_CUSTOMER_STATEMENTS_EXPORT: "accounting_customer_statements_export",
  // BI Features
  BI_DASHBOARD_VIEW: "bi_dashboard_view",
  BI_PARTNER_REPORTS_VIEW: "bi_partner_reports_view",
  // Logistics Features
  LOGISTICS_DASHBOARD_VIEW: "logistics_dashboard_view",
  LOGISTICS_LOADINGS_VIEW: "logistics_loadings_view",
  LOGISTICS_LOADINGS_CREATE: "logistics_loadings_create",
  LOGISTICS_LOADINGS_EDIT: "logistics_loadings_edit",
  LOGISTICS_LOADINGS_FINALIZE: "logistics_loadings_finalize",
  LOGISTICS_LOADINGS_CANCEL: "logistics_loadings_cancel",
  LOGISTICS_CORRECTIONS_CREATE: "logistics_corrections_create",
  LOGISTICS_DRIVERS_VIEW: "logistics_drivers_view",
  LOGISTICS_DRIVERS_MANAGE: "logistics_drivers_manage",
  // HR-hosted Driver and Vehicle Operations Features
  HR_INTERNAL_DRIVERS_VIEW: "hr_internal_drivers_view",
  HR_INTERNAL_DRIVERS_MANAGE: "hr_internal_drivers_manage",
  HR_VEHICLE_OPERATIONS_VIEW: "hr_vehicle_operations_view",
  HR_VEHICLE_OPERATIONS_MANAGE: "hr_vehicle_operations_manage",
  HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE: "hr_internal_driver_eligibility_manage",
  HR_DRIVER_BIOMETRIC_AUDIT_VIEW: "hr_driver_biometric_audit_view",
  HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE: "hr_driver_biometric_enrollment_manage",
  HR_DRIVER_PROFILES_MANAGE: "hr_driver_profiles_manage",
  HR_COMPANY_VEHICLES_MANAGE: "hr_company_vehicles_manage",
  HR_VEHICLE_PLATES_MANAGE: "hr_vehicle_plates_manage",
  HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE: "hr_driver_vehicle_assignments_manage",
  HR_VEHICLE_OPERATIONS_AUDIT_VIEW: "hr_vehicle_operations_audit_view",
  // Human Resources Features
  HR_DASHBOARD_VIEW: "hr_dashboard_view",
  HR_ORGANIZATION_VIEW: "hr_organization_view",
  HR_ORGANIZATION_CREATE: "hr_organization_create",
  HR_ORGANIZATION_EDIT: "hr_organization_edit",
  HR_ORGANIZATION_ARCHIVE: "hr_organization_archive",
  HR_ORGANIZATION_DELETE: "hr_organization_delete",
  HR_PERSONNEL_VIEW: "hr_personnel_view",
  HR_PERSONNEL_EDIT: "hr_personnel_edit",
  HR_RECRUITMENT_VIEW: "hr_recruitment_view",
  HR_RECRUITMENT_EDIT: "hr_recruitment_edit",
  HR_ASSESSMENTS_EDIT: "hr_assessments_edit",
  HR_WORK_MANAGEMENT_VIEW: "hr_work_management_view",
  HR_WORK_MANAGEMENT_EDIT: "hr_work_management_edit",
  HR_PERMISSIONS_VIEW: "hr_permissions_view",
  HR_PERMISSIONS_EDIT: "hr_permissions_edit",
  HR_MIGRATION_VIEW: "hr_migration_view",
  HR_MIGRATION_EDIT: "hr_migration_edit",
  HR_USERS_VIEW: "hr_users_view",
  HR_USERS_CREATE: "hr_users_create",
  HR_USERS_EDIT: "hr_users_edit",
  HR_USERS_DELETE: "hr_users_delete",
  // Security Features
  SECURITY_SHIFTS_VIEW: "security_shifts_view",
  SECURITY_SHIFTS_CREATE: "security_shifts_create",
  SECURITY_SHIFTS_START: "security_shifts_start",
  SECURITY_SHIFTS_END: "security_shifts_end",
  SECURITY_ATTENDANCE_CHECKIN: "security_attendance_checkin",
  SECURITY_ATTENDANCE_CHECKOUT: "security_attendance_checkout",
  SECURITY_ATTENDANCE_EXCEPTION: "security_attendance_exception",
  SECURITY_ATTENDANCE_DAILY_VIEW: "security_attendance_daily_view",
  SECURITY_DASHBOARD_VIEW: "security_dashboard_view",
  SECURITY_PERSONNEL_VIEW: "security_personnel_view",
  SECURITY_PERSONNEL_ASSIGN: "security_personnel_assign",
  SECURITY_EXCEPTIONS_REQUEST: "security_exceptions_request",
  SECURITY_EXCEPTIONS_VIEW: "security_exceptions_view",
  SECURITY_EXCEPTIONS_APPROVE: "security_exceptions_approve",
  SECURITY_EXCEPTIONS_REJECT: "security_exceptions_reject",
  SECURITY_MISSIONS_ASSIGN: "security_missions_assign",
  SECURITY_MISSIONS_VIEW: "security_missions_view",
  SECURITY_MISSIONS_APPROVE: "security_missions_approve",
  SECURITY_SIGNATURE_UPDATE: "security_signature_update",
  SECURITY_SIGNATURE_VIEW: "security_signature_view",
  SECURITY_SIGNATURE_VALIDATE: "security_signature_validate",
  SECURITY_EXTERNAL_DRIVERS_VIEW: "security_external_drivers_view",
  SECURITY_EXTERNAL_DRIVERS_MANAGE: "security_external_drivers_manage",
  SECURITY_EXTERNAL_DRIVER_VEHICLE_MANAGE: "security_external_driver_vehicle_manage",
  SECURITY_DISPATCH_EVIDENCE_VIEW: "security_dispatch_evidence_view",
  SECURITY_DISPATCH_CONFIRMATION_APPROVE: "security_dispatch_confirmation_approve",
  SUPPORT_SECURITY_INCIDENT_HANDLE: "support_security_incident_handle"
};
var permissionLevels = [
  FEATURE_PERMISSIONS.VIEW,
  FEATURE_PERMISSIONS.EDIT,
  FEATURE_PERMISSIONS.ADMIN
];
var FEATURE_WORKSPACE_MAP = {
  // Core/Admin Features
  [FEATURES.CORE_DASHBOARD_STATS_VIEW]: "sales",
  [FEATURES.CORE_DASHBOARD_PROFILE_VIEW]: "sales",
  [FEATURES.CORE_DEPARTMENTS_VIEW]: "sales",
  [FEATURES.CORE_DEPARTMENTS_CREATE]: "sales",
  [FEATURES.CORE_DEPARTMENTS_EDIT]: "sales",
  [FEATURES.CORE_DEPARTMENTS_DELETE]: "sales",
  [FEATURES.CORE_POSTS_VIEW]: "sales",
  [FEATURES.CORE_POSTS_CREATE]: "sales",
  [FEATURES.CORE_POSTS_EDIT]: "sales",
  [FEATURES.CORE_POSTS_DELETE]: "sales",
  [FEATURES.CORE_ORDERS_VIEW]: "sales",
  [FEATURES.CORE_ORDERS_CREATE]: "sales",
  [FEATURES.CORE_ORDERS_EDIT]: "sales",
  [FEATURES.CORE_ORDERS_DELETE]: "sales",
  [FEATURES.CORE_ORDERS_UPDATE_STATUS]: "sales",
  // CRM Features
  [FEATURES.CRM_CUSTOMERS_VIEW]: "crm",
  [FEATURES.CRM_CUSTOMERS_VIEW_ALL]: "crm",
  [FEATURES.CRM_CUSTOMERS_CREATE]: "crm",
  [FEATURES.CRM_CUSTOMERS_EDIT]: "crm",
  [FEATURES.CRM_CUSTOMERS_DELETE]: "crm",
  [FEATURES.CRM_CUSTOMERS_BLACKLIST]: "crm",
  [FEATURES.CRM_CUSTOMERS_LOCK]: "crm",
  [FEATURES.CRM_CUSTOMERS_ASSIGN_OWNER]: "crm",
  [FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE]: "crm",
  [FEATURES.CRM_PROJECT_ADDRESSES_CREATE]: "crm",
  [FEATURES.CRM_PROJECT_ADDRESSES_EDIT]: "crm",
  [FEATURES.CRM_PROJECT_ADDRESSES_DELETE]: "crm",
  [FEATURES.CRM_PHONE_NUMBERS_CREATE]: "crm",
  [FEATURES.CRM_PHONE_NUMBERS_EDIT]: "crm",
  [FEATURES.CRM_PHONE_NUMBERS_DELETE]: "crm",
  [FEATURES.CRM_CONTACTS_VIEW]: "crm",
  [FEATURES.CRM_CONTACTS_CREATE]: "crm",
  [FEATURES.CRM_CONTACTS_EDIT]: "crm",
  [FEATURES.CRM_CONTACTS_DELETE]: "crm",
  [FEATURES.CRM_LEADS_VIEW]: "crm",
  [FEATURES.CRM_LEADS_CREATE]: "crm",
  [FEATURES.CRM_LEADS_EDIT]: "crm",
  [FEATURES.CRM_LEADS_DELETE]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_VIEW]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_CREATE]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_EDIT]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_DELETE]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_VIEW]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_CREATE]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_EDIT]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_REASSIGN]: "crm",
  [FEATURES.CRM_FOLLOW_UPS_VIEW]: "crm",
  [FEATURES.CRM_FOLLOW_UPS_CREATE]: "crm",
  [FEATURES.CRM_NEXT_ACTIONS_VIEW]: "crm",
  [FEATURES.CRM_NEXT_ACTIONS_EDIT]: "crm",
  [FEATURES.CRM_DASHBOARD_VIEW]: "crm",
  // Sales Features
  [FEATURES.SALES_CONTRACTS_VIEW]: "sales",
  [FEATURES.SALES_CONTRACTS_CREATE]: "sales",
  [FEATURES.SALES_CONTRACTS_EDIT]: "sales",
  [FEATURES.SALES_CONTRACTS_DELETE]: "sales",
  [FEATURES.SALES_CONTRACTS_CANCEL_AFTER_APPROVAL]: "sales",
  [FEATURES.SALES_CONTRACTS_APPROVE]: "sales",
  [FEATURES.SALES_CONTRACTS_REJECT]: "sales",
  [FEATURES.SALES_CONTRACTS_SIGN]: "sales",
  [FEATURES.SALES_CONTRACTS_PRINT]: "sales",
  [FEATURES.SALES_CONTRACT_ITEMS_CREATE]: "sales",
  [FEATURES.SALES_DELIVERIES_VIEW]: "sales",
  [FEATURES.SALES_DELIVERIES_CREATE]: "sales",
  [FEATURES.SALES_PAYMENTS_VIEW]: "sales",
  [FEATURES.SALES_PAYMENTS_CREATE]: "sales",
  [FEATURES.SALES_VERIFICATION_SEND]: "sales",
  [FEATURES.SALES_VERIFICATION_VERIFY]: "sales",
  [FEATURES.SALES_VERIFICATION_TIME]: "sales",
  [FEATURES.SALES_DASHBOARD_VIEW]: "sales",
  [FEATURES.SALES_CONTRACT_NUMBER_VIEW]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_VIEW]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_CREATE]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_EDIT]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_DELETE]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_GENERATE]: "sales",
  [FEATURES.SALES_PRODUCTS_VIEW]: "sales",
  [FEATURES.SALES_PRODUCTS_CREATE]: "sales",
  [FEATURES.SALES_PRODUCTS_EDIT]: "sales",
  [FEATURES.SALES_PRODUCTS_DELETE]: "sales",
  [FEATURES.SALES_PRODUCTS_IMPORT]: "sales",
  [FEATURES.SALES_PRODUCTS_EXPORT]: "sales",
  [FEATURES.SALES_PRODUCTS_TEMPLATE]: "sales",
  [FEATURES.SALES_PRODUCTS_STATS]: "sales",
  [FEATURES.SALES_PRODUCTS_ATTRIBUTES]: "sales",
  [FEATURES.SALES_CUSTOMERS_VIEW]: "sales",
  [FEATURES.SALES_CUSTOMERS_CREATE]: "sales",
  [FEATURES.SALES_CUSTOMERS_EDIT]: "sales",
  [FEATURES.SALES_CUSTOMERS_DELETE]: "sales",
  [FEATURES.SALES_CUSTOMERS_ASSIGN_OWNER]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_VIEW]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_CREATE]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_EDIT]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_DELETE]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_APPROVE]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_REJECT]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_SIGN]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_PRINT]: "sales",
  [FEATURES.SALES_PARTNER_INQUIRIES_VIEW]: "sales",
  [FEATURES.SALES_PARTNER_INQUIRIES_RESPOND]: "sales",
  [FEATURES.SALES_PARTNER_SELLERS_MANAGE]: "sales",
  // Inventory Features
  [FEATURES.INVENTORY_CUT_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_CUT_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_CUT_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_CUT_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_VIEW]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_CREATE]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_EDIT]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_DELETE]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_VIEW]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_CREATE]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_EDIT]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_DELETE]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_VIEW]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_CREATE]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_EDIT]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_DELETE]: "inventory",
  [FEATURES.INVENTORY_MINES_VIEW]: "inventory",
  [FEATURES.INVENTORY_MINES_CREATE]: "inventory",
  [FEATURES.INVENTORY_MINES_EDIT]: "inventory",
  [FEATURES.INVENTORY_MINES_DELETE]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_COLORS_VIEW]: "inventory",
  [FEATURES.INVENTORY_COLORS_CREATE]: "inventory",
  [FEATURES.INVENTORY_COLORS_EDIT]: "inventory",
  [FEATURES.INVENTORY_COLORS_DELETE]: "inventory",
  [FEATURES.INVENTORY_SERVICES_VIEW]: "inventory",
  [FEATURES.INVENTORY_SERVICES_CREATE]: "inventory",
  [FEATURES.INVENTORY_SERVICES_EDIT]: "inventory",
  [FEATURES.INVENTORY_SERVICES_DELETE]: "inventory",
  [FEATURES.INVENTORY_SERVICES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_VIEW]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_CREATE]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_EDIT]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_DELETE]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_VIEW]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_CREATE]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_EDIT]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_DELETE]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_VIEW]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_CREATE]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_EDIT]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_DELETE]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_COST_EVIDENCE_MANAGE]: "inventory",
  // Accounting Features
  [FEATURES.ACCOUNTING_DASHBOARD_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_CONTRACTS_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_RECEIVABLES_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_PAYMENTS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_TAX_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_CREATE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_APPROVE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_VERIFY]: "accounting",
  [FEATURES.ACCOUNTING_AUDIT_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID]: "accounting",
  [FEATURES.ACCOUNTING_ACTIONS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CUSTOMER_POSTING_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_TREASURY_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_EVIDENCE_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_TAX_SUBMISSIONS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CUSTOMER_STATEMENTS_EXPORT]: "accounting",
  // BI Features
  [FEATURES.BI_DASHBOARD_VIEW]: "bi",
  [FEATURES.BI_PARTNER_REPORTS_VIEW]: "bi",
  // Logistics Features
  [FEATURES.LOGISTICS_DASHBOARD_VIEW]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_VIEW]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_CREATE]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_EDIT]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_FINALIZE]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_CANCEL]: "logistics",
  [FEATURES.LOGISTICS_CORRECTIONS_CREATE]: "logistics",
  [FEATURES.LOGISTICS_DRIVERS_VIEW]: "logistics",
  [FEATURES.LOGISTICS_DRIVERS_MANAGE]: "logistics",
  [FEATURES.HR_INTERNAL_DRIVERS_VIEW]: "hr",
  [FEATURES.HR_INTERNAL_DRIVERS_MANAGE]: "hr",
  [FEATURES.HR_VEHICLE_OPERATIONS_VIEW]: "hr",
  [FEATURES.HR_VEHICLE_OPERATIONS_MANAGE]: "hr",
  [FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE]: "hr",
  [FEATURES.HR_DRIVER_BIOMETRIC_AUDIT_VIEW]: "hr",
  [FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE]: "hr",
  [FEATURES.HR_DRIVER_PROFILES_MANAGE]: "hr",
  [FEATURES.HR_COMPANY_VEHICLES_MANAGE]: "hr",
  [FEATURES.HR_VEHICLE_PLATES_MANAGE]: "hr",
  [FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE]: "hr",
  [FEATURES.HR_VEHICLE_OPERATIONS_AUDIT_VIEW]: "hr",
  // Human Resources Features
  [FEATURES.HR_DASHBOARD_VIEW]: "hr",
  [FEATURES.HR_ORGANIZATION_VIEW]: "hr",
  [FEATURES.HR_ORGANIZATION_CREATE]: "hr",
  [FEATURES.HR_ORGANIZATION_EDIT]: "hr",
  [FEATURES.HR_ORGANIZATION_ARCHIVE]: "hr",
  [FEATURES.HR_ORGANIZATION_DELETE]: "hr",
  [FEATURES.HR_PERSONNEL_VIEW]: "hr",
  [FEATURES.HR_PERSONNEL_EDIT]: "hr",
  [FEATURES.HR_RECRUITMENT_VIEW]: "hr",
  [FEATURES.HR_RECRUITMENT_EDIT]: "hr",
  [FEATURES.HR_ASSESSMENTS_EDIT]: "hr",
  [FEATURES.HR_WORK_MANAGEMENT_VIEW]: "hr",
  [FEATURES.HR_WORK_MANAGEMENT_EDIT]: "hr",
  [FEATURES.HR_PERMISSIONS_VIEW]: "hr",
  [FEATURES.HR_PERMISSIONS_EDIT]: "hr",
  [FEATURES.HR_MIGRATION_VIEW]: "hr",
  [FEATURES.HR_MIGRATION_EDIT]: "hr",
  [FEATURES.HR_USERS_VIEW]: "hr",
  [FEATURES.HR_USERS_CREATE]: "hr",
  [FEATURES.HR_USERS_EDIT]: "hr",
  [FEATURES.HR_USERS_DELETE]: "hr",
  // Security Features
  [FEATURES.SECURITY_SHIFTS_VIEW]: "security",
  [FEATURES.SECURITY_SHIFTS_CREATE]: "security",
  [FEATURES.SECURITY_SHIFTS_START]: "security",
  [FEATURES.SECURITY_SHIFTS_END]: "security",
  [FEATURES.SECURITY_ATTENDANCE_CHECKIN]: "security",
  [FEATURES.SECURITY_ATTENDANCE_CHECKOUT]: "security",
  [FEATURES.SECURITY_ATTENDANCE_EXCEPTION]: "security",
  [FEATURES.SECURITY_ATTENDANCE_DAILY_VIEW]: "security",
  [FEATURES.SECURITY_DASHBOARD_VIEW]: "security",
  [FEATURES.SECURITY_PERSONNEL_VIEW]: "security",
  [FEATURES.SECURITY_PERSONNEL_ASSIGN]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_REQUEST]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_VIEW]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_APPROVE]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_REJECT]: "security",
  [FEATURES.SECURITY_MISSIONS_ASSIGN]: "security",
  [FEATURES.SECURITY_MISSIONS_VIEW]: "security",
  [FEATURES.SECURITY_MISSIONS_APPROVE]: "security",
  [FEATURES.SECURITY_SIGNATURE_UPDATE]: "security",
  [FEATURES.SECURITY_SIGNATURE_VIEW]: "security",
  [FEATURES.SECURITY_SIGNATURE_VALIDATE]: "security",
  [FEATURES.SECURITY_EXTERNAL_DRIVERS_VIEW]: "security",
  [FEATURES.SECURITY_EXTERNAL_DRIVERS_MANAGE]: "security",
  [FEATURES.SECURITY_EXTERNAL_DRIVER_VEHICLE_MANAGE]: "security",
  [FEATURES.SECURITY_DISPATCH_EVIDENCE_VIEW]: "security",
  [FEATURES.SECURITY_DISPATCH_CONFIRMATION_APPROVE]: "security",
  [FEATURES.SUPPORT_SECURITY_INCIDENT_HANDLE]: "security"
};
var FEATURE_SUBJECT_LABELS_FA = {
  core_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0633\u0627\u0645\u0627\u0646\u0647",
  core_departments: "\u0628\u062E\u0634\u200C\u0647\u0627",
  core_posts: "\u0633\u0645\u062A\u200C\u0647\u0627",
  core_orders: "\u0633\u0641\u0627\u0631\u0634\u200C\u0647\u0627",
  crm_customers: "\u0645\u0634\u062A\u0631\u06CC\u0627\u0646",
  crm_project_addresses: "\u0646\u0634\u0627\u0646\u06CC\u200C\u0647\u0627\u06CC \u067E\u0631\u0648\u0698\u0647",
  crm_phone_numbers: "\u0634\u0645\u0627\u0631\u0647\u200C\u0647\u0627\u06CC \u062A\u0645\u0627\u0633",
  crm_contacts: "\u0645\u062E\u0627\u0637\u0628\u0627\u0646",
  crm_leads: "\u0633\u0631\u0646\u062E\u200C\u0647\u0627",
  crm_communications: "\u0627\u0631\u062A\u0628\u0627\u0637\u0627\u062A \u0645\u0634\u062A\u0631\u06CC",
  crm_potential_projects: "\u067E\u0631\u0648\u0698\u0647\u200C\u0647\u0627\u06CC \u0627\u062D\u062A\u0645\u0627\u0644\u06CC",
  crm_follow_ups: "\u067E\u06CC\u06AF\u06CC\u0631\u06CC\u200C\u0647\u0627",
  crm_next_actions: "\u0627\u0642\u062F\u0627\u0645\u200C\u0647\u0627\u06CC \u0628\u0639\u062F\u06CC",
  crm_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u0645\u0634\u062A\u0631\u06CC",
  sales_contracts: "\u0642\u0631\u0627\u0631\u062F\u0627\u062F\u0647\u0627\u06CC \u0641\u0631\u0648\u0634",
  sales_contract_items: "\u0627\u0642\u0644\u0627\u0645 \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u0641\u0631\u0648\u0634",
  sales_deliveries: "\u062A\u062D\u0648\u06CC\u0644\u200C\u0647\u0627\u06CC \u0641\u0631\u0648\u0634",
  sales_payments: "\u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627\u06CC \u0641\u0631\u0648\u0634",
  sales_verification: "\u062A\u0623\u06CC\u06CC\u062F \u0641\u0631\u0648\u0634",
  sales_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0641\u0631\u0648\u0634",
  sales_contract_number: "\u0634\u0645\u0627\u0631\u0647 \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u0641\u0631\u0648\u0634",
  sales_contract_templates: "\u0627\u0644\u06AF\u0648\u0647\u0627\u06CC \u0642\u0631\u0627\u0631\u062F\u0627\u062F",
  sales_products: "\u0645\u062D\u0635\u0648\u0644\u0627\u062A \u0641\u0631\u0648\u0634",
  sales_customers: "\u0645\u0634\u062A\u0631\u06CC\u0627\u0646 \u0641\u0631\u0648\u0634",
  sales_legacy_contracts: "\u0642\u0631\u0627\u0631\u062F\u0627\u062F\u0647\u0627\u06CC \u0642\u062F\u06CC\u0645\u06CC",
  sales_partner_inquiries: "\u0627\u0633\u062A\u0639\u0644\u0627\u0645\u200C\u0647\u0627\u06CC \u0647\u0645\u06A9\u0627\u0631",
  sales_partner_sellers: "\u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u0648 \u067E\u0627\u0633\u062E\u200C\u062F\u0647\u0646\u062F\u06AF\u0627\u0646 \u0647\u0645\u06A9\u0627\u0631",
  inventory_cut_types: "\u0627\u0646\u0648\u0627\u0639 \u0628\u0631\u0634",
  inventory_stone_materials: "\u062C\u0646\u0633\u200C\u0647\u0627\u06CC \u0633\u0646\u06AF",
  inventory_cut_widths: "\u0639\u0631\u0636\u200C\u0647\u0627\u06CC \u0628\u0631\u0634",
  inventory_thicknesses: "\u0636\u062E\u0627\u0645\u062A\u200C\u0647\u0627",
  inventory_mines: "\u0645\u0639\u0627\u062F\u0646",
  inventory_finish_types: "\u0627\u0646\u0648\u0627\u0639 \u067E\u0631\u062F\u0627\u062E\u062A",
  inventory_colors: "\u0631\u0646\u06AF\u200C\u0647\u0627",
  inventory_services: "\u062E\u062F\u0645\u0627\u062A \u0627\u0646\u0628\u0627\u0631",
  inventory_cutting_types: "\u0631\u0648\u0634\u200C\u0647\u0627\u06CC \u0628\u0631\u0634",
  inventory_sub_services: "\u0632\u06CC\u0631\u062E\u062F\u0645\u062A\u200C\u0647\u0627",
  inventory_stair_standard_lengths: "\u0637\u0648\u0644\u200C\u0647\u0627\u06CC \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F \u067E\u0644\u0647",
  inventory_layer_types: "\u0627\u0646\u0648\u0627\u0639 \u0644\u0627\u06CC\u0647",
  inventory_stone_finishings: "\u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627\u06CC \u0633\u0646\u06AF",
  inventory_cost_evidence: "\u0634\u0648\u0627\u0647\u062F \u0628\u0647\u0627\u06CC \u0645\u0648\u062C\u0648\u062F\u06CC",
  accounting_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_contracts: "\u0642\u0631\u0627\u0631\u062F\u0627\u062F\u0647\u0627\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_invoice_candidates: "\u06AF\u0632\u06CC\u0646\u0647\u200C\u0647\u0627\u06CC \u0635\u062F\u0648\u0631 \u0635\u0648\u0631\u062A\u200C\u062D\u0633\u0627\u0628",
  accounting_receivables: "\u062F\u0631\u06CC\u0627\u0641\u062A\u0646\u06CC\u200C\u0647\u0627",
  accounting_payments: "\u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627",
  accounting_tax: "\u0645\u0627\u0644\u06CC\u0627\u062A",
  accounting_corrections: "\u0627\u0635\u0644\u0627\u062D\u0627\u062A \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_audit: "\u0645\u0645\u06CC\u0632\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_records: "\u0627\u0633\u0646\u0627\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_actions: "\u0639\u0645\u0644\u06CC\u0627\u062A \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_biometric_diagnostics: "\u0639\u06CC\u0628\u200C\u06CC\u0627\u0628\u06CC \u0627\u062A\u0635\u0627\u0644 \u0632\u06CC\u0633\u062A\u200C\u0633\u0646\u062C\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_dispatch_candidates: "\u06AF\u0632\u06CC\u0646\u0647\u200C\u0647\u0627\u06CC \u0627\u0631\u0633\u0627\u0644 \u0627\u0633\u0646\u0627\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_dispatch_confirmation: "\u062A\u0623\u06CC\u06CC\u062F \u0627\u0631\u0633\u0627\u0644 \u0627\u0633\u0646\u0627\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_partner_terms: "\u0634\u0631\u0627\u06CC\u0637 \u062A\u062C\u0627\u0631\u06CC \u0648 \u0627\u0639\u062A\u0628\u0627\u0631 \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631",
  accounting_customer_posting: "\u062B\u0628\u062A \u0641\u0631\u0648\u0634 \u0648 \u062F\u0631\u06CC\u0627\u0641\u062A\u0646\u06CC \u0645\u0634\u062A\u0631\u06CC",
  accounting_treasury: "\u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0632\u0627\u0646\u0647\u200C\u062F\u0627\u0631\u06CC",
  accounting_evidence: "\u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_tax_submissions: "\u0627\u0631\u0633\u0627\u0644 \u0635\u0648\u0631\u062A\u062D\u0633\u0627\u0628 \u0645\u0627\u0644\u06CC\u0627\u062A\u06CC",
  accounting_customer_statements: "\u0635\u0648\u0631\u062A\u062D\u0633\u0627\u0628 \u0645\u0634\u062A\u0631\u06CC",
  bi_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0647\u0648\u0634 \u062A\u062C\u0627\u0631\u06CC",
  bi_partner_reports: "\u06AF\u0632\u0627\u0631\u0634\u200C\u0647\u0627 \u0648 \u062D\u0633\u0627\u0628\u200C\u0647\u0627\u06CC \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631",
  logistics_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0644\u062C\u0633\u062A\u06CC\u06A9",
  logistics_loadings: "\u0628\u0627\u0631\u06AF\u06CC\u0631\u06CC\u200C\u0647\u0627",
  logistics_corrections: "\u0627\u0635\u0644\u0627\u062D\u0627\u062A \u0644\u062C\u0633\u062A\u06CC\u06A9",
  logistics_drivers: "\u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u0644\u062C\u0633\u062A\u06CC\u06A9",
  hr_internal_drivers: "\u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_vehicle_operations: "\u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_internal_driver_eligibility: "\u0635\u0644\u0627\u062D\u06CC\u062A \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_driver_biometric_audit: "\u0645\u0645\u06CC\u0632\u06CC \u0632\u06CC\u0633\u062A\u200C\u0633\u0646\u062C\u06CC \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_driver_biometric_enrollment: "\u062B\u0628\u062A \u0632\u06CC\u0633\u062A\u200C\u0633\u0646\u062C\u06CC \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_driver_profiles: "\u0646\u0645\u0627\u06CC\u0647\u200C\u0647\u0627\u06CC \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_company_vehicles: "\u062E\u0648\u062F\u0631\u0648\u0647\u0627\u06CC \u0634\u0631\u06A9\u062A",
  hr_vehicle_plates: "\u067E\u0644\u0627\u06A9 \u062E\u0648\u062F\u0631\u0648\u0647\u0627",
  hr_driver_vehicle_assignments: "\u062A\u062E\u0635\u06CC\u0635 \u0631\u0627\u0646\u0646\u062F\u0647 \u0648 \u062E\u0648\u062F\u0631\u0648",
  hr_vehicle_operations_audit: "\u0645\u0645\u06CC\u0632\u06CC \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC",
  hr_organization: "\u0633\u0627\u062E\u062A\u0627\u0631 \u0633\u0627\u0632\u0645\u0627\u0646\u06CC",
  hr_personnel: "\u067E\u0631\u0633\u0646\u0644",
  hr_recruitment: "\u067E\u0631\u0648\u0646\u062F\u0647\u200C\u0647\u0627\u06CC \u062C\u0630\u0628",
  hr_assessments: "\u0645\u0635\u0627\u062D\u0628\u0647 \u0648 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0627\u0633\u062A\u062E\u062F\u0627\u0645",
  hr_work_management: "\u0648\u0638\u0627\u06CC\u0641 \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC",
  hr_permissions: "\u0627\u062E\u062A\u06CC\u0627\u0631 \u0648 \u0645\u0633\u0626\u0648\u0644\u06CC\u062A",
  hr_migration: "\u0645\u0647\u0627\u062C\u0631\u062A \u0648 \u062A\u0637\u0628\u06CC\u0642",
  hr_users: "\u06A9\u0627\u0631\u0628\u0631\u0627\u0646",
  security_shifts: "\u0634\u06CC\u0641\u062A\u200C\u0647\u0627\u06CC \u0627\u0645\u0646\u06CC\u062A",
  security_attendance: "\u062D\u0636\u0648\u0631 \u0648 \u063A\u06CC\u0627\u0628 \u0627\u0645\u0646\u06CC\u062A",
  security_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0627\u0645\u0646\u06CC\u062A",
  security_personnel: "\u067E\u0631\u0633\u0646\u0644 \u0627\u0645\u0646\u06CC\u062A",
  security_exceptions: "\u0627\u0633\u062A\u062B\u0646\u0627\u0647\u0627\u06CC \u062D\u0636\u0648\u0631",
  security_missions: "\u0645\u0623\u0645\u0648\u0631\u06CC\u062A\u200C\u0647\u0627",
  security_signature: "\u0627\u0645\u0636\u0627",
  security_external_drivers: "\u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u0628\u06CC\u0631\u0648\u0646\u06CC",
  security_external_driver_vehicle: "\u062E\u0648\u062F\u0631\u0648\u06CC \u0631\u0627\u0646\u0646\u062F\u0647 \u0628\u06CC\u0631\u0648\u0646\u06CC",
  security_dispatch_evidence: "\u0634\u0648\u0627\u0647\u062F \u0627\u0631\u0633\u0627\u0644",
  security_dispatch_confirmation: "\u062A\u0623\u06CC\u06CC\u062F \u0627\u0631\u0633\u0627\u0644",
  support_security_incident: "\u0631\u062E\u062F\u0627\u062F \u0627\u0645\u0646\u06CC\u062A\u06CC \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC"
};
var FEATURE_ACTION_LABELS_FA = [
  ["cancel_after_approval", "\u0644\u063A\u0648 \u067E\u0633 \u0627\u0632 \u062A\u0623\u06CC\u06CC\u062F"],
  ["stats_view", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0622\u0645\u0627\u0631"],
  ["profile_view", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u0645\u0627\u06CC\u0647"],
  ["daily_view", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0631\u0648\u0632\u0627\u0646\u0647"],
  ["assign_owner", "\u062A\u062E\u0635\u06CC\u0635 \u0645\u0633\u0626\u0648\u0644"],
  ["update_status", "\u062A\u063A\u06CC\u06CC\u0631 \u0648\u0636\u0639\u06CC\u062A"],
  ["approve_void", "\u062A\u0623\u06CC\u06CC\u062F \u06CC\u0627 \u0627\u0628\u0637\u0627\u0644"],
  ["checkin", "\u062B\u0628\u062A \u0648\u0631\u0648\u062F"],
  ["checkout", "\u062B\u0628\u062A \u062E\u0631\u0648\u062C"],
  ["blacklist", "\u0627\u0641\u0632\u0648\u062F\u0646 \u0628\u0647 \u0641\u0647\u0631\u0633\u062A \u0645\u0633\u062F\u0648\u062F"],
  ["reassign", "\u062A\u062E\u0635\u06CC\u0635 \u062F\u0648\u0628\u0627\u0631\u0647"],
  ["attributes", "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0648\u06CC\u0698\u06AF\u06CC\u200C\u0647\u0627\u06CC"],
  ["template", "\u062F\u0631\u06CC\u0627\u0641\u062A \u0627\u0644\u06AF\u0648\u06CC"],
  ["stats", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0622\u0645\u0627\u0631"],
  ["create", "\u0627\u06CC\u062C\u0627\u062F"],
  ["delete", "\u062D\u0630\u0641"],
  ["edit", "\u0648\u06CC\u0631\u0627\u06CC\u0634"],
  ["view", "\u0645\u0634\u0627\u0647\u062F\u0647"],
  ["manage", "\u0645\u062F\u06CC\u0631\u06CC\u062A"],
  ["approve", "\u062A\u0623\u06CC\u06CC\u062F"],
  ["reject", "\u0631\u062F"],
  ["sign", "\u0627\u0645\u0636\u0627\u06CC"],
  ["print", "\u0686\u0627\u067E"],
  ["send", "\u0627\u0631\u0633\u0627\u0644 \u06A9\u062F"],
  ["verify", "\u0628\u0631\u0631\u0633\u06CC \u06A9\u062F"],
  ["time", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0632\u0645\u0627\u0646 \u0627\u0639\u062A\u0628\u0627\u0631"],
  ["generate", "\u062A\u0648\u0644\u06CC\u062F"],
  ["import", "\u062F\u0631\u0648\u0646\u200C\u0631\u06CC\u0632\u06CC"],
  ["export", "\u0628\u0631\u0648\u0646\u200C\u0631\u06CC\u0632\u06CC"],
  ["toggle", "\u0641\u0639\u0627\u0644 \u06CC\u0627 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644\u200C\u06A9\u0631\u062F\u0646"],
  ["finalize", "\u0646\u0647\u0627\u06CC\u06CC\u200C\u06A9\u0631\u062F\u0646"],
  ["cancel", "\u0644\u063A\u0648"],
  ["archive", "\u0628\u0627\u06CC\u06AF\u0627\u0646\u06CC"],
  ["start", "\u0634\u0631\u0648\u0639"],
  ["end", "\u067E\u0627\u06CC\u0627\u0646"],
  ["exception", "\u062B\u0628\u062A \u0627\u0633\u062A\u062B\u0646\u0627\u06CC"],
  ["request", "\u062F\u0631\u062E\u0648\u0627\u0633\u062A"],
  ["respond", "\u067E\u0627\u0633\u062E\u200C\u06AF\u0648\u06CC\u06CC \u0628\u0647"],
  ["assign", "\u062A\u062E\u0635\u06CC\u0635"],
  ["update", "\u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC"],
  ["validate", "\u0627\u0639\u062A\u0628\u0627\u0631\u0633\u0646\u062C\u06CC"],
  ["lock", "\u0642\u0641\u0644\u200C\u06A9\u0631\u062F\u0646"],
  ["handle", "\u0631\u0633\u06CC\u062F\u06AF\u06CC \u0628\u0647"]
];
var featureLabelFa = (feature) => {
  if (feature === FEATURES.CRM_CUSTOMERS_VIEW_ALL) return "\u0645\u0634\u0627\u0647\u062F\u0647 \u0647\u0645\u0647 \u0645\u0634\u062A\u0631\u06CC\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC \u0648 \u0647\u0645\u06A9\u0627\u0631";
  if (feature === FEATURES.CRM_CUSTOMERS_DELETE) return "\u062D\u0630\u0641 \u062F\u0627\u0626\u0645\u06CC \u0645\u0634\u062A\u0631\u06CC \u0628\u062F\u0648\u0646 \u0633\u0627\u0628\u0642\u0647";
  const action = FEATURE_ACTION_LABELS_FA.find(([suffix2]) => feature.endsWith(`_${suffix2}`));
  if (!action) throw new Error(`Missing Persian action label for feature: ${feature}`);
  const [suffix, actionLabel] = action;
  const subjectKey = feature.slice(0, -(suffix.length + 1));
  const subjectLabel = FEATURE_SUBJECT_LABELS_FA[subjectKey];
  if (!subjectLabel) throw new Error(`Missing Persian subject label for feature: ${feature}`);
  return `${actionLabel} ${subjectLabel}`;
};
var FEATURE_LABELS = Object.fromEntries(
  Object.values(FEATURES).map((feature) => [feature, feature === FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE ? "\u0628\u0631\u0631\u0633\u06CC \u0648 \u062A\u0635\u0645\u06CC\u0645 \u0627\u0646\u062A\u0642\u0627\u0644 \u0645\u0634\u062A\u0631\u06CC \u0628\u0647 \u0647\u0645\u06A9\u0627\u0631" : featureLabelFa(feature)])
);

// src/services/hrActionPermissionCatalog.ts
var LEGACY_PERFORMANCE_ACTION_PERMISSIONS = [
  { code: "REQUEST_PERFORMANCE_PRIVACY_CASE", labelFa: "\u062B\u0628\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_PRIVACY_CASE", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u067E\u0631\u0648\u0646\u062F\u0647 \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "ACKNOWLEDGE_PERFORMANCE_PRIVACY_CASE", labelFa: "\u0627\u0639\u0644\u0627\u0645 \u062F\u0631\u06CC\u0627\u0641\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "VERIFY_PERFORMANCE_PRIVACY_IDENTITY", labelFa: "\u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "DECIDE_PERFORMANCE_PRIVACY_ACCESS", labelFa: "\u062A\u0635\u0645\u06CC\u0645 \u062F\u0633\u062A\u0631\u0633\u06CC \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "REGISTER_PERFORMANCE_CORRECTION", labelFa: "\u062B\u0628\u062A \u0627\u0635\u0644\u0627\u062D \u0646\u0633\u062E\u0647\u200C\u062F\u0627\u0631 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "DECIDE_PERFORMANCE_PRIVACY_CORRECTION", labelFa: "\u062A\u0635\u0645\u06CC\u0645 \u0627\u0635\u0644\u0627\u062D \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "DECIDE_PERFORMANCE_ERASURE", labelFa: "\u062A\u0635\u0645\u06CC\u0645 \u062D\u0630\u0641 \u0645\u062C\u0627\u0632 \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RESTRICT_PERFORMANCE_EVIDENCE", labelFa: "\u0645\u062D\u062F\u0648\u062F\u0633\u0627\u0632\u06CC \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RELEASE_PERFORMANCE_RESTRICTION", labelFa: "\u0631\u0641\u0639 \u0645\u062D\u062F\u0648\u062F\u0633\u0627\u0632\u06CC \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "PLACE_PERFORMANCE_LEGAL_HOLD", labelFa: "\u0627\u06CC\u062C\u0627\u062F \u062A\u0648\u0642\u0641 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RELEASE_PERFORMANCE_LEGAL_HOLD", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_POLICY", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0648 \u0627\u0646\u062A\u0634\u0627\u0631 \u0633\u06CC\u0627\u0633\u062A \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_CYCLE", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0686\u0631\u062E\u0647 \u0648 \u0645\u0647\u0644\u062A \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "SUBMIT_PERFORMANCE_EVALUATION", labelFa: "\u0627\u0631\u0633\u0627\u0644 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F \u0633\u0631\u067E\u0631\u0633\u062A", level: "EDIT", prerequisites: [] },
  { code: "REVIEW_PERFORMANCE_EVALUATION", labelFa: "\u0628\u0631\u0631\u0633\u06CC \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_HISTORY", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0633\u0627\u0628\u0642\u0647 \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_BADGE_LIST", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u0634\u0627\u0646 \u0631\u0634\u062F \u062F\u0631 \u0641\u0647\u0631\u0633\u062A \u067E\u0631\u0633\u0646\u0644", level: "VIEW", prerequisites: [] },
  { code: "DELIVER_PERFORMANCE_PERSONAL_SUMMARY", labelFa: "\u062A\u062D\u0648\u06CC\u0644 \u062E\u0644\u0627\u0635\u0647 \u0634\u062E\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F \u067E\u0633 \u0627\u0632 \u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A", level: "EDIT", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_ANALYTICS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u062A\u062D\u0644\u06CC\u0644 \u062A\u062C\u0645\u06CC\u0639\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "VIEW_NAMED_PERFORMANCE_RANKING", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u062A\u062D\u0644\u06CC\u0644 \u0648 \u0631\u062A\u0628\u0647\u200C\u0628\u0646\u062F\u06CC \u0646\u0627\u0645\u200C\u062F\u0627\u0631 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "VIEW_EVALUATOR_CALIBRATION", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u06A9\u0627\u0644\u06CC\u0628\u0631\u0627\u0633\u06CC\u0648\u0646 \u0627\u0631\u0632\u06CC\u0627\u0628", level: "VIEW", prerequisites: [] },
  { code: "REQUEST_PERFORMANCE_EXPORT", labelFa: "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062E\u0631\u0648\u062C\u06CC \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_AUDIT", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u062D\u0633\u0627\u0628\u0631\u0633\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_RETENTION", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0648 \u0645\u062D\u062F\u0648\u062F\u0633\u0627\u0632\u06CC \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF", labelFa: "\u0627\u06CC\u062C\u0627\u062F \u0648\u0627\u06AF\u0630\u0627\u0631\u06CC \u067E\u06CC\u0627\u0645\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0627\u0631\u062C\u0627\u0639 \u067E\u06CC\u0627\u0645\u062F \u0639\u0645\u0644\u06A9\u0631\u062F \u0627\u062E\u062A\u0635\u0627\u0635\u200C\u06CC\u0627\u0641\u062A\u0647", level: "VIEW", prerequisites: [] },
  { code: "REVIEW_PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL", labelFa: "\u06A9\u0646\u062A\u0631\u0644 \u062D\u0642\u0648\u0642\u06CC \u0645\u0633\u062A\u0642\u0644 \u067E\u06CC\u0627\u0645\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "MANAGE_COMPENSATION_AGREEMENTS", labelFa: "\u0627\u0646\u062A\u0634\u0627\u0631 \u062A\u0648\u0627\u0641\u0642 \u062C\u0628\u0631\u0627\u0646 \u062E\u062F\u0645\u062A", level: "ADMIN", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_ROLLOUT", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0645\u0631\u062D\u0644\u0647 \u0648 \u062C\u0627\u0645\u0639\u0647 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "PAUSE_PERFORMANCE_EVALUATION", labelFa: "\u062A\u0648\u0642\u0641 \u0627\u06CC\u0645\u0646 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RECORD_PERFORMANCE_TRAINING", labelFa: "\u062B\u0628\u062A \u0634\u0627\u0647\u062F \u0622\u0645\u0648\u0632\u0634 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RECORD_PERFORMANCE_PROMOTION_EVIDENCE", labelFa: "\u062B\u0628\u062A \u0648 \u0627\u0628\u0637\u0627\u0644 \u0628\u0633\u062A\u0647 \u0634\u0648\u0627\u0647\u062F \u0627\u0631\u062A\u0642\u0627\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_COHORT_HR", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_COHORT_SECURITY", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0627\u0645\u0646\u06CC\u062A \u0648 \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_COHORT_SYSTEM", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0627\u0644\u06A9 \u0633\u0627\u0645\u0627\u0646\u0647 \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT", labelFa: "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0641\u0646\u06CC \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_RESUME_HR", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_RESUME_SECURITY", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0627\u0645\u0646\u06CC\u062A \u0648 \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_RESUME_SYSTEM", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0627\u0644\u06A9 \u0633\u0627\u0645\u0627\u0646\u0647 \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] }
];
var PERFORMANCE_ACTION_PERMISSIONS = [
  { code: "VIEW_PERFORMANCE_EVALUATIONS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC\u200C\u0647\u0627\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "EVALUATE_DIRECT_REPORTS", labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0627\u0641\u0631\u0627\u062F \u062A\u062D\u062A \u0633\u0631\u067E\u0631\u0633\u062A\u06CC", level: "EDIT", prerequisites: [] },
  { code: "EVALUATE_ALL_PERSONNEL", labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0647\u0645\u0647 \u067E\u0631\u0633\u0646\u0644", level: "EDIT", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_PROFILES", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0644\u06AF\u0648\u0647\u0627\u06CC \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC", level: "ADMIN", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_BADGE_LIST", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u0634\u0627\u0646 \u0631\u0634\u062F \u062F\u0631 \u0641\u0647\u0631\u0633\u062A \u067E\u0631\u0633\u0646\u0644", level: "VIEW", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_SURVEYS", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0646\u0638\u0631\u0633\u0646\u062C\u06CC \u0631\u0641\u062A\u0627\u0631\u06CC", level: "ADMIN", prerequisites: [] },
  { code: "RESPOND_PERFORMANCE_SURVEYS", labelFa: "\u067E\u0627\u0633\u062E \u0628\u0647 \u0646\u0638\u0631\u0633\u0646\u062C\u06CC \u0631\u0641\u062A\u0627\u0631\u06CC", level: "EDIT", prerequisites: [] },
  { code: "ENTER_PERFORMANCE_EVIDENCE", labelFa: "\u062B\u0628\u062A \u0634\u0648\u0627\u0647\u062F \u06A9\u0645\u06CC \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC", level: "EDIT", prerequisites: [] },
  { code: "FINALIZE_PERFORMANCE_RESULTS", labelFa: "\u0646\u0647\u0627\u06CC\u06CC\u200C\u0633\u0627\u0632\u06CC \u0646\u062A\u06CC\u062C\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC", level: "ADMIN", prerequisites: [] },
  { code: "VIEW_RAW_PERFORMANCE_SURVEY", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u067E\u0627\u0633\u062E \u062E\u0627\u0645 \u0646\u0638\u0631\u0633\u0646\u062C\u06CC", level: "ADMIN", prerequisites: [] }
];
var PERFORMANCE_ACTION_PERMISSION_CODES = PERFORMANCE_ACTION_PERMISSIONS.map(({ code }) => code);
var INDEPENDENT_PERFORMANCE_ACTION_PERMISSION_CODES = [
  ...LEGACY_PERFORMANCE_ACTION_PERMISSIONS.map(({ code }) => code),
  ...PERFORMANCE_ACTION_PERMISSION_CODES
];
var HR_ACTION_PERMISSION_GROUPS = [
  {
    code: "PARTNER_SELLER",
    labelFa: "\u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631",
    permissions: [
      { code: "VERIFY_PARTNER_IDENTITY", labelFa: "\u062A\u0623\u06CC\u06CC\u062F \u0647\u0648\u06CC\u062A \u0647\u0645\u06A9\u0627\u0631\u06CC", level: "EDIT", prerequisites: [] }
    ]
  },
  {
    code: "CASE_EVIDENCE",
    labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u067E\u0631\u0648\u0646\u062F\u0647 \u0648 \u0634\u0648\u0627\u0647\u062F",
    permissions: [
      { code: "VIEW_INITIAL_INTERVIEW_REPORT", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u06AF\u0632\u0627\u0631\u0634 \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "VIEW_FULL_APPLICANT_INFORMATION", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u06A9\u0627\u0645\u0644 \u0645\u062A\u0642\u0627\u0636\u06CC", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "VIEW_COMPANY_EVALUATION_RESULTS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u062A\u0627\u06CC\u062C \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0634\u0631\u06A9\u062A", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "VIEW_FORMAL_ASSESSMENT_RESULTS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u062A\u0627\u06CC\u062C \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC\u200C\u0647\u0627\u06CC \u0631\u0633\u0645\u06CC", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] }
    ]
  },
  {
    code: "INITIAL_INTERVIEW",
    labelFa: "\u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647",
    permissions: [
      { code: "RECORD_INITIAL_INTERVIEW", labelFa: "\u062B\u0628\u062A \u0648 \u062A\u06A9\u0645\u06CC\u0644 \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_INITIAL_INTERVIEW_CRITERIA"] },
      { code: "VIEW_INITIAL_INTERVIEW_CRITERIA", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u0639\u06CC\u0627\u0631\u0647\u0627\u06CC \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_INITIAL_INTERVIEW_CRITERIA", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0648 \u0627\u0646\u062A\u0634\u0627\u0631 \u0645\u0639\u06CC\u0627\u0631\u0647\u0627\u06CC \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "ADMIN", prerequisites: ["VIEW_INITIAL_INTERVIEW_CRITERIA"] },
      { code: "RECORD_PRELIMINARY_DECISION", labelFa: "\u062B\u0628\u062A \u062A\u0635\u0645\u06CC\u0645 \u0645\u0642\u062F\u0645\u0627\u062A\u06CC", level: "EDIT", prerequisites: ["VIEW_INITIAL_INTERVIEW_REPORT"] }
    ]
  },
  {
    code: "COMPANY_EVALUATION",
    labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC\u200C\u0647\u0627\u06CC \u0634\u0631\u06A9\u062A",
    permissions: [
      { code: "MANAGE_COMPANY_EVALUATION_PLAN", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0628\u0631\u0646\u0627\u0645\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0634\u0631\u06A9\u062A", level: "EDIT", prerequisites: ["VIEW_INITIAL_INTERVIEW_REPORT", "VIEW_COMPANY_EVALUATION_RESULTS"] },
      { code: "RECORD_COMPANY_EVALUATION_RESULT", labelFa: "\u062B\u0628\u062A \u0646\u062A\u06CC\u062C\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0634\u0631\u06A9\u062A", level: "EDIT", prerequisites: ["VIEW_COMPANY_EVALUATION_RESULTS"] },
      { code: "MANAGE_RECRUITMENT_EVALUATOR_SETTINGS", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0627\u0631\u0632\u06CC\u0627\u0628\u0627\u0646 \u062C\u0630\u0628", level: "ADMIN", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "RECORD_FINAL_MANAGEMENT_DECISION", labelFa: "\u062B\u0628\u062A \u062A\u0635\u0645\u06CC\u0645 \u0646\u0647\u0627\u06CC\u06CC \u0645\u062F\u06CC\u0631\u06CC\u062A", level: "EDIT", prerequisites: ["VIEW_INITIAL_INTERVIEW_REPORT", "VIEW_COMPANY_EVALUATION_RESULTS"] }
    ]
  },
  {
    code: "CASE_ADMINISTRATION",
    labelFa: "\u0627\u062F\u0627\u0631\u0647 \u067E\u0631\u0648\u0646\u062F\u0647 \u0648 \u0639\u0645\u0644\u06CC\u0627\u062A \u062A\u06A9\u0645\u06CC\u0644\u06CC",
    permissions: [
      { code: "MANAGE_RECRUITMENT_CASE", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u0631\u0648\u0646\u062F\u0647 \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "REVISE_PLANNED_EMPLOYMENT_START", labelFa: "\u0627\u0635\u0644\u0627\u062D \u062A\u0627\u0631\u06CC\u062E \u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0631\u06CC\u0632\u06CC\u200C\u0634\u062F\u0647 \u0634\u0631\u0648\u0639", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0644\u0632\u0627\u0645\u0627\u062A \u067E\u06CC\u0634 \u0627\u0632 \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_PERSONNEL_SCHEDULE", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0628\u0631\u0646\u0627\u0645\u0647 \u06A9\u0627\u0631 \u067E\u0631\u0633\u0646\u0644", level: "EDIT", prerequisites: ["PERSONNEL"] },
      { code: "ARCHIVE_RECRUITMENT_CASE", labelFa: "\u0628\u0627\u06CC\u06AF\u0627\u0646\u06CC \u0648 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u067E\u0631\u0648\u0646\u062F\u0647", level: "ADMIN", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_HR_WORK", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u06A9\u0627\u0631\u0647\u0627\u06CC \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC", level: "EDIT", prerequisites: ["HR_WORK_MANAGEMENT"] },
      { code: "MANAGE_COMPENSATION", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0648 \u062C\u0628\u0631\u0627\u0646 \u062E\u062F\u0645\u062A", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_PAYROLL", labelFa: "\u062B\u0628\u062A \u0648 \u062A\u0623\u06CC\u06CC\u062F \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u062D\u0642\u0648\u0642", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_COMPENSATION_AGREEMENTS", labelFa: "\u0627\u0646\u062A\u0634\u0627\u0631 \u062A\u0648\u0627\u0641\u0642 \u062C\u0628\u0631\u0627\u0646 \u062E\u062F\u0645\u062A", level: "ADMIN", prerequisites: [] },
      { code: "MANAGE_FINANCE_EVIDENCE", labelFa: "\u0645\u062C\u0648\u0632 \u0642\u062F\u06CC\u0645\u06CC \u0634\u0648\u0627\u0647\u062F \u0645\u0627\u0644\u06CC (\u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u062F\u0631 \u0627\u0633\u062A\u062E\u062F\u0627\u0645)", level: "EDIT", prerequisites: [] },
      { code: "REVIEW_IDENTITY_DOCUMENTS", labelFa: "\u062F\u0631\u06CC\u0627\u0641\u062A \u0648 \u062A\u0637\u0628\u06CC\u0642 \u0627\u0633\u0646\u0627\u062F \u0647\u0648\u06CC\u062A\u06CC", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_FULL_APPLICANT_INFORMATION"] },
      { code: "APPROVE_IDENTITY_CLEARANCE", labelFa: "\u062A\u0623\u06CC\u06CC\u062F \u0646\u0647\u0627\u06CC\u06CC \u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_FULL_APPLICANT_INFORMATION"] },
      { code: "RESOLVE_CANDIDATE_PERSONNEL_IDENTITY_CONFLICT", labelFa: "\u062A\u0639\u06CC\u06CC\u0646 \u062A\u06A9\u0644\u06CC\u0641 \u0645\u063A\u0627\u06CC\u0631\u062A \u0647\u0648\u06CC\u062A \u0645\u062A\u0642\u0627\u0636\u06CC \u0648 \u067E\u0631\u0633\u0646\u0644", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_FULL_APPLICANT_INFORMATION"] },
      { code: "RECORD_SIGNED_EMPLOYMENT_CONTRACT", labelFa: "\u062B\u0628\u062A \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u06A9\u0627\u063A\u0630\u06CC \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: [] },
      { code: "VERIFY_SIGNED_EMPLOYMENT_CONTRACT", labelFa: "\u0628\u0631\u0631\u0633\u06CC \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u06A9\u0627\u063A\u0630\u06CC \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: [] },
      { code: "MANAGE_COLLATERAL_REQUIREMENTS", labelFa: "\u062A\u0639\u06CC\u06CC\u0646 \u0627\u0644\u0632\u0627\u0645\u0627\u062A \u0648\u062B\u06CC\u0642\u0647 \u0645\u062A\u0642\u0627\u0636\u06CC", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "RECORD_COLLATERAL_CUSTODY", labelFa: "\u062B\u0628\u062A \u062F\u0631\u06CC\u0627\u0641\u062A \u0648 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0648\u062B\u06CC\u0642\u0647", level: "EDIT", prerequisites: [] },
      { code: "VERIFY_COLLATERAL_CUSTODY", labelFa: "\u0628\u0631\u0631\u0633\u06CC \u0648 \u062A\u0623\u06CC\u06CC\u062F \u0648\u062B\u06CC\u0642\u0647", level: "EDIT", prerequisites: [] }
    ]
  },
  {
    code: "FOUNDATION_ADMINISTRATION",
    labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0633\u0627\u062E\u062A\u0627\u0631 \u0633\u0627\u0632\u0645\u0627\u0646\u06CC",
    permissions: [
      { code: "PERMANENTLY_DELETE_ORGANIZATIONAL_FOUNDATION", labelFa: "\u062D\u0630\u0641 \u062F\u0627\u0626\u0645\u06CC \u0648\u0627\u062D\u062F\u060C \u0634\u063A\u0644 \u0648 \u062C\u0627\u06CC\u06AF\u0627\u0647", level: "ADMIN", prerequisites: ["ORGANIZATIONAL_STRUCTURE"] }
    ]
  },
  {
    code: "PERSONNEL_PERFORMANCE",
    labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F \u067E\u0631\u0633\u0646\u0644",
    permissions: PERFORMANCE_ACTION_PERMISSIONS
  }
];
var HR_ACTION_PERMISSIONS = HR_ACTION_PERMISSION_GROUPS.flatMap((group) => group.permissions);
var AUTHORIZABLE_HR_ACTION_PERMISSIONS = [...new Map([
  ...LEGACY_PERFORMANCE_ACTION_PERMISSIONS,
  ...HR_ACTION_PERMISSIONS
].map((permission2) => [permission2.code, permission2])).values()];
var definitions = new Map(AUTHORIZABLE_HR_ACTION_PERMISSIONS.map((permission2) => [permission2.code, permission2]));

// src/services/hrRedesignDataContracts.ts
var HR_REDESIGN_CATALOG = Object.freeze({
  contractVersion: 1,
  workspaceCode: "HUMAN_RESOURCES",
  workspaceFeatures: [
    { code: "DASHBOARD" },
    { code: "ORGANIZATIONAL_STRUCTURE" },
    { code: "PERSONNEL" },
    { code: "RECRUITMENT_CASES" },
    { code: "HR_WORK_MANAGEMENT" },
    { code: "AUTHORITY_RESPONSIBILITY_ADMINISTRATION" },
    { code: "DATA_MIGRATION_RECONCILIATION" },
    { code: "USER_ADMINISTRATION" },
    // HR-owned driver, vehicle and biometric capabilities use the same
    // effective-dated grant ledger as every other HR capability.
    { code: "hr_internal_drivers_view" },
    { code: "hr_internal_drivers_manage" },
    { code: "hr_vehicle_operations_view" },
    { code: "hr_vehicle_operations_manage" },
    { code: "hr_internal_driver_eligibility_manage" },
    { code: "hr_driver_biometric_audit_view" },
    { code: "hr_driver_biometric_enrollment_manage" },
    { code: "hr_driver_profiles_manage" },
    { code: "hr_company_vehicles_manage" },
    { code: "hr_vehicle_plates_manage" },
    { code: "hr_driver_vehicle_assignments_manage" },
    { code: "hr_vehicle_operations_audit_view" },
    ...HR_ACTION_PERMISSIONS.map(({ code }) => ({ code }))
  ],
  featureLevels: ["VIEW", "EDIT", "ADMIN"],
  businessAuthorities: [
    "HR_PROCESSOR",
    "HR_MANAGER",
    "COMPANY_MANAGER",
    "HR_PAYROLL_PROCESSOR",
    "HR_PAYROLL_MANAGER",
    "FINANCE_RECORDER",
    "FINANCE_MANAGER"
  ],
  responsibilityTypes: [
    "HR_PROCESSOR",
    "HR_MANAGER",
    "RESPONSIBLE_SUPERVISOR",
    "COMPANY_MANAGER",
    "HR_PAYROLL_PROCESSOR",
    "HR_PAYROLL_MANAGER",
    "FINANCE_RECORDER",
    "FINANCE_MANAGER"
  ],
  assessmentKinds: ["DISC", "EQ", "BIG_FIVE"],
  dutyEnvelopeVersion: 1
});
var everyFeatureAt = (level) => Object.fromEntries(
  HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => [code, level])
);
var HR_QA_ACCESS_MATRIX = Object.freeze({
  qa_no_hr_access: { workspaceLevel: null, features: {}, authority: null, responsibility: null, destinationWorkspace: null },
  qa_hr_viewer: { workspaceLevel: "VIEW", features: everyFeatureAt("VIEW"), authority: null, responsibility: null, destinationWorkspace: null },
  qa_finance_manager: { workspaceLevel: null, features: {}, authority: "FINANCE_MANAGER", responsibility: "FINANCE_MANAGER", destinationWorkspace: "ACCOUNTING" },
  qa_finance_recorder: { workspaceLevel: null, features: {}, authority: "FINANCE_RECORDER", responsibility: "FINANCE_RECORDER", destinationWorkspace: "ACCOUNTING" },
  qa_payroll_manager: {
    workspaceLevel: "EDIT",
    features: { DASHBOARD: "VIEW", PERSONNEL: "VIEW", RECRUITMENT_CASES: "VIEW", HR_WORK_MANAGEMENT: "EDIT" },
    authority: "HR_PAYROLL_MANAGER",
    responsibility: "HR_PAYROLL_MANAGER",
    destinationWorkspace: "HUMAN_RESOURCES"
  },
  qa_payroll_processor: {
    workspaceLevel: "EDIT",
    features: { DASHBOARD: "VIEW", PERSONNEL: "VIEW", RECRUITMENT_CASES: "EDIT", HR_WORK_MANAGEMENT: "EDIT" },
    authority: "HR_PAYROLL_PROCESSOR",
    responsibility: "HR_PAYROLL_PROCESSOR",
    destinationWorkspace: "HUMAN_RESOURCES"
  },
  qa_hr_manager: {
    workspaceLevel: "ADMIN",
    features: {
      PERSONNEL: "VIEW",
      RECRUITMENT_CASES: "VIEW",
      HR_WORK_MANAGEMENT: "VIEW",
      VIEW_INITIAL_INTERVIEW_CRITERIA: "VIEW",
      VIEW_INITIAL_INTERVIEW_REPORT: "VIEW",
      RECORD_PRELIMINARY_DECISION: "EDIT",
      MANAGE_INITIAL_INTERVIEW_CRITERIA: "ADMIN",
      ARCHIVE_RECRUITMENT_CASE: "ADMIN",
      MANAGE_HR_WORK: "EDIT",
      MANAGE_RECRUITMENT_CASE: "EDIT",
      MANAGE_PERSONNEL_SCHEDULE: "EDIT"
    },
    authority: "HR_MANAGER",
    responsibility: "HR_MANAGER",
    destinationWorkspace: "HUMAN_RESOURCES"
  },
  qa_hr_processor: {
    workspaceLevel: "EDIT",
    features: {
      DASHBOARD: "VIEW",
      ORGANIZATIONAL_STRUCTURE: "VIEW",
      PERSONNEL: "EDIT",
      RECRUITMENT_CASES: "EDIT",
      HR_WORK_MANAGEMENT: "EDIT",
      AUTHORITY_RESPONSIBILITY_ADMINISTRATION: "VIEW",
      DATA_MIGRATION_RECONCILIATION: "VIEW"
    },
    authority: "HR_PROCESSOR",
    responsibility: "HR_PROCESSOR",
    destinationWorkspace: "HUMAN_RESOURCES"
  }
});
var featureDisplayNames = {
  DASHBOARD: "Dashboard",
  ORGANIZATIONAL_STRUCTURE: "Organizational Structure",
  PERSONNEL: "Personnel",
  RECRUITMENT_CASES: "Recruitment Cases",
  HR_WORK_MANAGEMENT: "HR Work Management",
  AUTHORITY_RESPONSIBILITY_ADMINISTRATION: "Authority and Responsibility Administration",
  DATA_MIGRATION_RECONCILIATION: "Data Migration and Reconciliation",
  USER_ADMINISTRATION: "User Administration",
  hr_internal_drivers_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_internal_drivers_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_vehicle_operations_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_vehicle_operations_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_internal_driver_eligibility_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0635\u0644\u0627\u062D\u06CC\u062A \u0631\u0627\u0646\u0646\u062F\u0647 \u062F\u0627\u062E\u0644\u06CC",
  hr_driver_biometric_audit_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u0645\u06CC\u0632\u06CC \u0628\u06CC\u0648\u0645\u062A\u0631\u06CC\u06A9 \u0631\u0627\u0646\u0646\u062F\u0647",
  hr_driver_biometric_enrollment_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062B\u0628\u062A \u0628\u06CC\u0648\u0645\u062A\u0631\u06CC\u06A9 \u0631\u0627\u0646\u0646\u062F\u0647",
  hr_driver_profiles_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_company_vehicles_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062E\u0648\u062F\u0631\u0648\u0647\u0627\u06CC \u0634\u0631\u06A9\u062A",
  hr_vehicle_plates_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u0644\u0627\u06A9 \u062E\u0648\u062F\u0631\u0648\u0647\u0627",
  hr_driver_vehicle_assignments_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062A\u062E\u0635\u06CC\u0635 \u0631\u0627\u0646\u0646\u062F\u0647 \u0648 \u062E\u0648\u062F\u0631\u0648",
  hr_vehicle_operations_audit_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u0645\u06CC\u0632\u06CC \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  ...Object.fromEntries(HR_ACTION_PERMISSIONS.map(({ code, labelFa }) => [code, labelFa]))
};

// src/services/effectiveAuthorization/scopedActions.ts
var import_node_crypto = require("node:crypto");
async function resolveScopedActions(tx, actorId, domain) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
  const [version] = await tx.$queryRaw`
    SELECT revision FROM effective_authorization_state WHERE id = 1 FOR UPDATE`;
  return scopedActionSnapshot(tx, actorId, domain, version);
}
async function scopedActionSnapshot(tx, actorId, domain, version) {
  if (!version) throw new Error("Scoped authority state unavailable");
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  const rows = !actor?.isActive ? [] : await tx.$queryRaw`
    SELECT id, "principalKind", "principalId", domain, action, "rootKind", purpose, scope, effect, "boundRootId", "expiresAt"
    FROM effective_action_grants WHERE domain = ${domain} AND "revokedAt" IS NULL
      AND "effectiveFrom" <= clock_timestamp() AND ("expiresAt" IS NULL OR "expiresAt" > clock_timestamp())
      AND (("principalKind" = 'USER' AND "principalId" = ${actorId})
        OR ("principalKind" = 'ROLE' AND "principalId" = ${actor.role})) ORDER BY id`;
  const direct = new Set(rows.filter((row) => row.principalKind === "USER").map(key));
  const selected = rows.filter((row) => row.principalKind === "USER" || !direct.has(key(row)));
  const denied = new Set(selected.filter((row) => row.effect === "DENY").map(key));
  return { authorizationRevision: version.revision, grants: selected.filter((row) => row.effect === "ALLOW" && !denied.has(key(row))).map((row) => ({
    action: row.action,
    rootKind: row.rootKind,
    purpose: row.purpose,
    scope: row.scope,
    ...row.boundRootId ? { boundRootId: row.boundRootId } : {},
    ...row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {},
    provenance: {
      source: row.principalKind === "USER" ? "DIRECT_ACTION" : "ROLE_ACTION",
      grantId: row.id,
      version: 1
    }
  })) };
}
function key(row) {
  return JSON.stringify([row.action, row.rootKind, row.purpose]);
}
async function grantScopedAction(tx, authority, grant) {
  if (![grant.domain, grant.action, grant.rootKind, grant.purpose].every((value) => /^[A-Z][A-Z0-9_]{0,79}$/.test(value)) || !["USER", "ROLE"].includes(grant.principal.kind) || !grant.principal.id.trim() || grant.principal.id.length > 200 || !["OWN", "ASSIGNED", "DEPARTMENT", "COMPANY", "PURPOSE_BOUND"].includes(grant.scope) || !["ALLOW", "DENY"].includes(grant.effect) || (grant.scope === "PURPOSE_BOUND" ? !grant.boundRootId?.trim() : grant.boundRootId !== void 0) || grant.effectiveFrom && !Number.isFinite(grant.effectiveFrom.getTime()) || grant.expiresAt && !Number.isFinite(grant.expiresAt.getTime())) {
    throw new Error("Invalid scoped grant");
  }
  await mutationAuthority(tx, authority, grant.principal.kind === "USER" ? grant.principal.id : void 0);
  if (grant.principal.kind === "ROLE") {
    const roles = await tx.$queryRaw`SELECT unnest(enum_range(NULL::"UserRole"))::text AS role`;
    if (!roles.some((row) => row.role === grant.principal.id)) throw new Error("Invalid grant role");
  }
  const id = (0, import_node_crypto.randomUUID)();
  await tx.$executeRaw`INSERT INTO effective_action_grants
    (id, "principalKind", "principalId", "subjectUserId", domain, action, "rootKind", purpose, scope, effect,
      "boundRootId", "effectiveFrom", "expiresAt", "grantedBy", reason, "correlationId")
    VALUES (${id}, ${grant.principal.kind}, ${grant.principal.id}, ${grant.principal.kind === "USER" ? grant.principal.id : null},
      ${grant.domain}, ${grant.action}, ${grant.rootKind}, ${grant.purpose}, ${grant.scope}, ${grant.effect}, ${grant.boundRootId ?? null},
      COALESCE(${grant.effectiveFrom ?? null}::timestamp, clock_timestamp()), ${grant.expiresAt ?? null},
      ${authority.actorId}, ${authority.reason.trim()}, ${authority.correlationId})`;
  return { id };
}
async function mutationAuthority(tx, authority, subject) {
  if (!authority.reason.trim() || authority.reason.length > 2e3 || !authority.correlationId.trim() || authority.correlationId.length > 200) {
    throw new Error("Reason and correlation required");
  }
  for (const id of [.../* @__PURE__ */ new Set([authority.actorId, ...subject ? [subject] : []])].sort()) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  }
  const actor = await tx.user.findUnique({ where: { id: authority.actorId }, select: { role: true, isActive: true, partnerProfile: { select: { id: true } } } });
  if (!actor?.isActive || actor.role !== "ADMIN" || actor.partnerProfile) throw new Error("Scoped authority mutation forbidden");
  await tx.$queryRaw`SELECT revision FROM effective_authorization_state WHERE id = 1 FOR UPDATE`;
}
async function revokeScopedAction(tx, authority, grantId) {
  const [grant] = await tx.$queryRaw`
    SELECT "subjectUserId" FROM effective_action_grants WHERE id = ${grantId}`;
  await mutationAuthority(tx, authority, grant?.subjectUserId ?? void 0);
  if (!grant) return { found: false, changed: false };
  const changed = await tx.$executeRaw`UPDATE effective_action_grants SET "revokedAt" = clock_timestamp(),
    "revokedBy" = ${authority.actorId}, "revocationReason" = ${authority.reason.trim()},
    "revocationCorrelationId" = ${authority.correlationId} WHERE id = ${grantId} AND "revokedAt" IS NULL`;
  return { found: true, changed: changed === 1 };
}

// src/services/effectiveAccessService.ts
var EXPLICIT_FEATURES = /* @__PURE__ */ new Set([
  FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE,
  FEATURES.SALES_PARTNER_INQUIRIES_VIEW,
  FEATURES.SALES_PARTNER_INQUIRIES_RESPOND
]);
var ADMIN_WORKSPACES = ["sales", "crm", "hr", "accounting", "inventory", "security", "bi", "logistics"];
var HR_FEATURE_CODES = HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code);
var HR_ACTION_CODES = new Set(AUTHORIZABLE_HR_ACTION_PERMISSIONS.map(({ code }) => code));
var activeLegacyGrant = (grant, at) => grant.isActive && (!grant.expiresAt || grant.expiresAt > at);
var activeCanonicalGrant = (grant, at) => grant.status === "ACTIVE" && grant.effectiveFrom <= at && (!grant.effectiveTo || grant.effectiveTo > at);
var permission = (value) => value.toLowerCase();
var PERMISSION_RANK = { view: 1, edit: 2, admin: 3 };
var capAtWorkspaceLevel = (featureLevel, workspaceLevel) => {
  const featurePermission = permission(featureLevel);
  const workspacePermission = permission(workspaceLevel);
  return PERMISSION_RANK[featurePermission] <= PERMISSION_RANK[workspacePermission] ? featurePermission : workspacePermission;
};
var getEffectiveUserAccess = async (client2, input) => {
  if (input.userRole === "ADMIN") {
    const workspaces2 = ADMIN_WORKSPACES.map((workspace) => ({ workspace, permission: "admin" }));
    const features2 = [
      ...Object.entries(FEATURE_WORKSPACE_MAP).filter(([, workspace]) => workspace !== "hr").map(([feature, workspace]) => ({ feature, workspace, permission: "admin" })),
      ...HR_FEATURE_CODES.map((feature) => ({ feature, workspace: "hr", permission: "admin" }))
    ];
    return {
      workspaces: workspaces2,
      features: features2,
      provenance: {
        workspaces: workspaces2.map((grant) => ({ ...grant, source: "SYSTEM_ADMIN_OVERRIDE", grantId: null })),
        features: features2.map((grant) => ({ ...grant, source: "SYSTEM_ADMIN_OVERRIDE", grantId: null }))
      }
    };
  }
  const at = input.at ?? /* @__PURE__ */ new Date();
  const [
    directWorkspaces,
    roleWorkspaces,
    directFeatures,
    roleFeatures,
    canonicalHrWorkspaces,
    canonicalHrFeatures
  ] = await Promise.all([
    client2.workspacePermission.findMany({ where: { userId: input.userId, isActive: true } }),
    client2.roleWorkspacePermission.findMany({ where: { role: input.userRole, isActive: true } }),
    client2.featurePermission.findMany({ where: { userId: input.userId, isActive: true } }),
    client2.roleFeaturePermission.findMany({ where: { role: input.userRole, isActive: true } }),
    client2.hrWorkspaceAccessGrant.findMany({
      where: { userId: input.userId, workspaceCode: "HUMAN_RESOURCES" },
      orderBy: { effectiveFrom: "desc" }
    }),
    client2.hrFeatureAccessGrant.findMany({
      where: { userId: input.userId },
      orderBy: { effectiveFrom: "desc" }
    })
  ]);
  const activeDirect = directWorkspaces.filter((grant) => grant.workspace !== "hr" && activeLegacyGrant(grant, at));
  const directWorkspaceCodes = new Set(activeDirect.map((grant) => grant.workspace));
  const canonicalHr = canonicalHrWorkspaces.find((grant) => grant.reason !== "HR redesign baseline" && activeCanonicalGrant(grant, at));
  const inheritedHr = roleWorkspaces.find((grant) => grant.workspace === "hr" && activeLegacyGrant(grant, at));
  const workspaces = [
    ...activeDirect.map((grant) => ({ workspace: grant.workspace, permission: permission(grant.permissionLevel) })),
    ...canonicalHr ? [{ workspace: "hr", permission: permission(canonicalHr.level) }] : inheritedHr ? [{ workspace: "hr", permission: permission(inheritedHr.permissionLevel) }] : [],
    ...roleWorkspaces.filter((grant) => grant.workspace !== "hr" && !directWorkspaceCodes.has(grant.workspace) && activeLegacyGrant(grant, at)).map((grant) => ({ workspace: grant.workspace, permission: permission(grant.permissionLevel) }))
  ];
  const activeDirectFeatures = directFeatures.filter((grant) => grant.workspace !== "hr" && activeLegacyGrant(grant, at));
  const activeRoleFeatures = roleFeatures.filter((grant) => grant.workspace !== "hr" && activeLegacyGrant(grant, at));
  const nonHrFeatureCodes = /* @__PURE__ */ new Set([
    ...activeDirectFeatures.map((grant) => grant.feature),
    ...activeRoleFeatures.map((grant) => grant.feature),
    ...Object.entries(FEATURE_WORKSPACE_MAP).filter(([, workspace]) => workspace !== "hr" && (activeDirect.some((grant) => grant.workspace === workspace) || roleWorkspaces.some((grant) => grant.workspace === workspace && activeLegacyGrant(grant, at)))).map(([feature]) => feature)
  ]);
  const nonHrFeatures = [...nonHrFeatureCodes].flatMap((feature) => {
    const workspace = FEATURE_WORKSPACE_MAP[feature];
    if (!workspace || workspace === "hr") return [];
    const directFeature = activeDirectFeatures.find((grant) => grant.feature === feature);
    const directWorkspace = activeDirect.find((grant) => grant.workspace === workspace);
    const roleFeature = activeRoleFeatures.find((grant) => grant.feature === feature);
    const roleWorkspace = roleWorkspaces.find((grant) => grant.workspace === workspace && activeLegacyGrant(grant, at));
    if (EXPLICIT_FEATURES.has(feature)) {
      const explicit = directFeature ?? roleFeature;
      return explicit ? [{ feature, permission: permission(explicit.permissionLevel), workspace }] : [];
    }
    const effective = directWorkspace?.permissionLevel.toLowerCase() === "admin" ? directWorkspace : directFeature ?? directWorkspace ?? roleFeature ?? roleWorkspace;
    return effective ? [{ feature, permission: permission(effective.permissionLevel), workspace }] : [];
  });
  const effectiveHrWorkspaceLevel = canonicalHr?.level ?? inheritedHr?.permissionLevel;
  const broadManagerOverride = input.userRole === "MANAGER" && effectiveHrWorkspaceLevel?.toUpperCase() === "ADMIN";
  const activeCanonicalFeatures = canonicalHrFeatures.filter((grant) => grant.reason !== "HR redesign baseline" && activeCanonicalGrant(grant, at));
  const directHrFeatures = /* @__PURE__ */ new Map();
  for (const grant of activeCanonicalFeatures) {
    if (!directHrFeatures.has(grant.featureCode)) directHrFeatures.set(grant.featureCode, grant);
  }
  const inheritedHrFeatures = roleFeatures.filter((grant) => grant.workspace === "hr" && activeLegacyGrant(grant, at));
  const hrFeatureCodes = /* @__PURE__ */ new Set([
    ...directHrFeatures.keys(),
    ...inheritedHrFeatures.map((grant) => grant.feature)
  ]);
  const independentActionFeatures = activeCanonicalFeatures.filter((grant) => HR_ACTION_CODES.has(grant.featureCode)).map((grant) => ({ feature: grant.featureCode, permission: permission(grant.level), workspace: "hr" }));
  const hrFeatures = !effectiveHrWorkspaceLevel ? independentActionFeatures : broadManagerOverride ? HR_FEATURE_CODES.map((feature) => ({
    feature,
    permission: "admin",
    workspace: "hr"
  })) : [...hrFeatureCodes].map((feature) => {
    const direct = directHrFeatures.get(feature);
    const inherited = inheritedHrFeatures.find((grant) => grant.feature === feature);
    const resolvedLevel = direct?.level ?? inherited.permissionLevel;
    return {
      feature,
      // Action permissions are independently scoped authorization. A VIEW
      // workspace grant admits the user to the destination without reducing
      // an explicitly granted EDIT action to VIEW.
      permission: HR_ACTION_CODES.has(feature) ? permission(resolvedLevel) : capAtWorkspaceLevel(resolvedLevel, effectiveHrWorkspaceLevel),
      workspace: "hr"
    };
  });
  const features = [...nonHrFeatures, ...hrFeatures];
  const workspaceProvenance = workspaces.map((grant) => {
    if (grant.workspace === "hr") {
      return {
        ...grant,
        source: canonicalHr ? "CANONICAL_HR_WORKSPACE" : "ROLE_WORKSPACE",
        grantId: canonicalHr?.id ?? inheritedHr?.id ?? null
      };
    }
    const direct = activeDirect.find((candidate) => candidate.workspace === grant.workspace);
    const inherited = roleWorkspaces.find((candidate) => candidate.workspace === grant.workspace && activeLegacyGrant(candidate, at));
    return {
      ...grant,
      source: direct ? "DIRECT_WORKSPACE" : "ROLE_WORKSPACE",
      grantId: direct?.id ?? inherited?.id ?? null
    };
  });
  const featureProvenance = features.map((grant) => {
    if (grant.workspace === "hr") {
      if (broadManagerOverride) return { ...grant, source: "HR_MANAGER_OVERRIDE", grantId: canonicalHr?.id ?? null };
      const direct = directHrFeatures.get(grant.feature);
      const inherited = inheritedHrFeatures.find((candidate) => candidate.feature === grant.feature);
      return {
        ...grant,
        source: direct ? "CANONICAL_HR_FEATURE" : "ROLE_FEATURE",
        grantId: direct?.id ?? inherited?.id ?? null
      };
    }
    const directFeature = activeDirectFeatures.find((candidate) => candidate.feature === grant.feature);
    const directWorkspace = activeDirect.find((candidate) => candidate.workspace === grant.workspace);
    const roleFeature = activeRoleFeatures.find((candidate) => candidate.feature === grant.feature);
    const roleWorkspace = roleWorkspaces.find((candidate) => candidate.workspace === grant.workspace && activeLegacyGrant(candidate, at));
    if (EXPLICIT_FEATURES.has(grant.feature)) {
      return { ...grant, source: directFeature ? "DIRECT_FEATURE" : "ROLE_FEATURE", grantId: directFeature?.id ?? roleFeature?.id ?? null };
    }
    if (directWorkspace?.permissionLevel.toLowerCase() === "admin") {
      return { ...grant, source: "DIRECT_WORKSPACE", grantId: directWorkspace.id };
    }
    if (directFeature) return { ...grant, source: "DIRECT_FEATURE", grantId: directFeature.id };
    if (directWorkspace) return { ...grant, source: "DIRECT_WORKSPACE", grantId: directWorkspace.id };
    if (roleFeature) return { ...grant, source: "ROLE_FEATURE", grantId: roleFeature.id };
    return { ...grant, source: "ROLE_WORKSPACE", grantId: roleWorkspace?.id ?? null };
  });
  return { workspaces, features, provenance: { workspaces: workspaceProvenance, features: featureProvenance } };
};

// src/services/partnerSales/accounting/capabilities.ts
async function readPartnerCommercialAccountingCapabilities(tx, actorId) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return { view: false, paper: false };
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const workspace = effective.workspaces.find((row) => row.workspace === "accounting")?.permission;
  const view = ["view", "edit", "admin"].includes(workspace || "") && (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role, workspace: "accounting", feature: "accounting_contracts_view", requiredPermission: "view" })).allowed;
  const paper = view && ["edit", "admin"].includes(workspace || "") && (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role, workspace: "accounting", feature: "accounting_actions_manage", requiredPermission: "edit" })).allowed;
  return { view, paper };
}

// src/services/partnerSales/authorization/workspaceAuthority.ts
var rank = { view: 1, edit: 2, admin: 3 };
async function resolvePartnerWorkspaceAuthority(tx, actorId) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, isActive: true, partnerProfile: { select: { id: true } } }
  });
  if (!actor?.isActive || actor.partnerProfile) {
    return { isSystemAdmin: false, canViewAssigned: false, canRespondAssigned: false, canManageInquiries: false, grants: [] };
  }
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const level = (feature) => effective.features.find((item) => item.feature === feature)?.permission;
  const atLeast = (feature, required) => {
    const actual = level(feature);
    return Boolean(actual && rank[actual] >= rank[required]);
  };
  const isSystemAdmin = actor.role === "ADMIN";
  const canViewAssigned = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_INQUIRIES_VIEW, "view");
  const canRespondAssigned = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_INQUIRIES_RESPOND, "edit");
  const canManageInquiries = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_SELLERS_MANAGE, "admin");
  const grants = [];
  const add = (grant) => {
    if (!grants.some((item) => item.action === grant.action && item.rootKind === grant.rootKind && item.purpose === grant.purpose && item.scope === grant.scope)) grants.push(grant);
  };
  if ((await readPartnerCommercialAccountingCapabilities(tx, actorId)).view) {
    add({ action: "ACCOUNTING_READ", rootKind: "CASE", purpose: "ACCOUNTING", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast(FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE, "edit")) {
    add({ action: "CUSTOMER_READ", rootKind: "CUSTOMER", purpose: "CRM", scope: "COMPANY" });
    add({ action: "CUSTOMER_TRANSFER_DECIDE", rootKind: "CUSTOMER", purpose: "CRM", scope: "COMPANY" });
  }
  if (canViewAssigned) {
    add({ action: "INQUIRY_READ", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "ASSIGNED" });
  }
  if (canRespondAssigned) {
    add({ action: "INQUIRY_RESPOND", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "ASSIGNED" });
  }
  if (canManageInquiries) {
    add({ action: "INQUIRY_READ", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "COMPANY" });
    add({ action: "INQUIRY_RESPOND", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "COMPANY" });
    add({ action: "PROFILE_READ", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
    add({ action: "COMMERCIAL_TERMS_MANAGE", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "RESPONDER_ASSIGN", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "RESPONDER_REASSIGN", rootKind: "INQUIRY", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "PROFILE_CONVERSION_MANAGE", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast("VERIFY_PARTNER_IDENTITY", "edit")) {
    add({ action: "PROFILE_READ", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
    add({ action: "IDENTITY_VERIFY", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast(FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE, "edit")) {
    add({ action: "PROFILE_READ", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
    add({ action: "COMMERCIAL_TERMS_MANAGE", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "CREDIT_TERMS_MANAGE", rootKind: "PROFILE", purpose: "ACCOUNTING", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast(FEATURES.BI_PARTNER_REPORTS_VIEW, "view")) {
    add({ action: "REPORT_READ", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "REPORT_READ", rootKind: "CASE", purpose: "MANAGEMENT", scope: "COMPANY" });
  }
  return { isSystemAdmin, canViewAssigned, canRespondAssigned, canManageInquiries, grants };
}

// src/services/partnerSales/authorization/centralAuthority.ts
var resolvePartnerScopedAuthority = async (tx, input) => {
  const current = await resolveScopedActions(tx, input.actorId, "PARTNER");
  const workspace = await resolvePartnerWorkspaceAuthority(tx, input.actorId);
  const grants = [];
  for (const grant of current.grants) {
    const action = import_partner_sales_contracts.PartnerActionV2Schema.safeParse(grant.action);
    const kind = import_partner_sales_contracts.PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = import_partner_sales_contracts.PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success) grants.push({ ...grant, action: action.data, rootKind: kind.data, purpose: purpose.data });
  }
  for (const grant of workspace.grants) {
    if (grant.action === "ACCOUNTING_READ") {
      const explicit = await tx.$queryRaw`
        SELECT g.id FROM effective_action_grants g JOIN users u ON u.id = ${input.actorId}
        WHERE g.domain = 'PARTNER' AND g.action = 'ACCOUNTING_READ'
          AND g."rootKind" = 'CASE' AND g.purpose = 'ACCOUNTING' AND g."revokedAt" IS NULL
          AND g."effectiveFrom" <= clock_timestamp()
          AND (g."expiresAt" IS NULL OR g."expiresAt" > clock_timestamp())
          AND ((g."principalKind" = 'USER' AND g."principalId" = u.id)
            OR (g."principalKind" = 'ROLE' AND g."principalId" = u.role::text)) LIMIT 1`;
      if (explicit.length) continue;
    }
    const action = import_partner_sales_contracts.PartnerActionV2Schema.safeParse(grant.action);
    const kind = import_partner_sales_contracts.PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = import_partner_sales_contracts.PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success && !grants.some((item) => item.action === action.data && item.rootKind === kind.data && item.purpose === purpose.data && item.scope === grant.scope)) {
      grants.push({ action: action.data, rootKind: kind.data, purpose: purpose.data, scope: grant.scope });
    }
  }
  return { authorizationRevision: current.authorizationRevision, grants };
};

// ../reports/qa/server-response-20261011/latest-accounting-bridge.ts
var url = new URL(process.env.DATABASE_URL);
import_strict.default.equal(url.hostname, "postgres");
import_strict.default.equal(url.pathname, "/sabalanerp");
var client = new import_client2.PrismaClient();
var rollback = new Error("ROLLBACK_BRIDGE_RELEASE_QA");
async function main() {
  try {
    await import_strict.default.rejects(client.$transaction(async (tx) => {
      const runId = (0, import_node_crypto2.randomUUID)();
      const actorId = `qa-view-${runId}`, adminId = `qa-admin-${runId}`;
      for (const [id, role] of [[actorId, "USER"], [adminId, "ADMIN"]])
        await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`, password: "not-login", firstName: "QA", lastName: "Bridge", role } });
      await tx.workspacePermission.create({ data: { userId: actorId, workspace: "accounting", permissionLevel: "view" } });
      await tx.featurePermission.create({ data: { userId: actorId, workspace: "accounting", feature: "accounting_contracts_view", permissionLevel: "view", grantedBy: adminId } });
      const authority = { actorId: adminId, reason: "isolated bridge release QA", correlationId: runId };
      const read = () => resolvePartnerScopedAuthority(tx, { actorId, root: { kind: "CASE", id: "case-A" } });
      const bridged = await read();
      import_strict.default.ok(bridged.grants.some((row) => row.action === "ACCOUNTING_READ" && row.scope === "COMPANY"));
      import_strict.default.equal(bridged.grants.some((row) => row.action === "ACCOUNTING_WRITE"), false);
      const denied = await grantScopedAction(tx, authority, { principal: { kind: "USER", id: actorId }, domain: "PARTNER", action: "ACCOUNTING_READ", rootKind: "CASE", purpose: "ACCOUNTING", scope: "COMPANY", effect: "DENY" });
      import_strict.default.equal((await read()).grants.some((row) => row.action === "ACCOUNTING_READ"), false);
      await revokeScopedAction(tx, authority, denied.id);
      await grantScopedAction(tx, authority, { principal: { kind: "USER", id: actorId }, domain: "PARTNER", action: "ACCOUNTING_READ", rootKind: "CASE", purpose: "ACCOUNTING", scope: "PURPOSE_BOUND", boundRootId: "case-A", effect: "ALLOW" });
      const narrowed = (await read()).grants.filter((row) => row.action === "ACCOUNTING_READ");
      import_strict.default.equal(narrowed.length, 1);
      import_strict.default.equal(narrowed[0].scope, "PURPOSE_BOUND");
      import_strict.default.equal(narrowed[0].boundRootId, "case-A");
      throw rollback;
    }, { timeout: 3e4 }), (error) => error === rollback);
    console.log("PASS: read-only bridge, no write grant, explicit denial and narrower scope; all fixture writes rolled back");
  } finally {
    await client.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.name + ": " + error.message);
  process.exitCode = 1;
});
