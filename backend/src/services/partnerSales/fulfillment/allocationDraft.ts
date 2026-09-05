import { Prisma } from '@prisma/client';
import { canonicalHash, canonicalJson, IdSchema, RevisionRefSchema, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { canonicalPartnerQuantity } from './lineage';
import type { PartnerLoadingSource } from './repository';
import { createPartnerFulfillmentAdapter } from './adapter';
import { createPrismaPartnerFulfillmentRepository } from './prismaRepository';
import type { PartnerLoadingActor } from './loadingAuthority';

export type PartnerAllocationLineInput = {
  sourceKind: 'PARTNER_CASE'; productRowId: string; quantity: string; unit: string;
};
const failure = (code: Parameters<typeof partnerError>[0]): Result<never> => ({ ok: false, error: partnerError(code) });

/** Draft quantities are intent, not a stock reservation. The canonical
 * finalizer must recheck the selected delivery and the aggregate ledger. */
export async function buildPartnerAllocationDraftRows(source: PartnerLoadingSource, lines: unknown):
Promise<Result<Array<Omit<Prisma.LogisticsAllocationDraftLineCreateManyInput, 'draftId'>>>> {
  if (!Array.isArray(lines) || !lines.length || lines.length > source.rows.length) return failure('INVALID_PAYLOAD');
  const seen = new Set<string>();
  const rows: Array<Omit<Prisma.LogisticsAllocationDraftLineCreateManyInput, 'draftId'>> = [];
  const sourceHash = await canonicalHash(source);
  for (const line of lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line) ||
        Object.keys(line).some(key => !['sourceKind', 'productRowId', 'quantity', 'unit'].includes(key)) ||
        line.sourceKind !== 'PARTNER_CASE' || !IdSchema.safeParse(line.productRowId).success ||
        typeof line.quantity !== 'string' || seen.has(line.productRowId)) return failure('INVALID_PAYLOAD');
    const quantity = canonicalPartnerQuantity(line.quantity);
    const row = source.rows.find(row => row.productRowId === line.productRowId);
    if (!quantity || !row || line.unit !== row.unit) return failure('INVALID_PAYLOAD');
    // The decimal storage boundary is explicit; no database rounding or overflow.
    if (quantity.split('.')[0].length > 15 || new Prisma.Decimal(quantity).gt(row.plannedQuantity)) return failure('STATE_CONFLICT');
    seen.add(line.productRowId);
    rows.push({ sourceKind: 'PARTNER_CASE', sourceContractId: null, sourceContractItemId: null, productId: null,
      partnerCaseId: source.owner.caseId, partnerCaseRevision: source.owner.revision,
      partnerIntegrityHash: source.owner.integrityHash, partnerDeliveryId: source.deliveryId,
      partnerLineageId: row.lineageId, productRowId: row.productRowId, quantity, unit: row.unit,
      snapshot: { schemaVersion: 1, sourceHash, row } });
  }
  return { ok: true, value: rows };
}

/** Current authority is established by the loading reader. Rebuild each
 * retained draft source before presenting a price-free, allowlisted view. */
export async function readPartnerAllocationDrafts(tx: Prisma.TransactionClient, actor: PartnerLoadingActor,
  loadingId: string, loadingSource: PartnerLoadingSource) {
  const drafts = await tx.logisticsAllocationDraft.findMany({ where: { loadingId },
    include: { lines: true, queueTurn: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const adapter = createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database: tx, ...actor }));
  const result: Array<{ id: string; queueTurnId: string; queueStatus: string; reservationActive: boolean; lines: Array<{
    id: string; sourceKind: 'PARTNER_CASE'; productRowId: string; description: string; quantity: string; unit: string;
  }> }> = [];
  for (const draft of drafts) {
    const lines: typeof result[number]['lines'] = [];
    const seen = new Set<string>();
    for (const line of draft.lines) {
      const owner = RevisionRefSchema.safeParse({ caseId: line.partnerCaseId, revision: line.partnerCaseRevision,
        integrityHash: line.partnerIntegrityHash });
      if (line.sourceKind !== 'PARTNER_CASE' || !owner.success || owner.data.caseId !== loadingSource.owner.caseId ||
          line.partnerDeliveryId !== loadingSource.deliveryId || line.sourceContractId !== null ||
          line.sourceContractItemId !== null || line.productId !== null || seen.has(line.productRowId)) return failure('INTEGRITY_CONFLICT');
      const source = await adapter.readLoadingEvidence(owner.data, line.partnerDeliveryId);
      if (!source.ok) return source;
      if (canonicalJson({ ...source.value, owner: loadingSource.owner }) !== canonicalJson(loadingSource)) return failure('INTEGRITY_CONFLICT');
      const rebuilt = await buildPartnerAllocationDraftRows(source.value, [{ sourceKind: 'PARTNER_CASE',
        productRowId: line.productRowId, quantity: line.quantity.toFixed(3), unit: line.unit }]);
      if (!rebuilt.ok || rebuilt.value[0].partnerLineageId !== line.partnerLineageId ||
          canonicalJson(rebuilt.value[0].snapshot) !== canonicalJson(line.snapshot)) return failure('INTEGRITY_CONFLICT');
      seen.add(line.productRowId);
      lines.push({ id: line.id, sourceKind: 'PARTNER_CASE', productRowId: line.productRowId,
        description: source.value.rows.find(row => row.productRowId === line.productRowId)!.description,
        quantity: line.quantity.toFixed(3), unit: line.unit });
    }
    result.push({ id: draft.id, queueTurnId: draft.queueTurnId, queueStatus: draft.queueTurn.status,
      reservationActive: draft.queueTurn.loadingId === loadingId && draft.queueTurn.status === 'RESERVED_FOR_LOADING', lines });
  }
  return { ok: true as const, value: result };
}
