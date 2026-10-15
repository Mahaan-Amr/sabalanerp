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

export const createSupplyChainLedgerPosting = (prisma: PrismaClient | Prisma.TransactionClient,
  customerCheckAsset?: { accountId: string; partyId: string }) => async (command: PostingCommand) => {
  const database = currentSupplyChainDatabase(prisma);
  const isCustomerCheckAsset = (role: string) => Boolean(customerCheckAsset && ['RECEIVABLE_CHECK', 'RETURNED_RECEIVABLE_CHECK'].includes(role));
  if (customerCheckAsset) {
    const asset = await database.accountingLedgerAccount.findUnique({ where: { id: customerCheckAsset.accountId } });
    const party = await database.accountingParty.findUnique({ where: { id: customerCheckAsset.partyId } });
    const book = await database.accountingBook.findUnique({ where: { id: command.bookId } });
    if (!asset || !party || !book || asset.bookId !== book.id || party.legalEntityId !== book.legalEntityId || asset.level !== 'MOIN'
      || asset.retiredAt || asset.statementRole !== 'ASSET' || asset.normalSide !== 'DEBIT' || asset.partyRequirement !== 'REQUIRED'
      || asset.financialAccountRequirement !== 'FORBIDDEN') throw new SupplyChainAccountingError('CUSTOMER_CHECK_ASSET_INVALID', 'حساب حضانت ابزار مشتری با دفتر و تفصیلی منطبق نیست.');
  }
  const accountIds = await Promise.all(command.lines.map((line) => isCustomerCheckAsset(line.accountRole) ? customerCheckAsset!.accountId : findPostingAccount(database, command, line.accountRole)));
  const ledger = createAccountingLedgerApplication(
    createAccountingLedgerPrismaRepository(database, !('$transaction' in database)),
    { now: () => new Date(), nextReference: () => `عطف-${randomUUID()}` },
  );
  const lines = command.lines.map((line, index) => {
    const partyId = isCustomerCheckAsset(line.accountRole) ? customerCheckAsset!.partyId : line.partyId;
    const financialAccountId = isCustomerCheckAsset(line.accountRole) ? undefined : line.financialAccountId;
    const payload = {
      sourceHash: command.source.hash,
      sourceType: command.source.type,
      sourceId: command.source.id,
      sourceVersion: command.source.version,
      sequence: index + 1,
      accountRole: line.accountRole,
      debitRials: line.debitRials.toString(),
      creditRials: line.creditRials.toString(),
      partyId: partyId ?? null,
      financialAccountId: financialAccountId ?? null,
      inventoryIdentityId: line.inventoryIdentityId ?? null,
    };
    const postedAmount = line.debitRials > 0n ? line.debitRials : line.creditRials;
    return {
      accountId: accountIds[index],
      partyId,
      financialAccountId,
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
