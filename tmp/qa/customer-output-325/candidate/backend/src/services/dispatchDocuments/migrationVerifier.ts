import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  SHIPMENT_STATEMENT_PRESERVATION_SCOPES,
  type MigrationEvidenceSnapshot,
  type ShipmentStatementPreservationScope,
} from './migrationManifest';

type QueryDatabase = {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
};

type EvidenceRow = Record<string, unknown> & { id: string };

type ScopeQuery = {
  scope: ShipmentStatementPreservationScope;
  sql: string;
  quantityField?: string;
  amountField?: string;
};

const scopeQueries: ScopeQuery[] = [
  { scope: 'sales_contracts', sql: 'SELECT "id", "totalAmount"::text AS "amount" FROM "sales_contracts" ORDER BY "id"', amountField: 'amount' },
  { scope: 'contract_items', sql: 'SELECT "id", "quantity"::text AS "quantity", "totalPrice"::text AS "amount" FROM "contract_items" ORDER BY "id"', quantityField: 'quantity', amountField: 'amount' },
  { scope: 'accounting_financial_records', sql: 'SELECT "id", "amount"::text AS "amount" FROM "accounting_financial_records" ORDER BY "id"', amountField: 'amount' },
  { scope: 'logistics_allocation_revisions', sql: 'SELECT "id" FROM "logistics_allocation_revisions" ORDER BY "id"' },
  { scope: 'logistics_allocation_revision_lines', sql: 'SELECT "id", "quantity"::text AS "quantity" FROM "logistics_allocation_revision_lines" ORDER BY "id"', quantityField: 'quantity' },
  { scope: 'accounting_dispatch_waybills', sql: 'SELECT "id" FROM "accounting_dispatch_waybills" ORDER BY "id"' },
  { scope: 'dispatch_corrections', sql: 'SELECT "id" FROM "dispatch_corrections" ORDER BY "id"' },
  { scope: 'dispatch_lifecycle_audits', sql: 'SELECT "id" FROM "dispatch_lifecycle_audits" ORDER BY "id"' },
];

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const sumField = (rows: EvidenceRow[], field: string | undefined, scale: number): string | null => {
  if (!field) return null;
  const total = rows.reduce(
    (sum, row) => row[field] == null ? sum : sum.plus(String(row[field])),
    new Prisma.Decimal(0),
  );
  return total.toFixed(scale);
};

export const buildMigrationEvidenceSnapshot = (
  query: ScopeQuery,
  rows: EvidenceRow[],
): MigrationEvidenceSnapshot => {
  const normalizedRows = rows.map((row) => Object.fromEntries(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right)),
  ));
  const quantityTotal = sumField(rows, query.quantityField, 3);
  const amountTotal = sumField(rows, query.amountField, 12);
  const identityHash = sha256(JSON.stringify(rows.map(({ id }) => id)));
  return {
    scope: query.scope,
    recordCount: String(rows.length),
    identityHash,
    quantityTotal,
    amountTotal,
    evidenceHash: sha256(JSON.stringify({ scope: query.scope, rows: normalizedRows, quantityTotal, amountTotal })),
  };
};

export const captureShipmentStatementMigrationEvidence = async (
  database: QueryDatabase,
): Promise<MigrationEvidenceSnapshot[]> => {
  const snapshots = await Promise.all(scopeQueries.map(async (query) => {
    const rows = await database.$queryRawUnsafe<EvidenceRow[]>(query.sql);
    return buildMigrationEvidenceSnapshot(query, rows);
  }));
  const byScope = new Map(snapshots.map((snapshot) => [snapshot.scope, snapshot]));
  return SHIPMENT_STATEMENT_PRESERVATION_SCOPES.map((scope) => byScope.get(scope)!);
};
