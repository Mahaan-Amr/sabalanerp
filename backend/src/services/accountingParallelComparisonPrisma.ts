import { Prisma, type PrismaClient } from '@prisma/client';
import { compareAccountingParallelEvents, type ParallelEventPair } from './accountingParallelComparison';
import { AccountingReplacementError, hashAccountingReplacementEvidence } from './accountingReplacement';
import { createAccountingReplacementPrismaRepository } from './accountingReplacementPrismaRepository';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { verifyLedgerAuditChain } from './accountingLedgerPrismaRepository';
import { parseSepidarLocalDateTime } from './sepidarCalendar';

const code = 'PARALLEL_EVENTS';
const object = (value: unknown) => value as Record<string, unknown>;
const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Retry the whole transaction only after PostgreSQL has rolled back a serialization conflict. */
export const runAccountingParallelTransaction = async <T>(db: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await db.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 20_000, timeout: 120_000 }); }
    catch (error) {
      if ((error as { code?: string }).code !== 'P2034') throw error;
      if (attempt === 2) throw new AccountingReplacementError('PARALLEL_CONCURRENT_CHANGE', 'داده‌ها هم‌زمان تغییر کردند؛ عملیات را دوباره اجرا کنید.', 409);
    }
  }
  throw new Error('Unreachable parallel transaction state');
};

