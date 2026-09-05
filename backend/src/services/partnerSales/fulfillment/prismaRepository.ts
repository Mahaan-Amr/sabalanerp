import { Prisma, type PrismaClient } from '@prisma/client';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import {
  FulfillmentViewSchema, canonicalHash, partnerError,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { readCurrentPartnerCaseViews, readPartnerRevisionProjections } from '../cases/lifecycle';
import { buildPartnerPhysicalLineage, canonicalPartnerQuantity } from './lineage';
import { capturePartnerContractedQuantities, readPartnerShipmentQuantityProjection } from './quantityStore';
import type {
  PartnerFulfillmentCommandReceipt, PartnerFulfillmentCommandScope, PartnerFulfillmentRepository,
  PartnerFulfillmentSource, PartnerPhysicalLineage,
} from './repository';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

class RollbackResult extends Error {
  constructor(readonly result: Result<unknown>) { super('rollback Partner fulfillment'); }
}

function decodeLineage(row: { id: string; caseId: string; caseRevision: number; integrityHash: string;
  internalRecordId: string; productRowId: string; quantity: Prisma.Decimal; unit: string; recipient: Prisma.JsonValue;
  deliveryIds: Prisma.JsonValue }): PartnerPhysicalLineage | undefined {
  const recipient = object(row.recipient);
  if (!recipient || !Array.isArray(row.deliveryIds) || row.deliveryIds.some(item => typeof item !== 'string')) return undefined;
  return { lineageId: row.id, sourceKind: 'PARTNER_CASE', caseId: row.caseId,
    createdFrom: { caseId: row.caseId, revision: row.caseRevision, integrityHash: row.integrityHash },
    internalRecordId: row.internalRecordId, productRowId: row.productRowId,
    quantity: row.quantity.toFixed(3), unit: row.unit,
    recipient: recipient as PartnerPhysicalLineage['recipient'], deliveryIds: row.deliveryIds as string[] };
}

export function createPrismaPartnerFulfillmentRepository(input: {
  database: PrismaClient | Prisma.TransactionClient;
  actorId: string;
  correlationId: string;
  reason?: string;
}): PartnerFulfillmentRepository {
  return { async transaction(operation) {
    try {
      const run = async (tx: Prisma.TransactionClient) => {
        let mutating = false;
        await lockPartnerOperationsControl(tx);
        const source = async (expected: PartnerFulfillmentSource['view']['owner'], action: 'MATERIALIZE' | 'SELECT_DELIVERY' | 'INSPECT_LOADING' | 'INSPECT_DEPENDENCIES' | 'INSPECT_VOIDING',
          authenticatedActorId?: string): Promise<Result<PartnerFulfillmentSource>> => {
          if (authenticatedActorId && authenticatedActorId !== input.actorId) return { ok: false, error: partnerError('FORBIDDEN') };
          await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${expected.caseId} FOR UPDATE`;
          const row = await tx.partnerSaleCase.findUnique({ where: { id: expected.caseId }, select: {
            id: true, state: true, headRevision: true, integrityHash: true, customerId: true, internalRecordId: true,
            head: { select: { graphHash: true, graph: true, internalProjection: true, partySnapshots: true } },
          } });
          if (!row) return { ok: false, error: partnerError('NOT_FOUND') };
          const authAction = action === 'MATERIALIZE' ? 'FULFILLMENT_WRITE' : 'FULFILLMENT_READ';
          const authorization = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
            purpose: 'FULFILLMENT', channel: 'API' }, { correlationId: input.correlationId, reason: input.reason })
            .authorize(authAction, { kind: 'CASE', id: row.id });
          if (!authorization.ok) return authorization;
          if (!await readCurrentPartnerCaseViews(tx, row.id)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          const historical = action === 'INSPECT_LOADING';
          const history = historical ? await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
            caseId: expected.caseId, revision: expected.revision } } }) : null;
          if (historical && (!history || !await readPartnerRevisionProjections(tx, expected))) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const head = history ?? row.head;
          const owner = historical ? expected : { caseId: row.id, revision: row.headRevision, integrityHash: row.integrityHash };
          const view = FulfillmentViewSchema.safeParse(object(head.internalProjection)?.fulfillment);
          if (!view.success || view.data.owner.caseId !== owner.caseId || view.data.owner.revision !== owner.revision ||
              view.data.owner.integrityHash !== owner.integrityHash || view.data.recordId !== row.internalRecordId) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          let graph;
          try { graph = parseCanonicalProductGraph(head.graph); }
          catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
          const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
          if (graphHash !== head.graphHash) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          const customerParty = object(object(head.partySnapshots)?.customer);
          // Historical lineage retains recipient evidence, not a selected loading
          // destination. Unscheduled commitments still have a canonical recipient.
          const destination = view.data.deliveries[0]?.destination ?? customerParty?.address;
          const phone = customerParty?.phone, displayName = customerParty?.displayName;
          if (typeof phone !== 'string' || typeof displayName !== 'string' || typeof destination !== 'string' || !destination) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          return { ok: true, value: { view: view.data,
            graph: { owner: view.data.owner, schemaVersion: 1, graphHash, productRowIds: graph.rows.map(item => item.productRowId) },
            canonicalGraph: { graphHash, productRowIds: graph.rows.map(item => item.productRowId) },
            caseState: row.state, customer: { customerId: row.customerId, displayName, phone,
              destination },
          } };
        };
        const result = await operation({
          readAuthorizedSource: source,
          readLineageCommand: async command => {
            const saved = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
              actorId: command.idempotency.actorId, operation: command.idempotency.operation,
              targetScope: command.idempotency.targetId, key: command.idempotency.key,
            } }, select: { outcome: true } });
            const value = object(saved?.outcome)?.fulfillmentCommand;
            return value && typeof value === 'object' && !Array.isArray(value) ? value as PartnerFulfillmentCommandReceipt : null;
          },
          findLineage: async (caseId, productRowId) => {
            const row = await tx.partnerFulfillmentLineage.findUnique({ where: {
              caseId_productRowId: { caseId, productRowId } } });
            if (!row) return null;
            const lineage = decodeLineage(row);
            if (!lineage || !await readPartnerRevisionProjections(tx, lineage.createdFrom)) return null;
            const origin = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: {
              caseId, revision: lineage.createdFrom.revision } }, include: { case: { select: { customerId: true } } } });
            const view = FulfillmentViewSchema.safeParse(object(origin.internalProjection)?.fulfillment);
            const recipient = object(object(origin.partySnapshots)?.customer);
            if (!view.success || !recipient || typeof recipient.displayName !== 'string' || typeof recipient.phone !== 'string') return null;
            const destination = view.data.deliveries[0]?.destination ?? recipient.address;
            const product = view.data.products.find(item => item.productRowId === productRowId);
            if (!product || !canonicalPartnerQuantity(product.quantity) || typeof destination !== 'string') return null;
            const expected = await buildPartnerPhysicalLineage({ view: view.data, customer: {
              customerId: origin.case.customerId, displayName: recipient.displayName, phone: recipient.phone, destination } }, product);
            return await canonicalHash(lineage) === await canonicalHash(expected) ? lineage : null;
          },
          commitLineages: async ({ command, intentHash, lineages }) => {
            mutating = true;
            const current = await tx.partnerSaleCase.findUnique({ where: { id: command.expected.caseId },
              select: { state: true, headRevision: true, integrityHash: true } });
            if (!current || current.state !== 'COMMITTED' || current.headRevision !== command.expected.revision ||
                current.integrityHash !== command.expected.integrityHash) return { ok: false, error: partnerError('ROW_STALE') };
            for (const lineage of lineages) {
              const prior = await tx.partnerFulfillmentLineage.findUnique({ where: { caseId_productRowId: {
                caseId: lineage.caseId,
                productRowId: lineage.productRowId } } });
              if (prior) {
                const decoded = decodeLineage(prior);
                if (!decoded || await canonicalHash(decoded) !== await canonicalHash(lineage)) {
                  return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
                }
                continue;
              }
              await tx.partnerFulfillmentLineage.create({ data: { id: lineage.lineageId, caseId: lineage.caseId,
                caseRevision: lineage.createdFrom.revision, integrityHash: lineage.createdFrom.integrityHash,
                internalRecordId: lineage.internalRecordId, productRowId: lineage.productRowId,
                quantity: lineage.quantity, unit: lineage.unit, recipient: json(lineage.recipient),
                deliveryIds: json(lineage.deliveryIds), commandId: command.commandId } });
            }
            const verified = await readCurrentPartnerCaseViews(tx, command.expected.caseId);
            if (!verified) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
            await capturePartnerContractedQuantities(tx, FulfillmentViewSchema.parse(object(verified.row.head.internalProjection)?.fulfillment));
            const receipt: PartnerFulfillmentCommandReceipt = { commandId: command.commandId, intentHash,
              idempotency: command.idempotency, lineageEvidenceIds: lineages.map(item => item.lineageId) };
            await tx.partnerCommandOutcome.create({ data: { id: command.commandId,
              actorId: command.idempotency.actorId, operation: command.idempotency.operation,
              targetScope: command.idempotency.targetId, key: command.idempotency.key, payloadHash: intentHash,
              outcome: json({ schemaVersion: 1, fulfillmentCommand: receipt }) } });
            return { ok: true, value: receipt };
          },
          readQuantityDependencies: async expected => {
            const caseRow = await tx.partnerSaleCase.findUnique({ where: { id: expected.caseId },
              select: { internalRecordId: true } });
            if (!caseRow) return [];
            const projection = await readPartnerShipmentQuantityProjection(tx, expected.caseId);
            return projection.rows.map(row => ({ sourceKind: 'PARTNER_CASE' as const, owner: expected,
              internalRecordId: caseRow.internalRecordId, productRowId: row.productRowId, unit: row.unit,
              contracted: row.quantities?.contracted ?? '', finalizedReserved: row.quantities?.finalizedReserved ?? '',
              physicallyDispatched: row.quantities?.physicallyDispatched ?? '', health: row.health,
              evidenceIds: row.sourceEvidenceIds,
            }));
          },
        });
        if (!result.ok && mutating) throw new RollbackResult(result);
        return result;
      };
      // Composition inside the loading transaction must not open another
      // transaction or release the global/Case locks before the loading write.
      return '$transaction' in input.database ? await input.database.$transaction(run) : await run(input.database);
    } catch (error) {
      if (error instanceof RollbackResult && '$transaction' in input.database) return error.result as Result<never>;
      throw error;
    }
  } };
}
