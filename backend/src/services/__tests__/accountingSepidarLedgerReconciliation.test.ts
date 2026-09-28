import assert from 'node:assert/strict';
import test from 'node:test';
import { hashAccountingEvidence } from '../accountingLedgerFoundation';
import { assertLocalSepidarHistoricalPosting, assertSepidarHistoricalPostingCandidate, reconcileSepidarLedger, type SepidarLedgerReconciliationInput } from '../accountingSepidarLedgerReconciliation';

const fixture = (): SepidarLedgerReconciliationInput => {
  const sources = [
    { sourceTable: 'FMK.FiscalYear', sourceKey: '1', sourceHash: 'f'.repeat(64), payload: { Title: '1404' } },
    ...['10', '20'].map((key) => ({ sourceTable: 'ACC.Account', sourceKey: key, sourceHash: 'a'.repeat(64), payload: { Code: key } })),
    ...['101', '102'].flatMap((key, index) => [
      { sourceTable: 'ACC.Voucher', sourceKey: key, sourceHash: String(index + 1).repeat(64), payload: { FiscalYearRef: 1, Date: '2025-04-01T00:00:00.0000000', Version: 3 } },
      ...[1, 2].map((side) => ({ sourceTable: 'ACC.VoucherItem', sourceKey: `${key}${side}`, sourceHash: String(index + side + 3).repeat(64), payload: { VoucherRef: Number(key), RowNumber: side, AccountSLRef: side === 1 ? 10 : 20, Debit: side === 1 ? `${(index + 1) * 100}.0000` : '0.0000', Credit: side === 2 ? `${(index + 1) * 100}.0000` : '0.0000', Version: 3, DLRef: null } })),
    ]),
  ];
  const links = sources.filter((row) => ['ACC.Account', 'ACC.Voucher'].includes(row.sourceTable)).map((row) => ({ bookId: 'book', sourceTable: row.sourceTable, sourceKey: row.sourceKey, sourceHash: row.sourceHash, firstSnapshotId: 'snapshot', latestSnapshotId: 'snapshot', targetKind: row.sourceTable === 'ACC.Account' ? 'LEDGER_ACCOUNT' : 'LEDGER_DRAFT', targetId: `${row.sourceTable}:${row.sourceKey}`, mappingVersion: 1, reviewStatus: 'USER_APPROVED', reviewedBy: 'manager', reviewEvidence: 'snapshot' }));
  const vouchers = sources.filter((row) => row.sourceTable === 'ACC.Voucher').map((source) => {
    const sourcePayload = { snapshotId: 'snapshot', sourceRecordHash: source.sourceHash, voucher: source.payload };
    const lines = sources.filter((row) => row.sourceTable === 'ACC.VoucherItem' && String((row.payload as Record<string, unknown>).VoucherRef) === source.sourceKey).map((row, index) => {
      const payload = row.payload as Record<string, unknown>;
      const evidencePayload = { snapshotId: 'snapshot', sourceRecordHash: row.sourceHash, row: row.payload };
      return { id: `line:${row.sourceKey}`, sequence: index + 1, accountId: `ACC.Account:${payload.AccountSLRef}`, accountBookId: 'book', partyId: null, financialAccountId: null, debitRials: String(payload.Debit).split('.')[0], creditRials: String(payload.Credit).split('.')[0], evidenceType: 'SEPIDAR_ACC_VOUCHER_ITEM', evidenceId: row.sourceKey, evidenceVersion: 3, evidenceHash: hashAccountingEvidence(evidencePayload), evidencePayload, dimensions: [] };
    });
    return { id: `ACC.Voucher:${source.sourceKey}`, bookId: 'book', fiscalYearId: 'fy', fiscalYearCode: '1404', fiscalYearBookId: 'book', periodFiscalYearId: 'fy', periodStartsAt: new Date('2025-03-20T20:30:00Z'), periodEndsAt: new Date('2026-03-20T20:29:59.999Z'), documentDate: new Date('2025-03-31T20:30:00Z'), sourceType: 'SEPIDAR_ACC_VOUCHER', sourceId: source.sourceKey, sourceVersion: 3, sourceHash: hashAccountingEvidence(sourcePayload), sourcePayload, status: 'POSTED', postedAt: new Date('2026-09-28T00:00:00Z'), debitTotalRials: lines[0].debitRials, creditTotalRials: lines[1].creditRials, lines };
  });
  return { bookId: 'book', snapshot: { id: 'snapshot', bookId: 'book', status: 'COMPLETE', completedAt: new Date('2026-09-27T00:00:00Z'), sourcePackageHash: 'c'.repeat(64), expectedRecordCount: sources.length, importedRecordCount: sources.length, exportFormat: 'sepidar-source-jsonl-v1' }, actualArchiveRecordCount: sources.length, completeSnapshotIds: ['snapshot'], sources, links, vouchers, audit: { valid: true, checkedEntries: 4 } };
};

