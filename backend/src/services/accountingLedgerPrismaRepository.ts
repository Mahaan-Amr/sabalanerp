import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type {
  AccountingLedgerRepository,
  DraftVoucherPersistence,
  LedgerLineInput,
  LedgerVoucherRecord,
  PostingContext,
} from './accountingLedgerFoundation';
import { AccountingLedgerError, hashAccountingEvidence, type AccountingAccessProfile } from './accountingLedgerFoundation';
import { assertLocalSepidarHistoricalPosting, assertSepidarHistoricalPostingCandidate, type SepidarLedgerReconciliationInput } from './accountingSepidarLedgerReconciliation';

type Database = PrismaClient | Prisma.TransactionClient;

const decimalToBigInt = (value: Prisma.Decimal) => BigInt(value.toFixed(0));

const canonicalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]),
  );
  return value;
};

const auditEntryHash = (entry: {
  sequence: bigint; action: string; result: string; actorId: string; effectiveProfile: string;
  entityType: string; entityId: string; correlationId: string; reason?: string | null;
  payloadHash: string; previousHash?: string | null; sessionContext?: unknown; createdAt: Date;
}) => createHash('sha256').update(JSON.stringify(canonicalize({
  sequence: entry.sequence,
  action: entry.action,
  result: entry.result,
  actorId: entry.actorId,
  effectiveProfile: entry.effectiveProfile,
  entityType: entry.entityType,
  entityId: entry.entityId,
  correlationId: entry.correlationId,
  reason: entry.reason ?? null,
  payloadHash: entry.payloadHash,
  previousHash: entry.previousHash ?? null,
  sessionContext: entry.sessionContext ?? null,
  createdAt: entry.createdAt,
}))).digest('hex');

const lineInput = (line: any): LedgerLineInput => ({
  accountId: line.accountId,
  partyId: line.partyId ?? undefined,
  financialAccountId: line.financialAccountId ?? undefined,
  debitRials: decimalToBigInt(line.debitRials),
  creditRials: decimalToBigInt(line.creditRials),
  description: line.description ?? undefined,
  dimensions: (line.dimensions || []).map((dimension: any) => ({
    typeId: dimension.dimensionTypeId,
    memberId: dimension.memberId,
  })).sort((left: { typeId: string; memberId: string }, right: { typeId: string; memberId: string }) => `${left.typeId}:${left.memberId}`.localeCompare(`${right.typeId}:${right.memberId}`)),
  originalAmount: line.originalAmount?.toString(),
  originalCurrency: line.originalCurrency ?? undefined,
  exchangeRate: line.exchangeRate?.toString(),
  exchangeRateDate: line.exchangeRateDate ?? undefined,
  exchangeRateSource: line.exchangeRateSource ?? undefined,
  rawAmountBeforeRounding: line.rawAmountBeforeRounding?.toString(),
  roundingRuleVersion: line.roundingRuleVersion ?? undefined,
  evidence: {
    type: line.evidenceType,
    id: line.evidenceId,
    version: line.evidenceVersion,
    hash: line.evidenceHash,
    payload: line.evidencePayload,
  },
});

const voucherRecord = (voucher: any): LedgerVoucherRecord => ({
  id: voucher.id,
  bookId: voucher.bookId,
  fiscalYearId: voucher.fiscalYearId,
  periodId: voucher.periodId,
  referenceNumber: voucher.referenceNumber,
  statutoryNumber: voucher.statutoryNumber,
  idempotencyKey: voucher.idempotencyKey,
  correlationId: voucher.correlationId,
  description: voucher.description,
  documentDate: voucher.documentDate,
  occurredAt: voucher.occurredAt,
  recordedAt: voucher.recordedAt,
  discoveredAt: voucher.discoveredAt,
  source: {
    type: voucher.sourceType,
    id: voucher.sourceId,
    version: voucher.sourceVersion,
    hash: voucher.sourceHash,
    payload: voucher.sourcePayload,
  },
  actorId: voucher.createdBy,
  status: voucher.status,
  debitTotalRials: decimalToBigInt(voucher.debitTotalRials),
  creditTotalRials: decimalToBigInt(voucher.creditTotalRials),
  contentHash: voucher.contentHash,
  lines: (voucher.lines || []).map(lineInput),
  postedAt: voucher.postedAt,
  reversedAt: voucher.reversedAt,
  reversalOfId: voucher.reversalOfId,
});

