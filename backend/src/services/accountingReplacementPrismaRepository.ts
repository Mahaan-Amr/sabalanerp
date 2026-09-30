import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  hashAccountingReplacementEvidence,
  type AccountingReplacementRepository,
  type CutoverRun,
  type LegacyArchiveRecord,
  type MigrationDisposition,
  type MigrationReconciliation,
  type MigrationRun,
  type ParallelDifference,
  type ParallelRun,
  type RecoveryProof,
  type ReplacementAuditEntry,
} from './accountingReplacement';

type Database = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
const bigint = (value: unknown) => BigInt(String(value ?? 0));

const disposition = (row: any): MigrationDisposition => ({
  sourceId: row.sourceId, kind: row.kind, disposition: row.disposition, targetIdentity: row.targetIdentity,
  rejectionReason: row.rejectionReason, sourceHash: row.sourceHash, targetHash: row.targetHash,
  debitRials: bigint(row.debitRials), creditRials: bigint(row.creditRials), quantity: row.quantity,
  valueRials: row.valueRials == null ? null : bigint(row.valueRials), sourcePayload: row.sourcePayload,
});
const reconciliation = (value: any): MigrationReconciliation | null => value ? {
  sourceDebitRials: bigint(value.sourceDebitRials), sourceCreditRials: bigint(value.sourceCreditRials),
  targetDebitRials: bigint(value.targetDebitRials), targetCreditRials: bigint(value.targetCreditRials),
  sourceCount: Number(value.sourceCount), targetCount: Number(value.targetCount), rejectedCount: Number(value.rejectedCount), exact: Boolean(value.exact),
} : null;
const migration = (row: any): MigrationRun => ({
  id: row.id, bookId: row.bookId, sourceSystem: row.sourceSystem, sourcePackageHash: row.sourcePackageHash,
  toolVersion: row.toolVersion, mappingVersion: row.mappingVersion, scope: row.scope, status: row.status,
  inputCount: row.inputCount, acceptedCount: row.acceptedCount, rejectedCount: row.rejectedCount, outputHash: row.outputHash,
  dispositions: (row.dispositions ?? []).map(disposition), reconciliation: reconciliation(row.reconciliation),
  predecessorRunId: row.predecessorRunId, successorRunId: row.successorRunId, previewedAt: row.previewedAt,
  committedAt: row.committedAt, acceptedBy: row.acceptedBy, acceptanceReason: row.acceptanceReason,
});
const differences = (value: any): ParallelDifference[] => (Array.isArray(value) ? value : []).map((item) => ({
  code: String(item.code), amountRials: bigint(item.amountRials), itemCount: Number(item.itemCount), cause: String(item.cause),
  ownerId: String(item.ownerId), resolution: String(item.resolution), evidenceHash: String(item.evidenceHash), resolved: Boolean(item.resolved),
}));
const parallel = (row: any): ParallelRun => ({ ...row, differences: differences(row.differences) });
const recovery = (row: any): RecoveryProof => row;
const cutover = (row: any): CutoverRun => row;
const audit = (row: any): ReplacementAuditEntry => ({ sequence: bigint(row.sequence), action: row.action, payloadHash: row.payloadHash, previousHash: row.previousHash, entryHash: row.entryHash });

