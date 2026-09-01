import { z } from 'zod';
import { CaseStateSchema, HashSchema, IdSchema, InstantSchema, RevisionRefSchema } from './primitives';

export const CaseGraphRefSchema = z.object({
  owner: RevisionRefSchema, schemaVersion: z.literal(1), graphHash: HashSchema,
  productRowIds: z.array(IdSchema).min(1).refine(ids => new Set(ids).size === ids.length),
}).strict();
export const PartnerSaleCaseSchema = z.object({
  schemaVersion: z.literal(1), caseId: IdSchema, caseNumber: IdSchema,
  partnerSellerId: IdSchema, creatorId: IdSchema, responsibleSellerId: IdSchema, salesCreditOwnerId: IdSchema,
  customerId: IdSchema, state: CaseStateSchema, head: RevisionRefSchema, graph: CaseGraphRefSchema,
  internalRecord: z.object({ kind: z.literal('SABALAN_TO_PARTNER'), recordId: IdSchema,
    recordNumber: IdSchema, owner: RevisionRefSchema, commercialAccountId: IdSchema }).strict(),
  customerContract: z.object({ kind: z.literal('PARTNER_CUSTOMER'), contractId: IdSchema,
    contractNumber: IdSchema, owner: RevisionRefSchema }).strict(),
  commitment: z.object({ committedAt: InstantSchema, trigger: z.enum(['SIGNED', 'PRINTED']), eventId: IdSchema,
    committedRevision: RevisionRefSchema }).strict().optional(),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if ([value.creatorId, value.responsibleSellerId, value.salesCreditOwnerId].some(id => id !== value.partnerSellerId)) fail('Partner attribution must agree');
  for (const ref of [value.head, value.graph.owner, value.internalRecord.owner, value.customerContract.owner]) {
    if (ref.caseId !== value.caseId || ref.revision !== value.head.revision || ref.integrityHash !== value.head.integrityHash) fail('Case revision must agree across the exact pair and graph');
  }
  if (value.internalRecord.recordId === value.customerContract.contractId) fail('Records have distinct identities');
  if (new Set([value.caseNumber, value.internalRecord.recordNumber, value.customerContract.contractNumber]).size !== 3) fail('Numbers have distinct purposes');
  if (['COMMITTED', 'VOIDED'].includes(value.state) !== Boolean(value.commitment)) fail('Commitment evidence must survive voiding and cannot precede commitment');
  if (value.commitment && (value.commitment.committedRevision.caseId !== value.caseId || value.commitment.committedRevision.revision > value.head.revision)) fail('Commitment belongs to this Case history');
});
export type PartnerSaleCase = z.infer<typeof PartnerSaleCaseSchema>;
