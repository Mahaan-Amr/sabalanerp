import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1, type LedgerLineInput } from '../services/accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from '../services/accountingLedgerPrismaRepository';
import { parseSepidarLocalDateTime } from '../services/sepidarCalendar';

type SourceRow = { sourceKey: string; sourceHash: string; payload: unknown };
const asObject = (value: unknown) => value as Record<string, unknown>;
const bookId = 'cmub2hd63007zrqlphrzi5eey';
const snapshotId = '107e07de8110cdbe0ceeb995a98c9111a223a738d182dd1c0f0cf4cf43bcd009';
const actor = { id: 'sepidar-user-approved-development-import', profile: 'ACCOUNTING_MANAGER' as const };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const idFor = (kind: string, sourceId: string) => sha(`${bookId}:${kind}:${sourceId}`);
const amount = (value: unknown) => {
  const source = String(value ?? '0');
  if (!/^\d+(?:\.0+)?$/.test(source)) throw new Error(`Source amount is not an integer rial value: ${source}`);
  return BigInt(source.split('.')[0]);
};
const year = process.argv.find((arg) => /^--year=140[45]$/.test(arg))?.split('=')[1];
const limitText = process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
const limit = limitText ? Number(limitText) : Number.POSITIVE_INFINITY;
const apply = process.argv.includes('--apply');
if (!year || !(limit > 0 && (Number.isInteger(limit) || limit === Number.POSITIVE_INFINITY))) throw new Error('--year=1404|1405 and optional positive --limit=N required');

