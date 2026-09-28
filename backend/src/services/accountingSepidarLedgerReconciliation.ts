import { AccountingLedgerError, hashAccountingEvidence } from './accountingLedgerFoundation';
import { parseSepidarLocalDateTime } from './sepidarCalendar';

export type SepidarReconciliationSource = { sourceTable: string; sourceKey: string; sourceHash: string; payload: unknown };
export type SepidarReconciliationLink = {
  bookId: string; sourceTable: string; sourceKey: string; sourceHash: string;
  firstSnapshotId: string; latestSnapshotId: string; targetKind: string; targetId: string;
  mappingVersion: number; reviewStatus: string; reviewedBy: string | null; reviewEvidence: string | null;
};
export type SepidarReconciliationLine = {
  id: string; sequence: number; accountId: string; accountBookId: string;
  partyId: string | null; financialAccountId: string | null; debitRials: string; creditRials: string;
  evidenceType: string; evidenceId: string; evidenceVersion: number; evidenceHash: string; evidencePayload: unknown;
  dimensions: Array<{ typeCode: string; bookId: string; memberId: string }>;
};
export type SepidarReconciliationVoucher = {
  id: string; bookId: string; fiscalYearId: string; fiscalYearCode: string; fiscalYearBookId: string;
  periodFiscalYearId: string; periodStartsAt: Date; periodEndsAt: Date; documentDate: Date;
  sourceType: string; sourceId: string; sourceVersion: number; sourceHash: string; sourcePayload: unknown;
  status: string; postedAt: Date | null; debitTotalRials: string; creditTotalRials: string; lines: SepidarReconciliationLine[];
};
export type SepidarLedgerReconciliationInput = {
  bookId: string;
  snapshot: { id: string; bookId: string; status: string; completedAt: Date | null; sourcePackageHash: string;
    expectedRecordCount: number; importedRecordCount: number; exportFormat: string };
  actualArchiveRecordCount: number; completeSnapshotIds: string[]; sources: SepidarReconciliationSource[];
  links: SepidarReconciliationLink[]; vouchers: SepidarReconciliationVoucher[];
  audit: { valid: boolean; checkedEntries: number };
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const amount = (value: unknown): bigint | null => {
  const text = String(value ?? '');
  return /^\d+(?:\.0+)?$/.test(text) ? BigInt(text.split('.')[0]) : null;
};
const evidenceId = (key: string, kind: 'ITEM' | 'VOUCHER') => key.length >= 3 ? key : `SEP-${kind}-${key}`;
const version = (value: unknown) => Math.max(1, Number(value) || 1);

/** Read-only, exact ledger reconciliation. It confers no subledger, cutover or deployment acceptance. */
const reconcile = (input: SepidarLedgerReconciliationInput, draftCandidateId?: string) => {
  const issues: Array<{ code: string; sourceTable: string | null; sourceKey: string | null; targetId: string | null }> = [];
  const issue = (code: string, source?: SepidarReconciliationSource, targetId?: string) => {
    issues.push({ code, sourceTable: source?.sourceTable ?? null, sourceKey: source?.sourceKey ?? null, targetId: targetId ?? null });
  };
  const snapshot = input.snapshot;
  if (snapshot.bookId !== input.bookId || snapshot.status !== 'COMPLETE' || !snapshot.completedAt
    || snapshot.expectedRecordCount !== snapshot.importedRecordCount || snapshot.expectedRecordCount !== input.actualArchiveRecordCount
    || !/^[a-f0-9]{64}$/.test(snapshot.sourcePackageHash) || snapshot.exportFormat !== 'sepidar-source-jsonl-v1') issue('SOURCE_SNAPSHOT_INCOMPLETE');
  if (!input.audit.valid || input.audit.checkedEntries < 1) issue('LEDGER_AUDIT_INVALID');
  const sourceMap = new Map<string, SepidarReconciliationSource>();
  for (const source of input.sources) {
    const key = `${source.sourceTable}:${source.sourceKey}`;
    if (sourceMap.has(key)) issue('SOURCE_ID_DUPLICATE', source);
    sourceMap.set(key, source);
    if (!/^[a-f0-9]{64}$/.test(source.sourceHash)) issue('SOURCE_HASH_INVALID', source);
  }
  const linksByIdentity = new Map<string, SepidarReconciliationLink[]>();
  for (const link of input.links) {
    const key = `${link.sourceTable}:${link.sourceKey}:${link.targetKind}`;
    linksByIdentity.set(key, [...(linksByIdentity.get(key) ?? []), link]);
  }
  const findLink = (source: SepidarReconciliationSource, kind: string) => {
    const links = linksByIdentity.get(`${source.sourceTable}:${source.sourceKey}:${kind}`) ?? [];
    if (links.length !== 1) { issue('SOURCE_MAPPING_MISSING_OR_AMBIGUOUS', source); return null; }
    const link = links[0];
    if (link.bookId !== input.bookId || link.sourceHash !== source.sourceHash || link.latestSnapshotId !== snapshot.id
      || !input.completeSnapshotIds.includes(link.firstSnapshotId) || link.mappingVersion < 1
      || link.reviewStatus !== 'USER_APPROVED' || !link.reviewedBy || !link.reviewEvidence) issue('SOURCE_MAPPING_PROVENANCE_INVALID', source, link.targetId);
    return link;
  };
  const ownersByDetail = new Map<string, SepidarReconciliationSource[]>();
  for (const source of input.sources) {
    const field = source.sourceTable === 'GNR.Party' ? 'DLRef' : source.sourceTable === 'RPA.BankAccount' ? 'DlRef' : null;
    if (!field || object(source.payload)[field] == null) continue;
    const key = `${source.sourceTable}:${object(source.payload)[field]}`;
    ownersByDetail.set(key, [...(ownersByDetail.get(key) ?? []), source]);
  }
  const owners = (table: string, detail: string, kind: string) => {
    const rows = ownersByDetail.get(`${table}:${detail}`) ?? [];
    if (rows.length > 1) { issue('DETAIL_OWNER_AMBIGUOUS', rows[0]); return undefined; }
    return rows.length ? findLink(rows[0], kind)?.targetId : null;
  };
  const sourceVouchers = input.sources.filter((row) => row.sourceTable === 'ACC.Voucher');
  const sourceLines = input.sources.filter((row) => row.sourceTable === 'ACC.VoucherItem');
  if (!sourceVouchers.length || !sourceLines.length) issue('SOURCE_LEDGER_EMPTY');
  const linesByVoucher = new Map<string, SepidarReconciliationSource[]>();
  for (const line of sourceLines) {
    const key = String(object(line.payload).VoucherRef);
    linesByVoucher.set(key, [...(linesByVoucher.get(key) ?? []), line]);
    if (!sourceMap.has(`ACC.Voucher:${key}`)) issue('SOURCE_LINE_ORPHANED', line);
  }
  const targetsById = new Map<string, SepidarReconciliationVoucher>();
  for (const target of input.vouchers) {
    if (targetsById.has(target.id)) issue('TARGET_VOUCHER_DUPLICATE', undefined, target.id);
    targetsById.set(target.id, target);
  }
  const usedTargets = new Set<string>();
  const rows: Array<{ sourceTable: string; sourceKey: string; sourceHash: string; targetId: string | null; observedTargetHash: string | null }> = [];
  let sourceDebit = 0n; let sourceCredit = 0n; let targetDebit = 0n; let targetCredit = 0n;
  for (const target of input.vouchers) for (const line of target.lines) {
    const debit = amount(line.debitRials); const credit = amount(line.creditRials);
    if (debit == null || credit == null) issue('TARGET_AMOUNT_INVALID', undefined, line.id);
    targetDebit += debit ?? 0n; targetCredit += credit ?? 0n;
  }
  for (const source of sourceVouchers) {
    const payload = object(source.payload); const link = findLink(source, 'LEDGER_DRAFT');
    const target = link ? targetsById.get(link.targetId) : undefined;
    rows.push({ sourceTable: source.sourceTable, sourceKey: source.sourceKey, sourceHash: source.sourceHash,
      targetId: target?.id ?? null, observedTargetHash: target ? hashAccountingEvidence({ ...target,
        lines: [...target.lines].sort((a, b) => a.id.localeCompare(b.id)).map((line) => ({ ...line,
          dimensions: [...line.dimensions].sort((a, b) => a.memberId.localeCompare(b.memberId)) })) }) : null });
    if (!target) issue('SOURCE_VOUCHER_MISSING_TARGET', source, link?.targetId);
    else {
      if (usedTargets.has(target.id)) issue('TARGET_VOUCHER_REUSED', source, target.id);
      usedTargets.add(target.id);
      const frozen = object(target.sourcePayload);
      if (target.bookId !== input.bookId || target.fiscalYearBookId !== input.bookId
        || target.periodFiscalYearId !== target.fiscalYearId) issue('TARGET_BOOK_OR_PERIOD_MISMATCH', source, target.id);
      const candidate = draftCandidateId === target.id && target.status === 'DRAFT' && target.postedAt == null;
      if (!candidate && (target.status !== 'POSTED' || !target.postedAt)) issue('TARGET_NOT_POSTED', source, target.id);
      if (target.sourceType !== 'SEPIDAR_ACC_VOUCHER' || target.sourceId !== evidenceId(source.sourceKey, 'VOUCHER')
        || target.sourceVersion !== version(payload.Version) || frozen.snapshotId !== snapshot.id || frozen.sourceRecordHash !== source.sourceHash
        || hashAccountingEvidence(frozen.voucher) !== hashAccountingEvidence(source.payload)
        || hashAccountingEvidence(target.sourcePayload) !== target.sourceHash) issue('VOUCHER_PROVENANCE_MISMATCH', source, target.id);
      const year = sourceMap.get(`FMK.FiscalYear:${payload.FiscalYearRef}`);
      if (!year || String(object(year.payload).Title) !== target.fiscalYearCode) issue('FISCAL_YEAR_MISMATCH', source, target.id);
      try {
        const date = parseSepidarLocalDateTime(String(payload.Date));
        if (date.getTime() !== target.documentDate.getTime() || date < target.periodStartsAt || date > target.periodEndsAt) issue('DOCUMENT_DATE_OR_PERIOD_MISMATCH', source, target.id);
      } catch { issue('SOURCE_DATE_INVALID', source); }
    }
    const children = [...(linesByVoucher.get(source.sourceKey) ?? [])].sort((a, b) => Number(object(a.payload).RowNumber) - Number(object(b.payload).RowNumber));
    if (children.length < 2) issue('SOURCE_VOUCHER_LINES_INCOMPLETE', source);
    const usedLines = new Set<string>(); const rowNumbers = new Set<number>();
    let voucherDebit = 0n; let voucherCredit = 0n;
    for (const [index, child] of children.entries()) {
      const raw = object(child.payload); const debit = amount(raw.Debit); const credit = amount(raw.Credit);
      const rowNumber = Number(raw.RowNumber);
      if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumbers.has(rowNumber)) issue('SOURCE_ROW_NUMBER_INVALID', child);
      rowNumbers.add(rowNumber);
      if (debit == null || credit == null || (debit > 0n) === (credit > 0n)) issue('SOURCE_AMOUNT_INVALID', child);
      sourceDebit += debit ?? 0n; sourceCredit += credit ?? 0n; voucherDebit += debit ?? 0n; voucherCredit += credit ?? 0n;
      const matches = target?.lines.filter((line) => line.evidenceType === 'SEPIDAR_ACC_VOUCHER_ITEM' && line.evidenceId === evidenceId(child.sourceKey, 'ITEM')) ?? [];
      const line = matches.length === 1 ? matches[0] : undefined;
      rows.push({ sourceTable: child.sourceTable, sourceKey: child.sourceKey, sourceHash: child.sourceHash,
        targetId: line?.id ?? null, observedTargetHash: line ? hashAccountingEvidence({ ...line, dimensions: [...line.dimensions].sort((a, b) => a.memberId.localeCompare(b.memberId)) }) : null });
      if (!line) { issue(matches.length ? 'TARGET_LINE_ID_AMBIGUOUS' : 'SOURCE_LINE_MISSING_TARGET', child, target?.id); continue; }
      usedLines.add(line.id);
      if (line.sequence !== index + 1) issue('LINE_SEQUENCE_MISMATCH', child, line.id);
      if (amount(line.debitRials) !== debit || amount(line.creditRials) !== credit) issue('LINE_AMOUNT_MISMATCH', child, line.id);
      const account = sourceMap.get(`ACC.Account:${raw.AccountSLRef}`);
      const accountLink = account ? findLink(account, 'LEDGER_ACCOUNT') : null;
      if (!accountLink || line.accountId !== accountLink.targetId || line.accountBookId !== input.bookId) issue('LINE_ACCOUNT_MISMATCH', child, line.id);
      const frozen = object(line.evidencePayload);
      if (line.evidenceVersion !== version(raw.Version) || frozen.snapshotId !== snapshot.id || frozen.sourceRecordHash !== child.sourceHash
        || hashAccountingEvidence(frozen.row) !== hashAccountingEvidence(child.payload)
        || hashAccountingEvidence(line.evidencePayload) !== line.evidenceHash) issue('LINE_PROVENANCE_MISMATCH', child, line.id);
      const detail = raw.DLRef == null ? null : String(raw.DLRef);
      if (detail == null) {
        if (line.partyId != null || line.financialAccountId != null || line.dimensions.length) issue('LINE_DETAIL_MISMATCH', child, line.id);
      } else {
        const dl = sourceMap.get(`ACC.DL:${detail}`); const detailLink = dl ? findLink(dl, 'DIMENSION_MEMBER') : null;
        if (!detailLink || line.dimensions.length !== 1 || line.dimensions[0].typeCode !== 'SEPIDAR_DL'
          || line.dimensions[0].bookId !== input.bookId || line.dimensions[0].memberId !== detailLink.targetId
          || line.partyId !== owners('GNR.Party', detail, 'PARTY')
          || line.financialAccountId !== owners('RPA.BankAccount', detail, 'FINANCIAL_ACCOUNT')) issue('LINE_DETAIL_MISMATCH', child, line.id);
      }
    }
    if (voucherDebit !== voucherCredit) issue('SOURCE_VOUCHER_UNBALANCED', source);
    if (target) {
      for (const line of target.lines) if (!usedLines.has(line.id)) issue('TARGET_LINE_EXTRA', source, line.id);
      const actualDebit = target.lines.reduce((sum, line) => sum + (amount(line.debitRials) ?? 0n), 0n);
      const actualCredit = target.lines.reduce((sum, line) => sum + (amount(line.creditRials) ?? 0n), 0n);
      if (actualDebit !== actualCredit || actualDebit !== amount(target.debitTotalRials) || actualCredit !== amount(target.creditTotalRials)) issue('TARGET_VOUCHER_TOTAL_MISMATCH', source, target.id);
    }
  }
  for (const target of input.vouchers) if (!usedTargets.has(target.id)) issue('TARGET_VOUCHER_EXTRA', undefined, target.id);
  rows.sort((a, b) => `${a.sourceTable}:${a.sourceKey}`.localeCompare(`${b.sourceTable}:${b.sourceKey}`));
  issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const evidence = {
    format: 'sepidar-ledger-row-reconciliation-v1', bookId: input.bookId, snapshotId: snapshot.id,
    sourcePackageHash: snapshot.sourcePackageHash,
    sourceHashConvention: 'Opaque SHA-256 of original JSONL payload bytes; embedded evidence uses historical canonical accounting hash.',
    exact: issues.length === 0 && sourceDebit === targetDebit && sourceCredit === targetCredit,
    scope: 'SOURCE_LEDGER_ONLY_NOT_SUBLEDGER_OR_CUTOVER_ACCEPTANCE',
    totals: { sourceVouchers: sourceVouchers.length, sourceLines: sourceLines.length, targetVouchers: input.vouchers.length,
      targetLines: input.vouchers.reduce((sum, target) => sum + target.lines.length, 0), sourceDebitRials: sourceDebit.toString(), sourceCreditRials: sourceCredit.toString(), targetDebitRials: targetDebit.toString(), targetCreditRials: targetCredit.toString() },
    audit: input.audit, rows, issues,
  };
  return { ...evidence, outputHash: hashAccountingEvidence(evidence) };
};

