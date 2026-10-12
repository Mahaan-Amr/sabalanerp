import { Prisma, type PrismaClient } from '@prisma/client';
import { collectCalculatedOperationQuantities, collectProductOperationQuantities, evaluateOperationMinimums, operationMinimumMessage,
  parseCanonicalProductGraph, type OperationMinimumQuantity, type OperationMinimumRule } from '@sabalanerp/contract-product-graph';

type Database = PrismaClient | Prisma.TransactionClient;
export class OperationMinimumError extends Error {
  readonly code = 'OPERATION_MINIMUM_NOT_MET';
  constructor(public readonly details: ReturnType<typeof evaluateOperationMinimums>) {
    super(details.map(operationMinimumMessage).join('\n'));
  }
}
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
async function legacyPartnerMinimumServices(db: Database, contractId: string, caseId: string, envelope: Record<string, any>, wholesale: unknown) {
  const products = Array.isArray(envelope.products) ? envelope.products.filter((row: any) => row.productType === 'service') : [];
  if (!products.length) return [];
  const sessions = await db.salesContractEditSession.findMany({ where: { OR: [
    { contractId }, { recovery: { path: ['partnerCaseId'], equals: caseId } },
  ] }, select: { recovery: true }, orderBy: { updatedAt: 'desc' } });
  const { decodeTechnicalSavedSnapshot } = await import('./partnerSales/cases/technicalSavedRecords');
  for (const session of sessions) {
    const snapshots = record(session.recovery).validatedSnapshots;
    for (const raw of Array.isArray(snapshots) ? [...snapshots].reverse() : []) {
      const snapshot = await decodeTechnicalSavedSnapshot(raw);
      const services = snapshot?.serviceRows;
      if (!services || services.length !== products.length) continue;
      const matches = products.every((product: any) => services.some(service => {
        const wholesaleRow = record(wholesale).products?.find((row: any) => row.productRowId === product.productRowId);
        return service.serviceRowId === product.productRowId && service.unit === product.unit &&
          new Prisma.Decimal(service.quantity).eq(product.quantity) &&
          (!wholesaleRow?.configurationHash || wholesaleRow.configurationHash === service.rateEvidenceId);
      }));
      if (matches) return standaloneMinimumQuantities(services);
    }
  }
  // Only genuinely unresolved historical source evidence requires correction.
  throw new Error('هویت خدمات مستقل این نسخه قدیمی کامل نیست؛ خدمات را در ویرایش قرارداد بازبینی و ذخیره کنید.');
}
export function standaloneMinimumQuantities(rows: unknown): OperationMinimumQuantity[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(raw => {
    const row = record(raw);
    if ((row.sourceType !== 'tool' && row.sourceType !== 'finishing') ||
        !['meter', 'squareMeter', 'count'].includes(row.unit)) return [];
    return [{ kind: row.sourceType, catalogItemId: String(row.sourceId ?? row.catalogItemId),
      unit: row.unit, quantity: String(row.quantity), selectionId: String(row.id ?? row.serviceRowId) }];
  });
}

/** Current catalog rules are checked only at a new sales approval boundary.
 * Callers already lock the current commercial version and retain approved history. */
export async function assertContractOperationMinimums(db: Database, contractId: string) {
  const contract = await db.salesContract.findUnique({ where: { id: contractId }, include: { productGraphState: true } });
  if (!contract) throw new Error('قرارداد یافت نشد.');
  let quantities: OperationMinimumQuantity[];
  if (contract.partnerKind === 'PARTNER_CUSTOMER' && contract.partnerCaseId) {
    const root = await db.partnerSaleCase.findUnique({ where: { id: contract.partnerCaseId }, include: { head: true } });
    if (!root?.head) throw new Error('اطلاعات عملیات قرارداد همکار کامل نیست؛ قرارداد را بازبینی کنید.');
    quantities = collectCalculatedOperationQuantities(parseCanonicalProductGraph(root.head.graph));
    const envelope = record(root.head.retailEnvelope);
    quantities.push(...standaloneMinimumQuantities(envelope.operationMinimumServices));
    // Recover original source identities from retained, verified evidence.
    if (!Array.isArray(envelope.operationMinimumServices) && Array.isArray(envelope.products) &&
        envelope.products.some((row: any) => row.productType === 'service')) {
      const count = await db.subService.count({ where: { minimumQuantity: { gt: 0 } } })
        + await db.stoneFinishing.count({ where: { minimumQuantity: { gt: 0 } } });
      if (count) quantities.push(...await legacyPartnerMinimumServices(db, contract.id, root.id, envelope, root.head.wholesaleEnvelope));
    }
  } else {
    const products = record(contract.contractData).products ?? [];
    if (contract.productGraphState) {
      const graph = parseCanonicalProductGraph(contract.productGraphState.graph);
      quantities = collectCalculatedOperationQuantities(graph);
      const groupIds = new Set([...graph.toolSelections, ...graph.finishingSelections].map(item => item.operationGroupId));
      const ownedRows = new Set(graph.operationGroups.filter(group => groupIds.has(group.operationGroupId)).map(group => String(group.productRowId)));
      quantities.forEach(item => { if (item.scopeId) ownedRows.add(item.scopeId); });
      // Older ordinary rows can retain only the priced legacy service copies.
      // Never ignore them, and never count a graph-owned row's display copy twice.
      quantities.push(...collectProductOperationQuantities(products.filter((raw: unknown) => {
        const product = record(raw);
        return !product.operationPolicyInput && !ownedRows.has(String(product.rowId ?? product.productRowId));
      })));
    } else quantities = collectProductOperationQuantities(products);
    quantities.push(...standaloneMinimumQuantities(record(contract.contractData).serviceRows));
  }
  await assertOperationQuantityMinimums(db, quantities);
}

export async function assertOperationQuantityMinimums(db: Database, quantities: readonly OperationMinimumQuantity[]) {
  if (!quantities.length) return;
  const toolIds = [...new Set(quantities.filter(item => item.kind === 'tool').map(item => item.catalogItemId))].sort();
  const finishingIds = [...new Set(quantities.filter(item => item.kind === 'finishing').map(item => item.catalogItemId))].sort();
  // Hold current catalog rules through the caller's commercial transaction.
  if (toolIds.length) await db.$queryRaw(Prisma.sql`SELECT id FROM sub_services WHERE id IN (${Prisma.join(toolIds)}) ORDER BY id FOR SHARE`);
  if (finishingIds.length) await db.$queryRaw(Prisma.sql`SELECT id FROM stone_finishings WHERE id IN (${Prisma.join(finishingIds)}) ORDER BY id FOR SHARE`);
  const [tools, finishings] = await Promise.all([
    db.subService.findMany({ where: { id: { in: toolIds } } }),
    db.stoneFinishing.findMany({ where: { id: { in: finishingIds } } }),
  ]);
  const rules: OperationMinimumRule[] = [
    ...tools.map(item => ({ kind: 'tool' as const, catalogItemId: item.id, name: item.namePersian,
      unit: item.calculationBase === 'squareMeters' ? 'squareMeter' as const : 'meter' as const, minimumQuantity: item.minimumQuantity?.toFixed() })),
    ...finishings.map(item => ({ kind: 'finishing' as const, catalogItemId: item.id, name: item.namePersian,
      unit: item.calculationBase === 'length' ? 'meter' as const : 'squareMeter' as const, minimumQuantity: item.minimumQuantity?.toFixed() })),
  ];
  const deficits = evaluateOperationMinimums(quantities, rules);
  if (deficits.length) throw new OperationMinimumError(deficits);
}
