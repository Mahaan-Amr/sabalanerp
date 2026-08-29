import type { PartnerAction, PartnerActionV2, PermissionContext } from '@sabalanerp/partner-sales-contracts';

type Capability = readonly [PermissionContext['root']['kind'], PermissionContext['purpose']];
/** Approved fixed bundle (#309), not configurable feature grants. */
export const partnerCapabilities: Partial<Record<PartnerAction, readonly Capability[]>> = {
  PROFILE_READ: [['PROFILE', 'ONBOARDING']],
  CUSTOMER_READ: [['CUSTOMER', 'CRM']], CUSTOMER_WRITE: [['CUSTOMER', 'CRM']],
  INQUIRY_READ: [['INQUIRY', 'PARTNER']],
  // The first inquiry does not exist yet, so creation is authorized against
  // the owning Profile. Existing inquiry mutations remain rooted in Inquiry.
  INQUIRY_WRITE: [['INQUIRY', 'PARTNER'], ['PROFILE', 'PARTNER']],
  // Before Case creation the creator-private technical draft is rooted in the
  // owning Profile. This never grants another actor access to a recovery id.
  CASE_READ: [['CASE', 'PARTNER'], ['PROFILE', 'PARTNER']],
  CASE_DRAFT_WRITE: [['CASE', 'PARTNER'], ['PROFILE', 'PARTNER']],
  // The Case does not exist at final submission time, so creation is rooted in
  // the already-authorized Profile. Existing Case mutations remain Case-rooted.
  CASE_SUBMIT: [['CASE', 'PARTNER'], ['PROFILE', 'PARTNER']],
  CASE_CANCEL: [['CASE', 'PARTNER']], CUSTOMER_OUTPUT: [['CASE', 'CUSTOMER_OUTPUT']],
  // Permission to execute the signed/printed command, not a lifecycle bypass.
  CASE_COMMIT: [['CASE', 'PARTNER']],
  RETAIL_COLLECTION_WRITE: [['CASE', 'PARTNER']], CORRECTION_REQUEST: [['CASE', 'PARTNER']],
  RETAIL_CORRECTION_SAVE: [['CASE', 'PARTNER']], VOID_REQUEST: [['CASE', 'PARTNER']],
  ACCOUNTING_READ: [['PROFILE', 'PARTNER']], FULFILLMENT_READ: [['CASE', 'PARTNER']],
  REPORT_READ: [['PROFILE', 'PARTNER'], ['CASE', 'PARTNER']],
};

export const internalCapabilities: Partial<Record<PartnerAction, readonly Capability[]>> = {
  PROFILE_READ: [['PROFILE', 'ONBOARDING']], IDENTITY_VERIFY: [['PROFILE', 'ONBOARDING']],
  PROFILE_CREATE: [['PROFILE', 'ONBOARDING']], PROFILE_ACTIVATE: [['PROFILE', 'ONBOARDING']],
  PROFILE_SUSPEND: [['PROFILE', 'ONBOARDING']], PROFILE_TERMINATE: [['PROFILE', 'ONBOARDING']],
  RESPONDER_ASSIGN: [['PROFILE', 'MANAGEMENT']], RESPONDER_REASSIGN: [['INQUIRY', 'MANAGEMENT']],
  CUSTOMER_READ: [['CUSTOMER', 'CRM']], CUSTOMER_TRANSFER_DECIDE: [['CUSTOMER', 'CRM']],
  INQUIRY_READ: [['INQUIRY', 'RESPONDER'], ['INQUIRY', 'MANAGEMENT']],
  ACCOUNTING_READ: [['CASE', 'ACCOUNTING']], ACCOUNTING_WRITE: [['CASE', 'ACCOUNTING']],
  FULFILLMENT_READ: [['CASE', 'FULFILLMENT']], FULFILLMENT_WRITE: [['CASE', 'FULFILLMENT']],
  CASE_READ: [['CASE', 'MANAGEMENT']], CASE_CANCEL: [['CASE', 'MANAGEMENT']],
  CASE_COMMIT: [['CASE', 'MANAGEMENT']], CUSTOMER_OUTPUT: [['CASE', 'CUSTOMER_OUTPUT']],
  CORRECTION_SCOPE_APPROVE: [['CASE', 'MANAGEMENT']], INTERNAL_REMEDIATION: [['CASE', 'MANAGEMENT']],
  CREDIT_TERMS_MANAGE: [['PROFILE', 'ACCOUNTING']], FINANCIAL_VERIFY: [['CASE', 'ACCOUNTING']],
  REPORT_READ: [['PROFILE', 'MANAGEMENT'], ['CASE', 'MANAGEMENT'], ['PROFILE', 'ACCOUNTING'], ['CASE', 'ACCOUNTING']],
  AUDIT_READ: [['PROFILE', 'AUDIT'], ['CUSTOMER', 'AUDIT'], ['INQUIRY', 'AUDIT'], ['CASE', 'AUDIT']],
  OPERATIONS_MANAGE: [['PROFILE', 'OPERATIONS']],
  INQUIRY_RESPOND: [['INQUIRY', 'RESPONDER']],
  FINANCIAL_PROCESS: [['CASE', 'ACCOUNTING']], FINANCIAL_APPROVE: [['CASE', 'ACCOUNTING']],
  VOID_REMEDIATION_REQUEST: [['CASE', 'MANAGEMENT']],
};

export const internalCapabilitiesV2: Partial<Record<PartnerActionV2, readonly Capability[]>> = {
  ...internalCapabilities,
  COMMERCIAL_TERMS_MANAGE: [['PROFILE', 'MANAGEMENT']],
  PROFILE_CONVERSION_MANAGE: [['PROFILE', 'MANAGEMENT']],
};

export const readActions: ReadonlySet<PartnerActionV2> = new Set([
  'PROFILE_READ', 'CUSTOMER_READ', 'INQUIRY_READ', 'CASE_READ', 'CUSTOMER_OUTPUT',
  'ACCOUNTING_READ', 'FULFILLMENT_READ', 'REPORT_READ', 'AUDIT_READ',
]);