export const reconcileSepidarLedger = (input: SepidarLedgerReconciliationInput) => reconcile(input);

export const assertLocalSepidarHistoricalPosting = (bookId: string, runtime: { nodeEnv?: string; databaseUrl?: string }) => {
  let localDatabase = false;
  try {
    const url = new URL(runtime.databaseUrl ?? '');
    localDatabase = ['postgresql:', 'postgres:'].includes(url.protocol)
      && ['postgres', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && ['/sabalanerp'].includes(url.pathname)
      && ['5432', '55432', ''].includes(url.port)
      && url.searchParams.get('application_name') === 'sabalanerp-backend-local';
  } catch { /* Missing or malformed runtime identity fails closed. */ }
  if (runtime.nodeEnv !== 'development' || bookId !== 'cmub2hd63007zrqlphrzi5eey' || !localDatabase) {
    throw new AccountingLedgerError('SEPIDAR_LOCAL_HISTORY_ONLY', 'ثبت تاریخچهٔ سپیدار فقط در دفتر توسعهٔ محلی سبلان مجاز است؛ انتقال تولید به شواهد عملیاتی مستقل نیاز دارد.', 409);
  }
};

/** Posting preflight only: exactly one addressed draft, never a migration acceptance report. */
export const assertSepidarHistoricalPostingCandidate = (input: SepidarLedgerReconciliationInput, candidateId: string,
  runtime: { nodeEnv?: string; databaseUrl?: string }) => {
  assertLocalSepidarHistoricalPosting(input.bookId, runtime);
  if (input.vouchers.length !== 1 || input.vouchers[0].id !== candidateId || input.vouchers[0].status !== 'DRAFT'
    || input.sources.filter((source) => source.sourceTable === 'ACC.Voucher').length !== 1) {
    throw new AccountingLedgerError('SEPIDAR_SOURCE_NOT_VERIFIED', 'پیش‌بررسی ثبت سپیدار باید دقیقاً یک سند پیش‌نویس و خطوط منبع همان سند را بررسی کند.', 409);
  }
  const result = reconcile(input, candidateId);
  if (!result.exact) throw new AccountingLedgerError('SEPIDAR_SOURCE_NOT_VERIFIED', 'خطوط، نگاشت، مبلغ یا شاهد سند سپیدار با نسخهٔ مستقل منبع تطبیق ندارند.', 409);
};