test('balanced swapped values fail row reconciliation with unchanged aggregate totals', () => {
  const input = fixture();
  assert.equal(reconcileSepidarLedger(input).exact, true);
  input.vouchers.forEach((voucher, index) => {
    const swapped = String(index === 0 ? 200 : 100);
    voucher.lines[0].debitRials = swapped; voucher.lines[1].creditRials = swapped;
    voucher.debitTotalRials = swapped; voucher.creditTotalRials = swapped;
  });
  const result = reconcileSepidarLedger(input);
  assert.equal(result.totals.sourceDebitRials, result.totals.targetDebitRials);
  assert.equal(result.exact, false);
  assert.ok(result.issues.some((issue) => issue.code === 'LINE_AMOUNT_MISMATCH'));
});

test('wrong identity, missing and extra target lines fail independently of totals', () => {
  const input = fixture();
  input.vouchers[0].lines[0].accountId = 'ACC.Account:20';
  assert.ok(reconcileSepidarLedger(input).issues.some((issue) => issue.code === 'LINE_ACCOUNT_MISMATCH'));
  input.vouchers[0].lines.pop();
  assert.ok(reconcileSepidarLedger(input).issues.some((issue) => issue.code === 'SOURCE_LINE_MISSING_TARGET'));
  input.vouchers[1].lines.push({ ...input.vouchers[1].lines[0], id: 'extra', evidenceId: 'extra', sequence: 3 });
  assert.ok(reconcileSepidarLedger(input).issues.some((issue) => issue.code === 'TARGET_LINE_EXTRA'));
});

test('incomplete archive, changed provenance, missing mapping and draft status fail closed', () => {
  const mutations: Array<(input: SepidarLedgerReconciliationInput) => void> = [
    (input) => { input.snapshot.status = 'IMPORTING'; },
    (input) => { input.actualArchiveRecordCount--; },
    (input) => { input.sources.find((row) => row.sourceTable === 'ACC.VoucherItem')!.sourceHash = 'd'.repeat(64); },
    (input) => { input.links = input.links.filter((link) => link.sourceTable !== 'ACC.Account'); },
    (input) => { input.vouchers[0].status = 'DRAFT'; },
    (input) => { input.vouchers[0].lines[0].evidencePayload = {}; },
    (input) => { input.audit.valid = false; },
    (input) => { input.links[0].latestSnapshotId = 'unknown'; },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.equal(reconcileSepidarLedger(input).exact, false); }
});

test('evidence is deterministic across query order and excludes payloads', () => {
  const input = fixture(); const first = reconcileSepidarLedger(input);
  input.sources.reverse(); input.links.reverse(); input.vouchers.reverse(); input.vouchers.forEach((voucher) => voucher.lines.reverse());
  assert.deepEqual(reconcileSepidarLedger(input), first);
  assert.doesNotMatch(JSON.stringify(first), /FiscalYearRef|AccountSLRef|sourcePayload|evidencePayload/);
});

test('detail membership, financial owner and period/book identity are compared', () => {
  const input = fixture();
  const child = input.sources.find((row) => row.sourceTable === 'ACC.VoucherItem')!;
  (child.payload as Record<string, unknown>).DLRef = 77;
  const line = input.vouchers[0].lines[0];
  line.evidencePayload = { snapshotId: 'snapshot', sourceRecordHash: child.sourceHash, row: child.payload };
  line.evidenceHash = hashAccountingEvidence(line.evidencePayload);
  input.sources.push({ sourceTable: 'ACC.DL', sourceKey: '77', sourceHash: 'e'.repeat(64), payload: { Code: '77' } });
  input.links.push({ ...input.links[0], sourceTable: 'ACC.DL', sourceKey: '77', sourceHash: 'e'.repeat(64), targetKind: 'DIMENSION_MEMBER', targetId: 'detail:77' });
  input.actualArchiveRecordCount++; input.snapshot.expectedRecordCount++; input.snapshot.importedRecordCount++;
  line.dimensions.push({ typeCode: 'SEPIDAR_DL', bookId: 'book', memberId: 'detail:77' });
  assert.equal(reconcileSepidarLedger(input).exact, true);
  line.financialAccountId = 'wrong-bank';
  assert.ok(reconcileSepidarLedger(input).issues.some((issue) => issue.code === 'LINE_DETAIL_MISMATCH'));
  line.dimensions[0].memberId = 'wrong-detail';
  input.vouchers[0].bookId = 'wrong-book';
  input.vouchers[0].documentDate = new Date('2025-04-01T00:00:00Z');
  const result = reconcileSepidarLedger(input);
  assert.ok(result.issues.some((issue) => issue.code === 'TARGET_BOOK_OR_PERIOD_MISMATCH'));
  assert.ok(result.issues.some((issue) => issue.code === 'DOCUMENT_DATE_OR_PERIOD_MISMATCH'));
});

