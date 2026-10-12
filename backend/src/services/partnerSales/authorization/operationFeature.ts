import type { PartnerActionV2, PermissionContext } from '@sabalanerp/partner-sales-contracts';

/** Only equivalent operation controls are mapped. Scope, assignment and the
 * fixed Partner self-service bundle never become grants through this map. */
export function partnerOperationFeature(action: PartnerActionV2, purpose: PermissionContext['purpose']): string | undefined {
  if (purpose === 'PARTNER') return ({
    CASE_READ: 'sales_contracts_view', CASE_DRAFT_WRITE: 'sales_contracts_edit',
    CASE_SUBMIT: 'sales_contracts_create', CASE_CANCEL: 'sales_contracts_reject',
    CASE_COMMIT: 'sales_contracts_sign', RETAIL_CORRECTION_SAVE: 'sales_contracts_edit',
  } as Partial<Record<PartnerActionV2, string>>)[action];
  return ({
    INQUIRY_READ: 'sales_partner_inquiries_view', INQUIRY_RESPOND: 'sales_partner_inquiries_respond',
    CUSTOMER_TRANSFER_DECIDE: 'crm_partner_customer_transfers_manage',
    FINANCIAL_PROCESS: 'accounting_corrections_manage', FINANCIAL_APPROVE: 'accounting_corrections_approve',
    FINANCIAL_VERIFY: 'accounting_corrections_verify', IDENTITY_VERIFY: 'VERIFY_PARTNER_IDENTITY',
    CREDIT_TERMS_MANAGE: 'accounting_partner_terms_manage', REPORT_READ: 'bi_partner_reports_view',
    RESPONDER_ASSIGN: 'sales_partner_sellers_manage', RESPONDER_REASSIGN: 'sales_partner_sellers_manage',
    PROFILE_CONVERSION_MANAGE: 'sales_partner_sellers_manage',
  } as Partial<Record<PartnerActionV2, string>>)[action];
}