const main = async () => {
  const db = new PrismaClient();
  try {
    const snapshot = await db.accountingSepidarSourceSnapshot.findUnique({ where: { id: snapshotId }, select: { status: true, bookId: true } });
    const fiscalYear = await db.accountingFiscalYear.findUnique({ where: { bookId_code: { bookId, code: year } }, include: { periods: { where: { isAdjustment: false } } } });
    if (snapshot?.status !== 'COMPLETE' || snapshot.bookId !== bookId || !fiscalYear || fiscalYear.periods.length !== 12) throw new Error('Complete source snapshot and target fiscal year required');
    const ref = year === '1404' ? 1 : 10;
    const [vouchers, allLines, accounts, details, parties, banks, partyLinks, bankLinks] = await Promise.all([
      db.accountingSepidarSourceRecord.findMany({ where: { snapshotId, sourceTable: 'ACC.Voucher', fiscalYearRef: ref }, select: { sourceKey: true, sourceHash: true, payload: true }, orderBy: { sourceKey: 'asc' } }),
      db.accountingSepidarSourceRecord.findMany({ where: { snapshotId, sourceTable: 'ACC.VoucherItem' }, select: { sourceKey: true, sourceHash: true, payload: true } }),
      db.accountingSepidarTargetLink.findMany({ where: { bookId, sourceTable: 'ACC.Account', targetKind: 'LEDGER_ACCOUNT' }, select: { sourceKey: true, targetId: true } }),
      db.accountingSepidarTargetLink.findMany({ where: { bookId, sourceTable: 'ACC.DL', targetKind: 'DIMENSION_MEMBER' }, select: { sourceKey: true, targetId: true } }),
      db.accountingSepidarSourceRecord.findMany({ where: { snapshotId, sourceTable: 'GNR.Party' }, select: { sourceKey: true, payload: true } }),
      db.accountingSepidarSourceRecord.findMany({ where: { snapshotId, sourceTable: 'RPA.BankAccount' }, select: { sourceKey: true, payload: true } }),
      db.accountingSepidarTargetLink.findMany({ where: { bookId, sourceTable: 'GNR.Party', targetKind: 'PARTY' }, select: { sourceKey: true, targetId: true } }),
      db.accountingSepidarTargetLink.findMany({ where: { bookId, sourceTable: 'RPA.BankAccount', targetKind: 'FINANCIAL_ACCOUNT' }, select: { sourceKey: true, targetId: true } }),
    ]);
    const accountBySource = new Map(accounts.map((link) => [link.sourceKey, link.targetId]));
    const detailBySource = new Map(details.map((link) => [link.sourceKey, link.targetId]));
    const partyBySource = new Map(partyLinks.map((link) => [link.sourceKey, link.targetId]));
    const bankBySource = new Map(bankLinks.map((link) => [link.sourceKey, link.targetId]));
    const partyByDetail = new Map(parties.filter((party) => asObject(party.payload).DLRef != null).map((party) => [String(asObject(party.payload).DLRef), partyBySource.get(party.sourceKey)]));
    const bankByDetail = new Map(banks.filter((bank) => asObject(bank.payload).DlRef != null).map((bank) => [String(asObject(bank.payload).DlRef), bankBySource.get(bank.sourceKey)]));
    const dimension = await db.accountingDimensionType.findUnique({ where: { bookId_code: { bookId, code: 'SEPIDAR_DL' } }, select: { id: true } });
    if (!dimension || accountBySource.size !== 195 || detailBySource.size !== 1617) throw new Error('Complete account and detail mapping required');
    const linesByVoucher = new Map<string, SourceRow[]>();
    for (const line of allLines) {
      const key = String(asObject(line.payload).VoucherRef);
      linesByVoucher.set(key, [...(linesByVoucher.get(key) ?? []), line]);
    }
    const prepared = vouchers.map((voucher) => {
      const payload = asObject(voucher.payload);
      const rawDate = String(payload.Date ?? '');
      if (!/^\d{4}-\d\d-\d\dT/.test(rawDate)) throw new Error(`Invalid date in voucher ${voucher.sourceKey}`);
      const documentDate = parseSepidarLocalDateTime(rawDate);
      const period = fiscalYear.periods.find((item) => item.startsAt <= documentDate && documentDate <= item.endsAt);
      if (!period) throw new Error(`Voucher ${voucher.sourceKey} is outside fiscal period coverage`);
      const sourceLines = [...(linesByVoucher.get(voucher.sourceKey) ?? [])].sort((left, right) => Number(asObject(left.payload).RowNumber) - Number(asObject(right.payload).RowNumber));
      if (sourceLines.length < 2) throw new Error(`Voucher ${voucher.sourceKey} has fewer than two lines`);
      const lines: LedgerLineInput[] = sourceLines.map((sourceLine) => {
        const item = asObject(sourceLine.payload);
        const debitRials = amount(item.Debit);
        const creditRials = amount(item.Credit);
        if ((debitRials > 0n) === (creditRials > 0n)) throw new Error(`Invalid debit/credit sides on ${sourceLine.sourceKey}`);
        const accountId = accountBySource.get(String(item.AccountSLRef));
        if (!accountId) throw new Error(`Unmapped account ${String(item.AccountSLRef)} on ${sourceLine.sourceKey}`);
        const dl = item.DLRef == null ? null : String(item.DLRef);
        const memberId = dl == null ? null : detailBySource.get(dl);
        if (dl != null && !memberId) throw new Error(`Unmapped detail ${dl} on ${sourceLine.sourceKey}`);
        const evidencePayload = { snapshotId, sourceRecordHash: sourceLine.sourceHash, row: item };
        return {
          accountId, debitRials, creditRials, description: String(item.Description ?? '').trim() || undefined,
          partyId: dl == null ? undefined : partyByDetail.get(dl),
          financialAccountId: dl == null ? undefined : bankByDetail.get(dl),
          dimensions: memberId ? [{ typeId: dimension.id, memberId }] : [],
          rawAmountBeforeRounding: debitRials > 0n ? String(item.Debit) : String(item.Credit),
          roundingRuleVersion: IRR_ROUNDING_RULE_V1,
          evidence: { type: 'SEPIDAR_ACC_VOUCHER_ITEM', id: sourceLine.sourceKey.length >= 3 ? sourceLine.sourceKey : `SEP-ITEM-${sourceLine.sourceKey}`, version: Math.max(1, Number(item.Version) || 1),
            hash: hashAccountingEvidence(evidencePayload), payload: evidencePayload },
        };
      });
      const debit = lines.reduce((total, line) => total + line.debitRials, 0n);
      const credit = lines.reduce((total, line) => total + line.creditRials, 0n);
      if (debit !== credit) throw new Error(`Unbalanced source voucher ${voucher.sourceKey}`);
      return { voucher, payload, documentDate, periodId: period.id, lines, debit, credit };
    });
    const selected = prepared.slice(0, limit);
    const totals = { vouchers: prepared.length, lines: prepared.reduce((sum, voucher) => sum + voucher.lines.length, 0),
      debitRials: prepared.reduce((sum, voucher) => sum + voucher.debit, 0n).toString(),
      creditRials: prepared.reduce((sum, voucher) => sum + voucher.credit, 0n).toString() };
    if (!apply) { console.log(JSON.stringify({ action: 'dry-run', year, selected: selected.length, ...totals })); return; }
    const repository = createAccountingLedgerPrismaRepository(db);
    let created = 0;
    for (const item of selected) {
      const sourcePayload = { snapshotId, sourceRecordHash: item.voucher.sourceHash, voucher: item.payload,
        historicalCoverageNotice: year === '1404' ? 'ریزگردش ۱۴۰۴ پیش از ۲۰۲۵-۱۲-۲۲ در نسخهٔ منبع موجود نیست.' : null,
        authority: 'SEPIDAR_UNTIL_CUTOVER' };
      const application = createAccountingLedgerApplication(repository, { now: () => new Date(), nextReference: () => `SEP-${item.voucher.sourceKey}` });
      const drafted = await application.createManualDraft({
        bookId, fiscalYearId: fiscalYear.id, periodId: item.periodId,
        idempotencyKey: `SEPIDAR:ACC.Voucher:${item.voucher.sourceKey}`,
        correlationId: `SEPIDAR:${item.voucher.sourceKey}`,
        description: String(item.payload.Description ?? '').trim() || `سند سپیدار ${item.voucher.sourceKey}`,
        documentDate: item.documentDate, occurredAt: item.documentDate,
        source: { type: 'SEPIDAR_ACC_VOUCHER', id: item.voucher.sourceKey.length >= 3 ? item.voucher.sourceKey : `SEP-VOUCHER-${item.voucher.sourceKey}`,
          version: Math.max(1, Number(item.payload.Version) || 1), hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload },
        actor, lines: item.lines,
      });
      const sourceIdentity = { bookId_sourceTable_sourceKey_targetKind: {
        bookId, sourceTable: 'ACC.Voucher', sourceKey: item.voucher.sourceKey, targetKind: 'LEDGER_DRAFT',
      } };
      const existingLink = await db.accountingSepidarTargetLink.findUnique({ where: sourceIdentity });
      if (existingLink && (existingLink.sourceHash !== item.voucher.sourceHash || existingLink.targetId !== drafted.id)) {
        throw new Error(`Source voucher ${item.voucher.sourceKey} changed after draft import; review successor snapshot before any new posting`);
      }
      if (!existingLink) await db.accountingSepidarTargetLink.create({ data: {
        id: idFor('LINK:ACC.Voucher:LEDGER_DRAFT', item.voucher.sourceKey), bookId,
        sourceTable: 'ACC.Voucher', sourceKey: item.voucher.sourceKey, sourceHash: item.voucher.sourceHash,
        firstSnapshotId: snapshotId, latestSnapshotId: snapshotId, targetKind: 'LEDGER_DRAFT', targetId: drafted.id,
        mappingVersion: 1, reviewStatus: 'USER_APPROVED', reviewedBy: actor.id, reviewEvidence: snapshotId,
      } });
      created++;
      if (created % 100 === 0) console.log(JSON.stringify({ year, created, selected: selected.length }));
    }
    console.log(JSON.stringify({ action: 'drafts-imported', year, processed: created, sourceTotals: totals }));
  } finally { await db.$disconnect(); }
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
