import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';
import { importBankStatementLineWithTx } from './accountingCustomerTreasuryPrisma';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';

type AdapterType = 'CSV' | 'XLSX';
type SourceRow = { rowNumber: number; rawRecord: Record<string, string> };

const bankFileTransaction = async <T>(database: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 20_000, timeout: 120_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error;
      if (attempt === 2) throw new AccountingCustomerTreasuryError('BANK_FILE_CONCURRENT_CHANGE', 'داده‌های بانکی هم‌زمان تغییر کردند؛ عملیات را دوباره اجرا کنید.', 409);
    }
  }
  throw new Error('Unreachable bank file transaction state');
};

export const parseBankStatementFile = (input: { adapterType: AdapterType; fileBase64: string }) => {
  if (input.adapterType !== 'CSV' && input.adapterType !== 'XLSX') {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'نوع فایل بانکی معتبر نیست.', 400);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.fileBase64) || input.fileBase64.length > 2_800_000) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'فایل بانکی نامعتبر یا بزرگ‌تر از حد مجاز است.', 400);
  }
  const bytes = Buffer.from(input.fileBase64, 'base64');
  if (!bytes.length || bytes.length > 2_000_000 || bytes.toString('base64') !== input.fileBase64) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'فایل بانکی نامعتبر یا بزرگ‌تر از حد مجاز است.', 400);
  }
  if (input.adapterType === 'XLSX' && bytes.subarray(0, 4).toString('hex') !== '504b0304') {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'فایل اکسل باید با قالب XLSX معتبر باشد.', 400);
  }
  if (input.adapterType === 'CSV' && bytes.includes(0)) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'فایل CSV معتبر نیست.', 400);
  }
  const csvText = input.adapterType === 'CSV' ? bytes.toString('utf8').replace(/^\uFEFF/, '') : '';
  if (csvText.includes('\uFFFD')) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'رمزگذاری فایل CSV باید UTF-8 باشد.', 400);
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = input.adapterType === 'CSV'
      ? XLSX.read(csvText, { type: 'string', raw: true, dense: false })
      : XLSX.read(bytes, { type: 'buffer', raw: true, dense: false });
  } catch {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'خواندن فایل بانکی ممکن نشد.', 400);
  }
  if (workbook.SheetNames.length !== 1) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'فایل بانکی باید دقیقاً یک برگه داشته باشد.', 400);
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r > 1000 || range.e.c > 99 || range.s.r !== 0 || range.s.c !== 0) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'ستون‌ها یا شمار ردیف‌های فایل بانکی معتبر نیست.', 400);
  }
  if (Object.values(sheet).some((cell) => cell && typeof cell === 'object' && 'f' in cell)) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'فرمول در فایل بانکی مجاز نیست.', 400);
  }
  if (Object.values(sheet).some((cell) => cell && typeof cell === 'object' && 'v' in cell
    && typeof cell.v === 'number' && !Number.isSafeInteger(cell.v))) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'اعداد فایل بانکی باید صحیح و دقیق باشند؛ اعداد بزرگ را به صورت متن ذخیره کنید.', 400);
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
  const headers = (matrix[0] || []).map((value) => String(value).trim());
  if (!headers.length || headers.some((header) => !header) || new Set(headers).size !== headers.length || matrix.length < 2 || matrix.length > 1001) {
    throw new AccountingCustomerTreasuryError('BANK_FILE_INVALID', 'ستون‌ها یا شمار ردیف‌های فایل بانکی معتبر نیست.', 400);
  }
  const rows: SourceRow[] = matrix.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    rawRecord: Object.fromEntries(headers.map((header, column) => [header, String(values[column] ?? '').trim()])),
  }));
  return { fileHash: createHash('sha256').update(bytes).digest('hex'), rows };
};

