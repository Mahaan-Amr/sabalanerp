import { z } from 'zod';
import { IdSchema, InstantSchema, RevisionSchema } from './primitives';
import { PartnerTechnicalDraftSchema } from './technical-draft';
import type { Result } from './errors';

const revision = z.number().int().nonnegative().safe();
export const PartnerTechnicalRecoveryAccessSchema = z.object({
  schemaVersion: z.literal(1), recoveryId: IdSchema, browserSessionId: IdSchema,
  leaseToken: IdSchema, baseRevision: revision,
}).strict();
export const PartnerTechnicalCheckpointSchema = PartnerTechnicalRecoveryAccessSchema.extend({
  expectedRecoveryRevision: revision, idempotencyKey: IdSchema, draft: PartnerTechnicalDraftSchema,
}).strict();
export const PartnerTechnicalCheckpointReceiptSchema = z.object({
  schemaVersion: z.literal(1), recoveryId: IdSchema, recoveryRevision: RevisionSchema,
  inputRevision: revision, updatedAt: InstantSchema, replayed: z.boolean(),
}).strict();
export const PartnerTechnicalRecoveryViewSchema = z.object({
  schemaVersion: z.literal(1), recoveryId: IdSchema, recoveryRevision: revision,
  updatedAt: InstantSchema, draft: PartnerTechnicalDraftSchema.nullable(),
}).strict();
export type PartnerTechnicalRecoveryAccess = z.infer<typeof PartnerTechnicalRecoveryAccessSchema>;
export type PartnerTechnicalCheckpoint = z.infer<typeof PartnerTechnicalCheckpointSchema>;
export type PartnerTechnicalCheckpointReceipt = z.infer<typeof PartnerTechnicalCheckpointReceiptSchema>;
export type PartnerTechnicalRecoveryView = z.infer<typeof PartnerTechnicalRecoveryViewSchema>;

/** Adapter binds authenticated actor and checks current authority/lease within
 * the transaction. Checkpoint acknowledgement is durable, but is never an
 * inquiry-ready configuration reference or a successful validated save. */
export interface PartnerTechnicalRecoveryPort {
  read(access: PartnerTechnicalRecoveryAccess): Promise<Result<PartnerTechnicalRecoveryView>>;
  checkpoint(command: PartnerTechnicalCheckpoint): Promise<Result<PartnerTechnicalCheckpointReceipt>>;
}
