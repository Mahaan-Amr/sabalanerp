import { z } from 'zod';
import { PartnerErrorSchema, Result } from './errors';
import { IdempotencySchema } from './integrity';
import { IdSchema, InstantSchema, RevisionSchema, TextSchema } from './primitives';

export const PartnerDirectActivationQueryV4Schema = z.object({
  schemaVersion: z.literal(4), purpose: z.literal('PARTNER_DIRECT_ACTIVATION'), userId: IdSchema,
}).strict();
export type PartnerDirectActivationQueryV4 = z.infer<typeof PartnerDirectActivationQueryV4Schema>;

export const PartnerDirectActivationCommandV4Schema = z.object({
  schemaVersion: z.literal(4),
  type: z.literal('PROFILE_DIRECT_ACTIVATE'),
  commandId: IdSchema,
  correlationId: IdSchema,
  userId: IdSchema,
  responderId: IdSchema,
  expectedUserUpdatedAt: InstantSchema,
  consequenceConfirmed: z.literal(true),
  idempotency: IdempotencySchema,
}).strict().superRefine((command, context) => {
  if (command.idempotency.operation !== command.type) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'operation'], message: 'Idempotency operation must match command' });
  }
  if (command.idempotency.targetId !== command.userId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'targetId'], message: 'Idempotency target must match user' });
  }
});
export type PartnerDirectActivationCommandV4 = z.infer<typeof PartnerDirectActivationCommandV4Schema>;

export const PartnerDirectActivationRevertCommandV4Schema = z.object({
  schemaVersion: z.literal(4),
  type: z.literal('PROFILE_DIRECT_ACTIVATION_REVERT'),
  commandId: IdSchema,
  correlationId: IdSchema,
  userId: IdSchema,
  profileId: IdSchema,
  expectedProfileRevision: RevisionSchema,
  consequenceConfirmed: z.literal(true),
  idempotency: IdempotencySchema,
}).strict().superRefine((command, context) => {
  if (command.idempotency.operation !== command.type) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'operation'], message: 'Idempotency operation must match command' });
  }
  if (command.idempotency.targetId !== command.profileId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'targetId'], message: 'Idempotency target must match profile' });
  }
});
export type PartnerDirectActivationRevertCommandV4 = z.infer<typeof PartnerDirectActivationRevertCommandV4Schema>;

export const PartnerDirectActivationBlockerV4Schema = z.object({
  action: z.enum(['ACTIVATE', 'REACTIVATE', 'REVERT']),
  code: IdSchema,
  title: TextSchema,
  detail: TextSchema,
  owner: TextSchema,
  nextStep: TextSchema,
}).strict();
export type PartnerDirectActivationBlockerV4 = z.infer<typeof PartnerDirectActivationBlockerV4Schema>;

export const PartnerDirectActivationViewV4Schema = z.object({
  schemaVersion: z.literal(4),
  purpose: z.literal('PARTNER_DIRECT_ACTIVATION'),
  actorId: IdSchema,
  subject: z.object({
    userId: IdSchema,
    displayName: TextSchema,
    active: z.boolean(),
    role: TextSchema,
    userUpdatedAt: InstantSchema,
    partnerState: z.enum(['NONE', 'PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']),
    profileId: IdSchema.optional(),
    profileRevision: RevisionSchema.optional(),
    responderId: IdSchema.optional(),
    convertedAt: InstantSchema.optional(),
    convertedBy: IdSchema.optional(),
    canActivate: z.boolean(),
    blocker: PartnerErrorSchema.optional(),
    canRevert: z.boolean(),
    revertBlocker: PartnerErrorSchema.optional(),
    customerCount: z.number().int().nonnegative(),
    inquiryCount: z.number().int().nonnegative(),
    caseCount: z.number().int().nonnegative(),
    priorResponsibilityCount: z.number().int().nonnegative().default(0),
    blockers: z.array(PartnerDirectActivationBlockerV4Schema).default([]),
  }).strict().superRefine((subject, context) => {
    if (Boolean(subject.profileId) !== Boolean(subject.profileRevision)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['profileId'], message: 'Profile identity and revision must travel together' });
    }
    if (subject.canActivate === Boolean(subject.blocker)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['canActivate'], message: 'Only blocked activation carries a blocker' });
    }
    if (subject.canRevert && subject.revertBlocker) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['canRevert'], message: 'Revertable activation cannot carry a blocker' });
    }
  }),
  responders: z.array(z.object({ id: IdSchema, label: TextSchema }).strict()),
}).strict();
export type PartnerDirectActivationViewV4 = z.infer<typeof PartnerDirectActivationViewV4Schema>;

export const PartnerDirectActivationReceiptV4Schema = z.object({
  schemaVersion: z.literal(4),
  commandId: IdSchema,
  replayed: z.boolean(),
  userId: IdSchema,
  profileId: IdSchema,
  profileRevision: RevisionSchema,
  responderAssignmentId: IdSchema,
  commercialAccountId: IdSchema,
  eventIds: z.array(IdSchema).min(1),
  removedAccessCount: z.number().int().nonnegative(),
  preservedResponsibilityCount: z.number().int().nonnegative(),
}).strict();
export type PartnerDirectActivationReceiptV4 = z.infer<typeof PartnerDirectActivationReceiptV4Schema>;

export const PartnerDirectActivationRevertReceiptV4Schema = z.object({
  schemaVersion: z.literal(4),
  commandId: IdSchema,
  replayed: z.boolean(),
  userId: IdSchema,
  profileId: IdSchema,
  profileRevision: RevisionSchema,
  eventId: IdSchema,
  restoredAccessCount: z.number().int().nonnegative(),
}).strict();
export type PartnerDirectActivationRevertReceiptV4 = z.infer<typeof PartnerDirectActivationRevertReceiptV4Schema>;

export interface PartnerDirectActivationV4Port {
  query(input: PartnerDirectActivationQueryV4): Promise<Result<PartnerDirectActivationViewV4>>;
  execute(command: PartnerDirectActivationCommandV4): Promise<Result<PartnerDirectActivationReceiptV4>>;
  revert(command: PartnerDirectActivationRevertCommandV4): Promise<Result<PartnerDirectActivationRevertReceiptV4>>;
}
