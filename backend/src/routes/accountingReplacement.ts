import express, { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccessWithClient, WORKSPACES, type WorkspaceRequest } from '../middleware/workspace';
import { accountingAccessProfileFromPermission } from '../services/accountingLedgerFoundation';
import { AccountingReplacementError, createAccountingReplacementApplication, type MigrationRecordKind } from '../services/accountingReplacement';
import { createAccountingReplacementPrismaRepository } from '../services/accountingReplacementPrismaRepository';
import { compareSepidarSnapshots } from '../services/sepidarSnapshotDelta';

const router = express.Router();
const repository = createAccountingReplacementPrismaRepository(prisma);
const application = createAccountingReplacementApplication(repository, { now: () => new Date() });
const backupRoot = process.env.SEPIDAR_BACKUP_STORAGE_ROOT?.trim() || '';
const backupIncoming = path.join(backupRoot || os.tmpdir(), 'incoming');
if (backupRoot) mkdirSync(backupIncoming, { recursive: true, mode: 0o700 });
const backupUpload = multer({ dest: backupIncoming, limits: { files: 1, fileSize: 2 * 1024 * 1024 * 1024 } });
const access = (permission: 'view' | 'edit' | 'admin') => [protect, requireWorkspaceAccessWithClient(prisma, WORKSPACES.ACCOUNTING, permission)];
const actor = (req: WorkspaceRequest) => ({ id: req.user!.id, profile: accountingAccessProfileFromPermission(req.workspacePermission) });
const serialize = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
const rials = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new AccountingReplacementError('INVALID_RIAL_AMOUNT', 'مبلغ ریال باید عدد صحیح نامنفی باشد.', 400);
  return BigInt(text);
};
const handle = (operation: (req: WorkspaceRequest) => Promise<unknown>, created = false) => async (req: WorkspaceRequest, res: Response) => {
  try { return res.status(created ? 201 : 200).json({ success: true, data: serialize(await operation(req)) }); }
  catch (error) {
    if (error instanceof AccountingReplacementError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    const trackingId = `ACC-REP-${randomUUID().slice(0, 8).toUpperCase()}`;
    console.error('Accounting replacement operation failed.', { trackingId, error });
    return res.status(500).json({ success: false, message: `عملیات جایگزینی حسابداری کامل نشد. کد پیگیری ${trackingId} را به پشتیبانی اعلام کنید.`, trackingId });
  }
};

router.get('/overview', access('view'), handle(async (req) => {
  const bookId = String(req.query.bookId ?? '');
  if (!bookId) throw new AccountingReplacementError('BOOK_REQUIRED', 'دفتر حسابداری باید مشخص شود.', 400);
  const [migrations, parallelRuns, recoveryProofs, cutovers, auditVerification, exceptionCases, supplyExceptions, closeBlockers, taxQueue] = await Promise.all([
    prisma.accountingReplacementMigrationRun.findMany({ where: { bookId }, include: { dispositions: { where: { disposition: 'REJECTED' } } }, orderBy: { previewedAt: 'desc' }, take: 30 }),
    prisma.accountingReplacementParallelRun.findMany({ where: { bookId }, orderBy: { recordedAt: 'desc' }, take: 24 }),
    prisma.accountingReplacementRecoveryProof.findMany({ where: { bookId }, orderBy: { recordedAt: 'desc' }, take: 12 }),
    prisma.accountingReplacementCutoverRun.findMany({ where: { bookId }, orderBy: { authorityTransferredAt: 'desc' }, take: 10 }),
    application.verifyAudit(),
    prisma.accountingExceptionCase.findMany({ where: { status: { not: 'RESOLVED' } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.accountingSupplyChainException.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.accountingCloseRunStep.findMany({ where: { status: 'BLOCKED', closeRun: { bookId } }, include: { closeRun: { select: { id: true, runIdentity: true } } }, orderBy: { updatedAt: 'desc' }, take: 100 }),
    prisma.accountingTaxOutboxMessage.findMany({ where: { status: { in: ['FAILED', 'RETRY'] } }, orderBy: { availableAt: 'asc' }, take: 100 }),
  ]);
  const now = Date.now();
  const exceptions = [
    ...exceptionCases.map((item) => ({ id: item.id, category: item.code.includes('TAX') ? 'مالیات' : item.code.includes('BANK') ? 'بانک' : item.code.includes('CHECK') ? 'چک' : 'ثبت',
      title: item.messagePersian, owner: item.assignedUserId ?? item.assignedProfile, ageHours: Math.floor((now - item.createdAt.getTime()) / 3_600_000), status: item.status,
      source: `${item.sourceType}:${item.sourceId}`, resolutionHref: `/dashboard/accounting/customer-accounts` })),
    ...supplyExceptions.map((item) => ({ id: item.id, category: item.code.includes('INVENTORY') ? 'موجودی' : item.code.includes('CHECK') ? 'چک' : 'ثبت',
      title: item.messagePersian, owner: 'حسابدار', ageHours: Math.floor((now - item.createdAt.getTime()) / 3_600_000), status: 'باز',
      source: `${item.sourceType}:${item.sourceId}`, resolutionHref: '/dashboard/accounting/supply-chain' })),
    ...migrations.flatMap((run) => run.dispositions.map((item) => ({ id: item.id, category: 'مهاجرت', title: item.rejectionReason ?? 'رکورد مهاجرت رد شده است.', owner: 'مدیر حسابداری',
      ageHours: Math.floor((now - run.previewedAt.getTime()) / 3_600_000), status: run.status, source: `${run.sourceSystem}:${item.sourceId}`, resolutionHref: '/dashboard/accounting/replacement' }))),
    ...closeBlockers.map((item) => ({ id: item.id, category: 'بستن دوره', title: item.blocker ?? 'مرحله بستن دوره متوقف است.', owner: 'مدیر حسابداری',
      ageHours: Math.floor((now - item.updatedAt.getTime()) / 3_600_000), status: item.status, source: item.closeRun.runIdentity, resolutionHref: '/dashboard/accounting/period-end' })),
    ...taxQueue.map((item) => ({ id: item.id, category: 'صف و اتصال', title: 'ارسال صورتحساب مالیاتی نیازمند رسیدگی است.', owner: 'حسابدار',
      ageHours: Math.floor((now - item.createdAt.getTime()) / 3_600_000), status: item.status, source: item.requestIdentity, resolutionHref: '/dashboard/accounting/tax-center' })),
    ...(!auditVerification.valid ? [{ id: `audit-${auditVerification.failedSequence ?? 'missing'}`, category: 'ممیزی', title: 'زنجیره شواهد حسابداری آسیب دیده یا ناقص است.', owner: 'مدیر حسابداری', ageHours: 0, status: 'بحرانی', source: auditVerification.failedSequence == null ? 'شاهد ممیزی ثبت نشده' : `ردیف ${auditVerification.failedSequence}`, resolutionHref: '/dashboard/accounting/audit' }] : []),
    ...(!recoveryProofs[0]?.proven ? [{ id: 'recovery-proof-missing', category: 'پشتیبان', title: 'بازیابی کامل و تکرارشده برای آخرین نقطه هماهنگ اثبات نشده است.', owner: 'مدیر سامانه', ageHours: 0, status: 'مسدودکننده انتشار', source: 'کنترل بازیابی حسابداری', resolutionHref: '/dashboard/admin/system-recovery' }] : []),
  ];
  return { migrations, parallelRuns, recoveryProofs, cutovers, auditVerification, exceptions };
}));

router.get('/legacy-archive', access('view'), handle((req) => application.searchLegacyArchive({ bookId: String(req.query.bookId ?? ''), query: String(req.query.query ?? '') })));

router.get('/sepidar-backups', access('admin'), handle(async (req) => {
  const bookId = String(req.query.bookId ?? '');
  if (!bookId) throw new AccountingReplacementError('BOOK_REQUIRED', 'دفتر حسابداری باید مشخص شود.', 400);
  return prisma.accountingSepidarBackupUpload.findMany({ where: { bookId }, orderBy: { uploadedAt: 'desc' }, take: 100,
    select: { id: true, sourcePackageHash: true, originalName: true, sizeBytes: true, status: true, uploadedBy: true, uploadedAt: true } });
}));

router.post('/sepidar-backups', access('admin'), (req, res, next) => {
  if (process.env.NODE_ENV !== 'development' || process.env.SEPIDAR_ALLOW_UNCOORDINATED_STAGING !== 'development-only') return res.status(503).json({ success: false, code: 'COORDINATED_BACKUP_RECOVERY_REQUIRED', message: 'دریافت پشتیبان سپیدار تا پوشش فایل‌های بارگذاری‌شده در بازیابی هماهنگ غیرفعال است.' });
  if (!backupRoot || !path.isAbsolute(backupRoot)) return res.status(503).json({ success: false, code: 'BACKUP_STORAGE_NOT_CONFIGURED', message: 'فضای خصوصی دریافت پشتیبان سپیدار تنظیم نشده است.' });
  next();
}, backupUpload.single('file'), handle(async (req) => {
  const uploaded = req.file;
  if (!uploaded) throw new AccountingReplacementError('BACKUP_FILE_REQUIRED', 'فایل پشتیبان سپیدار الزامی است.', 400);
  try {
    const bookId = String(req.body.bookId ?? '');
    const name = path.basename(uploaded.originalname);
    if (!bookId || !/\.bak$/i.test(name) || uploaded.size === 0) throw new AccountingReplacementError('INVALID_SEPIDAR_BACKUP', 'دفتر و فایل غیرخالی با پسوند bak الزامی‌اند.', 400);
    const book = await prisma.accountingBook.findUnique({ where: { id: bookId }, select: { id: true } });
    if (!book) throw new AccountingReplacementError('BOOK_NOT_FOUND', 'دفتر حسابداری پیدا نشد.', 404);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(uploaded.path)) digest.update(chunk);
    const sourcePackageHash = digest.digest('hex');
    const storageName = `${sourcePackageHash}.bak`;
    const destination = path.join(backupRoot, storageName);
    await fs.chmod(uploaded.path, 0o600);
    try { await fs.link(uploaded.path, destination); }
    catch (error: any) {
      if (error?.code !== 'EEXIST' || !existsSync(destination)) throw error;
      const existingDigest = createHash('sha256');
      for await (const chunk of createReadStream(destination)) existingDigest.update(chunk);
      if (existingDigest.digest('hex') !== sourcePackageHash) throw new Error('Existing backup object has different content');
    }
    const stored = await prisma.accountingSepidarBackupUpload.upsert({
      where: { bookId_sourcePackageHash: { bookId, sourcePackageHash } },
      create: { id: randomUUID(), bookId, sourcePackageHash, originalName: name, storageName,
        sizeBytes: BigInt(uploaded.size), status: 'STAGED_UNVERIFIED', uploadedBy: req.user!.id },
      update: {},
      select: { id: true, sourcePackageHash: true, originalName: true, sizeBytes: true, status: true, uploadedAt: true },
    });
    return { ...stored, nextStep: 'VERIFY_RESTORE_AND_EXTRACT_IN_ISOLATED_SEPIDAR_READER' };
  } finally { await fs.rm(uploaded.path, { force: true }); }
}, true));

router.get('/sepidar-snapshots', access('admin'), handle(async (req) => {
  const bookId = String(req.query.bookId ?? '');
  if (!bookId) throw new AccountingReplacementError('BOOK_REQUIRED', 'دفتر حسابداری باید مشخص شود.', 400);
  const snapshots = await prisma.accountingSepidarSourceSnapshot.findMany({
    where: { bookId }, orderBy: { startedAt: 'desc' }, take: 10,
    select: { id: true, sourcePackageHash: true, sourceDatabase: true, tableCount: true, expectedRecordCount: true, importedRecordCount: true, status: true, startedAt: true, completedAt: true, schemaManifest: true },
  });
  return snapshots.map(({ schemaManifest, ...snapshot }) => ({ ...snapshot, tables: schemaManifest }));
}));

router.get('/sepidar-snapshots/:id/delta', access('admin'), handle(async (req) => {
  const bookId = String(req.query.bookId ?? '');
  const previousId = String(req.query.previousId ?? '');
  const page = Number(req.query.page ?? 0);
  if (!bookId || !previousId || !Number.isInteger(page) || page < 0) throw new AccountingReplacementError('INVALID_DELTA_REQUEST', 'دفتر، نسخهٔ قبلی و صفحهٔ معتبر الزامی‌اند.', 400);
  const [previous, current] = await Promise.all([
    prisma.accountingSepidarSourceSnapshot.findUnique({ where: { id: previousId }, select: { id: true, bookId: true, status: true, completedAt: true } }),
    prisma.accountingSepidarSourceSnapshot.findUnique({ where: { id: req.params.id }, select: { id: true, bookId: true, status: true, completedAt: true } }),
  ]);
  if (!previous || !current || previous.bookId !== bookId || current.bookId !== bookId || previous.status !== 'COMPLETE' || current.status !== 'COMPLETE') {
    throw new AccountingReplacementError('SNAPSHOT_PAIR_INVALID', 'هر دو نسخهٔ کامل باید متعلق به همین دفتر باشند.', 409);
  }
  if (previous.id === current.id || !previous.completedAt || !current.completedAt || previous.completedAt >= current.completedAt) {
    throw new AccountingReplacementError('SNAPSHOT_ORDER_INVALID', 'نسخهٔ دوم باید پس از نسخهٔ اول دریافت شده باشد.', 409);
  }
  const [before, after] = await Promise.all([
    prisma.accountingSepidarSourceRecord.findMany({ where: { snapshotId: previous.id }, select: { sourceTable: true, sourceKey: true, sourceHash: true } }),
    prisma.accountingSepidarSourceRecord.findMany({ where: { snapshotId: current.id }, select: { sourceTable: true, sourceKey: true, sourceHash: true } }),
  ]);
  const delta = compareSepidarSnapshots(before, after);
  const take = 100;
  const changes = [
    ...delta.added.map((after) => ({ kind: 'ADDED', before: null, after })),
    ...delta.changed.map((item) => ({ kind: 'CHANGED', ...item })),
    ...delta.removed.map((before) => ({ kind: 'REMOVED', before, after: null })),
  ];
  return {
    previousId, currentId: current.id, unchangedCount: delta.unchangedCount,
    addedCount: delta.added.length, changedCount: delta.changed.length, removedCount: delta.removed.length,
    page, pageSize: take, totalChanges: changes.length, changes: changes.slice(page * take, (page + 1) * take),
  };
}));

router.get('/sepidar-snapshots/:id/readiness', access('admin'), handle(async (req) => {
  const bookId = String(req.query.bookId ?? '');
  const snapshot = await prisma.accountingSepidarSourceSnapshot.findUnique({ where: { id: req.params.id }, select: { id: true, bookId: true, status: true } });
  if (!snapshot || snapshot.bookId !== bookId || snapshot.status !== 'COMPLETE') throw new AccountingReplacementError('SNAPSHOT_NOT_FOUND', 'نسخهٔ کامل سپیدار در این دفتر پیدا نشد.', 404);
  const [sourceYear, firstVoucher, deliveries, summaries, ledgerDraftCount, postedCount] = await Promise.all([
    prisma.accountingSepidarSourceRecord.findUnique({ where: { snapshotId_sourceTable_sourceKey: { snapshotId: snapshot.id, sourceTable: 'FMK.FiscalYear', sourceKey: '1' } }, select: { payload: true } }),
    prisma.accountingSepidarSourceRecord.findFirst({ where: { snapshotId: snapshot.id, sourceTable: 'ACC.Voucher', fiscalYearRef: 1 }, orderBy: { documentDate: 'asc' }, select: { payload: true } }),
    prisma.accountingSepidarSourceRecord.findMany({ where: { snapshotId: snapshot.id, sourceTable: 'INV.InventoryDelivery', fiscalYearRef: 10 }, select: { payload: true } }),
    prisma.accountingSepidarSourceRecord.findMany({ where: { snapshotId: snapshot.id, sourceTable: 'INV.ItemStockSummary', fiscalYearRef: 10 }, select: { payload: true } }),
    prisma.accountingLedgerVoucher.count({ where: { bookId, sourceType: 'SEPIDAR_ACC_VOUCHER', status: 'DRAFT' } }),
    prisma.accountingLedgerVoucher.count({ where: { bookId, sourceType: 'SEPIDAR_ACC_VOUCHER', status: 'POSTED' } }),
  ]);
  const year = sourceYear?.payload as Record<string, unknown> | undefined;
  const first = firstVoucher?.payload as Record<string, unknown> | undefined;
  const firstDate = String(first?.Date ?? '').slice(0, 10);
  const fiscalStart = String(year?.StartDate ?? '').slice(0, 10);
  const unvalued = deliveries.filter((row) => {
    const item = row.payload as Record<string, unknown>;
    return Number(item.TotalPrice ?? 0) === 0 && item.AccountingVoucherRef == null;
  }).length;
  const negative = summaries.filter((row) => Number((row.payload as Record<string, unknown>).Quantity ?? 0) < 0).length;
  return {
    snapshotId: snapshot.id, authority: 'SEPIDAR', sourceCoverage: {
      fiscalYear1404Start: fiscalStart, earliestVoucher1404: firstDate, missingEarlyDetail: Boolean(fiscalStart && firstDate && firstDate > fiscalStart),
    }, inventory1405: { deliveries: deliveries.length, unvaluedUnlinkedDeliveries: unvalued, stockSummaries: summaries.length, negativeStockSummaries: negative },
    targetLedger: { drafts: ledgerDraftCount, posted: postedCount },
    officialReportsBlocked: Boolean((fiscalStart && firstDate && firstDate > fiscalStart) || unvalued || negative),
  };
}));

router.get('/sepidar-snapshots/:id/records', access('admin'), handle(async (req) => {
  const snapshot = await prisma.accountingSepidarSourceSnapshot.findUnique({ where: { id: req.params.id }, select: { id: true, bookId: true, status: true, schemaManifest: true } });
  if (!snapshot || snapshot.bookId !== String(req.query.bookId ?? '')) throw new AccountingReplacementError('SNAPSHOT_NOT_FOUND', 'نسخهٔ پشتیبان پیدا نشد.', 404);
  if (snapshot.status !== 'COMPLETE') throw new AccountingReplacementError('SNAPSHOT_INCOMPLETE', 'ورود نسخهٔ پشتیبان هنوز کامل نشده است.', 409);
  const table = String(req.query.table ?? '');
  const tables = snapshot.schemaManifest as Array<{ table_name: string; exact_rows: number }>;
  if (!tables.some((item) => item.table_name === table)) throw new AccountingReplacementError('TABLE_NOT_FOUND', 'جدول منبع پیدا نشد.', 404);
  const page = Number(req.query.page ?? 0);
  if (!Number.isInteger(page) || page < 0 || page > 10000) throw new AccountingReplacementError('INVALID_PAGE', 'شمارهٔ صفحه معتبر نیست.', 400);
  const take = 50;
  const records = await prisma.accountingSepidarSourceRecord.findMany({
    where: { snapshotId: snapshot.id, sourceTable: table },
    orderBy: { sourceKey: 'asc' }, skip: page * take, take,
    select: { id: true, sourceKey: true, sourceHash: true, fiscalYearRef: true, documentDate: true, payload: true },
  });
  return { table, page, pageSize: take, total: tables.find((item) => item.table_name === table)?.exact_rows ?? 0, records };
}));

router.get('/sepidar-snapshots/:id/vouchers', access('admin'), handle(async (req) => {
  const snapshot = await prisma.accountingSepidarSourceSnapshot.findUnique({ where: { id: req.params.id }, select: { id: true, bookId: true, status: true } });
  if (!snapshot || snapshot.bookId !== String(req.query.bookId ?? '')) throw new AccountingReplacementError('SNAPSHOT_NOT_FOUND', 'نسخهٔ پشتیبان پیدا نشد.', 404);
  if (snapshot.status !== 'COMPLETE') throw new AccountingReplacementError('SNAPSHOT_INCOMPLETE', 'ورود نسخهٔ پشتیبان هنوز کامل نشده است.', 409);
  const year = String(req.query.year ?? '');
  if (!/^14\d{2}$/.test(year)) throw new AccountingReplacementError('YEAR_REQUIRED', 'سال مالی معتبر باید مشخص شود.', 400);
  const fiscalYear = await prisma.accountingSepidarSourceRecord.findFirst({ where: { snapshotId: snapshot.id, sourceTable: 'FMK.FiscalYear', payload: { path: ['Title'], equals: year } }, select: { sourceKey: true } });
  if (!fiscalYear) throw new AccountingReplacementError('YEAR_NOT_FOUND', 'سال مالی در پشتیبان وجود ندارد.', 404);
  const page = Number(req.query.page ?? 0);
  if (!Number.isInteger(page) || page < 0 || page > 10000) throw new AccountingReplacementError('INVALID_PAGE', 'شمارهٔ صفحه معتبر نیست.', 400);
  const where = { snapshotId: snapshot.id, sourceTable: 'ACC.Voucher', fiscalYearRef: Number(fiscalYear.sourceKey) };
  const [total, vouchers] = await Promise.all([
    prisma.accountingSepidarSourceRecord.count({ where }),
    prisma.accountingSepidarSourceRecord.findMany({ where, orderBy: [{ documentDate: 'desc' }, { sourceKey: 'desc' }], skip: page * 25, take: 25, select: { sourceKey: true, payload: true, documentDate: true } }),
  ]);
  return { year, page, pageSize: 25, total, vouchers };
}));

router.get('/sepidar-snapshots/:id/vouchers/:voucherKey', access('admin'), handle(async (req) => {
  const snapshot = await prisma.accountingSepidarSourceSnapshot.findUnique({ where: { id: req.params.id }, select: { id: true, bookId: true, status: true } });
  if (!snapshot || snapshot.bookId !== String(req.query.bookId ?? '')) throw new AccountingReplacementError('SNAPSHOT_NOT_FOUND', 'نسخهٔ پشتیبان پیدا نشد.', 404);
  if (snapshot.status !== 'COMPLETE') throw new AccountingReplacementError('SNAPSHOT_INCOMPLETE', 'ورود نسخهٔ پشتیبان هنوز کامل نشده است.', 409);
  const voucherKey = req.params.voucherKey;
  if (!/^\d+$/.test(voucherKey)) throw new AccountingReplacementError('VOUCHER_NOT_FOUND', 'سند منبع پیدا نشد.', 404);
  const voucher = await prisma.accountingSepidarSourceRecord.findUnique({ where: { snapshotId_sourceTable_sourceKey: { snapshotId: snapshot.id, sourceTable: 'ACC.Voucher', sourceKey: voucherKey } }, select: { sourceKey: true, payload: true } });
  if (!voucher) throw new AccountingReplacementError('VOUCHER_NOT_FOUND', 'سند منبع پیدا نشد.', 404);
  const lines = await prisma.accountingSepidarSourceRecord.findMany({ where: { snapshotId: snapshot.id, sourceTable: 'ACC.VoucherItem', payload: { path: ['VoucherRef'], equals: Number(voucherKey) } }, select: { sourceKey: true, payload: true } });
  const linePayloads: Array<Record<string, unknown> & { sourceKey: string }> = lines.map((line) => ({ sourceKey: line.sourceKey, ...(line.payload as Record<string, unknown>) }));
  const accountKeys = [...new Set(linePayloads.map((line) => String(line.AccountSLRef ?? '')).filter(Boolean))];
  const detailKeys = [...new Set(linePayloads.map((line) => String(line.DLRef ?? '')).filter(Boolean))];
  const [accounts, details] = await Promise.all([
    prisma.accountingSepidarSourceRecord.findMany({ where: { snapshotId: snapshot.id, sourceTable: 'ACC.Account', sourceKey: { in: accountKeys } }, select: { sourceKey: true, payload: true } }),
    prisma.accountingSepidarSourceRecord.findMany({ where: { snapshotId: snapshot.id, sourceTable: 'ACC.DL', sourceKey: { in: detailKeys } }, select: { sourceKey: true, payload: true } }),
  ]);
  const accountByKey = new Map(accounts.map((item) => [item.sourceKey, item.payload as Record<string, unknown>]));
  const detailByKey = new Map(details.map((item) => [item.sourceKey, item.payload as Record<string, unknown>]));
  const mapped = linePayloads.sort((a, b) => Number(a.RowNumber) - Number(b.RowNumber)).map((line) => ({
    ...line, accountCode: accountByKey.get(String(line.AccountSLRef ?? ''))?.Code ?? null,
    accountTitle: accountByKey.get(String(line.AccountSLRef ?? ''))?.Title ?? null,
    detailCode: detailByKey.get(String(line.DLRef ?? ''))?.Code ?? null,
    detailTitle: detailByKey.get(String(line.DLRef ?? ''))?.Title ?? null,
  }));
  return { voucher, lines: mapped };
}));

router.post('/migrations/preview', access('admin'), handle((req) => application.previewMigration({
  bookId: String(req.body.bookId), sourceSystem: String(req.body.sourceSystem ?? 'SEPIDAR'), sourcePackageHash: String(req.body.sourcePackageHash),
  packagePayload: req.body.packagePayload, toolVersion: String(req.body.toolVersion), mappingVersion: Number(req.body.mappingVersion), scope: req.body.scope,
  predecessorRunId: req.body.predecessorRunId ? String(req.body.predecessorRunId) : undefined, actor: actor(req),
  records: (req.body.records ?? []).map((item: any) => ({ sourceId: String(item.sourceId), kind: String(item.kind) as MigrationRecordKind,
    debitRials: rials(item.debitRials), creditRials: rials(item.creditRials), targetIdentity: item.targetIdentity ? String(item.targetIdentity) : undefined,
    rejectionReason: item.rejectionReason ? String(item.rejectionReason) : undefined, quantity: item.quantity ? String(item.quantity) : undefined,
    valueRials: item.valueRials == null ? undefined : rials(item.valueRials), payload: item.payload })),
}), true));
router.post('/migrations/:id/commit', access('admin'), handle((req) => application.commitMigration({ runId: req.params.id, expectedOutputHash: String(req.body.expectedOutputHash), acceptanceReason: String(req.body.acceptanceReason), actor: actor(req) })));
router.post('/parallel-runs', access('admin'), handle((req) => application.recordParallelRun({ bookId: String(req.body.bookId), periodIdentity: String(req.body.periodIdentity), completeMonth: Boolean(req.body.completeMonth), fullClose: Boolean(req.body.fullClose), actor: actor(req),
  differences: (req.body.differences ?? []).map((item: any) => ({ ...item, amountRials: rials(item.amountRials), itemCount: Number(item.itemCount), resolved: Boolean(item.resolved) })) }), true));
router.post('/recovery-proofs', access('admin'), handle((req) => application.recordRecoveryProof({ ...req.body, bookId: String(req.body.bookId), rpoMinutes: Number(req.body.rpoMinutes), rtoMinutes: Number(req.body.rtoMinutes), actor: actor(req) }), true));
router.post('/cutovers', access('admin'), handle((req) => application.prepareCutover({ ...req.body, bookId: String(req.body.bookId), actor: actor(req) }), true));
router.post('/cutovers/:id/transfer', access('admin'), handle((req) => application.transferAuthority({ cutoverId: req.params.id, confirmed: Boolean(req.body.confirmed), reason: String(req.body.reason), actor: actor(req) })));
router.post('/cutovers/:id/authoritative-write', access('admin'), handle((req) => application.acknowledgeAuthoritativeWrite({ cutoverId: req.params.id, voucherId: String(req.body.voucherId), actor: actor(req) })));
router.post('/cutovers/:id/failures', access('admin'), handle((req) => application.recordCutoverFailure({ cutoverId: req.params.id, code: String(req.body.code), reason: String(req.body.reason), actor: actor(req) })));
router.post('/cutovers/:id/resume', access('admin'), handle((req) => application.resumeFixForward({ cutoverId: req.params.id, resolution: String(req.body.resolution), evidenceHash: String(req.body.evidenceHash), actor: actor(req) })));

export default router;
