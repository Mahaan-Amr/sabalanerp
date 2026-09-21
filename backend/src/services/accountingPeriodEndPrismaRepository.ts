import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  IRR_ROUNDING_RULE_V1,
  createAccountingLedgerApplication,
  hashAccountingEvidence,
} from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import type { PeriodEndPosting, PeriodEndRepository, PeriodEndResult } from './accountingPeriodEnd';
import { buildOfficialAccountingDataset, type OfficialDatasetRequest } from './accountingPeriodEnd';

type Database = PrismaClient | Prisma.TransactionClient;

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (typeof item === 'bigint') return item.toString();
  if (item instanceof Date) return item.toISOString();
  return item;
})) as Prisma.InputJsonValue;

const resultFromRecord = (record: { resultPayload: Prisma.JsonValue }) => record.resultPayload as unknown as PeriodEndResult;

export const createAccountingPeriodEndPrismaRepository = (
  database: Database,
  transactional = false,
): PeriodEndRepository => {
  const repository: PeriodEndRepository = {
    transaction: async (operation) => {
      if (transactional) return operation(repository);
      if (!('$transaction' in database)) throw new Error('تراکنش حسابداری در دسترس نیست.');
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          return await database.$transaction((tx) => operation(createAccountingPeriodEndPrismaRepository(tx, true)), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          });
        } catch (error) {
          const retryable = error instanceof Prisma.PrismaClientKnownRequestError
            && (error.code === 'P2034' || error.code === 'P2002');
          if (!retryable || attempt === 3) throw error;
        }
      }
      throw new Error('تراکنش پایان دوره پس از چند تلاش هم‌زمان تکمیل نشد.');
    },
    findResult: async (identity) => {
      const found = await database.accountingPeriodEndResult.findUnique({ where: { identity } });
      return found ? resultFromRecord(found) : null;
    },
    postVoucher: async (posting: PeriodEndPosting) => {
      const dimensionTypes = posting.lines.flatMap((line) => line.dimensions.map((dimension) => dimension.typeCode));
      const typeRows = dimensionTypes.length === 0 ? [] : await database.accountingDimensionType.findMany({
        where: { bookId: posting.bookId, code: { in: dimensionTypes } },
        select: { id: true, code: true },
      });
      const typeIds = new Map(typeRows.map((row) => [row.code, row.id]));
      if (typeIds.size !== new Set(dimensionTypes).size) throw new Error('بُعد خلاصه حسابداری حقوق در دفترکل تعریف نشده است.');
      const { sourceHash: _sourceHash, ...unsignedPayload } = posting.sourcePayload;
      const ledger = createAccountingLedgerApplication(
        createAccountingLedgerPrismaRepository(database, true),
        { now: () => new Date(), nextReference: () => `عطف-${randomUUID()}` },
      );
      const draft = await ledger.createManualDraft({
        bookId: posting.bookId,
        fiscalYearId: posting.fiscalYearId,
        periodId: posting.periodId,
        idempotencyKey: posting.idempotencyKey,
        correlationId: `پایان-دوره-${posting.sourceType}-${posting.sourceId}-${posting.sourceVersion}`,
        description: posting.description,
        documentDate: posting.documentDate,
        occurredAt: posting.documentDate,
        source: {
          type: posting.sourceType,
          id: posting.sourceId,
          version: posting.sourceVersion,
          hash: posting.sourceHash,
          payload: unsignedPayload,
        },
        actor: { id: posting.actorId, profile: 'ACCOUNTANT' },
        lines: posting.lines.map((line, index) => {
          const amount = line.debitRials > 0n ? line.debitRials : line.creditRials;
          const evidencePayload = {
            sourceType: posting.sourceType,
            sourceId: posting.sourceId,
            sourceVersion: posting.sourceVersion,
            sourceHash: posting.sourceHash,
            lineSequence: index + 1,
            amountRials: amount.toString(),
          };
          return {
            accountId: line.accountId,
            debitRials: line.debitRials,
            creditRials: line.creditRials,
            description: line.description,
            dimensions: line.dimensions.map((dimension) => ({
              typeId: typeIds.get(dimension.typeCode)!, memberId: dimension.memberId,
            })),
            rawAmountBeforeRounding: amount.toString(),
            roundingRuleVersion: IRR_ROUNDING_RULE_V1,
            evidence: {
              type: 'شاهد پایان دوره',
              id: `${posting.sourceId}:${index + 1}`,
              version: posting.sourceVersion,
              hash: hashAccountingEvidence(evidencePayload),
              payload: evidencePayload,
            },
          };
        }),
      });
      const posted = await ledger.postVoucher({
        voucherId: draft.id,
        actor: { id: posting.actorId, profile: 'ACCOUNTANT' },
        reason: 'ثبت قطعی شواهد تأییدشده پایان دوره',
      });
      if (posted.statutoryNumber == null) throw new Error('شماره قطعی سند پایان دوره تخصیص نیافت.');
      if (posting.sourcePayload.kind === 'ASSET_READY_FOR_USE') {
        await database.accountingFixedAsset.update({
          where: { id: posting.sourcePayload.asset.id },
          data: { readyForUseAt: posting.sourcePayload.asset.readyForUseAt, status: 'ACTIVE' },
        });
        await database.accountingAssetEvent.create({
          data: {
            assetId: posting.sourcePayload.asset.id,
            eventIdentity: `${posting.sourcePayload.kind}:${posting.sourceId}:${posting.sourceVersion}`,
            eventType: 'READY_FOR_USE',
            occurredAt: posting.documentDate,
            sourceType: posting.sourceType,
            sourceId: posting.sourceId,
            sourceVersion: posting.sourceVersion,
            sourceHash: posting.sourceHash,
            payload: jsonValue(unsignedPayload),
            voucherId: posted.id,
            createdBy: posting.actorId,
          },
        });
      }
      if (posting.sourcePayload.kind === 'ASSET_COST') {
        await database.accountingAssetEvent.create({ data: {
          assetId: posting.sourcePayload.assetId,
          eventIdentity: `${posting.sourcePayload.kind}:${posting.sourceId}:${posting.sourceVersion}`,
          eventType: posting.sourcePayload.costKind,
          occurredAt: posting.documentDate,
          sourceType: posting.sourceType,
          sourceId: posting.sourceId,
          sourceVersion: posting.sourceVersion,
          sourceHash: posting.sourceHash,
          payload: jsonValue(unsignedPayload),
          voucherId: posted.id,
          createdBy: posting.actorId,
        } });
      }
      if (posting.sourcePayload.kind === 'ASSET_LIFECYCLE') {
        await database.accountingAssetEvent.create({ data: {
          assetId: posting.sourcePayload.assetId,
          eventIdentity: `${posting.sourcePayload.kind}:${posting.sourceId}:${posting.sourceVersion}`,
          eventType: posting.sourcePayload.eventType,
          occurredAt: posting.documentDate,
          sourceType: posting.sourceType,
          sourceId: posting.sourceId,
          sourceVersion: posting.sourceVersion,
          sourceHash: posting.sourceHash,
          payload: jsonValue(unsignedPayload),
          voucherId: posted.id,
          createdBy: posting.actorId,
        } });
        if (['SALE', 'LOSS', 'THEFT', 'DISPOSAL'].includes(posting.sourcePayload.eventType)) {
          await database.accountingFixedAsset.update({ where: { id: posting.sourcePayload.assetId }, data: { status: posting.sourcePayload.eventType } });
        }
        if (posting.sourcePayload.eventType === 'TRANSFER') {
          await database.accountingFixedAsset.update({ where: { id: posting.sourcePayload.assetId }, data: {
            location: posting.sourcePayload.lifecyclePayload.toLocation,
            custodianPartyId: posting.sourcePayload.lifecyclePayload.custodianPartyId,
          } });
        }
        if (posting.sourcePayload.eventType === 'COMPONENT_REPLACEMENT') {
          await database.accountingAssetComponent.update({
            where: { id: posting.sourcePayload.lifecyclePayload.priorComponentId! },
            data: { retiredAt: posting.documentDate, replacedByComponentId: posting.sourcePayload.lifecyclePayload.successorComponentId },
          });
        }
      }
      if (posting.sourcePayload.kind === 'APPROVED_PAYROLL') {
        const handoff = await database.accountingPayrollHandoff.create({
          data: {
            bookId: posting.bookId,
            payrollRunId: posting.sourceId,
            payrollRunVersion: posting.sourceVersion,
            populationHash: posting.sourcePayload.populationHash,
            policyHash: posting.sourcePayload.policyHash,
            sourceHash: posting.sourceHash,
            status: 'POSTED',
            summaryPayload: jsonValue({ summaryLines: posting.sourcePayload.summaryLines }),
            debitTotalRials: posting.lines.reduce((total, line) => total + line.debitRials, 0n).toString(),
            creditTotalRials: posting.lines.reduce((total, line) => total + line.creditRials, 0n).toString(),
            voucherId: posted.id,
            acceptedBy: posting.actorId,
            acceptedAt: new Date(),
          },
        });
        await database.accountingPayrollObligation.createMany({
          data: posting.sourcePayload.obligations.map((obligation) => ({
            handoffId: handoff.id,
            obligationIdentity: obligation.identity,
            obligationType: obligation.kind,
            amountRials: obligation.amountRials.toString(),
            status: 'OPEN',
          })),
        });
      }
      if (posting.sourcePayload.kind === 'RECOGNITION_DUE') {
        await database.accountingRecognitionSchedule.updateMany({
          where: {
            bookId: posting.bookId,
            scheduleIdentity: posting.sourceId,
            version: posting.sourceVersion,
          },
          data: { recognizedRials: { increment: posting.sourcePayload.amountRials.toString() } },
        });
      }
      return { voucherId: posted.id, statutoryNumber: posted.statutoryNumber };
    },
    saveResult: async (identity, result) => {
      const source = identity.split(':');
      const created = await database.accountingPeriodEndResult.create({
        data: {
          identity,
          bookId: source[0],
          sourceType: source[1],
          sourceId: source.slice(2, -1).join(':'),
          sourceVersion: Number(source.at(-1)),
          sourceHash: result.sourceHash,
          resultKind: result.kind,
          resultPayload: jsonValue(result),
          voucherId: result.kind === 'POSTED' ? result.voucherId : null,
          statutoryNumber: result.kind === 'POSTED' ? result.statutoryNumber : null,
        },
      });
      return resultFromRecord(created);
    },
  };
  return repository;
};

