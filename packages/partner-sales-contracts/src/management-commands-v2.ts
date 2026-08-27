import { z } from 'zod';
import { Result } from './errors';
import { IdempotencySchema } from './integrity';
import { IdSchema, PersianReasonSchema, RevisionSchema } from './primitives';

const envelope = { schemaVersion: z.literal(2), commandId: IdSchema, correlationId: IdSchema,
  idempotency: IdempotencySchema, reason: PersianReasonSchema };
const profile = { profileId: IdSchema, expectedRevision: RevisionSchema };

export const PartnerManagementCommandV2Schema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('PROFILE_CREATE'), identityEvidenceId: IdSchema }).strict(),
  z.object({ ...envelope, ...profile, type: z.literal('IDENTITY_VERIFY'), evidenceId: IdSchema }).strict(),
  z.object({ ...envelope, ...profile, type: z.literal('COMMERCIAL_TERMS_SET'), termsVersionId: IdSchema }).strict(),
  z.object({ ...envelope, ...profile, type: z.literal('CREDIT_TERMS_SET'), termsVersionId: IdSchema }).strict(),
  z.object({ ...envelope, ...profile, type: z.literal('RESPONDER_ASSIGN'), responderId: IdSchema }).strict(),
  z.object({ ...envelope, ...profile, type: z.literal('PROFILE_CONVERSION'),
    transition: z.enum(['START', 'ABANDON', 'RESOLVE']), dispositionEvidenceIds: z.array(IdSchema) }).strict(),
]).superRefine((command, context) => {
  if (command.idempotency.operation !== command.type) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'operation'], message: 'Idempotency operation must match command' });
  }
  const target = command.type === 'PROFILE_CREATE' ? command.identityEvidenceId : command.profileId;
  if (command.idempotency.targetId !== target) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency', 'targetId'], message: 'Idempotency target must match the profile or creation identity evidence' });
  }
  if (command.type === 'PROFILE_CONVERSION' && command.transition === 'RESOLVE' && command.dispositionEvidenceIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dispositionEvidenceIds'], message: 'Resolution requires owner-issued disposition evidence' });
  }
});
export type PartnerManagementCommandV2 = z.infer<typeof PartnerManagementCommandV2Schema>;
export interface PartnerManagementCommandV2Port {
  /** Owner validates actor, evidence provenance, CAS and lifecycle in one transaction.
   * Client action availability and supplied idempotency.actorId are never authority.
   * Same-intent replay returns the original result, not a new profile/transition.
   */
  execute(command: PartnerManagementCommandV2): Promise<Result<{
    commandId: string; replayed: boolean; profileId: string; revision: number; eventIds: readonly string[];
  }>>;
}
