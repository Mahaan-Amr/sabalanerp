import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  IRR_ROUNDING_RULE_V1,
  createAccountingLedgerApplication,
  hashAccountingEvidence,
} from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import { SupplyChainAccountingError, type PostingCommand } from './accountingSupplyChain';
import { currentSupplyChainDatabase } from './accountingSupplyChainPrismaRepository';

const findPostingAccount = async (
  database: PrismaClient | Prisma.TransactionClient,
  command: PostingCommand,
  accountRole: string,
) => {
  const rule = await database.accountingSupplyChainPostingRule.findFirst({
    where: {
      bookId: command.bookId,
      accountRole,
      effectiveFrom: { lte: command.documentDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: command.documentDate } }],
    },
    orderBy: [{ version: 'desc' }, { effectiveFrom: 'desc' }],
    include: { account: { select: { id: true, retiredAt: true, level: true } } },
  });
  if (!rule || rule.account.retiredAt || rule.account.level !== 'MOIN') {
    throw new SupplyChainAccountingError(
      'SUPPLY_CHAIN_POSTING_RULE_MISSING',
      `قاعده ثبت فعال برای نقش حسابی «${accountRole}» یافت نشد.`,
    );
  }
  return rule.account.id;
};

export const createSupplyChainLedgerPosting = (prisma: PrismaClient) => async (command: PostingCommand) => {
  const database = currentSupplyChainDatabase(prisma);
  const accountIds = await Promise.all(command.lines.map((line) => findPostingAccount(database, command, line.accountRole)));
  const ledger = createAccountingLedgerApplication(
    createAccountingLedgerPrismaRepository(database, database !== prisma),
    { now: () => new Date(), nextReference: () => `عطف-${randomUUID()}` },
  );
  const lines = command.lines.map((line, index) => {
    const payload = {
      sourceHash: command.source.hash,
      sourceType: command.source.type,
      sourceId: command.source.id,
      sourceVersion: command.source.version,
      sequence: index + 1,
      accountRole: line.accountRole,
      debitRials: line.debitRials.toString(),
      creditRials: line.creditRials.toString(),
      partyId: line.partyId ?? null,
      financialAccountId: line.financialAccountId ?? null,
      inventoryIdentityId: line.inventoryIdentityId ?? null,
    };
    const postedAmount = line.debitRials > 0n ? line.debitRials : line.creditRials;
    return {
      accountId: accountIds[index],
      partyId: line.partyId,
      financialAccountId: line.financialAccountId,
      debitRials: line.debitRials,
      creditRials: line.creditRials,
      description: command.description,
      dimensions: [],
      originalAmount: postedAmount.toString(),
      originalCurrency: 'IRR',
      rawAmountBeforeRounding: postedAmount.toString(),
      roundingRuleVersion: IRR_ROUNDING_RULE_V1,
      evidence: {
        type: 'ACCOUNTING_SUPPLY_CHAIN_LINE',
        id: `${command.source.id}:${index + 1}:${line.accountRole}`,
        version: command.source.version,
        hash: hashAccountingEvidence(payload),
        payload,
      },
    };
  });
  const draft = await ledger.createManualDraft({
    bookId: command.bookId,
    fiscalYearId: command.fiscalYearId,
    periodId: command.periodId,
    idempotencyKey: `ledger:${command.idempotencyKey}`,
    correlationId: command.correlationId ?? `supply-chain:${command.source.id}`,
    description: command.description,
    documentDate: command.documentDate,
    occurredAt: command.documentDate,
    source: command.source,
    actor: command.actor,
    lines,
  });
  const posted = await ledger.postVoucher({
    voucherId: draft.id,
    actor: command.actor,
    reason: 'ثبت خودکار پس از کنترل کامل شواهد عملیاتی',
  });
  if (posted.statutoryNumber == null) {
    throw new SupplyChainAccountingError('LEDGER_POSTING_INCOMPLETE', 'سند دفترکل شماره قانونی دریافت نکرد.');
  }
  return { voucherId: posted.id, statutoryNumber: posted.statutoryNumber };
};