export const listAccountingPeriodEndOverview = async (database: Database, bookId: string) => {
  const [assets, payroll, schedules, estimates, taxes, closeRuns, snapshots, mappings, statutoryFormats, archiveEvidence, restatements] = await Promise.all([
    database.accountingFixedAsset.findMany({ where: { bookId }, orderBy: { registerNumber: 'asc' }, include: { components: true } }),
    database.accountingPayrollHandoff.findMany({ where: { bookId }, orderBy: { createdAt: 'desc' }, include: { obligations: true }, take: 50 }),
    database.accountingRecognitionSchedule.findMany({ where: { bookId }, orderBy: [{ nextReviewAt: 'asc' }, { createdAt: 'desc' }], take: 100 }),
    database.accountingEstimateCase.findMany({ where: { bookId }, orderBy: { nextReviewAt: 'asc' }, take: 100 }),
    database.accountingTaxObligation.findMany({ where: { bookId }, orderBy: { dueAt: 'asc' }, include: { attempts: { orderBy: { attemptedAt: 'desc' }, take: 1 } }, take: 100 }),
    database.accountingCloseRun.findMany({ where: { bookId }, orderBy: { createdAt: 'desc' }, include: { steps: true }, take: 20 }),
    database.accountingOfficialReportSnapshot.findMany({ where: { bookId }, orderBy: { generatedAt: 'desc' }, take: 20 }),
    database.accountingFinancialStatementMapping.findMany({ where: { bookId }, orderBy: { version: 'desc' }, include: { rows: true }, take: 20 }),
    database.accountingStatutoryFormat.findMany({ where: { bookId }, orderBy: [{ formatCode: 'asc' }, { version: 'desc' }], take: 50 }),
    database.accountingArchiveEvidence.findMany({ where: { bookId }, orderBy: { uploadedAt: 'desc' }, take: 50 }),
    database.accountingRestatementCase.findMany({ where: { bookId }, orderBy: { discoveredAt: 'desc' }, take: 50 }),
  ]);
  return {
    assets, payroll, schedules, estimates, taxes, closeRuns, snapshots, mappings, statutoryFormats, restatements,
    archiveEvidence: archiveEvidence.map(({ storageKey: _protectedStorageKey, ...evidence }) => evidence),
  };
};

