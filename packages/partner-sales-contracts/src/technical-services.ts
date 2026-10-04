import { z } from 'zod';
import { IdSchema, InstantSchema, MoneySchema, TextSchema } from './primitives';
import { technicalDecimal } from './technical-values';
export const PartnerTechnicalServiceRowSchema = z.object({
  serviceRowId: IdSchema, sourceType: z.enum(['tool', 'cutting', 'finishing']),
  catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema,
  title: z.string().max(300), description: z.string().max(2000).optional(),
  unit: z.enum(['meter', 'squareMeter', 'count']), quantity: technicalDecimal.optional(),
  retailUnitPrice: MoneySchema.optional(),
}).strict();
export type PartnerTechnicalServiceRow = z.infer<typeof PartnerTechnicalServiceRowSchema>;
export const PartnerTechnicalServiceCatalogItemSchema = z.object({
  catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema,
  sourceType: z.enum(['tool', 'cutting', 'finishing']), name: TextSchema,
  unit: z.enum(['meter', 'squareMeter', 'count']), suggestedRetailUnitPrice: MoneySchema.optional(),
}).strict();
export type PartnerTechnicalServiceCatalogItem = z.infer<typeof PartnerTechnicalServiceCatalogItemSchema>;
