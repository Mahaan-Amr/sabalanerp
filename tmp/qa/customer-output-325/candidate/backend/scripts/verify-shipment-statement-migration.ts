import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  SHIPMENT_STATEMENT_MIGRATION_NAME,
  SHIPMENT_STATEMENT_SCHEMA_VERSION,
  compareMigrationEvidence,
} from '../src/services/dispatchDocuments/migrationManifest';
import { captureShipmentStatementMigrationEvidence } from '../src/services/dispatchDocuments/migrationVerifier';

const actorId = process.env.SHIPMENT_STATEMENT_MIGRATION_ACTOR_ID?.trim();
if (!actorId) throw new Error('SHIPMENT_STATEMENT_MIGRATION_ACTOR_ID is required.');

const prisma = new PrismaClient();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const migrationNames = [
  '20260809000100_shipment_statement_data_contracts',
  '20260809000110_harden_shipment_statement_data_contracts',
  '20260809000120_review_harden_shipment_statement_contracts',
];

const sourceSchemaHash = hash(migrationNames.map((name) => readFileSync(
  resolve(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'),
  'utf8',
)).join('\n'));

const run = async () => {
  const captureConsistentSnapshot = () => prisma.$transaction(
    (tx) => captureShipmentStatementMigrationEvidence(tx),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  const before = await captureConsistentSnapshot();
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  const after = await captureConsistentSnapshot();
  const comparisons = before.map((snapshot, index) => compareMigrationEvidence(snapshot, after[index]));
  const matched = comparisons.every((comparison) => comparison.matched);

  const manifest = await prisma.shipmentStatementMigrationManifest.findUnique({
    where: { migrationName: SHIPMENT_STATEMENT_MIGRATION_NAME },
  }) ?? await prisma.shipmentStatementMigrationManifest.create({
    data: {
      id: randomUUID(),
      migrationName: SHIPMENT_STATEMENT_MIGRATION_NAME,
      schemaVersion: SHIPMENT_STATEMENT_SCHEMA_VERSION,
      sourceSchemaHash,
      createdBy: actorId,
    },
  });
  if (manifest.sourceSchemaHash !== sourceSchemaHash) {
    throw new Error('The immutable shipment-statement migration manifest hash differs from the checked-in migrations.');
  }

  const completedAt = new Date();
  const persisted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "shipment_statement_migration_manifests" WHERE "id" = ${manifest.id} FOR UPDATE`;
    const latest = await tx.shipmentStatementMigrationRun.findFirst({
      where: { manifestId: manifest.id },
      orderBy: { runNumber: 'desc' },
      select: { runNumber: true },
    });
    return tx.shipmentStatementMigrationRun.create({ data: {
      id: randomUUID(),
      manifestId: manifest.id,
      runNumber: (latest?.runNumber ?? 0) + 1,
      status: matched ? 'COMPLETED' : 'FAILED',
      completedAt,
      reason: matched ? null : 'LEGACY_EVIDENCE_CHANGED_DURING_MIGRATION',
      evidence: {
        create: comparisons.map((comparison) => ({
          id: randomUUID(),
          scope: comparison.scope,
          beforeRecordCount: BigInt(comparison.before.recordCount),
          afterRecordCount: BigInt(comparison.after.recordCount),
          beforeIdentityHash: comparison.before.identityHash,
          afterIdentityHash: comparison.after.identityHash,
          beforeQuantityTotal: comparison.before.quantityTotal == null ? null : new Prisma.Decimal(comparison.before.quantityTotal),
          afterQuantityTotal: comparison.after.quantityTotal == null ? null : new Prisma.Decimal(comparison.after.quantityTotal),
          beforeAmountTotal: comparison.before.amountTotal == null ? null : new Prisma.Decimal(comparison.before.amountTotal),
          afterAmountTotal: comparison.after.amountTotal == null ? null : new Prisma.Decimal(comparison.after.amountTotal),
          beforeEvidenceHash: comparison.before.evidenceHash,
          afterEvidenceHash: comparison.after.evidenceHash,
          outcome: comparison.matched ? 'MATCHED' : 'FAILED',
          reason: comparison.matched ? null : comparison.differences.join(','),
          detail: { differences: comparison.differences },
        })),
      },
    }, include: { evidence: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  console.log(JSON.stringify({
    migrationName: manifest.migrationName,
    runNumber: persisted.runNumber,
    status: persisted.status,
    evidenceScopes: persisted.evidence.length,
    sourceSchemaHash,
  }));
  if (!matched) process.exitCode = 1;
};

run().finally(() => prisma.$disconnect());