export const createOfficialAccountingSnapshot = async (database: Database, input: {
  request: OfficialDatasetRequest;
  actorId: string;
  policyVersions?: Record<string, string>;
}) => {
  const mapping = input.request.mappingVersionId ? await database.accountingFinancialStatementMapping.findUnique({
    where: { id: input.request.mappingVersionId },
    include: { rows: true },
  }) : null;
  if (['FINANCIAL_STATEMENT', 'CASH_FLOW'].includes(input.request.reportKind) && !mapping) throw new Error('نسخه نگاشت برای این گزارش رسمی الزامی است.');
  if (mapping && mapping.bookId !== input.request.bookId) throw new Error('نسخه نگاشت گزارش رسمی پیدا نشد.');
  if (mapping && (mapping.effectiveFrom > input.request.to || (mapping.effectiveTo && mapping.effectiveTo < input.request.from))) {
    throw new Error('نسخه نگاشت در بازه گزارش رسمی معتبر نیست.');
  }
  let statutoryFormat: { id: string; contentHash: string } | null = null;
  if (input.request.reportKind === 'LEGAL_BOOK') {
    if (!input.request.statutoryFormatId) throw new Error('نسخه قالب رسمی دفتر قانونی الزامی است.');
    const format = await database.accountingStatutoryFormat.findUnique({ where: { id: input.request.statutoryFormatId } });
    if (!format || format.bookId !== input.request.bookId || format.effectiveFrom > input.request.to
      || (format.effectiveTo && format.effectiveTo < input.request.from)) {
      throw new Error('نسخه قالب رسمی دفتر قانونی در بازه گزارش معتبر نیست.');
    }
    statutoryFormat = { id: format.id, contentHash: format.contentHash };
  }
  const lines = await database.accountingLedgerLine.findMany({
    where: {
      voucher: {
        bookId: input.request.bookId,
        fiscalYearId: input.request.fiscalYearId,
        status: { in: ['POSTED', 'REVERSED'] },
        documentDate: { lte: input.request.to },
        postedAt: { lte: input.request.cutoffAt },
      },
    },
    include: {
      voucher: { select: { id: true, statutoryNumber: true, status: true, documentDate: true, postedAt: true } },
      account: { include: { parent: { include: { parent: true } } } },
      dimensions: { include: { dimensionType: true, member: true } },
    },
    orderBy: [{ voucher: { documentDate: 'asc' } }, { voucher: { statutoryNumber: 'asc' } }, { sequence: 'asc' }],
  });
  const dataset = buildOfficialAccountingDataset({
    request: input.request,
    mapping: {
      id: mapping?.id ?? 'بدون-نگاشت',
      effectiveFrom: mapping?.effectiveFrom ?? input.request.from,
      rows: (mapping?.rows ?? []).map((row) => ({
        accountId: row.accountId,
        statement: row.statementType as 'FINANCIAL_POSITION' | 'PROFIT_OR_LOSS' | 'COMPREHENSIVE_INCOME' | 'CHANGES_IN_EQUITY' | 'NOTES',
        sectionCode: row.sectionCode,
        signMultiplier: row.signMultiplier,
        cashFlowClass: row.cashFlowClass as 'OPERATING' | 'INVESTING' | 'FINANCING' | 'INTERNAL_TRANSFER' | undefined,
      })),
    },
    lines: lines.map((line) => {
      const group = line.account.level === 'GROUP' ? line.account : line.account.parent?.parent ?? line.account.parent ?? line.account;
      const general = line.account.level === 'KOL' ? line.account : line.account.parent ?? line.account;
      return {
        id: line.id,
        voucherId: line.voucher.id,
        voucherNumber: line.voucher.statutoryNumber,
        status: line.voucher.status,
        accountId: line.accountId,
        accountCode: line.account.code,
        accountTitlePersian: line.account.titlePersian,
        accountPath: {
          group: group.titlePersian,
          general: general.titlePersian,
          subsidiary: line.account.titlePersian,
        },
        debitRials: BigInt(line.debitRials.toFixed(0)),
        creditRials: BigInt(line.creditRials.toFixed(0)),
        documentDate: line.voucher.documentDate,
        postedAt: line.voucher.postedAt,
        dimensions: Object.fromEntries(line.dimensions.map((dimension) => [dimension.dimensionType.code, dimension.member.titlePersian])),
      };
    }),
  });
  const snapshotIdentity = `گزارش-${input.request.reportKind}-${randomUUID()}`;
  const snapshot = await database.accountingOfficialReportSnapshot.create({
    data: {
      bookId: input.request.bookId,
      snapshotIdentity,
      reportType: input.request.reportKind,
      parameters: jsonValue(input.request),
      cutoffAt: input.request.cutoffAt,
      mappingVersionId: mapping?.id ?? null,
      policyVersions: jsonValue({
        ...(input.policyVersions ?? {}),
        ...(statutoryFormat ? { statutoryFormatId: statutoryFormat.id, statutoryFormatHash: statutoryFormat.contentHash } : {}),
      }),
      sourceIdentities: jsonValue(dataset.sourceLineIds),
      dataset: jsonValue(dataset),
      datasetHash: dataset.integrityHash,
      generatedBy: input.actorId,
    },
  });
  return { snapshot, dataset };
};
