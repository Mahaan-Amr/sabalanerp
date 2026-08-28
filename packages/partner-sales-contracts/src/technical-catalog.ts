import { z } from 'zod';
import { IdSchema, InstantSchema, TextSchema } from './primitives';
import type { Result } from './errors';

export const PartnerTechnicalFamilySchema = z.enum(['longitudinal', 'stair', 'slab', 'prepared', 'volumetric']);
// Inventory width/thickness are centimetres; mother length is already metres.
// Name each unit explicitly instead of reinterpreting the legacy numeric fields.
const positiveDimension = z.string().max(80).regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/)
  .refine(value => /[1-9]/.test(value));

export const PartnerTechnicalProductSchema = z.object({
  catalogItemId: IdSchema,
  // Public inventory revision, not a private pricing/configuration identity.
  catalogSnapshotVersion: InstantSchema,
  code: TextSchema,
  name: TextSchema,
  families: z.array(PartnerTechnicalFamilySchema).min(1)
    .refine(values => new Set(values).size === values.length),
  dimensions: z.object({
    motherWidthCentimeters: positiveDimension.optional(),
    motherLengthMeters: positiveDimension.optional(),
    thicknessCentimeters: positiveDimension.optional(),
  }).strict(),
  attributes: z.object({
    stoneType: TextSchema, mine: TextSchema, finish: TextSchema,
    color: TextSchema, quality: TextSchema, cuttingDimension: TextSchema,
  }).strict(),
  isAvailable: z.boolean(),
}).strict();

export type PartnerTechnicalFamily = z.infer<typeof PartnerTechnicalFamilySchema>;
export type PartnerTechnicalProduct = z.infer<typeof PartnerTechnicalProductSchema>;

const operationIdentity = {
  catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema, name: TextSchema,
};
const operationUnit = z.enum(['meter', 'squareMeter']);
export const PartnerTechnicalOperationSchema = z.discriminatedUnion('kind', [
  z.object({ ...operationIdentity, kind: z.literal('TOOL'), unit: operationUnit }).strict(),
  z.object({ ...operationIdentity, kind: z.literal('FINISHING'), unit: operationUnit,
    incompatibleCatalogItemIds: z.array(IdSchema).refine(ids => new Set(ids).size === ids.length),
  }).strict(),
  z.object({ ...operationIdentity, kind: z.literal('LAYER'),
    unit: z.enum(['set', 'physicalPiece', 'meter', 'squareMeter']),
  }).strict(),
]);
export type PartnerTechnicalOperation = z.infer<typeof PartnerTechnicalOperationSchema>;

const catalogEnvelope = { schemaVersion: z.literal(1), purpose: z.literal('PARTNER_TECHNICAL_CATALOG') };
const catalogPagination = { search: z.string().trim().max(200).optional(), cursor: IdSchema.optional(), limit: z.number().int().min(1).max(100).optional() };
export const PartnerTechnicalCatalogQuerySchema = z.discriminatedUnion('kind', [
  z.object({ ...catalogEnvelope, ...catalogPagination, kind: z.literal('PRODUCT'), family: PartnerTechnicalFamilySchema.optional() }).strict(),
  z.object({ ...catalogEnvelope, ...catalogPagination, kind: z.literal('TOOL') }).strict(),
  z.object({ ...catalogEnvelope, ...catalogPagination, kind: z.literal('FINISHING') }).strict(),
  z.object({ ...catalogEnvelope, ...catalogPagination, kind: z.literal('LAYER') }).strict(),
]);
const catalogPage = { ...catalogEnvelope, nextCursor: IdSchema.optional() };
export const PartnerTechnicalCatalogPageSchema = z.discriminatedUnion('kind', [
  z.object({ ...catalogPage, kind: z.literal('PRODUCT'), items: z.array(PartnerTechnicalProductSchema).max(100) }).strict(),
  z.object({ ...catalogPage, kind: z.literal('TOOL'), items: z.array(PartnerTechnicalOperationSchema.options[0]).max(100) }).strict(),
  z.object({ ...catalogPage, kind: z.literal('FINISHING'), items: z.array(PartnerTechnicalOperationSchema.options[1]).max(100) }).strict(),
  z.object({ ...catalogPage, kind: z.literal('LAYER'), items: z.array(PartnerTechnicalOperationSchema.options[2]).max(100) }).strict(),
]);
export type PartnerTechnicalCatalogQuery = z.infer<typeof PartnerTechnicalCatalogQuerySchema>;
export type PartnerTechnicalCatalogPage = z.infer<typeof PartnerTechnicalCatalogPageSchema>;
export interface PartnerTechnicalCatalogPort {
  /** Bind authenticated actor/scope on the server and filter before pagination.
   * Cursor/catalog IDs grant no access; an empty catalog is not a network error.
   * This distinct purpose leaves existing strict v1/v2 query readers unchanged.
   */
  read(query: PartnerTechnicalCatalogQuery): Promise<Result<PartnerTechnicalCatalogPage>>;
}
