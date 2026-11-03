import { PrismaClient } from '@prisma/client';
import { sanitizeContractDataCustomerSnapshot } from '../../../backend/src/services/contractSnapshotBoundary';

const url = process.env.AUDIT_DATABASE_URL;
if (!url) throw new Error('AUDIT_DATABASE_URL is required');
const prisma = new PrismaClient({ datasources: { db: { url } } });

const stable = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]))
    : value;

const differences = (left: unknown, right: unknown, path = '$'): Array<Record<string, unknown>> => {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
      differences(left[index], right[index], `${path}[${index}]`)).flat();
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const keys = new Set([...Object.keys(left as object), ...Object.keys(right as object)]);
    return [...keys].sort().flatMap(key => differences(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
      `${path}.${key}`,
    ));
  }
  return [{ path, snapshot: left, current: right }];
};

const run = async () => {
  const requested = process.argv.slice(2);
  const contracts = await prisma.salesContract.findMany({
    where: { contractNumber: { in: requested } },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      productGraphState: true,
      financialRecords: {
        where: { kind: 'INVOICE_CANDIDATE' },
        include: { invoiceItems: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  const report = contracts.map(contract => ({
    contractNumber: contract.contractNumber,
    contractId: contract.id,
    status: contract.status,
    records: contract.financialRecords.map(record => {
      const snapshot = record.sourceSnapshot as Record<string, unknown>;
      const snapshotCommercial = stable(sanitizeContractDataCustomerSnapshot(snapshot.contractData));
      const currentCommercial = stable(sanitizeContractDataCustomerSnapshot(contract.contractData));
      return {
        financialRecordId: record.id,
        recordStatus: record.status,
        snapshotIdentity: { id: snapshot.id, customerId: snapshot.customerId, currency: snapshot.currency, totalAmount: snapshot.totalAmount },
        currentIdentity: { id: contract.id, customerId: contract.customerId, currency: contract.currency, totalAmount: contract.totalAmount?.toString() },
        commercialDifferences: differences(snapshotCommercial, currentCommercial),
        snapshotItems: Array.isArray(snapshot.items) ? snapshot.items : null,
        currentItems: contract.items.map(item => ({
          id: item.id,
          productId: item.productId,
          productRowId: item.productRowId,
          productType: item.productType,
          quantity: item.quantity.toString(),
          totalPrice: item.totalPrice.toString(),
        })),
        snapshotGraphState: snapshot.productGraphState ?? null,
        currentGraphState: contract.productGraphState,
        invoiceItems: record.invoiceItems.map(item => ({
          id: item.id,
          contractItemId: item.contractItemId,
          productId: item.productId,
          quantity: item.quantity.toString(),
          totalPrice: item.totalPrice.toString(),
        })),
      };
    }),
  }));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

run().finally(() => prisma.$disconnect());
