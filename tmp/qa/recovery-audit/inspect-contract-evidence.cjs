const { PrismaClient } = require('/app/node_modules/@prisma/client');
const { sanitizeContractDataCustomerSnapshot } = require('/app/dist/services/contractSnapshotBoundary.js');

const url = process.env.AUDIT_DATABASE_URL;
if (!url) throw new Error('AUDIT_DATABASE_URL is required');
const prisma = new PrismaClient({ datasources: { db: { url } } });

const differences = (left, right, path = '$') => {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
      differences(left[index], right[index], `${path}[${index}]`)).flat();
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].sort().flatMap(key => differences(left[key], right[key], `${path}.${key}`));
  }
  return [{ path, snapshot: left, current: right }];
};

const run = async () => {
  const contracts = await prisma.salesContract.findMany({
    where: { contractNumber: { in: process.argv.slice(2) } },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      productGraphState: true,
    },
  });
  const financialRecords = await prisma.accountingFinancialRecord.findMany({
    where: { contractId: { in: contracts.map(contract => contract.id) }, kind: 'INVOICE_CANDIDATE' },
    include: { invoiceItems: true },
    orderBy: { createdAt: 'desc' },
  });
  const graphAudits = await prisma.salesContractProductGraphAudit.findMany({
    where: { contractId: { in: contracts.map(contract => contract.id) } },
    orderBy: { createdAt: 'asc' },
  });
  const accountingAudits = await prisma.accountingAuditLog.findMany({
    where: { contractId: { in: contracts.map(contract => contract.id) } },
    orderBy: { createdAt: 'asc' },
  });
  const report = contracts.map(contract => ({
    contractNumber: contract.contractNumber,
    contractId: contract.id,
    status: contract.status,
    graphAudits: graphAudits.filter(audit => audit.contractId === contract.id),
    accountingAudits: accountingAudits.filter(audit => audit.contractId === contract.id),
    records: financialRecords.filter(record => record.contractId === contract.id).map(record => {
      const snapshot = record.sourceSnapshot;
      return {
        financialRecordId: record.id,
        recordStatus: record.status,
        snapshotIdentity: { id: snapshot.id, customerId: snapshot.customerId, currency: snapshot.currency, totalAmount: snapshot.totalAmount },
        currentIdentity: { id: contract.id, customerId: contract.customerId, currency: contract.currency, totalAmount: contract.totalAmount?.toString() },
        commercialDifferences: differences(
          sanitizeContractDataCustomerSnapshot(snapshot.contractData),
          sanitizeContractDataCustomerSnapshot(contract.contractData),
        ),
        snapshotItems: Array.isArray(snapshot.items) ? snapshot.items : null,
        currentItems: contract.items.map(item => ({
          id: item.id, productId: item.productId, productRowId: item.productRowId,
          productType: item.productType, quantity: item.quantity.toString(), totalPrice: item.totalPrice.toString(),
        })),
        snapshotGraphState: snapshot.productGraphState ?? null,
        currentGraphState: contract.productGraphState,
        invoiceItems: record.invoiceItems.map(item => ({
          id: item.id, contractItemId: item.contractItemId, productId: item.productId,
          quantity: item.quantity.toString(), totalPrice: item.totalPrice.toString(),
        })),
      };
    }),
  }));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

run().finally(() => prisma.$disconnect());
