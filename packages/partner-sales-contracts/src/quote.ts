import { z } from 'zod';
import { HashSchema, IdSchema, MoneySchema, RevisionSchema } from './primitives';

/** Partner-safe financial preview produced by the canonical sales engine. */
export const PartnerWholesaleQuoteSchema = z.object({
  schemaVersion: z.literal(1),
  recoveryId: IdSchema,
  recoveryRevision: RevisionSchema,
  graphHash: HashSchema,
  rows: z.array(z.object({ productRowId: IdSchema, wholesaleUnitPrice: MoneySchema }).strict()).min(1),
}).strict();

export type PartnerWholesaleQuote = z.infer<typeof PartnerWholesaleQuoteSchema>;