export const importBankStatementFilePrisma = async (database: PrismaClient, input: {
  financialAccountId: string; adapterType: AdapterType; mappingVersion: number; fileBase64: string; actorId: string;
  actorProfile?: 'ACCOUNTANT' | 'ACCOUNTING_MANAGER' | 'VIEWER';
}) => {
  if (!input.financialAccountId || !Number.isInteger(input.mappingVersion) || input.mappingVersion < 1) {
    throw new AccountingCustomerTreasuryError('BANK_MAPPING_INVALID', 'حساب مالی و نسخه نگاشت بانکی معتبر نیست.', 400);
  }
  const mapping = await database.accountingBankImportMapping.findUnique({ where: { financialAccountId_adapterType_version: {
    financialAccountId: input.financialAccountId, adapterType: input.adapterType, version: input.mappingVersion,
  } } });
  if (!mapping) throw new AccountingCustomerTreasuryError('BANK_MAPPING_NOT_EFFECTIVE', 'نگاشت نسخه‌دار برای این حساب و فایل پیدا نشد.', 409);
  const { fileHash, rows } = parseBankStatementFile(input);
  const identity = { financialAccountId: input.financialAccountId, adapterType: input.adapterType,
    mappingVersion: input.mappingVersion, fileHash };
  return bankFileTransaction(database, async (tx) => {
    const prior = await tx.accountingBankFileImportRun.findUnique({ where: {
      financialAccountId_adapterType_mappingVersion_fileHash: identity,
    } });
    if (prior) return { id: prior.id, fileHash: prior.fileHash, outputHash: prior.outputHash,
      totalRows: prior.totalRows, imported: prior.imported, rejected: prior.rejected, results: prior.results };
    const results: Array<{ rowNumber: number; rowHash: string; status: 'IMPORTED' | 'REJECTED'; lineId?: string;
      exceptionId?: string; reason?: string }> = [];
    for (const row of rows) {
      const rowHash = createHash('sha256').update(JSON.stringify(row.rawRecord)).digest('hex');
      try {
        const line = await importBankStatementLineWithTx(tx, {
          financialAccountId: input.financialAccountId, adapterType: input.adapterType, mappingVersion: input.mappingVersion,
          sourceIdentity: '', bookedAt: new Date(0), amountRials: 0n, direction: 'INBOUND', description: '',
          evidence: { fileHash, rowNumber: row.rowNumber, rawRecord: row.rawRecord },
        }, { allowOverlappingFileOccurrence: true });
        results.push({ rowNumber: row.rowNumber, rowHash, status: 'IMPORTED', lineId: line.id });
      } catch (error) {
        if (!(error instanceof AccountingCustomerTreasuryError)) throw error;
        const exception = await tx.accountingExceptionCase.upsert({ where: { sourceType_sourceId_sourceVersion_code: {
          sourceType: 'BANK_STATEMENT_FILE', sourceId: `${input.financialAccountId}:${fileHash}:${row.rowNumber}`,
          sourceVersion: input.mappingVersion, code: error.code,
        } }, create: { sourceType: 'BANK_STATEMENT_FILE', sourceId: `${input.financialAccountId}:${fileHash}:${row.rowNumber}`,
          sourceVersion: input.mappingVersion, code: error.code, evidenceHash: rowHash,
          messagePersian: `ردیف ${row.rowNumber}: ${error.message}`, assignedProfile: 'ACCOUNTANT',
          assignedUserId: input.actorId }, update: {} });
        results.push({ rowNumber: row.rowNumber, rowHash, status: 'REJECTED', exceptionId: exception.id, reason: error.message });
      }
    }
    const saved = await tx.accountingBankFileImportRun.create({ data: { ...identity, mappingEvidenceHash: mapping.evidenceHash,
      outputHash: createHash('sha256').update(JSON.stringify(results)).digest('hex'), totalRows: rows.length,
      imported: results.filter((item) => item.status === 'IMPORTED').length,
      rejected: results.filter((item) => item.status === 'REJECTED').length,
      sourceFile: Buffer.from(input.fileBase64, 'base64'), sourceRows: rows, results, createdBy: input.actorId } });
    await createAccountingLedgerPrismaRepository(tx, true).appendAudit({
      action: 'BANK_FILE_IMPORTED', result: 'SUCCEEDED', actorId: input.actorId,
      effectiveProfile: input.actorProfile ?? 'ACCOUNTANT', entityType: 'BANK_FILE_IMPORT_RUN', entityId: saved.id,
      correlationId: saved.id, payloadHash: saved.outputHash,
      sessionContext: { fileHash, mappingEvidenceHash: mapping.evidenceHash, imported: saved.imported, rejected: saved.rejected },
    });
    return { id: saved.id, fileHash: saved.fileHash, outputHash: saved.outputHash,
      totalRows: saved.totalRows, imported: saved.imported, rejected: saved.rejected, results: saved.results };
  });
};

