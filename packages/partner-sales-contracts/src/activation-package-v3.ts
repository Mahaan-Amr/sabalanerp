import { z } from 'zod';
import { PartnerActionV2Schema, ActionAvailabilityV2Schema } from './workspaces-v2';
import { PartnerErrorSchema, Result } from './errors';
import { IdempotencySchema } from './integrity';
import { HashSchema, IdSchema, InstantSchema, PersianReasonSchema, RevisionSchema, TextSchema } from './primitives';
import { PartnerProfileViewSchema } from './projections';

const commandEnvelope = {
  schemaVersion: z.literal(3),
  commandId: IdSchema,
  correlationId: IdSchema,
  idempotency: IdempotencySchema,
  reason: PersianReasonSchema,
};

export const PartnerActivationCommandV3Schema = z.discriminatedUnion('type', [
  z.object({ ...commandEnvelope, type: z.literal('RELEASE_READINESS_PUBLISH'),
    verifiedPackageId: IdSchema, expectedControlRevision: RevisionSchema }).strict(),
  z.object({ ...commandEnvelope, type: z.literal('PROFILE_BOOTSTRAP'), userId: IdSchema,
    expectedControlRevision: RevisionSchema, cohortId: IdSchema, cohortName: TextSchema,
    identityEvidenceId: IdSchema, commercialTermsPolicyId: IdSchema,
    creditTermsPolicyId: IdSchema, responderId: IdSchema }).strict(),
  z.object({ ...commandEnvelope, type: z.literal('PROFILE_ACTIVATE'), profileId: IdSchema,
    expectedProfileRevision: RevisionSchema, expectedControlRevision: RevisionSchema }).strict(),
]).superRefine((command, context) => {
  if (command.idempotency.operation !== command.type) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'operation'], message: 'Idempotency operation must match command' });
  }
  const target = command.type === 'RELEASE_READINESS_PUBLISH' ? command.verifiedPackageId
    : command.type === 'PROFILE_BOOTSTRAP' ? command.userId : command.profileId;
  if (command.idempotency.targetId !== target) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'targetId'], message: 'Idempotency target must match the activation subject' });
  }
});
export type PartnerActivationCommandV3 = z.infer<typeof PartnerActivationCommandV3Schema>;

export const PartnerActivationGateSchema = z.object({
  id: z.enum(['IDENTITY', 'COMMERCIAL_TERMS', 'CREDIT_TERMS', 'RESPONDER', 'CONVERSION', 'ENROLLMENT', 'COHORT', 'USER', 'RELEASE', 'OPERATIONS']),
  label: TextSchema,
  ready: z.boolean(),
  blocker: PartnerErrorSchema.optional(),
}).strict().refine(value => value.ready !== Boolean(value.blocker), 'A ready gate cannot carry a blocker');

export const PartnerActivationViewV3Schema = z.object({
  schemaVersion: z.literal(3), purpose: z.literal('PARTNER_ACTIVATION'), actorId: IdSchema,
  release: z.object({ controlRevision: RevisionSchema, status: z.enum(['MISSING', 'READY', 'EXPIRED', 'PAUSED']),
    publicationId: IdSchema.optional(), releaseId: IdSchema.optional(), expiresAt: InstantSchema.optional(),
    actions: z.array(ActionAvailabilityV2Schema) }).strict(),
  cohort: z.object({ id: IdSchema, name: TextSchema, enrollmentOpen: z.boolean(), operationsOpen: z.boolean() }).strict().optional(),
  subject: z.object({ userId: IdSchema, displayName: TextSchema,
    profileId: IdSchema.optional(), profileRevision: RevisionSchema.optional(), profile: PartnerProfileViewSchema.optional(),
    gates: z.array(PartnerActivationGateSchema), actions: z.array(ActionAvailabilityV2Schema),
  }).strict().optional(),
  candidates: z.array(z.object({ userId: IdSchema, displayName: TextSchema }).strict()),
  identityEvidence: z.array(z.object({ id: IdSchema, label: TextSchema,
    personType: z.enum(['NATURAL', 'LEGAL']) }).strict()),
  commercialTerms: z.array(z.object({ id: IdSchema, label: TextSchema }).strict()),
  creditTerms: z.array(z.object({ id: IdSchema, label: TextSchema }).strict()),
  responders: z.array(z.object({ id: IdSchema, label: TextSchema }).strict()),
}).strict().superRefine((view, context) => {
  const subject = view.subject;
  if (!subject) return;
  if (Boolean(subject.profileId) !== Boolean(subject.profileRevision)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['subject'], message: 'Profile identity and revision must travel together' });
  }
});
export type PartnerActivationViewV3 = z.infer<typeof PartnerActivationViewV3Schema>;

export const PartnerActivationReceiptV3Schema = z.object({
  schemaVersion: z.literal(3), commandId: IdSchema, replayed: z.boolean(),
  userId: IdSchema.optional(), profileId: IdSchema.optional(), publicationId: IdSchema.optional(),
  cohortId: IdSchema.optional(), profileRevision: RevisionSchema.optional(), controlRevision: RevisionSchema,
  eventIds: z.array(IdSchema), activationBundleId: IdSchema.optional(), activationBundleHash: HashSchema.optional(),
}).strict().refine(value => Boolean(value.activationBundleId) === Boolean(value.activationBundleHash),
  'Activation bundle identity and hash must travel together');
export type PartnerActivationReceiptV3 = z.infer<typeof PartnerActivationReceiptV3Schema>;

export interface PartnerActivationPackageV3Port {
  query(input: { schemaVersion: 3; purpose: 'PARTNER_ACTIVATION'; userId?: string }): Promise<Result<PartnerActivationViewV3>>;
  execute(command: PartnerActivationCommandV3): Promise<Result<PartnerActivationReceiptV3>>;
}

// Retain the action vocabulary at the package seam so consumers cannot widen it locally.
export const PartnerActivationActionV3Schema = PartnerActionV2Schema;
