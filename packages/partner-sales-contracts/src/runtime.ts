import { z } from 'zod';
import { IdSchema, InstantSchema, RevisionRefSchema } from './primitives';
import { PartnerCaseViewSchema } from './projections';
import { CaseDraftIntentSchema, PartnerDraftEditLeaseSchema } from './commands';
import { PartnerInquiryRowV2Schema } from './inquiry-v2';

export const PartnerCaseRuntimeQuerySchema = z.object({ caseId: IdSchema.optional() }).strict();

export const PartnerCaseRuntimeActionsSchema = z.object({
  canContinue: z.boolean(),
  canPreview: z.boolean(),
  canIssue: z.boolean(),
  canFinalize: z.boolean(),
  canSendConfirmation: z.boolean(),
  canRequestCorrection: z.boolean(),
  canCancel: z.boolean(),
  canRequestVoid: z.boolean(),
}).strict();

export const PartnerCaseRuntimeRowSchema = z.object({
  view: PartnerCaseViewSchema,
  snapshotId: IdSchema.nullable(),
  editRecovery: z.object({ recoveryId: IdSchema, baseRevision: z.number().int().nonnegative().safe() }).strict().optional(),
  actions: PartnerCaseRuntimeActionsSchema,
}).strict();

export const PartnerCaseRuntimeResultSchema = z.object({
  cases: z.array(PartnerCaseRuntimeRowSchema),
}).strict();

export const PartnerCustomerOutputRequestSchema = z.object({
  mode: z.enum(['PREVIEW', 'FINAL', 'DOWNLOAD_EXISTING']),
  snapshotId: IdSchema,
}).strict();

export const PartnerCaseFinalizeRequestSchema = z.object({
  expected: RevisionRefSchema,
  expectedState: z.enum(['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED']),
  lossAccepted: z.boolean(),
}).strict();

export const PARTNER_EDITABLE_CASE_STATES = [
  'DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED',
] as const;
export function isPartnerCaseEditableState(state: string): state is typeof PARTNER_EDITABLE_CASE_STATES[number] {
  return (PARTNER_EDITABLE_CASE_STATES as readonly string[]).includes(state);
}

export const PartnerCreationContextSchema = z.discriminatedUnion('kind', [
  z.object({ schemaVersion: z.literal(1), kind: z.literal('ORDINARY_SALES') }).strict(),
  z.object({ schemaVersion: z.literal(1), kind: z.literal('PARTNER'), actorId: IdSchema,
    actorDisplayName: z.string().trim().min(1).max(240).optional(),
    profileId: IdSchema, writable: z.boolean(), blockedCode: z.string().optional(),
    sabalanTermsVersionId: IdSchema.optional(), latestInquiryId: IdSchema.optional(),
    inquiryIds: z.array(IdSchema).max(100),
    recoverableDraft: z.object({ recoveryId: IdSchema, baseRevision: z.number().int().nonnegative().safe(),
      updatedAt: InstantSchema, title: z.string().trim().min(1).max(200).optional() }).strict().optional(),
    recoverableDrafts: z.array(z.object({ recoveryId: IdSchema, baseRevision: z.number().int().nonnegative().safe(),
      updatedAt: InstantSchema, title: z.string().trim().min(1).max(200).optional() }).strict()).max(50).optional(),
    customers: z.array(z.object({ id: IdSchema, displayName: z.string().min(1).max(240),
      address: z.string().min(1).max(2000), phone: z.string().min(1).max(30).optional() }).strict()),
    projects: z.array(z.object({ id: IdSchema, customerId: IdSchema, title: z.string().min(1).max(500) }).strict()),
  }).strict(),
]);
export type PartnerCreationContext = z.infer<typeof PartnerCreationContextSchema>;

export const PartnerWizardStepSchema = z.enum([
  'date', 'customer', 'project', 'products', 'delivery', 'payment', 'confirmation',
]);
export const PartnerWizardRecoverySaveSchema = z.object({
  schemaVersion: z.literal(1),
  expectedWizardRevision: z.number().int().nonnegative().safe(),
  editLease: PartnerDraftEditLeaseSchema,
  step: PartnerWizardStepSchema,
  intent: CaseDraftIntentSchema,
}).strict();
export const PartnerWizardRecoverySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  wizardRevision: z.number().int().positive().safe(),
  step: PartnerWizardStepSchema,
  intent: CaseDraftIntentSchema,
  updatedAt: InstantSchema,
}).strict();
export type PartnerWizardRecoverySave = z.infer<typeof PartnerWizardRecoverySaveSchema>;
export type PartnerWizardRecoverySnapshot = z.infer<typeof PartnerWizardRecoverySnapshotSchema>;

export const PartnerApprovalMatchRequestSchema = z.object({
  schemaVersion: z.literal(1), recoveryId: IdSchema,
  recoveryRevision: z.number().int().positive().safe(),
}).strict();
export const PartnerApprovalMatchSetSchema = z.object({
  schemaVersion: z.literal(1), recoveryId: IdSchema,
  recoveryRevision: z.number().int().positive().safe(),
  rows: z.array(PartnerInquiryRowV2Schema.refine(row => row.state === 'APPROVED' && Boolean(row.approvedRowBinding),
    'Only usable approved rows can be matched')),
  missingPricingSubjectIds: z.array(IdSchema),
}).strict();
export type PartnerApprovalMatchSet = z.infer<typeof PartnerApprovalMatchSetSchema>;

export type PartnerCaseRuntimeRow = z.infer<typeof PartnerCaseRuntimeRowSchema>;
