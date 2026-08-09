import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from '../../approvedPricing';

export const createConcurrentPricingFixture = async (client: PrismaClient, runId: string) => {
  const groups = await client.$queryRawUnsafe<Array<{ itemId: string; unit: string; productRowId: string; count: bigint }>>(`
    SELECT "sourceContractItemId" AS "itemId", "unit", "productRowId", count(*) AS "count"
    FROM "logistics_allocation_revision_lines"
    GROUP BY "sourceContractItemId", "unit", "productRowId"
    HAVING count(*) >= 2
    ORDER BY count(*) DESC, "sourceContractItemId"
    LIMIT 1`);
  if (!groups[0]) throw new Error('Concurrency fixture requires two finalized allocation lines for one stable contract item.');
  const item = await client.contractItem.findUniqueOrThrow({ where: { id: groups[0].itemId } });
  const lines = await client.logisticsAllocationRevisionLine.findMany({ where: { sourceContractItemId: item.id,
    unit: groups[0].unit, productRowId: groups[0].productRowId }, include: { revision: true }, orderBy: { id: 'asc' }, take: 2 });
  if (lines.length !== 2 || !item.productRowId) throw new Error('Stable concurrency pricing fixture is incomplete.');
  const contractedQuantity = lines.reduce((sum, line) => sum.add(line.quantity), new Prisma.Decimal(0)).toFixed(3);
  const actorId = `concurrency-${runId}`;
  const financialRecordId = `concurrency-financial-${runId}`;
  const versionId = `concurrency-pricing-${runId}`;
  const rowId = `concurrency-pricing-row-${runId}`;
  const approvedAt = new Date(Math.max(...lines.map(line => line.revision.finalizedAt.getTime())) - 1_000);
  const componentEvidence = { discountBasis: '100.000000000000' };
  const rowHash = approvedPricingRowIntegrityHash({ versionId, contractId: item.contractId,
    sourceFinancialRecordId: financialRecordId, versionNumber: 1, contractItemId: item.id,
    productRowId: item.productRowId, ordinal: 1, contractedQuantity, unit: groups[0].unit,
    canonicalAllInTotal: '100.000000000000', discountEligible: true, componentEvidence });
  const sourceEvidence = { customer: { id: `customer-${runId}` }, project: { id: `project-${runId}` },
    destination: { projectId: `project-${runId}`, address: `destination-${runId}` } };
  const versionHash = approvedPricingVersionIntegrityHash({ id: versionId, contractId: item.contractId,
    versionNumber: 1, sourceFinancialRecordId: financialRecordId, approvedAt, approvedBy: actorId,
    schemaVersion: 1, currency: 'IRR', grossAmount: '100.000000000000', discountAmount: '10.000000000000',
    netAmount: '90.000000000000', sourceEvidence, rowHashes: [rowHash] });
  await client.accountingFinancialRecord.create({ data: { id: financialRecordId, kind: 'INVOICE_CANDIDATE', status: 'ISSUED',
    sourceKind: 'SALES_CONTRACT', sourceId: item.contractId, contractId: item.contractId, amount: '90', currency: 'IRR',
    createdBy: actorId, financiallyApprovedAt: approvedAt, financiallyApprovedBy: actorId } });
  await client.contractApprovedPricingVersion.create({ data: { id: versionId, contractId: item.contractId, versionNumber: 1,
    sourceFinancialRecordId: financialRecordId, origin: 'FINANCIAL_APPROVAL', approvedAt, approvedBy: actorId,
    schemaVersion: 1, currency: 'IRR', grossAmount: '100.000000000000', discountAmount: '10.000000000000',
    netAmount: '90.000000000000', sourceEvidence, integrityHash: versionHash, rows: { create: { id: rowId,
      contractItemId: item.id, productRowId: item.productRowId, ordinal: 1, contractedQuantity, unit: groups[0].unit,
      canonicalAllInTotal: '100.000000000000', discountEligible: true, componentEvidence, integrityHash: rowHash } } } });
  await client.contractApprovedPricingHead.create({ data: { contractId: item.contractId, currentVersionId: versionId,
    advancedAt: approvedAt, advancedBy: actorId } });
  await client.contractPricingReadinessResult.create({ data: { id: randomUUID(), contractId: item.contractId,
    pricingVersionId: versionId, sourceFinancialRecordId: financialRecordId, status: 'READY', sourceCount: 1,
    sourceIdentityHash: 'a'.repeat(64), quantityTotal: contractedQuantity, amountTotal: '100.000000000000',
    evidenceHash: 'b'.repeat(64), evaluatedAt: approvedAt, evaluatedBy: actorId } });
  const manifest = await client.shipmentStatementMigrationManifest.create({ data: { id: `concurrency-manifest-${runId}`,
    migrationName: `concurrency-${runId}`, schemaVersion: 1, sourceSchemaHash: 'e'.repeat(64), createdBy: actorId } });
  const activatedAt = new Date('2000-01-01T00:00:01.000Z');
  await client.shipmentStatementCutover.update({ where: { id: 'customer-shipment-statements' }, data: {
    enabled: true, cutoverAt: new Date('2000-01-01T00:00:00.000Z'), activatedAt, activatedBy: actorId,
    manifestId: manifest.id, integrityHash: 'f'.repeat(64) } });
  return { actorId, item, lines, versionId, rowId, contractedQuantity, sourceEvidence, componentEvidence,
    scope: { customerId: `customer-${runId}`, projectId: `project-${runId}`, destination: `destination-${runId}` } };
};