export const createAccountingReplacementPrismaRepository = (db: Database): AccountingReplacementRepository => {
  const repository: AccountingReplacementRepository = {
    transaction: async (operation) => '$transaction' in db
      ? (db as PrismaClient).$transaction((tx) => operation(createAccountingReplacementPrismaRepository(tx)))
      : operation(repository),
    findMigrationByPackageAndMapping: async (bookId, sourcePackageHash, mappingVersion) => {
      const row = await db.accountingReplacementMigrationRun.findUnique({
        where: { bookId_sourcePackageHash_mappingVersion: { bookId, sourcePackageHash, mappingVersion } },
        include: { dispositions: { orderBy: { sequence: 'asc' } } },
      });
      return row ? migration(row) : null;
    },
    getMigration: async (id) => {
      const row = await db.accountingReplacementMigrationRun.findUnique({ where: { id }, include: { dispositions: { orderBy: { sequence: 'asc' } } } });
      return row ? migration(row) : null;
    },
    saveMigration: async (run) => {
      const existing = await db.accountingReplacementMigrationRun.findUnique({ where: { id: run.id }, select: { id: true } });
      const data = {
        bookId: run.bookId, sourceSystem: run.sourceSystem, sourcePackageHash: run.sourcePackageHash, toolVersion: run.toolVersion,
        mappingVersion: run.mappingVersion, scope: json(run.scope), status: run.status, inputCount: run.inputCount,
        acceptedCount: run.acceptedCount, rejectedCount: run.rejectedCount, outputHash: run.outputHash,
        reconciliation: run.reconciliation ? json(run.reconciliation) : Prisma.JsonNull, predecessorRunId: run.predecessorRunId,
        successorRunId: run.successorRunId, previewedAt: run.previewedAt, committedAt: run.committedAt,
        acceptedBy: run.acceptedBy, acceptanceReason: run.acceptanceReason,
      };
      if (existing) { await db.accountingReplacementMigrationRun.update({ where: { id: run.id }, data }); return; }
      await db.accountingReplacementMigrationRun.create({ data: {
        id: run.id, ...data,
        dispositions: { create: run.dispositions.map((item, sequence) => ({
          id: `${run.id}:${sequence + 1}`, sequence: sequence + 1, sourceId: item.sourceId, kind: item.kind,
          disposition: item.disposition, targetIdentity: item.targetIdentity, rejectionReason: item.rejectionReason,
          sourceHash: item.sourceHash, targetHash: item.targetHash, debitRials: item.debitRials.toString(),
          creditRials: item.creditRials.toString(), quantity: item.quantity, valueRials: item.valueRials?.toString(), sourcePayload: json(item.sourcePayload),
        })) },
      } });
    },
    saveArchive: async (record: LegacyArchiveRecord) => {
      await db.accountingLegacyArchiveRecord.upsert({ where: { id: record.id }, update: {}, create: {
        id: record.id, bookId: record.bookId, migrationRunId: record.migrationRunId, sourceId: record.sourceId,
        sourceHash: record.sourceHash, payload: json(record.payload), searchText: record.searchText,
      } });
    },
    searchArchive: async (bookId, query) => (await db.accountingLegacyArchiveRecord.findMany({
      where: { bookId, searchText: { contains: query.trim(), mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: 100,
    })).map((row) => ({ id: row.id, bookId: row.bookId, sourceId: row.sourceId, sourceHash: row.sourceHash, payload: row.payload,
      searchText: row.searchText, readOnly: true as const, postedVoucherId: null, migrationRunId: row.migrationRunId })),
    saveParallelRun: async (run) => {
      const exists = await db.accountingReplacementParallelRun.findUnique({ where: { bookId_periodIdentity: { bookId: run.bookId, periodIdentity: run.periodIdentity } }, select: { id: true } });
      if (!exists) await db.accountingReplacementParallelRun.create({ data: { ...run, differences: json(run.differences) } });
    },
    listParallelRuns: async (bookId) => (await db.accountingReplacementParallelRun.findMany({ where: { bookId }, orderBy: { recordedAt: 'asc' } })).map(parallel),
    saveRecoveryProof: async (proof) => {
      const exists = await db.accountingReplacementRecoveryProof.findUnique({ where: { bookId_checkpointIdentity: { bookId: proof.bookId, checkpointIdentity: proof.checkpointIdentity } }, select: { id: true } });
      if (!exists) await db.accountingReplacementRecoveryProof.create({ data: proof });
    },
    findRecoveryProof: async (bookId, checkpointIdentity) => {
      const row = await db.accountingReplacementRecoveryProof.findUnique({ where: { bookId_checkpointIdentity: { bookId, checkpointIdentity } } });
      return row ? recovery(row) : null;
    },
    saveCutover: async (run) => { await db.accountingReplacementCutoverRun.upsert({ where: { id: run.id }, update: run, create: run }); },
    getCutover: async (id) => { const row = await db.accountingReplacementCutoverRun.findUnique({ where: { id } }); return row ? cutover(row) : null; },
    findTransferredCutover: async (bookId) => { const row = await db.accountingReplacementCutoverRun.findFirst({ where: { bookId, authorityTransferredAt: { not: null } } }); return row ? cutover(row) : null; },
    appendAudit: async (action, payload) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('accounting-replacement-audit'))`;
      const previous = await db.accountingReplacementAuditEntry.findFirst({ orderBy: { sequence: 'desc' } });
      const unsigned = { sequence: (previous?.sequence ?? 0n) + 1n, action, payloadHash: hashAccountingReplacementEvidence(payload), previousHash: previous?.entryHash ?? null };
      const row = await db.accountingReplacementAuditEntry.create({ data: { id: randomUUID(), ...unsigned, entryHash: hashAccountingReplacementEvidence(unsigned) } });
      return audit(row);
    },
    listAudit: async () => (await db.accountingReplacementAuditEntry.findMany({ orderBy: { sequence: 'asc' } })).map(audit),
  };
  return repository;
};