/** Caller passes identities only; all amounts, mappings and evidence are read from their owners. */
export const recordAccountingParallelComparison = async (tx: Prisma.TransactionClient, command: {
  bookId: string; periodId: string; snapshotId: string; actorId: string;
  pair?: { sourceKey: string; targetId: string; reason: string };
}) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`accounting-parallel:${command.bookId}:${command.periodId}:${command.snapshotId}`}))`;
  const period = await tx.accountingPostingPeriod.findUnique({ where: { id: command.periodId }, include: { fiscalYear: true } });
  const snapshot = await tx.accountingSepidarSourceSnapshot.findUnique({ where: { id: command.snapshotId } });
  if (!period || period.fiscalYear.bookId !== command.bookId || !snapshot || snapshot.bookId !== command.bookId || snapshot.status !== 'COMPLETE' || !snapshot.completedAt
    || !/^[a-f0-9]{64}$/.test(snapshot.sourcePackageHash) || object(snapshot.sourceMetadata).exportFormat !== 'sepidar-source-jsonl-v1') {
    throw new AccountingReplacementError('PARALLEL_SCOPE_INVALID', 'دوره و نسخهٔ کامل سپیدار باید متعلق به همین دفتر باشند.', 409);
  }
  const [archiveCount, audit, records, links, targets, previous] = await Promise.all([
    tx.accountingSepidarSourceRecord.count({ where: { snapshotId: snapshot.id } }), verifyLedgerAuditChain(tx),
    tx.accountingSepidarSourceRecord.findMany({ where: { snapshotId: snapshot.id, sourceTable: { in: ['ACC.Voucher', 'ACC.VoucherItem', 'ACC.Account', 'ACC.DL', 'GNR.Party', 'RPA.BankAccount'] } }, select: { sourceTable: true, sourceKey: true, sourceHash: true, payload: true } }),
    tx.accountingSepidarTargetLink.findMany({ where: { bookId: command.bookId, latestSnapshotId: snapshot.id, reviewStatus: 'USER_APPROVED' } }),
    tx.accountingLedgerVoucher.findMany({ where: { bookId: command.bookId, periodId: period.id, status: 'POSTED', sourceType: { not: 'SEPIDAR_ACC_VOUCHER' } }, include: { lines: { include: { dimensions: true, account: { select: { bookId: true } } } } } }),
    tx.accountingOperationalReconciliation.findFirst({ where: { bookId: command.bookId, periodId: period.id, reconciliationCode: code, sourceSystem: snapshot.id }, orderBy: [{ reconciledAt: 'desc' }, { id: 'desc' }] }),
  ]);
  if (archiveCount !== snapshot.expectedRecordCount || archiveCount !== snapshot.importedRecordCount || !audit.valid || audit.checkedEntries < 1) {
    throw new AccountingReplacementError('PARALLEL_EVIDENCE_INCOMPLETE', 'بایگانی منبع یا زنجیرهٔ ممیزی دفتر کامل و معتبر نیست.', 409);
  }
  const lookup = new Map(records.map((row) => [`${row.sourceTable}:${row.sourceKey}`, row]));
  const mappingIndex = new Map<string, typeof links>();
  for (const link of links) {
    const key = `${link.sourceTable}:${link.sourceKey}:${link.targetKind}`;
    mappingIndex.set(key, [...(mappingIndex.get(key) ?? []), link]);
  }
  const mapped = (table: string, key: string, kind: string) => {
    const row = lookup.get(`${table}:${key}`);
    const candidates = (mappingIndex.get(`${table}:${key}:${kind}`) ?? []).filter((link) => link.sourceHash === row?.sourceHash && link.reviewedBy && link.reviewEvidence && link.mappingVersion > 0);
    return candidates.length === 1 ? candidates[0].targetId : null;
  };
  const ownerIndex = new Map<string, typeof records>();
  for (const row of records) {
    const field = row.sourceTable === 'GNR.Party' ? 'DLRef' : row.sourceTable === 'RPA.BankAccount' ? 'DlRef' : null;
    if (!field || object(row.payload)[field] == null) continue;
    const key = `${row.sourceTable}:${object(row.payload)[field]}`;
    ownerIndex.set(key, [...(ownerIndex.get(key) ?? []), row]);
  }
  const owners = (table: string, detail: unknown, kind: string) => {
    const rows = ownerIndex.get(`${table}:${detail}`) ?? [];
    return rows.length === 1 ? mapped(table, rows[0].sourceKey, kind) : null;
  };
  const sourceVouchers = records.filter((row) => {
    if (row.sourceTable !== 'ACC.Voucher') return false;
    let date: Date;
    try { date = parseSepidarLocalDateTime(String(object(row.payload).Date)); }
    catch { throw new AccountingReplacementError('PARALLEL_SOURCE_DATE_INVALID', 'تاریخ سند منبع معتبر نیست؛ تعیین دامنهٔ دوره ممکن نیست.', 409); }
    return date >= period.startsAt && date <= period.endsAt;
  });
  const items = new Map<string, typeof records>();
  for (const row of records.filter((item) => item.sourceTable === 'ACC.VoucherItem')) {
    const parent = String(object(row.payload).VoucherRef); items.set(parent, [...(items.get(parent) ?? []), row]);
  }
  const sources = sourceVouchers.map((row) => ({ key: row.sourceKey, hash: row.sourceHash, day: day(parseSepidarLocalDateTime(String(object(row.payload).Date))),
    lines: (items.get(row.sourceKey) ?? []).map((item) => {
      const raw = object(item.payload); const detail = raw.DLRef;
      const partyId = detail == null ? null : owners('GNR.Party', detail, 'PARTY');
      const financialAccountId = detail == null ? null : owners('RPA.BankAccount', detail, 'FINANCIAL_ACCOUNT');
      const missingOwner = detail != null && (['GNR.Party', 'RPA.BankAccount'].some((table) =>
        (ownerIndex.get(`${table}:${detail}`) ?? []).some((owner) => !mapped(table, owner.sourceKey, table === 'GNR.Party' ? 'PARTY' : 'FINANCIAL_ACCOUNT'))
        || (ownerIndex.get(`${table}:${detail}`) ?? []).length > 1));
      // An unidentified detail must not be dropped or converted to an anonymous line.
      const accountId = missingOwner || (detail != null && !partyId && !financialAccountId) ? null : mapped('ACC.Account', String(raw.AccountSLRef), 'LEDGER_ACCOUNT');
      return { accountId, partyId, financialAccountId, debit: String(raw.Debit), credit: String(raw.Credit) };
    }),
  }));
  for (const target of targets) {
    if (!target.postedAt || hashAccountingEvidence(target.sourcePayload) !== target.sourceHash || target.lines.some((line) => line.account.bookId !== command.bookId || hashAccountingEvidence(line.evidencePayload) !== line.evidenceHash)
      || target.lines.reduce((sum, line) => sum + BigInt(line.debitRials.toString()), 0n).toString() !== target.debitTotalRials.toString()
      || target.lines.reduce((sum, line) => sum + BigInt(line.creditRials.toString()), 0n).toString() !== target.creditTotalRials.toString()) {
      throw new AccountingReplacementError('PARALLEL_TARGET_EVIDENCE_INVALID', 'اثر انگشت شاهد سند مقصد معتبر نیست.', 409);
    }
  }
  const priorPayload = previous?.controlPayload ? object(previous.controlPayload) : null;
  const pairs: ParallelEventPair[] = priorPayload && Array.isArray(priorPayload.pairs) ? priorPayload.pairs as ParallelEventPair[] : [];
  if (command.pair) {
    const pair = command.pair;
    if (!pair.reason.trim() || !command.actorId.trim()) throw new AccountingReplacementError('PARALLEL_REASON_REQUIRED', 'دلیل پیوند رویداد و مسئول بررسی الزامی‌اند.', 400);
    const existing = pairs.find((item) => item.sourceKey === pair.sourceKey && item.targetId === pair.targetId);
    if (!existing) {
      // A correction produces a successor comparison, preserving all prior evidence.
      const kept = pairs.filter((item) => item.sourceKey !== pair.sourceKey && item.targetId !== pair.targetId);
      pairs.splice(0, pairs.length, ...kept, { ...pair, actorId: command.actorId });
    } else if (existing.reason !== pair.reason) throw new AccountingReplacementError('PARALLEL_RETRY_CHANGED', 'دلیل پیوند ثبت‌شده در تلاش تکراری تغییرپذیر نیست.', 409);
  }
  const report = compareAccountingParallelEvents({ bookId: command.bookId, periodId: period.id, snapshotId: snapshot.id,
    sourcePackageHash: snapshot.sourcePackageHash, sources, targets: targets.map((target) => ({ id: target.id,
      hash: target.sourceHash, day: day(target.documentDate), sourceType: target.sourceType, status: target.status,
      lines: target.lines.map((line) => ({ accountId: line.accountId, partyId: line.partyId, financialAccountId: line.financialAccountId,
        debit: line.debitRials.toString(), credit: line.creditRials.toString(), dimensions: line.dimensions.map((dimension) => `${dimension.dimensionTypeId}:${dimension.memberId}`) })),
    })), pairs });
  if (previous && priorPayload?.outputHash === report.outputHash) return { id: previous.id, ...report };
  const revisionHash = hashAccountingReplacementEvidence({ outputHash: report.outputHash, predecessorComparisonId: previous?.id ?? null });
  const saved = await tx.accountingOperationalReconciliation.create({ data: {
    bookId: command.bookId, fiscalYearId: period.fiscalYearId, periodId: period.id, reconciliationCode: code, sourceSystem: snapshot.id,
    sourceSnapshotHash: revisionHash, sourceDebitRials: report.sourceDebitRials, sourceCreditRials: report.sourceCreditRials,
    ledgerDebitRials: report.targetDebitRials, ledgerCreditRials: report.targetCreditRials,
    unresolvedDifferences: json(report.differences), controlPayload: json({ ...report, predecessorComparisonId: previous?.id ?? null }), evidenceHash: revisionHash, reconciledAt: new Date(),
  } });
  await createAccountingReplacementPrismaRepository(tx).appendAudit('PARALLEL_EVENTS_COMPARED', {
    actorId: command.actorId, bookId: command.bookId, periodId: period.id, comparisonId: saved.id,
    predecessorComparisonId: previous?.id ?? null, outputHash: report.outputHash, exact: report.exact,
  });
  return { id: saved.id, ...report };
};