export type ConcurrentPricingFixture = Awaited<ReturnType<typeof createConcurrentPricingFixture>>;

export const advanceConcurrentPricingVersion = async (
  tx: Prisma.TransactionClient,
  fixture: ConcurrentPricingFixture,
  runId: string,
) => {
  const financialRecordId = `concurrency-financial-v2-${runId}`;
  const versionId = `concurrency-pricing-v2-${runId}`;
  const rowId = `concurrency-pricing-row-v2-${runId}`;
  const approvedAt = new Date();
  const rowHash = approvedPricingRowIntegrityHash({ versionId, contractId: fixture.item.contractId,
    sourceFinancialRecordId: financialRecordId, versionNumber: 2, contractItemId: fixture.item.id,
    productRowId: fixture.item.productRowId!, ordinal: 1, contractedQuantity: fixture.contractedQuantity,
    unit: fixture.lines[0].unit, canonicalAllInTotal: '120.000000000000', discountEligible: true,
    componentEvidence: fixture.componentEvidence });
  const versionHash = approvedPricingVersionIntegrityHash({ id: versionId, contractId: fixture.item.contractId,
    versionNumber: 2, sourceFinancialRecordId: financialRecordId, approvedAt, approvedBy: fixture.actorId,
    schemaVersion: 1, currency: 'IRR', grossAmount: '120.000000000000', discountAmount: '12.000000000000',
    netAmount: '108.000000000000', sourceEvidence: fixture.sourceEvidence, rowHashes: [rowHash] });
  await tx.accountingFinancialRecord.create({ data: { id: financialRecordId, kind: 'INVOICE_CANDIDATE', status: 'ISSUED',
    sourceKind: 'SALES_CONTRACT', sourceId: fixture.item.contractId, contractId: fixture.item.contractId,
    amount: '108', currency: 'IRR', createdBy: fixture.actorId, financiallyApprovedAt: approvedAt,
    financiallyApprovedBy: fixture.actorId } });
  await tx.contractApprovedPricingVersion.create({ data: { id: versionId, contractId: fixture.item.contractId,
    versionNumber: 2, sourceFinancialRecordId: financialRecordId, origin: 'FINANCIAL_APPROVAL', approvedAt,
    approvedBy: fixture.actorId, schemaVersion: 1, currency: 'IRR', grossAmount: '120.000000000000',
    discountAmount: '12.000000000000', netAmount: '108.000000000000', sourceEvidence: fixture.sourceEvidence,
    integrityHash: versionHash, rows: { create: { id: rowId, contractItemId: fixture.item.id,
      productRowId: fixture.item.productRowId!, ordinal: 1, contractedQuantity: fixture.contractedQuantity,
      unit: fixture.lines[0].unit, canonicalAllInTotal: '120.000000000000', discountEligible: true,
      componentEvidence: fixture.componentEvidence, integrityHash: rowHash } } } });
  await tx.contractPricingReadinessResult.create({ data: { id: randomUUID(), contractId: fixture.item.contractId,
    pricingVersionId: versionId, sourceFinancialRecordId: financialRecordId, status: 'READY', sourceCount: 1,
    sourceIdentityHash: '1'.repeat(64), quantityTotal: fixture.contractedQuantity, amountTotal: '120.000000000000',
    evidenceHash: '2'.repeat(64), evaluatedAt: approvedAt, evaluatedBy: fixture.actorId } });
  await tx.contractApprovedPricingHead.update({ where: { contractId: fixture.item.contractId }, data: {
    currentVersionId: versionId, advancedAt: approvedAt, advancedBy: fixture.actorId } });
  return versionId;
};
