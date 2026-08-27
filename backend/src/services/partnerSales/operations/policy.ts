import { CaseState, ContractRuntime, OperationsState, PartnerAction, PartnerCommand, PermissionContext } from './contracts';
import { assessReadiness, ReadinessCheck } from './readiness';

export type Operation = PartnerAction | 'COHORT_ENROLL' | 'RECOVERY_WRITE' | 'CUSTOMER_CONFIRMATION_SEND' | 'CUSTOMER_OTP_VERIFY' | 'SHARED_CORRECTION_SAVE';
export function requiresReadiness(operation: Operation): boolean {
  return ['COHORT_ENROLL', 'PROFILE_ACTIVATE', 'CASE_SUBMIT', 'CASE_COMMIT'].includes(operation);
}
type Category = 'READ' | 'ENROLL' | 'MUTATE' | 'CONTROL' | 'REMEDIATE' | 'CANCEL';
const categories: Record<PartnerAction, Category> = {
  PROFILE_READ: 'READ', PROFILE_CREATE: 'MUTATE', IDENTITY_VERIFY: 'MUTATE', PROFILE_ACTIVATE: 'ENROLL',
  PROFILE_SUSPEND: 'MUTATE', PROFILE_TERMINATE: 'MUTATE', CUSTOMER_READ: 'READ', CUSTOMER_WRITE: 'MUTATE',
  CUSTOMER_TRANSFER_DECIDE: 'MUTATE', INQUIRY_READ: 'READ', INQUIRY_WRITE: 'MUTATE', INQUIRY_RESPOND: 'MUTATE',
  RESPONDER_ASSIGN: 'MUTATE', RESPONDER_REASSIGN: 'MUTATE', CASE_READ: 'READ', CASE_DRAFT_WRITE: 'MUTATE',
  CASE_SUBMIT: 'MUTATE', CASE_COMMIT: 'MUTATE', CASE_CANCEL: 'CANCEL', CUSTOMER_OUTPUT: 'READ',
  RETAIL_COLLECTION_WRITE: 'MUTATE', CORRECTION_REQUEST: 'MUTATE', RETAIL_CORRECTION_SAVE: 'MUTATE',
  CORRECTION_SCOPE_APPROVE: 'MUTATE', FINANCIAL_PROCESS: 'MUTATE', FINANCIAL_APPROVE: 'MUTATE', FINANCIAL_VERIFY: 'MUTATE',
  VOID_REQUEST: 'MUTATE', VOID_REMEDIATION_REQUEST: 'REMEDIATE', INTERNAL_REMEDIATION: 'REMEDIATE',
  CREDIT_TERMS_MANAGE: 'MUTATE', ACCOUNTING_READ: 'READ', ACCOUNTING_WRITE: 'MUTATE', FULFILLMENT_READ: 'READ',
  FULFILLMENT_WRITE: 'MUTATE', REPORT_READ: 'READ', AUDIT_READ: 'READ', OPERATIONS_MANAGE: 'CONTROL',
};
const extraActions: Record<Exclude<Operation, PartnerAction>, PartnerAction> = {
  COHORT_ENROLL: 'OPERATIONS_MANAGE', RECOVERY_WRITE: 'CASE_DRAFT_WRITE', CUSTOMER_CONFIRMATION_SEND: 'CUSTOMER_OUTPUT',
  CUSTOMER_OTP_VERIFY: 'CUSTOMER_OUTPUT', SHARED_CORRECTION_SAVE: 'RETAIL_CORRECTION_SAVE',
};

/** Map the parsed command to its actual port; never infer this from HTTP labels. */
export function operationForCommand(command: PartnerCommand): Operation {
  if (command.type === 'PROFILE_TRANSITION') return { ACTIVE: 'PROFILE_ACTIVATE', SUSPENDED: 'PROFILE_SUSPEND', TERMINATED: 'PROFILE_TERMINATE' }[command.to] as Operation;
  if (command.type === 'CORRECTION_GATE') return {
    SALES_SCOPE: 'CORRECTION_SCOPE_APPROVE', ACCOUNTING_PROCESS: 'FINANCIAL_PROCESS', ACCOUNTING_MANAGER: 'FINANCIAL_APPROVE',
    ACCOUNTING_VERIFY: 'FINANCIAL_VERIFY', CUSTOMER_CONFIRM: 'CUSTOMER_OTP_VERIFY',
  }[command.gate] as Operation;
  const commands: Record<Exclude<PartnerCommand['type'], 'PROFILE_TRANSITION' | 'CORRECTION_GATE'>, Operation> = {
    CASE_SUBMIT: 'CASE_SUBMIT', CASE_DRAFT_REVISE: 'CASE_DRAFT_WRITE', CASE_CANCEL: 'CASE_CANCEL', CASE_COMMIT: 'CASE_COMMIT',
    CUSTOMER_CONFIRMATION_SEND: 'CUSTOMER_CONFIRMATION_SEND', INQUIRY_SUBMIT: 'INQUIRY_WRITE', INQUIRY_DECIDE: 'INQUIRY_RESPOND',
    INQUIRY_CANCEL: 'INQUIRY_WRITE', INQUIRY_REASSIGN: 'RESPONDER_REASSIGN', CORRECTION_REQUEST: 'CORRECTION_REQUEST',
    RETAIL_CORRECTION_SAVE: 'RETAIL_CORRECTION_SAVE', SHARED_CORRECTION_SAVE: 'SHARED_CORRECTION_SAVE', VOID_REMEDIATION_REQUEST: 'VOID_REMEDIATION_REQUEST',
    RETAIL_RECEIPT: 'RETAIL_COLLECTION_WRITE', RETAIL_RECEIPT_REVERSE: 'RETAIL_COLLECTION_WRITE',
    CUSTOMER_TRANSFER_DECIDE: 'CUSTOMER_TRANSFER_DECIDE', OPERATIONS_PAUSE: 'OPERATIONS_MANAGE',
  };
  return commands[command.type];
}