const includeLines = {
  lines: { orderBy: { sequence: 'asc' as const }, include: { dimensions: true } },
};

// Ordinary ledger projections intentionally exclude immutable source/evidence
// payloads, hashes and external evidence identities. Those fields are proof
// material, not report data, and must never ride along on Viewer list reads.
const reportVoucherSelect = {
  id: true,
  bookId: true,
  fiscalYearId: true,
  periodId: true,
  referenceNumber: true,
  statutoryNumber: true,
  correlationId: true,
  status: true,
  description: true,
  documentDate: true,
  occurredAt: true,
  recordedAt: true,
  discoveredAt: true,
  postedAt: true,
  reversedAt: true,
  debitTotalRials: true,
  creditTotalRials: true,
  reversalOfId: true,
  createdAt: true,
  lines: {
    orderBy: { sequence: 'asc' as const },
    select: {
      id: true,
      sequence: true,
      accountId: true,
      partyId: true,
      financialAccountId: true,
      debitRials: true,
      creditRials: true,
      description: true,
      originalAmount: true,
      originalCurrency: true,
      exchangeRate: true,
      exchangeRateDate: true,
      exchangeRateSource: true,
      rawAmountBeforeRounding: true,
      roundingRuleVersion: true,
      account: { select: { id: true, code: true, titlePersian: true, level: true, normalSide: true } },
      dimensions: {
        select: {
          id: true,
          dimensionTypeId: true,
          memberId: true,
          dimensionType: { select: { id: true, code: true, titlePersian: true } },
          member: { select: { id: true, code: true, titlePersian: true } },
        },
      },
    },
  },
} satisfies Prisma.AccountingLedgerVoucherSelect;

