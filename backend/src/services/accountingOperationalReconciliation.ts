import { Prisma } from '@prisma/client';
import { hashAccountingEvidence } from './accountingLedgerFoundation';

type TrustedReconciliationInput = {
  bookId: string;
  fiscalYearId: string;
  periodId?: string;
  reconciliationCode: 'SUBLEDGERS' | 'TREASURY' | 'INVENTORY' | 'VAT';
  sourceSystem: string;
  sourceSnapshotHash: string;
  sourceDebitRials: bigint;
  sourceCreditRials: bigint;
  ledgerDebitRials: bigint;
  ledgerCreditRials: bigint;
  unresolvedDifferences: Array<{ identity: string; amountRials: string; reason: string }>;
  controlPayload: Record<string, string>;
  reconciledAt: Date;
};

// This is intentionally a server-only extension contract. HTTP routes must not expose it:
// source-owner adapters compute their own immutable snapshot and pass its trusted hash here.
export const recordOperationalReconciliation = async (database: Prisma.TransactionClient, input: TrustedReconciliationInput) => {
  if (!/^[a-f0-9]{64}$/.test(input.sourceSnapshotHash)) throw new Error('اثر انگشت snapshot منبع تطبیق معتبر نیست.');
  const [fiscalYear, period] = await Promise.all([
    database.accountingFiscalYear.findUniqueOrThrow({ where: { id: input.fiscalYearId } }),
    input.periodId ? database.accountingPostingPeriod.findUniqueOrThrow({ where: { id: input.periodId } }) : Promise.resolve(null),
  ]);
  if (fiscalYear.bookId !== input.bookId || (period && period.fiscalYearId !== fiscalYear.id)) throw new Error('دامنه دفتر، سال و دوره تطبیق عملیاتی سازگار نیست.');
  const evidence = {
    ...input,
    periodId: input.periodId ?? null,
    sourceDebitRials: input.sourceDebitRials.toString(), sourceCreditRials: input.sourceCreditRials.toString(),
    ledgerDebitRials: input.ledgerDebitRials.toString(), ledgerCreditRials: input.ledgerCreditRials.toString(),
  };
  return database.accountingOperationalReconciliation.create({ data: {
    bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    reconciliationCode: input.reconciliationCode, sourceSystem: input.sourceSystem, sourceSnapshotHash: input.sourceSnapshotHash,
    sourceDebitRials: input.sourceDebitRials.toString(), sourceCreditRials: input.sourceCreditRials.toString(),
    ledgerDebitRials: input.ledgerDebitRials.toString(), ledgerCreditRials: input.ledgerCreditRials.toString(),
    unresolvedDifferences: input.unresolvedDifferences, controlPayload: input.controlPayload, evidenceHash: hashAccountingEvidence(evidence), reconciledAt: input.reconciledAt,
  } });
};
