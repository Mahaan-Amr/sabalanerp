import { z } from 'zod';
import { IdSchema } from './primitives';
import { PartnerCaseViewSchema } from './projections';

export const PartnerCaseRuntimeQuerySchema = z.object({ caseId: IdSchema.optional() }).strict();

export const PartnerCaseRuntimeActionsSchema = z.object({
  canPreview: z.boolean(),
  canIssue: z.boolean(),
  canSendConfirmation: z.boolean(),
  canRequestCorrection: z.boolean(),
  canCancel: z.boolean(),
  canRequestVoid: z.boolean(),
}).strict();

export const PartnerCaseRuntimeRowSchema = z.object({
  view: PartnerCaseViewSchema,
  snapshotId: IdSchema.nullable(),
  actions: PartnerCaseRuntimeActionsSchema,
}).strict();

export const PartnerCaseRuntimeResultSchema = z.object({
  cases: z.array(PartnerCaseRuntimeRowSchema),
}).strict();

export const PartnerCustomerOutputRequestSchema = z.object({
  mode: z.enum(['PREVIEW', 'FINAL', 'DOWNLOAD_EXISTING']),
  snapshotId: IdSchema,
}).strict();

export const PartnerCreationContextSchema = z.discriminatedUnion('kind', [
  z.object({ schemaVersion: z.literal(1), kind: z.literal('ORDINARY_SALES') }).strict(),
  z.object({ schemaVersion: z.literal(1), kind: z.literal('PARTNER'), actorId: IdSchema,
    profileId: IdSchema, writable: z.boolean(), blockedCode: z.string().optional(),
    sabalanTermsVersionId: IdSchema.optional(), latestInquiryId: IdSchema.optional(),
    customers: z.array(z.object({ id: IdSchema, displayName: z.string().min(1).max(240),
      address: z.string().min(1).max(2000) }).strict()),
  }).strict(),
]);
export type PartnerCreationContext = z.infer<typeof PartnerCreationContextSchema>;

export type PartnerCaseRuntimeRow = z.infer<typeof PartnerCaseRuntimeRowSchema>;
