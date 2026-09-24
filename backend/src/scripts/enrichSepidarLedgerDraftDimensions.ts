import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAccountingLedgerPrismaRepository } from '../services/accountingLedgerPrismaRepository';
import { voucherContentHash } from '../services/accountingLedgerFoundation';

const bookId = 'cmub2hd63007zrqlphrzi5eey';
const snapshotId = '107e07de8110cdbe0ceeb995a98c9111a223a738d182dd1c0f0cf4cf43bcd009';
const actorId = 'sepidar-user-approved-development-import';
const payload = (value: unknown) => value as Record<string, unknown>;

const main = async () => {
  const db = new PrismaClient();
  try {
    const [partyRows, bankRows, partyLinks, bankLinks, year] = await Promise.all([
      db.accountingSepidarSourceRecord.findMany({ where: { snapshotId, sourceTable: 'GNR.Party' }, select: { sourceKey: true, payload: true } }),
      db.accountingSepidarSourceRecord.findMany({ where: { snapshotId, sourceTable: 'RPA.BankAccount' }, select: { sourceKey: true, payload: true } }),
      db.accountingSepidarTargetLink.findMany({ where: { bookId, sourceTable: 'GNR.Party', targetKind: 'PARTY' }, select: { sourceKey: true, targetId: true } }),
      db.accountingSepidarTargetLink.findMany({ where: { bookId, sourceTable: 'RPA.BankAccount', targetKind: 'FINANCIAL_ACCOUNT' }, select: { sourceKey: true, targetId: true } }),
      db.accountingFiscalYear.findUnique({ where: { bookId_code: { bookId, code: '1404' } }, select: { id: true } }),
    ]);
    if (!year || partyLinks.length !== 1514 || bankLinks.length !== 62) throw new Error('Complete source owner mapping required');
    const partyBySource = new Map(partyLinks.map((link) => [link.sourceKey, link.targetId]));
    const bankBySource = new Map(bankLinks.map((link) => [link.sourceKey, link.targetId]));
    const partyByDetail = new Map(partyRows.filter((row) => payload(row.payload).DLRef != null).map((row) => [String(payload(row.payload).DLRef), partyBySource.get(row.sourceKey)]));
    const bankByDetail = new Map(bankRows.filter((row) => payload(row.payload).DlRef != null).map((row) => [String(payload(row.payload).DlRef), bankBySource.get(row.sourceKey)]));
    const drafts = await db.accountingLedgerVoucher.findMany({ where: { bookId, fiscalYearId: year.id, sourceType: 'SEPIDAR_ACC_VOUCHER', status: 'DRAFT' }, select: { id: true } });
    let corrected = 0;
    let linkedLines = 0;
    for (const [index, row] of drafts.entries()) {
      const changed = await db.$transaction(async (tx) => {
        const repository = createAccountingLedgerPrismaRepository(tx, true);
        const voucher = await repository.getVoucherForUpdate(row.id);
        if (!voucher || voucher.status !== 'DRAFT') throw new Error(`Source draft ${row.id} no longer editable`);
        const lineRows = await tx.accountingLedgerLine.findMany({ where: { voucherId: row.id }, select: { id: true, sequence: true }, orderBy: { sequence: 'asc' } });
        if (lineRows.length !== voucher.lines.length) throw new Error(`Draft line count changed: ${row.id}`);
        const enriched = voucher.lines.map((line) => {
          const source = payload(line.evidence.payload);
          const detail = payload(source.row).DLRef;
          const dl = detail == null ? null : String(detail);
          return { ...line, partyId: dl == null ? undefined : partyByDetail.get(dl), financialAccountId: dl == null ? undefined : bankByDetail.get(dl) };
        });
        const changes = enriched.map((line, position) => ({ line, position })).filter(({ line, position }) =>
          line.partyId !== voucher.lines[position].partyId || line.financialAccountId !== voucher.lines[position].financialAccountId);
        if (!changes.length) return 0;
        for (const { line, position } of changes) await tx.accountingLedgerLine.update({ where: { id: lineRows[position].id }, data: {
          partyId: line.partyId ?? null, financialAccountId: line.financialAccountId ?? null,
        } });
        const correctedHash = voucherContentHash({ ...voucher, lines: enriched });
        await tx.accountingLedgerVoucher.update({ where: { id: row.id }, data: { contentHash: correctedHash } });
        await repository.appendAudit({ action: 'SEPIDAR_DRAFT_OWNER_LINKED', result: 'SUCCEEDED', actorId,
          effectiveProfile: 'ACCOUNTING_MANAGER', entityType: 'JOURNAL_VOUCHER', entityId: row.id, correlationId: randomUUID(),
          reason: 'اتصال تفصیلی سپیدار به شخص یا حساب مالی مقصد', payloadHash: correctedHash,
          sessionContext: { previousContentHash: voucher.contentHash, linkedLines: changes.length } });
        return changes.length;
      });
      if (changed) { corrected++; linkedLines += changed; }
      if ((index + 1) % 500 === 0) console.log(JSON.stringify({ inspected: index + 1, total: drafts.length, corrected, linkedLines }));
    }
    console.log(JSON.stringify({ action: 'enriched', inspected: drafts.length, corrected, linkedLines }));
  } finally { await db.$disconnect(); }
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