export function initialOperationsState(): OperationsState {
  return { revision: 1, enrollmentPaused: true, operationalPaused: true, cohort: null };
}

export interface GateInput {
  operation: Operation;
  permission: PermissionContext;
  caseState?: CaseState;
  integrityVerified?: boolean;
  readiness?: ReadinessCheck;
}

/** Denial-only guard. A null result is never a substitute for central authorization. */
export function checkOperationsGate(contract: ContractRuntime, state: OperationsState, input: GateInput) {
  if (!state || !contract.RevisionSchema.safeParse(state.revision).success || typeof state.enrollmentPaused !== 'boolean' ||
    typeof state.operationalPaused !== 'boolean' || (state.cohort !== null && (!state.cohort || typeof state.cohort.name !== 'string' ||
      !contract.IdSchema.safeParse(state.cohort.id).success || !Array.isArray(state.cohort.sellerIds) ||
      !state.cohort.sellerIds.every(id => contract.IdSchema.safeParse(id).success)))) return contract.partnerError('INTEGRITY_CONFLICT');
  const action = extraActions[input.operation as keyof typeof extraActions] ?? input.operation as PartnerAction;
  if (!contract.PartnerActionSchema.safeParse(action).success) return contract.partnerError('INVALID_PAYLOAD');
  const denial = contract.checkPartnerDomainRestrictions(action, input.permission);
  if (denial) return denial;
  const category = input.operation === 'COHORT_ENROLL' ? 'ENROLL'
    : Object.prototype.hasOwnProperty.call(extraActions, input.operation) ? 'MUTATE' : categories[action];
  if (category === 'READ') return null;
  const internal = input.permission.persona === 'INTERNAL';
  if (internal && input.permission.purpose === 'ONBOARDING' &&
    ['PROFILE_CREATE', 'IDENTITY_VERIFY', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE'].includes(input.operation)) return null;
  if (category === 'CONTROL') return internal && input.permission.purpose === 'OPERATIONS' ? null : contract.partnerError('FORBIDDEN');
  if (category === 'REMEDIATE') return internal ? null : contract.partnerError('FORBIDDEN');
  if (internal && category === 'CANCEL' && input.permission.purpose === 'MANAGEMENT') return null;
  if (input.permission.persona === 'PARTNER' && input.permission.partnerStatus !== 'ACTIVE') return contract.partnerError('PARTNER_NOT_ACTIVE');
  if (category === 'ENROLL' && state.enrollmentPaused) return contract.partnerError('COHORT_NOT_READY');
  // A committed predecessor must not unlock an uncommitted correction successor.
  const committedOperation = ['ACCOUNTING_WRITE', 'FULFILLMENT_WRITE', 'FINANCIAL_PROCESS', 'FINANCIAL_APPROVE', 'FINANCIAL_VERIFY', 'RETAIL_COLLECTION_WRITE'].includes(input.operation);
  if (committedOperation && (input.caseState === 'COMMITTED' || input.caseState === 'VOIDED')) {
    return input.integrityVerified === true ? null : contract.partnerError('INTEGRITY_CONFLICT');
  }
  if (state.operationalPaused) return contract.partnerError('OPERATIONAL_PAUSE');
  if (category !== 'ENROLL' && input.permission.partnerStatus !== 'ACTIVE') return contract.partnerError('PARTNER_NOT_ACTIVE');
  if (!state.cohort?.name.trim() || (input.operation !== 'COHORT_ENROLL' && !state.cohort.sellerIds.includes(input.permission.partnerSellerId))) return contract.partnerError('COHORT_NOT_READY');
  if (requiresReadiness(input.operation)) {
    if (!input.readiness || !assessReadiness(contract, input.readiness.evidence, input.readiness.current)) return contract.partnerError('COHORT_NOT_READY');
  }
  return null;
}