export const resolveBankFileExceptionPrisma = async (database: PrismaClient, input: {
  exceptionId: string; correctedRunId: string; correctedRowNumber: number; reason: string; actorId: string;
  actorProfile: 'ACCOUNTANT' | 'ACCOUNTING_MANAGER' | 'VIEWER'; attestUnlinkedCorrection?: boolean;
}) => bankFileTransaction(database, async (tx) => {
  const reason = input.reason.trim();
  if (!reason || reason.length < 8 || !Number.isInteger(input.correctedRowNumber) || input.correctedRowNumber < 2) {
    throw new AccountingCustomerTreasuryError('BANK_EXCEPTION_RESOLUTION_INVALID', 'دلیل و ردیف اصلاح‌شده معتبر لازم است.', 400);
  }
  const exception = await tx.accountingExceptionCase.findUnique({ where: { id: input.exceptionId } });
  if (!exception || exception.sourceType !== 'BANK_STATEMENT_FILE') {
    throw new AccountingCustomerTreasuryError('BANK_EXCEPTION_NOT_FOUND', 'استثنای فایل بانکی پیدا نشد.', 404);
  }
  if (exception.status !== 'OPEN') {
    throw new AccountingCustomerTreasuryError('BANK_EXCEPTION_ALREADY_RESOLVED', 'این استثنا قبلاً تعیین تکلیف شده است.', 409);
  }
  const [originalAccountId, originalHash, originalRowToken] = exception.sourceId.split(':');
  const originalRowNumber = Number(originalRowToken);
  const [original, corrected] = await Promise.all([
    tx.accountingBankFileImportRun.findFirst({ where: { financialAccountId: originalAccountId,
      fileHash: originalHash, mappingVersion: exception.sourceVersion } }),
    tx.accountingBankFileImportRun.findUnique({ where: { id: input.correctedRunId } }),
  ]);
  if (!original || !corrected || original.id === corrected.id || original.financialAccountId !== corrected.financialAccountId) {
    throw new AccountingCustomerTreasuryError('BANK_EXCEPTION_CORRECTION_INVALID', 'فایل اصلاح‌شده برای همان حساب بانکی معتبر نیست.', 409);
  }
  const originalResult = (original.results as Array<{ rowNumber: number; status: string; exceptionId?: string }>).find(
    (row) => row.rowNumber === originalRowNumber && row.exceptionId === exception.id && row.status === 'REJECTED');
  const correctedResult = (corrected.results as Array<{ rowNumber: number; status: string; lineId?: string }>).find(
    (row) => row.rowNumber === input.correctedRowNumber && row.status === 'IMPORTED' && row.lineId);
  if (!originalResult || !correctedResult?.lineId) {
    throw new AccountingCustomerTreasuryError('BANK_EXCEPTION_CORRECTION_INVALID', 'ردیف اصلاح‌شده با استثنای ثبت‌شده سازگار نیست.', 409);
  }
  const originalRow = (original.sourceRows as SourceRow[]).find((row) => row.rowNumber === originalRowNumber);
  const correctedRow = (corrected.sourceRows as SourceRow[]).find((row) => row.rowNumber === input.correctedRowNumber);
  const mapping = await tx.accountingBankImportMapping.findUnique({ where: { financialAccountId_adapterType_version: {
    financialAccountId: original.financialAccountId, adapterType: original.adapterType, version: original.mappingVersion,
  } } });
  const identityField = (mapping?.columnMapping as { sourceIdentityField?: string } | null)?.sourceIdentityField;
  const originalIdentity = identityField ? originalRow?.rawRecord[identityField]?.trim() : '';
  const line = await tx.accountingBankStatementLine.findUnique({ where: { id: correctedResult.lineId } });
  if (!line || line.financialAccountId !== original.financialAccountId) {
    throw new AccountingCustomerTreasuryError('BANK_EXCEPTION_CORRECTION_INVALID', 'ردیف اصلاح‌شده در حساب بانکی یافت نشد.', 409);
  }
  const correctedIdentity = line.sourceIdentity;
  const sameIdentity = Boolean(originalIdentity && originalIdentity === correctedIdentity);
  const sameSourceRow = Boolean(originalRow && correctedRow
    && JSON.stringify(originalRow.rawRecord) === JSON.stringify(correctedRow.rawRecord));
  if (!sameIdentity && !sameSourceRow && (!input.attestUnlinkedCorrection
    || input.actorProfile !== 'ACCOUNTING_MANAGER' || reason.length < 20)) {
    throw new AccountingCustomerTreasuryError('BANK_EXCEPTION_CORRECTION_INVALID', 'شناسه ردیف اصلاح‌شده باید با ردیف ردشده یکسان باشد.', 409);
  }
  const resolved = await tx.accountingExceptionCase.update({ where: { id: exception.id, status: 'OPEN' }, data: {
    status: 'RESOLVED', resolvedAt: new Date(), resolutionEvidence: {
      mode: 'CORRECTED_FILE_ROW', originalRunId: original.id, originalRowNumber,
      correctedRunId: corrected.id, correctedRowNumber: input.correctedRowNumber,
      correctedLineId: line.id, correctedFileHash: corrected.fileHash, reason, actorId: input.actorId,
      linkBasis: sameIdentity ? 'SOURCE_IDENTITY' : sameSourceRow ? 'UNCHANGED_SOURCE_ROW' : 'MANAGER_ATTESTATION',
    },
  } });
  await createAccountingLedgerPrismaRepository(tx, true).appendAudit({
    action: 'BANK_FILE_EXCEPTION_RESOLVED', result: 'SUCCEEDED', actorId: input.actorId,
    effectiveProfile: input.actorProfile, entityType: 'ACCOUNTING_EXCEPTION', entityId: exception.id,
    correlationId: corrected.id, reason,
    payloadHash: createHash('sha256').update(JSON.stringify(resolved.resolutionEvidence)).digest('hex'),
    sessionContext: { linkBasis: sameIdentity ? 'SOURCE_IDENTITY' : sameSourceRow ? 'UNCHANGED_SOURCE_ROW' : 'MANAGER_ATTESTATION' },
  });
  return resolved;
});
