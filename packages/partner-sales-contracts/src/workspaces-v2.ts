import { z } from 'zod';
import { PartnerActionSchema, PermissionContext } from './authorization';
import { PartnerErrorSchema, Result } from './errors';
import { PRICE_APPROVAL_VALIDITY_MS, ResponderInquiryViewSchema } from './inquiry';
import { InquiryRowStateV2Schema } from './inquiry-v2';
import { IdSchema, InstantSchema, PersianReasonSchema, RevisionSchema, TextSchema } from './primitives';
import { DuplicateCustomerMatchSchema, PartnerProfileViewSchema } from './projections';

// Additive vocabulary: v1 action readers and policies still reject unknown actions.
export const PartnerActionV2Schema = z.enum([...PartnerActionSchema.options,
  'COMMERCIAL_TERMS_MANAGE', 'PROFILE_CONVERSION_MANAGE',
  'CUSTOMER_LIST', 'CUSTOMER_CREATE', 'CUSTOMER_DUPLICATE_MATCH', 'CUSTOMER_TRANSFER_REQUEST']);
export type PartnerActionV2 = z.infer<typeof PartnerActionV2Schema>;
export interface PartnerAuthorizationV2Port {
  /** Central owner resolves current evidence; unsupported actions fail closed. */
  authorize(action: PartnerActionV2, root: PermissionContext['root']): Promise<Result<PermissionContext>>;
}

export const ActionAvailabilityV2Schema = z.object({
  action: PartnerActionV2Schema, enabled: z.boolean(),
  disabledReason: PartnerErrorSchema.optional(), expiresAt: InstantSchema.optional(),
}).strict().refine(value => !value.enabled || !value.disabledReason, 'Enabled actions cannot carry a denial')
  .refine(value => value.disabledReason?.status !== 404, 'Hidden resources must not be disclosed as disabled actions');
export type ActionAvailabilityV2 = z.infer<typeof ActionAvailabilityV2Schema>;
const actions = z.array(ActionAvailabilityV2Schema)
  .refine(values => new Set(values.map(value => value.action)).size === values.length, 'Duplicate action');
const option = z.object({ id: IdSchema, label: TextSchema }).strict();
const options = z.array(option).refine(values => new Set(values.map(value => value.id)).size === values.length, 'Duplicate option');
const terms = z.object({ currentVersionId: IdSchema.optional(), summary: TextSchema, options }).strict();

export const PartnerManagementProfileViewV2Schema = z.object({
  profile: PartnerProfileViewSchema, displayName: TextSchema, actions,
  identity: z.object({ evidenceId: IdSchema, legalName: TextSchema, phone: TextSchema,
    address: TextSchema, personType: z.enum(['NATURAL', 'LEGAL']) }).strict().optional(),
  commercialTerms: terms.optional(), creditTerms: terms.optional(),
  responder: z.object({ currentId: IdSchema.optional(), displayName: TextSchema.optional(), eligibleOptions: options,
    pendingInquiries: z.array(z.object({ inquiryId: IdSchema, assignmentRevision: RevisionSchema, label: TextSchema, actions }).strict())
      .refine(values => new Set(values.map(value => value.inquiryId)).size === values.length, 'Duplicate pending inquiry'),
  }).strict().optional(),
  conversion: z.object({ started: z.boolean(), irreversible: z.boolean(), blockers: options,
    dispositionEvidenceIds: z.array(IdSchema) }).strict().optional(),
}).strict();
export type PartnerManagementProfileViewV2 = z.infer<typeof PartnerManagementProfileViewV2Schema>;

export const PartnerManagementWorkspaceViewV2Schema = z.object({
  schemaVersion: z.literal(2), purpose: z.literal('PARTNER_MANAGEMENT'),
  actorId: IdSchema, personaLabel: TextSchema, actions,
  identityCandidates: z.array(z.object({ identityEvidenceId: IdSchema, displayName: TextSchema }).strict()).optional(),
  profiles: z.array(PartnerManagementProfileViewV2Schema),
  transfers: z.array(z.object({ transferId: IdSchema, revision: RevisionSchema,
    match: DuplicateCustomerMatchSchema, actions }).strict()),
  nextCursor: IdSchema.optional(),
}).strict().superRefine((view, context) => {
  if (view.identityCandidates && !view.actions.some(action => action.action === 'PROFILE_CREATE' && action.enabled)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['identityCandidates'], message: 'Identity candidates require an available profile-create action' });
  }
  if (new Set(view.profiles.map(value => value.profile.profileId)).size !== view.profiles.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profiles'], message: 'Duplicate profile' });
  }
  if (new Set(view.transfers.map(value => value.transferId)).size !== view.transfers.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['transfers'], message: 'Duplicate transfer' });
  }
});
export type PartnerManagementWorkspaceViewV2 = z.infer<typeof PartnerManagementWorkspaceViewV2Schema>;

const responderRow = ResponderInquiryViewSchema.shape.rows.element.extend({
  state: InquiryRowStateV2Schema, approvedAt: InstantSchema.optional(), expiresAt: InstantSchema.optional(),
  noteOrReason: TextSchema.optional(), actions,
}).strict().superRefine((row, context) => {
  const approved = ['APPROVED', 'EXPIRED', 'SUPERSEDED'].includes(row.state);
  if (approved) {
    if (!row.approvedPrice || !row.approvedAt || !row.expiresAt ||
      Date.parse(row.expiresAt) - Date.parse(row.approvedAt) !== PRICE_APPROVAL_VALIDITY_MS) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'An approved outcome preserves its price and exact 48-hour validity' });
    }
  } else if (row.approvedPrice || row.approvedAt || row.expiresAt || row.used) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'An undecided or rejected outcome cannot contain approval or usage evidence' });
  }
  if (['REJECTED', 'CANCELLED'].includes(row.state) && !PersianReasonSchema.safeParse(row.noteOrReason).success) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['noteOrReason'], message: 'Rejected and cancelled outcomes preserve their Persian reason' });
  }
});
export const ResponderInquiryViewV2Schema = ResponderInquiryViewSchema.extend({
  schemaVersion: z.literal(2), actions,
  rows: z.array(responderRow).refine(rows => new Set(rows.map(row => row.rowId)).size === rows.length, 'Duplicate inquiry row'),
}).strict();
export type ResponderInquiryViewV2 = z.infer<typeof ResponderInquiryViewV2Schema>;
export const ResponderWorkspaceViewV2Schema = z.object({
  schemaVersion: z.literal(2), purpose: z.literal('RESPONDER_WORKSPACE'), actorId: IdSchema,
  inquiries: z.array(ResponderInquiryViewV2Schema)
    .refine(values => new Set(values.map(value => value.inquiryId)).size === values.length, 'Duplicate inquiry'),
  nextCursor: IdSchema.optional(),
}).strict();
export type ResponderWorkspaceViewV2 = z.infer<typeof ResponderWorkspaceViewV2Schema>;