export const createAccountingLedgerPrismaRepository = (
  database: Database,
  transactional = false,
): AccountingLedgerRepository => {
  const repository: AccountingLedgerRepository = {
    transaction: async <T>(operation: (tx: AccountingLedgerRepository) => Promise<T>) => {
      if (transactional) return operation(repository);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          return await (database as PrismaClient).$transaction(
            (tx) => operation(createAccountingLedgerPrismaRepository(tx, true)),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        } catch (error) {
          const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : '';
          const databaseCode = error instanceof Prisma.PrismaClientKnownRequestError
            ? String((error.meta as { code?: string } | undefined)?.code || '')
            : '';
          if (attempt === 4 || (!['P2002', 'P2034'].includes(code) && databaseCode !== '40001')) throw error;
        }
      }
      throw new Error('تراکنش حسابداری پس از تلاش مجدد کامل نشد.');
    },

    getPostingContext: async ({ bookId, fiscalYearId, periodId, documentDate }): Promise<PostingContext> => {
      // Posting and period-state transitions take the same transaction-scoped
      // lock, so neither can cross a hard-close boundary after validating it.
      if (transactional) await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${periodId}))`;
      const [book, fiscalYear, period, accounts, dimensionTypes, parties, financialAccounts] = await Promise.all([
        database.accountingBook.findUnique({ where: { id: bookId }, select: { id: true, baseCurrency: true } }),
        database.accountingFiscalYear.findUnique({ where: { id: fiscalYearId }, select: { id: true, bookId: true, status: true } }),
        database.accountingPostingPeriod.findUnique({
          where: { id: periodId },
          select: { id: true, fiscalYearId: true, status: true, startsAt: true, endsAt: true },
        }),
        database.accountingLedgerAccount.findMany({
          where: { bookId },
          include: { dimensionRules: { select: { dimensionTypeId: true, requirement: true } } },
        }),
        database.accountingDimensionType.findMany({
          where: { bookId },
          select: {
            id: true,
            members: {
              where: {
                effectiveFrom: { lte: documentDate },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: documentDate } }],
              },
              select: { id: true },
            },
          },
        }),
        database.accountingParty.findMany({
          where: { legalEntity: { books: { some: { id: bookId } } }, activeFrom: { lte: documentDate }, OR: [{ activeTo: null }, { activeTo: { gte: documentDate } }] },
          select: { id: true },
        }),
        database.accountingFinancialAccount.findMany({
          where: { legalEntity: { books: { some: { id: bookId } } }, activeFrom: { lte: documentDate }, OR: [{ activeTo: null }, { activeTo: { gte: documentDate } }] },
          select: { id: true },
        }),
      ]);
      if (!book || !fiscalYear || !period) throw new Error('بستر ثبت حسابداری کامل نیست.');
      return {
        book: { id: book.id, baseCurrency: book.baseCurrency as 'IRR' },
        fiscalYear,
        period,
        accounts: new Map(accounts.map((account) => [account.id, {
          id: account.id,
          active: !account.retiredAt,
          effectiveFrom: account.effectiveFrom,
          effectiveTo: account.effectiveTo,
          level: account.level,
          currencyBehavior: account.currencyBehavior,
          partyRequirement: account.partyRequirement,
          financialAccountRequirement: account.financialAccountRequirement,
          dimensionRules: account.dimensionRules,
        }])),
        dimensionMembers: new Map(dimensionTypes.map((type) => [type.id, new Set(type.members.map(({ id }) => id))])),
        partyIds: new Set(parties.map(({ id }) => id)),
        financialAccountIds: new Set(financialAccounts.map(({ id }) => id)),
      };
    },

    findVoucherByIdempotencyKey: async (idempotencyKey) => {
      const found = await database.accountingLedgerVoucher.findUnique({
        where: { idempotencyKey }, include: includeLines,
      });
      return found ? voucherRecord(found) : null;
    },

    findVoucherBySource: async ({ bookId, type, id, version }) => {
      const found = await database.accountingLedgerVoucher.findFirst({
        where: { bookId, sourceType: type, sourceId: id, sourceVersion: version }, include: includeLines,
      });
      return found ? voucherRecord(found) : null;
    },

    createDraftVoucher: async (input: DraftVoucherPersistence) => {
      const created = await database.accountingLedgerVoucher.create({
        data: {
          bookId: input.bookId,
          fiscalYearId: input.fiscalYearId,
          periodId: input.periodId,
          referenceNumber: input.referenceNumber,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          description: input.description,
          documentDate: input.documentDate,
          occurredAt: input.occurredAt,
          discoveredAt: input.discoveredAt,
          recordedAt: input.recordedAt,
          sourceType: input.source.type,
          sourceId: input.source.id,
          sourceVersion: input.source.version,
          sourceHash: input.source.hash,
          sourcePayload: canonicalize(input.source.payload) as Prisma.InputJsonValue,
          debitTotalRials: input.debitTotalRials.toString(),
          creditTotalRials: input.creditTotalRials.toString(),
          contentHash: input.contentHash,
          createdBy: input.actorId,
          lines: {
            create: input.lines.map((line, index) => ({
              sequence: index + 1,
              accountId: line.accountId,
              partyId: line.partyId,
              financialAccountId: line.financialAccountId,
              debitRials: line.debitRials.toString(),
              creditRials: line.creditRials.toString(),
              description: line.description,
              originalAmount: line.originalAmount,
              originalCurrency: line.originalCurrency,
              exchangeRate: line.exchangeRate,
              exchangeRateDate: line.exchangeRateDate,
              exchangeRateSource: line.exchangeRateSource,
              rawAmountBeforeRounding: line.rawAmountBeforeRounding,
              roundingRuleVersion: line.roundingRuleVersion,
              evidenceType: line.evidence.type,
              evidenceId: line.evidence.id,
              evidenceVersion: line.evidence.version,
              evidenceHash: line.evidence.hash,
              evidencePayload: canonicalize(line.evidence.payload) as Prisma.InputJsonValue,
              dimensions: {
                create: line.dimensions.map((dimension) => ({
                  dimensionTypeId: dimension.typeId,
                  memberId: dimension.memberId,
                })),
              },
            })),
          },
        },
        include: includeLines,
      });
      return voucherRecord(created);
    },

    getVoucherForUpdate: async (id) => {
      if (transactional) await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const found = await database.accountingLedgerVoucher.findUnique({ where: { id }, include: includeLines });
      return found ? voucherRecord(found) : null;
    },

    confirmSepidarPostingSource: async (voucher) => {
      assertLocalSepidarHistoricalPosting(voucher.bookId, { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL });
      const payload = voucher.source.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || hashAccountingEvidence(payload) !== voucher.source.hash) {
        throw new AccountingLedgerError('SEPIDAR_SOURCE_NOT_VERIFIED', 'اثر انگشت منشأ سند سپیدار معتبر نیست.', 409);
      }
      const evidence = payload as Record<string, unknown>;
      const snapshotId = String(evidence.snapshotId ?? '');
      const sourceRecordHash = String(evidence.sourceRecordHash ?? '');
      const voucherLinks = await database.accountingSepidarTargetLink.findMany({
        where: { bookId: voucher.bookId, sourceTable: 'ACC.Voucher', targetKind: 'LEDGER_DRAFT', targetId: voucher.id },
      });
      const link = voucherLinks.length === 1 ? voucherLinks[0] : null;
      if (!link || link.reviewStatus !== 'USER_APPROVED' || !link.reviewedBy
          || link.sourceHash !== sourceRecordHash || link.firstSnapshotId !== snapshotId) {
        throw new AccountingLedgerError('SEPIDAR_SOURCE_NOT_VERIFIED', 'پیوند سند سپیدار یا تأیید نگاشت آن معتبر نیست.', 409);
      }
      const [snapshot, record] = await Promise.all([
        database.accountingSepidarSourceSnapshot.findUnique({ where: { id: snapshotId } }),
        database.accountingSepidarSourceRecord.findUnique({ where: { snapshotId_sourceTable_sourceKey: {
          snapshotId, sourceTable: 'ACC.Voucher', sourceKey: link.sourceKey,
        } } }),
      ]);
      if (snapshot?.status !== 'COMPLETE' || snapshot.bookId !== voucher.bookId || record?.sourceHash !== sourceRecordHash) {
        throw new AccountingLedgerError('SEPIDAR_SOURCE_NOT_VERIFIED', 'نسخهٔ کامل منبع و رکورد سند با پیوند مقصد تطبیق ندارند.', 409);
      }
      if (!snapshot || !record || !/^\d+$/.test(link.sourceKey)) {
        throw new AccountingLedgerError('SEPIDAR_SOURCE_NOT_VERIFIED', 'شناسهٔ منبع سند سپیدار معتبر نیست.', 409);
      }
      const rawVoucher = record.payload as Record<string, unknown>;
      const sourceLines = await database.accountingSepidarSourceRecord.findMany({ where: { snapshotId,
        sourceTable: 'ACC.VoucherItem', payload: { path: ['VoucherRef'], equals: Number(link.sourceKey) } } });
      const [masters, mappings, archiveCount, completeSnapshots, target, audit] = await Promise.all([
        database.accountingSepidarSourceRecord.findMany({ where: { snapshotId, OR: [
          { sourceTable: { in: ['ACC.Account', 'ACC.DL', 'GNR.Party', 'RPA.BankAccount'] } },
          { sourceTable: 'FMK.FiscalYear', sourceKey: String(rawVoucher.FiscalYearRef) },
        ] } }),
        database.accountingSepidarTargetLink.findMany({ where: { bookId: voucher.bookId,
          sourceTable: { in: ['ACC.Account', 'ACC.DL', 'GNR.Party', 'RPA.BankAccount'] } } }),
        database.accountingSepidarSourceRecord.count({ where: { snapshotId } }),
        database.accountingSepidarSourceSnapshot.findMany({ where: { bookId: voucher.bookId, status: 'COMPLETE', completedAt: { not: null } }, select: { id: true } }),
        database.accountingLedgerVoucher.findUnique({ where: { id: voucher.id }, select: {
          id: true, bookId: true, fiscalYearId: true, documentDate: true, status: true, postedAt: true,
          sourceType: true, sourceId: true, sourceVersion: true, sourceHash: true, sourcePayload: true,
          debitTotalRials: true, creditTotalRials: true,
          fiscalYear: { select: { code: true, bookId: true } }, period: { select: { fiscalYearId: true, startsAt: true, endsAt: true } },
          lines: { select: { id: true, sequence: true, accountId: true, account: { select: { bookId: true } },
            partyId: true, financialAccountId: true, debitRials: true, creditRials: true,
            evidenceType: true, evidenceId: true, evidenceVersion: true, evidenceHash: true, evidencePayload: true,
            dimensions: { select: { memberId: true, dimensionType: { select: { code: true, bookId: true } } } } } },
        } }),
        verifyLedgerAuditChain(database),
      ]);
      if (!target) throw new AccountingLedgerError('SEPIDAR_SOURCE_NOT_VERIFIED', 'سند مقصد سپیدار پیدا نشد.', 409);
      const input: SepidarLedgerReconciliationInput = {
        bookId: voucher.bookId, snapshot: { ...snapshot, exportFormat: String((snapshot.sourceMetadata as Record<string, unknown>).exportFormat ?? '') },
        actualArchiveRecordCount: archiveCount, completeSnapshotIds: completeSnapshots.map((item) => item.id),
        sources: [record, ...sourceLines, ...masters], links: [...voucherLinks, ...mappings],
        audit: { valid: audit.valid, checkedEntries: audit.checkedEntries },
        vouchers: [{ ...target, fiscalYearCode: target.fiscalYear.code, fiscalYearBookId: target.fiscalYear.bookId,
          periodFiscalYearId: target.period.fiscalYearId, periodStartsAt: target.period.startsAt, periodEndsAt: target.period.endsAt,
          debitTotalRials: target.debitTotalRials.toString(), creditTotalRials: target.creditTotalRials.toString(),
          lines: target.lines.map((line) => ({ ...line, accountBookId: line.account.bookId,
            debitRials: line.debitRials.toString(), creditRials: line.creditRials.toString(),
            dimensions: line.dimensions.map((dimension) => ({ memberId: dimension.memberId,
              typeCode: dimension.dimensionType.code, bookId: dimension.dimensionType.bookId })) })),
        }],
      };
      assertSepidarHistoricalPostingCandidate(input, voucher.id, { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL });
    },

    allocateStatutoryNumber: async ({ bookId, fiscalYearId }) => {
      const rows = await database.$queryRaw<Array<{ allocated: number }>>`
        INSERT INTO "accounting_voucher_sequences" ("id", "bookId", "fiscalYearId", "nextNumber", "updatedAt")
        VALUES (${`seq_${randomUUID()}`}, ${bookId}, ${fiscalYearId}, 2, NOW())
        ON CONFLICT ("bookId", "fiscalYearId") DO UPDATE
          SET "nextNumber" = "accounting_voucher_sequences"."nextNumber" + 1, "updatedAt" = NOW()
        RETURNING "nextNumber" - 1 AS allocated`;
      return rows[0].allocated;
    },

    markVoucherPosted: async ({ id, statutoryNumber, postedAt, contentHash }) => {
      const updated = await database.accountingLedgerVoucher.update({
        where: { id },
        data: { status: 'POSTED', statutoryNumber, postedAt, contentHash },
        include: includeLines,
      });
      await database.accountingLedgerAccount.updateMany({
        where: { id: { in: updated.lines.map(({ accountId }) => accountId) }, meaningLockedAt: null },
        data: { meaningLockedAt: postedAt },
      });
      return voucherRecord(updated);
    },

    createReversalVoucher: async ({ original, referenceNumber, statutoryNumber, idempotencyKey, actorId, description, postedAt, contentHash, commandHash, target }) => {
      const sourcePayload = { originalVoucherId: original.id, originalContentHash: original.contentHash, commandHash };
      const reversalDraft = await database.accountingLedgerVoucher.create({
        data: {
          bookId: original.bookId,
          fiscalYearId: target.fiscalYearId,
          periodId: target.periodId,
          referenceNumber,
          statutoryNumber,
          idempotencyKey,
          correlationId: original.correlationId,
          status: 'DRAFT',
          description,
          documentDate: target.documentDate,
          occurredAt: target.documentDate,
          discoveredAt: postedAt,
          recordedAt: postedAt,
          postedAt: null,
          sourceType: 'LEDGER_REVERSAL',
          sourceId: original.id,
          sourceVersion: 1,
          sourceHash: createHash('sha256').update(JSON.stringify(canonicalize(sourcePayload))).digest('hex'),
          sourcePayload: canonicalize(sourcePayload) as Prisma.InputJsonValue,
          debitTotalRials: original.creditTotalRials.toString(),
          creditTotalRials: original.debitTotalRials.toString(),
          contentHash,
          reversalOfId: original.id,
          createdBy: actorId,
          lines: {
            create: original.lines.map((line, index) => ({
              sequence: index + 1,
              accountId: line.accountId,
              partyId: line.partyId,
              financialAccountId: line.financialAccountId,
              debitRials: line.creditRials.toString(),
              creditRials: line.debitRials.toString(),
              description: line.description,
              originalAmount: line.originalAmount,
              originalCurrency: line.originalCurrency,
              exchangeRate: line.exchangeRate,
              exchangeRateDate: line.exchangeRateDate,
              exchangeRateSource: line.exchangeRateSource,
              rawAmountBeforeRounding: line.rawAmountBeforeRounding,
              roundingRuleVersion: line.roundingRuleVersion,
              evidenceType: line.evidence.type,
              evidenceId: line.evidence.id,
              evidenceVersion: line.evidence.version,
              evidenceHash: line.evidence.hash,
              evidencePayload: canonicalize(line.evidence.payload) as Prisma.InputJsonValue,
              dimensions: { create: line.dimensions.map((dimension) => ({ dimensionTypeId: dimension.typeId, memberId: dimension.memberId })) },
            })),
          },
        },
        include: includeLines,
      });
      const reversal = await database.accountingLedgerVoucher.update({
        where: { id: reversalDraft.id },
        data: { status: 'POSTED', postedAt },
        include: includeLines,
      });
      await database.accountingLedgerVoucher.update({
        where: { id: original.id },
        data: { status: 'REVERSED', reversedAt: postedAt },
      });
      return voucherRecord(reversal);
    },

    appendAudit: async (input) => {
      if (transactional) await database.$executeRaw`SELECT pg_advisory_xact_lock(93832471)`;
      const previous = await database.accountingLedgerAuditEntry.findFirst({ orderBy: { sequence: 'desc' } });
      const sequence = (previous?.sequence ?? 0n) + 1n;
      const createdAt = new Date();
      const effectiveProfile = input.effectiveProfile ?? 'ACCOUNTANT';
      const entryHash = auditEntryHash({
        sequence, action: input.action, result: input.result, actorId: input.actorId, effectiveProfile,
        entityType: input.entityType, entityId: input.entityId, correlationId: input.correlationId,
        reason: input.reason, payloadHash: input.payloadHash, previousHash: previous?.entryHash,
        sessionContext: input.sessionContext, createdAt,
      });
      await database.accountingLedgerAuditEntry.create({
        data: {
          sequence,
          action: input.action,
          result: input.result,
          actorId: input.actorId,
          effectiveProfile,
          entityType: input.entityType,
          entityId: input.entityId,
          correlationId: input.correlationId,
          reason: input.reason,
          payloadHash: input.payloadHash,
          previousHash: previous?.entryHash,
          entryHash,
          sessionContext: input.sessionContext == null
            ? undefined
            : JSON.parse(JSON.stringify(input.sessionContext)),
          createdAt,
        },
      });
    },
  };
  return repository;
};

export const listPostedJournal = async (database: Database, input: {
  bookId: string;
  fiscalYearId: string;
  periodId?: string;
}) => database.accountingLedgerVoucher.findMany({
  where: {
    bookId: input.bookId,
    fiscalYearId: input.fiscalYearId,
    periodId: input.periodId,
    status: { in: ['POSTED', 'REVERSED'] },
  },
  orderBy: [{ statutoryNumber: 'asc' }, { postedAt: 'asc' }],
  select: reportVoucherSelect,
});

export const listLedgerVouchers = async (database: Database, input: {
  bookId: string;
  fiscalYearId: string;
  periodId?: string;
  status?: 'DRAFT' | 'POSTED' | 'REVERSED';
}) => {
  const vouchers = await database.accountingLedgerVoucher.findMany({
  where: {
    bookId: input.bookId,
    fiscalYearId: input.fiscalYearId,
    periodId: input.periodId,
    status: input.status,
  },
  orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
    select: { ...reportVoucherSelect, sourceType: true },
  });
  return vouchers.map((voucher) => {
    let postingBlockedReason: string | null = null;
    if (voucher.status === 'DRAFT' && voucher.sourceType === 'SEPIDAR_ACC_VOUCHER') {
      try { assertLocalSepidarHistoricalPosting(input.bookId, { nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL }); }
      catch (error) {
        if (!(error instanceof AccountingLedgerError)) throw error;
        postingBlockedReason = error.message;
      }
    }
    return { ...voucher, postingBlockedReason };
  });
};

export const readLedgerVoucherEvidence = async (database: PrismaClient, input: {
  voucherId: string;
  actorId: string;
  effectiveProfile: AccountingAccessProfile;
  correlationId: string;
  reason: string;
}) => database.$transaction(async (tx) => {
  const voucher = await tx.accountingLedgerVoucher.findUnique({
    where: { id: input.voucherId },
    select: {
      id: true,
      referenceNumber: true,
      statutoryNumber: true,
      status: true,
      description: true,
      documentDate: true,
      sourceType: true,
      sourceId: true,
      sourceVersion: true,
      sourceHash: true,
      sourcePayload: true,
      contentHash: true,
      lines: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          description: true,
          debitRials: true,
          creditRials: true,
          account: { select: { code: true, titlePersian: true } },
          party: { select: { displayName: true } },
          financialAccount: { select: { titlePersian: true } },
          evidenceType: true,
          evidenceId: true,
          evidenceVersion: true,
          evidenceHash: true,
          evidencePayload: true,
        },
      },
    },
  });
  if (!voucher) throw new AccountingLedgerError('VOUCHER_NOT_FOUND', 'سند حسابداری پیدا نشد.', 404);
  await createAccountingLedgerPrismaRepository(tx, true).appendAudit({
    action: 'LEDGER_EVIDENCE_VIEWED',
    result: 'SUCCEEDED',
    actorId: input.actorId,
    effectiveProfile: input.effectiveProfile,
    entityType: 'JOURNAL_VOUCHER_EVIDENCE',
    entityId: voucher.id,
    correlationId: input.correlationId,
    reason: input.reason,
    payloadHash: createHash('sha256').update(`${voucher.id}:${voucher.contentHash}:${voucher.sourceHash}`).digest('hex'),
    sessionContext: { purpose: 'ACCOUNTING_EVIDENCE_REVIEW', voucherStatus: voucher.status },
  });
  return voucher;
});

export const listPostedTrialBalance = async (database: Database, input: {
  bookId: string;
  fiscalYearId: string;
  periodId?: string;
}) => database.$queryRaw<Array<{
  accountId: string;
  code: string;
  titlePersian: string;
  debitRials: Prisma.Decimal;
  creditRials: Prisma.Decimal;
}>>`
  SELECT a."id" AS "accountId", a."code", a."titlePersian",
         SUM(l."debitRials") AS "debitRials", SUM(l."creditRials") AS "creditRials"
  FROM "accounting_ledger_lines" l
  JOIN "accounting_ledger_vouchers" v ON v."id" = l."voucherId"
  JOIN "accounting_ledger_accounts" a ON a."id" = l."accountId"
  WHERE v."bookId" = ${input.bookId}
    AND v."fiscalYearId" = ${input.fiscalYearId}
    AND v."status" IN ('POSTED', 'REVERSED')
    AND (${input.periodId ?? null}::text IS NULL OR v."periodId" = ${input.periodId ?? null})
  GROUP BY a."id", a."code", a."titlePersian"
  ORDER BY a."code"`;

export const verifyLedgerAuditChain = async (database: Database) => {
  const entries = await database.accountingLedgerAuditEntry.findMany({ orderBy: { sequence: 'asc' } });
  let previousHash: string | null = null;
  for (const entry of entries) {
    const expected = auditEntryHash({ ...entry, previousHash, sessionContext: entry.sessionContext });
    if (entry.previousHash !== previousHash || entry.entryHash !== expected) {
      return { valid: false, checkedEntries: entries.indexOf(entry), failedSequence: entry.sequence.toString() };
    }
    previousHash = entry.entryHash;
  }
  return { valid: true, checkedEntries: entries.length, failedSequence: null };
};
