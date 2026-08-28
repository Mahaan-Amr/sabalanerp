import { z } from 'zod';
import { InstantSchema, QuantitySchema, RevisionSchema } from './primitives';
import { PartnerConfigurationRefSchema } from './inquiry';
import { PartnerTechnicalCheckpointSchema, PartnerTechnicalRecoveryAccessSchema } from './technical-recovery';
import type { Result } from './errors';

export const PartnerTechnicalSaveSchema = PartnerTechnicalCheckpointSchema;
export const PartnerTechnicalSavedReadSchema = PartnerTechnicalRecoveryAccessSchema.extend({
  recoveryRevision: RevisionSchema,
}).strict();
const saved = z.object({
  schemaVersion: z.literal(1), recoveryId: PartnerConfigurationRefSchema.shape.recoveryId,
  recoveryRevision: RevisionSchema, inputRevision: z.number().int().nonnegative().safe(), updatedAt: InstantSchema,
  rows: z.array(z.object({
    configurationRef: PartnerConfigurationRefSchema, quantity: QuantitySchema,
    unit: z.enum(['meter', 'squareMeter', 'count', 'ton']),
    // Comparison with the preceding validated save, not an approval decision.
    configurationChange: z.enum(['NEW', 'UNCHANGED', 'CHANGED']),
  }).strict().refine(row => row.unit !== 'count' || /^[0-9]+(?:\.0+)?$/.test(row.quantity), 'Piece count must be integral')).min(1),
}).strict();
const coherent = (value: z.infer<typeof saved>, context: z.RefinementCtx) => {
  const ids = new Set<string>();
  for (const { configurationRef: ref } of value.rows) {
    if (ref.recoveryId !== value.recoveryId || ref.recoveryRevision !== value.recoveryRevision || ids.has(ref.productRowId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Saved rows must uniquely identify this exact recovery revision' });
    }
    ids.add(ref.productRowId);
  }
};
export const PartnerTechnicalSavedViewSchema = saved.superRefine(coherent);
export const PartnerTechnicalSaveReceiptSchema = saved.extend({ replayed: z.boolean() }).strict().superRefine(coherent);
export type PartnerTechnicalSave = z.infer<typeof PartnerTechnicalSaveSchema>;
export type PartnerTechnicalSavedRead = z.infer<typeof PartnerTechnicalSavedReadSchema>;
export type PartnerTechnicalSavedView = z.infer<typeof PartnerTechnicalSavedViewSchema>;
export type PartnerTechnicalSaveReceipt = z.infer<typeof PartnerTechnicalSaveReceiptSchema>;

/** Successful save requires owner validation inside the current lease and DB
 * transaction. References identify private immutable technical snapshots only;
 * they do not approve a price, extend inquiry expiry or create a Case. */
export interface PartnerTechnicalSavePort {
  save(command: PartnerTechnicalSave): Promise<Result<PartnerTechnicalSaveReceipt>>;
  readSaved(access: PartnerTechnicalSavedRead): Promise<Result<PartnerTechnicalSavedView>>;
}