test('missing voucher, extra voucher and duplicate evidence identities are rejected', () => {
  const input = fixture(); input.vouchers.pop();
  assert.ok(reconcileSepidarLedger(input).issues.some((issue) => issue.code === 'SOURCE_VOUCHER_MISSING_TARGET'));
  input.vouchers.push({ ...input.vouchers[0], id: 'extra-voucher' });
  assert.ok(reconcileSepidarLedger(input).issues.some((issue) => issue.code === 'TARGET_VOUCHER_EXTRA'));
  input.vouchers[0].lines.push({ ...input.vouchers[0].lines[0], id: 'duplicate-line', sequence: 3 });
  assert.ok(reconcileSepidarLedger(input).issues.some((issue) => issue.code === 'TARGET_LINE_ID_AMBIGUOUS'));
});

const localRuntime = { nodeEnv: 'development', databaseUrl: 'postgresql://postgres:local@postgres:5432/sabalanerp?application_name=sabalanerp-backend-local' };
test('historical posting fails closed for production, wrong book, nonlocal and unbound database identity', () => {
  const book = 'cmub2hd63007zrqlphrzi5eey';
  assert.doesNotThrow(() => assertLocalSepidarHistoricalPosting(book, localRuntime));
  for (const runtime of [{ ...localRuntime, nodeEnv: 'production' }, { ...localRuntime, nodeEnv: undefined },
    { ...localRuntime, databaseUrl: localRuntime.databaseUrl.replace('@postgres:', '@production.example:') },
    { ...localRuntime, databaseUrl: localRuntime.databaseUrl.replace('sabalanerp-backend-local', 'sabalanerp-backend') },
    { ...localRuntime, databaseUrl: '' }]) assert.throws(() => assertLocalSepidarHistoricalPosting(book, runtime), /فقط در دفتر توسعه/);
  assert.throws(() => assertLocalSepidarHistoricalPosting('different-book', localRuntime), /فقط در دفتر توسعه/);
});

test('only exact addressed local draft may pass posting preflight; generic reconciliation still rejects it', () => {
  const input = fixture(); const book = 'cmub2hd63007zrqlphrzi5eey';
  input.bookId = book; input.snapshot.bookId = book; input.links.forEach((link) => { link.bookId = book; });
  input.vouchers = input.vouchers.slice(0, 1);
  input.sources = input.sources.filter((row) => !['ACC.Voucher', 'ACC.VoucherItem'].includes(row.sourceTable)
    || row.sourceTable === 'ACC.Voucher' && row.sourceKey === '101'
    || row.sourceTable === 'ACC.VoucherItem' && String((row.payload as Record<string, unknown>).VoucherRef) === '101');
  const draft = input.vouchers[0]; draft.bookId = book; draft.fiscalYearBookId = book;
  draft.lines.forEach((line) => { line.accountBookId = book; }); draft.status = 'DRAFT'; draft.postedAt = null;
  assert.equal(reconcileSepidarLedger(input).exact, false);
  assert.doesNotThrow(() => assertSepidarHistoricalPostingCandidate(input, draft.id, localRuntime));
  assert.throws(() => assertSepidarHistoricalPostingCandidate(input, draft.id, { ...localRuntime, nodeEnv: 'production' }), /فقط در دفتر توسعه/);
  draft.lines[0].debitRials = '200'; draft.lines[1].creditRials = '200'; draft.debitTotalRials = '200'; draft.creditTotalRials = '200';
  assert.throws(() => assertSepidarHistoricalPostingCandidate(input, draft.id, localRuntime), /تطبیق ندارند/);
});
