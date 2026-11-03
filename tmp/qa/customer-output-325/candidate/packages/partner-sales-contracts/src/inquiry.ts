import { z } from 'zod';
import { HashSchema, IdSchema, InstantSchema, MoneySchema, PersianReasonSchema, RevisionSchema, TextSchema } from './primitives';
import { PartnerError, partnerError } from './errors';

export const PRICE_APPROVAL_VALIDITY_MS = 48 * 60 * 60 * 1000;
// Opaque owner-private technical recovery reference; the server resolves the full
// graph and internal pricing identity. A client never supplies rates or policy inputs.
export const PartnerConfigurationRefSchema = z.object({
  recoveryId: IdSchema, recoveryRevision: RevisionSchema, productRowId: IdSchema,
}).strict();
export const ApprovedRowBindingSchema = z.object({ inquiryId: IdSchema, rowId: IdSchema, revision: RevisionSchema }).strict();
// Internal evidence only: Partner and customer DTOs never include these inputs.
export const InquiryIdentitySchema = z.object({
  schemaVersion: z.literal(1), partnerSellerId: IdSchema, catalogProductId: IdSchema,
  family: z.enum(['longitudinal', 'stair', 'slab', 'prepared', 'volumetric']), unit: TextSchema,
  configuration: z.array(z.object({ key: IdSchema, value: TextSchema }).strict()).min(1),
  materialRateEvidenceId: IdSchema, materialRateHash: HashSchema,
  components: z.array(z.object({ componentId: IdSchema, evidenceHash: HashSchema }).strict()),
  currency: z.enum(['IRR', 'IRT']), calculationPolicyVersion: IdSchema, roundingPolicyVersion: IdSchema,
}).strict();
export const ApprovedInquirySchema = z.object({
  schemaVersion: z.literal(1), approvalId: IdSchema, inquiryId: IdSchema, rowId: IdSchema,
  revision: RevisionSchema, partnerSellerId: IdSchema, configurationHash: HashSchema, evidenceHash: HashSchema,
  wholesaleUnitPrice: MoneySchema, approvedAt: InstantSchema, expiresAt: InstantSchema, note: TextSchema.optional(),
  predecessorApprovalId: IdSchema.optional(),
  supersessionReason: PersianReasonSchema.optional(),
  decision: z.object({ actorId: IdSchema, assignmentId: IdSchema, assignmentRevision: RevisionSchema,
    authorizationEvidenceId: IdSchema, commandId: IdSchema }).strict(),
}).strict().refine(row => Date.parse(row.expiresAt) - Date.parse(row.approvedAt) === PRICE_APPROVAL_VALIDITY_MS, 'Approval window must be exactly 48 hours')
  .refine(row => Boolean(row.predecessorApprovalId) === Boolean(row.supersessionReason), 'Successor decision preserves its mandatory supersession reason');
export type ApprovedInquiry = z.infer<typeof ApprovedInquirySchema>;
export type InquiryIdentity = z.infer<typeof InquiryIdentitySchema>;

export function checkApprovalUse(approval: ApprovedInquiry, use: {
  partnerSellerId: string; configurationHash: string; superseded: boolean; terminated: boolean;
}, databaseNow: string): PartnerError | null {
  ApprovedInquirySchema.parse(approval); InstantSchema.parse(databaseNow);
  if (approval.partnerSellerId !== use.partnerSellerId) return partnerError('NOT_FOUND');
  if (use.terminated) return partnerError('PARTNER_NOT_ACTIVE');
  if (use.superseded) return partnerError('APPROVAL_SUPERSEDED');
  if (approval.configurationHash !== use.configurationHash) return partnerError('CONFIG_MISMATCH');
  const now = Date.parse(databaseNow);
  return now < Date.parse(approval.approvedAt) || now >= Date.parse(approval.expiresAt) ? partnerError('APPROVAL_EXPIRED') : null;
}

export const InquiryUsageSchema = z.object({
  usageId: IdSchema, caseId: IdSchema, caseRevision: RevisionSchema, productRowId: IdSchema,
  approval: ApprovedInquirySchema, usedAt: InstantSchema,
}).strict();

export const PartnerInquiryViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('PARTNER_INQUIRY'), inquiryId: IdSchema,
  rows: z.array(z.object({ rowId: IdSchema, revision: RevisionSchema, description: TextSchema,
    state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED']),
    configuration: z.array(z.object({ label: TextSchema, value: TextSchema }).strict()),
    approvedPrice: MoneySchema.optional(), approvedAt: InstantSchema.optional(), expiresAt: InstantSchema.optional(),
    noteOrReason: TextSchema.optional(), usedCaseNumbers: z.array(IdSchema),
    approvedRowBinding: ApprovedRowBindingSchema.optional(),
  }).strict().refine(row => row.state !== 'APPROVED' || Boolean(row.approvedRowBinding), 'Approved rows expose a safe use binding')),
}).strict().superRefine((view, context) => {
  for (const row of view.rows) {
    const binding = row.approvedRowBinding;
    if (binding && (binding.inquiryId !== view.inquiryId || binding.rowId !== row.rowId || binding.revision !== row.revision)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Approved binding must identify its exact visible inquiry row' });
    }
  }
});

export const ResponderInquiryViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('RESPONDER_INQUIRY'), inquiryId: IdSchema,
  partnerDisplayName: TextSchema, assignmentId: IdSchema, assignmentRevision: RevisionSchema,
  rows: z.array(z.object({ rowId: IdSchema, revision: RevisionSchema, identity: InquiryIdentitySchema,
    approvedPrice: MoneySchema.optional(), used: z.boolean(),
  }).strict()),
}).strict();
