import { z } from 'zod';
import { IdSchema, InstantSchema, RevisionSchema } from './primitives';
import { PartnerError, partnerError, Result } from './errors';

export const PartnerActionSchema = z.enum([
  'PROFILE_READ', 'PROFILE_CREATE', 'IDENTITY_VERIFY', 'PROFILE_ACTIVATE', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE',
  'CUSTOMER_READ', 'CUSTOMER_WRITE', 'CUSTOMER_TRANSFER_DECIDE', 'INQUIRY_READ', 'INQUIRY_WRITE', 'INQUIRY_RESPOND',
  'RESPONDER_ASSIGN', 'RESPONDER_REASSIGN', 'CASE_READ', 'CASE_DRAFT_WRITE', 'CASE_SUBMIT', 'CASE_COMMIT', 'CASE_CANCEL',
  'CUSTOMER_OUTPUT', 'RETAIL_COLLECTION_WRITE', 'CORRECTION_REQUEST', 'RETAIL_CORRECTION_SAVE',
  'CORRECTION_SCOPE_APPROVE', 'FINANCIAL_PROCESS', 'FINANCIAL_APPROVE', 'FINANCIAL_VERIFY',
  'VOID_REQUEST', 'VOID_REMEDIATION_REQUEST', 'INTERNAL_REMEDIATION', 'CREDIT_TERMS_MANAGE',
  'ACCOUNTING_READ', 'ACCOUNTING_WRITE', 'FULFILLMENT_READ', 'FULFILLMENT_WRITE', 'REPORT_READ', 'AUDIT_READ', 'OPERATIONS_MANAGE',
]);
export const PermissionContextSchema = z.object({
  actorId: IdSchema, persona: z.enum(['PARTNER', 'INTERNAL', 'PUBLIC']), isAdmin: z.boolean(),
  partnerSellerId: IdSchema, partnerStatus: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']),
  root: z.object({ kind: z.enum(['PROFILE', 'CUSTOMER', 'INQUIRY', 'CASE']), id: IdSchema }).strict(),
  purpose: z.enum(['ONBOARDING', 'CRM', 'PARTNER', 'RESPONDER', 'CUSTOMER_OUTPUT', 'ACCOUNTING', 'FULFILLMENT', 'MANAGEMENT', 'AUDIT', 'OPERATIONS']),
  channel: z.enum(['LIST', 'DETAIL', 'SEARCH', 'COUNT', 'EXPORT', 'NOTIFICATION', 'PDF', 'PUBLIC', 'LINK', 'API']),
  scope: z.enum(['OWN', 'ASSIGNED', 'DEPARTMENT', 'COMPANY', 'PURPOSE_BOUND']),
  departmentId: IdSchema.optional(), resourceVisible: z.boolean(), actionGranted: z.boolean(),
  authorizationRevision: RevisionSchema, lifecycleRevision: RevisionSchema, evaluatedAt: InstantSchema,
  grantExpiresAt: InstantSchema.optional(), requesterId: IdSchema.optional(),
  assignment: z.object({ actorId: IdSchema, eligible: z.boolean(), assignmentId: IdSchema, revision: RevisionSchema }).strict().optional(),
}).strict();
export type PartnerAction = z.infer<typeof PartnerActionSchema>;
export type PermissionContext = z.infer<typeof PermissionContextSchema>;

/** Denial-only domain contract for #319's CENTRAL policy, not a permission resolver.
 * null means no additional denial, never authorization. Context must be resolved
 * from current database evidence inside the caller's transaction, never HTTP input.
 */
export function checkPartnerDomainRestrictions(action: PartnerAction, input: PermissionContext): PartnerError | null {
  PartnerActionSchema.parse(action);
  const context = PermissionContextSchema.parse(input);
  if (!context.resourceVisible || (context.scope === 'DEPARTMENT' && !context.departmentId)) return partnerError('NOT_FOUND');
  if (!context.actionGranted || (context.grantExpiresAt && context.grantExpiresAt <= context.evaluatedAt)) return partnerError('FORBIDDEN');
  const isOwner = context.persona === 'PARTNER' && context.actorId === context.partnerSellerId;
  const partnerAuthored: PartnerAction[] = ['CASE_DRAFT_WRITE', 'CASE_SUBMIT', 'RETAIL_CORRECTION_SAVE', 'RETAIL_COLLECTION_WRITE', 'CORRECTION_REQUEST', 'VOID_REQUEST'];
  if (partnerAuthored.includes(action) && !isOwner) return partnerError('FORBIDDEN');
  if (partnerAuthored.includes(action) && context.partnerStatus !== 'ACTIVE') return partnerError('PARTNER_NOT_ACTIVE');
  if (action === 'INQUIRY_RESPOND') {
    if (context.persona !== 'INTERNAL' || !context.assignment?.eligible || context.assignment.actorId !== context.actorId) return partnerError('NOT_ASSIGNED');
    if (context.partnerStatus !== 'ACTIVE') return partnerError('PARTNER_NOT_ACTIVE');
  }
  if (['FINANCIAL_PROCESS', 'FINANCIAL_APPROVE'].includes(action) && (!context.requesterId || context.requesterId === context.actorId)) return partnerError('FORBIDDEN');
  if (action === 'VOID_REMEDIATION_REQUEST' && (context.persona !== 'INTERNAL' || context.purpose !== 'MANAGEMENT' || !['SUSPENDED', 'TERMINATED'].includes(context.partnerStatus))) return partnerError('FORBIDDEN');
  return null;
}

export interface PartnerAuthorizationPort {
  /** #319: resolves root, effective grants, lifecycle, scope, purpose and the four exceptions. */
  authorize(action: PartnerAction, root: PermissionContext['root']): Promise<Result<PermissionContext>>;
}
