import { z } from 'zod';
import { HashSchema, IdSchema, MoneySchema, RevisionSchema } from './primitives';

/** Partner-safe financial preview produced by the canonical sales engine.
 * The retail value is the effective row rate after the Partner's material
 * rate has been combined with system-owned ancillary components. Wholesale
 * remains absent until every required Sabalan approval is usable. */
export const PartnerWholesaleQuoteSchema = z.object({
  schemaVersion: z.literal(1),
  recoveryId: IdSchema,
  recoveryRevision: RevisionSchema,
  graphHash: HashSchema,
  rows: z.array(z.object({ productRowId: IdSchema, retailEffectiveUnitPrice: MoneySchema,
    wholesaleUnitPrice: MoneySchema.optional() }).strict()).min(1),
}).strict();

export type PartnerWholesaleQuote = z.infer<typeof PartnerWholesaleQuoteSchema>;
