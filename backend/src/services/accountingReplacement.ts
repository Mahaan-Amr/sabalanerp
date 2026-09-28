import { createHash, randomUUID } from 'node:crypto';

export type ReplacementActor = Readonly<{ id: string; profile: 'VIEWER' | 'ACCOUNTANT' | 'ACCOUNTING_MANAGER' }>;
export type MigrationRecordKind = 'TARGET_CHART' | 'PARTY' | 'FINANCIAL_ACCOUNT' | 'FISCAL_STRUCTURE' | 'OPENING_BALANCE'
  | 'CURRENT_YEAR_MOVEMENT' | 'OPEN_ITEM' | 'CHECK' | 'BANK' | 'TAX' | 'INVENTORY_ITEM' | 'ASSET' | 'OTHER_SUBLEDGER' | 'LEGACY_ARCHIVE';
export type MigrationSourceRecord = Readonly<{
  sourceId: string; kind: MigrationRecordKind; debitRials: bigint; creditRials: bigint;
  targetIdentity?: string; rejectionReason?: string; quantity?: string; valueRials?: bigint; payload: unknown;
}>;
export type MigrationDisposition = Readonly<{
  sourceId: string; kind: MigrationRecordKind; disposition: 'ACCEPTED' | 'REJECTED'; targetIdentity: string | null;
  rejectionReason: string | null; sourceHash: string; targetHash: string | null; debitRials: bigint; creditRials: bigint;
  quantity: string | null; valueRials: bigint | null; sourcePayload: unknown;
}>;
export type MigrationReconciliation = Readonly<{
  sourceDebitRials: bigint; sourceCreditRials: bigint; targetDebitRials: bigint; targetCreditRials: bigint;
  sourceCount: number; targetCount: number; rejectedCount: number; exact: boolean;
}>;
export type MigrationRun = {
  id: string; bookId: string; sourceSystem: string; sourcePackageHash: string; toolVersion: string; mappingVersion: number;
  scope: unknown; status: 'PREVIEWED' | 'ARCHIVED' | 'RECONCILED'; inputCount: number; acceptedCount: number; rejectedCount: number;
  outputHash: string; dispositions: MigrationDisposition[]; reconciliation: MigrationReconciliation | null;
  predecessorRunId: string | null; successorRunId: string | null; previewedAt: Date; committedAt: Date | null;
  acceptedBy: string | null; acceptanceReason: string | null;
};
export type LegacyArchiveRecord = Readonly<{
  id: string; bookId: string; sourceId: string; sourceHash: string; payload: unknown; searchText: string;
  readOnly: true; postedVoucherId: null; migrationRunId: string;
}>;
export type ParallelDifference = Readonly<{
  code: string; amountRials: bigint; itemCount: number; cause: string; ownerId: string; resolution: string;
  evidenceHash: string; resolved: boolean;
}>;
export type ParallelRun = Readonly<{
  id: string; bookId: string; periodIdentity: string; completeMonth: boolean; fullClose: boolean; differences: readonly ParallelDifference[];
  accepted: boolean; recordedAt: Date; actorId: string;
}>;
export type RecoveryProof = Readonly<{
  id: string; bookId: string; checkpointIdentity: string; databaseHash: string; filesHash: string; configurationHash: string;
  encryptedOffsite: boolean; immutableRecoveryPoint: boolean; restoreVerified: boolean; repeatedRestoreVerified: boolean;
  rpoMinutes: number; rtoMinutes: number; drillKind: 'QUARTERLY_FULL' | 'RELEASE' | 'INCIDENT'; proven: boolean; actorId: string; recordedAt: Date;
}>;
export type CutoverRun = {
  id: string; bookId: string; checkpointIdentity: string; finalDeltaRunId: string; exactReconciliationHash: string; acceptanceHash: string;
  writesBlocked: boolean; servicesDrained: boolean; status: 'PREPARED' | 'AUTHORITY_TRANSFERRED' | 'ROLLED_BACK' | 'PAUSED_FIX_FORWARD';
  authorityTransferredAt: Date | null; authorityTransferReason: string | null; sepidarReadOnly: boolean; sabalanAuthoritative: boolean;
  firstAuthoritativeVoucherId: string | null; firstAuthoritativePostingAt: Date | null; rollbackAllowed: boolean;
  failureCode: string | null; failureReason: string | null;
};
export type ReplacementAuditEntry = Readonly<{
  sequence: bigint; action: string; payloadHash: string; previousHash: string | null; entryHash: string;
}>;

const canonicalize = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
};

export const hashAccountingReplacementEvidence = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value))).digest('hex');

export class AccountingReplacementError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

const requireManager = (actor: ReplacementActor) => {
  if (actor.profile !== 'ACCOUNTING_MANAGER') throw new AccountingReplacementError('ACCOUNTING_MANAGER_REQUIRED', 'این عملیات فقط با دسترسی مدیر حسابداری مجاز است.', 403);
};
const requireWriter = (actor: ReplacementActor) => {
  if (actor.profile === 'VIEWER') throw new AccountingReplacementError('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات حسابداری برای این کاربر فعال نیست.', 403);
};
const requireHash = (value: string, label: string) => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new AccountingReplacementError('INVALID_EVIDENCE_HASH', `${label} معتبر نیست.`, 400);
};

type RepositoryState = {
  migrations: MigrationRun[]; archives: LegacyArchiveRecord[]; parallelRuns: ParallelRun[]; recoveryProofs: RecoveryProof[];
  cutovers: CutoverRun[]; audits: ReplacementAuditEntry[];
};
export interface AccountingReplacementRepository {
  transaction<T>(operation: (repository: AccountingReplacementRepository) => Promise<T>): Promise<T>;
  findMigrationByPackageAndMapping(bookId: string, sourcePackageHash: string, mappingVersion: number): Promise<MigrationRun | null>;
  getMigration(id: string): Promise<MigrationRun | null>; saveMigration(run: MigrationRun): Promise<void>;
  saveArchive(record: LegacyArchiveRecord): Promise<void>; searchArchive(bookId: string, query: string): Promise<LegacyArchiveRecord[]>;
  saveParallelRun(run: ParallelRun): Promise<void>; listParallelRuns(bookId: string): Promise<ParallelRun[]>;
  saveRecoveryProof(proof: RecoveryProof): Promise<void>; findRecoveryProof(bookId: string, checkpointIdentity: string): Promise<RecoveryProof | null>;
  saveCutover(run: CutoverRun): Promise<void>; getCutover(id: string): Promise<CutoverRun | null>; findTransferredCutover(bookId: string): Promise<CutoverRun | null>;
  appendAudit(action: string, payload: unknown): Promise<ReplacementAuditEntry>; listAudit(): Promise<ReplacementAuditEntry[]>;
}

export const createInMemoryAccountingReplacementRepository = (): AccountingReplacementRepository => {
  const state: RepositoryState = { migrations: [], archives: [], parallelRuns: [], recoveryProofs: [], cutovers: [], audits: [] };
  const repository: AccountingReplacementRepository = {
    transaction: async (operation) => operation(repository),
    findMigrationByPackageAndMapping: async (bookId, hash, version) => state.migrations.find((item) => item.bookId === bookId && item.sourcePackageHash === hash && item.mappingVersion === version) ?? null,
    getMigration: async (id) => state.migrations.find((item) => item.id === id) ?? null,
    saveMigration: async (run) => { const index = state.migrations.findIndex((item) => item.id === run.id); if (index >= 0) state.migrations[index] = structuredClone(run); else state.migrations.push(structuredClone(run)); },
    saveArchive: async (record) => { if (!state.archives.some((item) => item.id === record.id)) state.archives.push(structuredClone(record)); },
    searchArchive: async (bookId, query) => state.archives.filter((item) => item.bookId === bookId && item.searchText.includes(query.trim())).map((item) => structuredClone(item)),
    saveParallelRun: async (run) => { if (!state.parallelRuns.some((item) => item.bookId === run.bookId && item.periodIdentity === run.periodIdentity)) state.parallelRuns.push(structuredClone(run)); },
    listParallelRuns: async (bookId) => structuredClone(state.parallelRuns.filter((item) => item.bookId === bookId)),
    saveRecoveryProof: async (proof) => { const index = state.recoveryProofs.findIndex((item) => item.bookId === proof.bookId && item.checkpointIdentity === proof.checkpointIdentity); if (index >= 0) state.recoveryProofs[index] = structuredClone(proof); else state.recoveryProofs.push(structuredClone(proof)); },
    findRecoveryProof: async (bookId, identity) => structuredClone(state.recoveryProofs.find((item) => item.bookId === bookId && item.checkpointIdentity === identity) ?? null),
    saveCutover: async (run) => { const index = state.cutovers.findIndex((item) => item.id === run.id); if (index >= 0) state.cutovers[index] = structuredClone(run); else state.cutovers.push(structuredClone(run)); },
    getCutover: async (id) => structuredClone(state.cutovers.find((item) => item.id === id) ?? null),
    findTransferredCutover: async (bookId) => structuredClone(state.cutovers.find((item) => item.bookId === bookId && item.authorityTransferredAt) ?? null),
    appendAudit: async (action, payload) => {
      const previous = state.audits.at(-1); const unsigned = { sequence: BigInt(state.audits.length + 1), action, payloadHash: hashAccountingReplacementEvidence(payload), previousHash: previous?.entryHash ?? null };
      const entry = { ...unsigned, entryHash: hashAccountingReplacementEvidence(unsigned) }; state.audits.push(entry); return structuredClone(entry);
    },
    listAudit: async () => structuredClone(state.audits),
  };
  return repository;
};

const sum = (items: readonly MigrationDisposition[], side: 'debitRials' | 'creditRials') => items.reduce((total, item) => total + item[side], 0n);
const buildDisposition = (record: MigrationSourceRecord): MigrationDisposition => {
  if (!record.sourceId.trim()) throw new AccountingReplacementError('SOURCE_ID_REQUIRED', 'شناسه رکورد منبع الزامی است.', 400);
  if (record.debitRials < 0n || record.creditRials < 0n || (record.debitRials > 0n && record.creditRials > 0n)) {
    throw new AccountingReplacementError('SOURCE_AMOUNT_INVALID', 'مبلغ بدهکار و بستانکار رکورد منبع معتبر نیست.', 400);
  }
  if (!record.targetIdentity?.trim() && !record.rejectionReason?.trim()) {
    throw new AccountingReplacementError('EXPLICIT_DISPOSITION_REQUIRED', 'هر رکورد باید نگاشت مقصد یا دلیل رد صریح داشته باشد.', 400);
  }
  const accepted = Boolean(record.targetIdentity?.trim());
  return {
    sourceId: record.sourceId, kind: record.kind, disposition: accepted ? 'ACCEPTED' : 'REJECTED',
    targetIdentity: accepted ? record.targetIdentity!.trim() : null, rejectionReason: accepted ? null : record.rejectionReason!.trim(),
    sourceHash: hashAccountingReplacementEvidence(record.payload),
    targetHash: accepted ? hashAccountingReplacementEvidence({ kind: record.kind, targetIdentity: record.targetIdentity, payload: record.payload }) : null,
    debitRials: record.debitRials, creditRials: record.creditRials, quantity: record.quantity ?? null, valueRials: record.valueRials ?? null,
    sourcePayload: record.payload,
  };
};

export const verifyAccountingReplacementAuditChain = (entries: readonly ReplacementAuditEntry[]) => {
  let previous: string | null = null; let expectedSequence = 1n;
  for (const entry of entries) {
    const unsigned = { sequence: entry.sequence, action: entry.action, payloadHash: entry.payloadHash, previousHash: entry.previousHash };
    if (entry.sequence !== expectedSequence || entry.previousHash !== previous || hashAccountingReplacementEvidence(unsigned) !== entry.entryHash) {
      return { valid: false, failedSequence: entry.sequence };
    }
    previous = entry.entryHash; expectedSequence += 1n;
  }
  return { valid: entries.length > 0, failedSequence: null };
};

export const createAccountingReplacementApplication = (repository: AccountingReplacementRepository, dependencies: { now: () => Date }) => ({
  previewMigration: async (command: {
    bookId: string; sourceSystem: string; sourcePackageHash: string; packagePayload: unknown; toolVersion: string; mappingVersion: number;
    scope: unknown; records: readonly MigrationSourceRecord[]; predecessorRunId?: string; actor: ReplacementActor;
  }) => repository.transaction(async (tx) => {
    requireManager(command.actor); requireHash(command.sourcePackageHash, 'اثر انگشت بسته منبع');
    if (hashAccountingReplacementEvidence(command.packagePayload) !== command.sourcePackageHash) throw new AccountingReplacementError('SOURCE_PACKAGE_HASH_MISMATCH', 'اثر انگشت بسته منبع با محتوای دریافتی تطبیق ندارد.', 400);
    const packageRecords = command.packagePayload && typeof command.packagePayload === 'object' && !Array.isArray(command.packagePayload)
      ? (command.packagePayload as Record<string, unknown>).records : undefined;
    if (!Array.isArray(packageRecords) || hashAccountingReplacementEvidence(packageRecords) !== hashAccountingReplacementEvidence(command.records)) {
      throw new AccountingReplacementError('SOURCE_PACKAGE_RECORDS_MISMATCH', 'رکوردهای مهاجرت باید دقیقاً همان رکوردهای بستهٔ منبعِ تأییدشده باشند.', 400);
    }
    if (!command.toolVersion.trim() || !Number.isInteger(command.mappingVersion) || command.mappingVersion < 1) throw new AccountingReplacementError('MIGRATION_VERSION_REQUIRED', 'نسخه ابزار و نگاشت مهاجرت الزامی است.', 400);
    const existing = await tx.findMigrationByPackageAndMapping(command.bookId, command.sourcePackageHash, command.mappingVersion);
    if (existing) {
      if (existing.sourceSystem !== command.sourceSystem || existing.toolVersion !== command.toolVersion
        || hashAccountingReplacementEvidence(existing.scope) !== hashAccountingReplacementEvidence(command.scope)
        || existing.predecessorRunId !== (command.predecessorRunId ?? null)) {
        throw new AccountingReplacementError('MIGRATION_RETRY_CHANGED', 'اجرای تکراری باید همان منبع، ابزار، دامنه و اجرای قبلی را حفظ کند؛ اصلاح نیازمند نسخهٔ جانشین است.', 409);
      }
      return existing;
    }
    const dispositions = command.records.map(buildDisposition);
    const accepted = dispositions.filter((item) => item.disposition === 'ACCEPTED');
    const rejected = dispositions.filter((item) => item.disposition === 'REJECTED');
    const run: MigrationRun = {
      id: randomUUID(), bookId: command.bookId, sourceSystem: command.sourceSystem, sourcePackageHash: command.sourcePackageHash,
      toolVersion: command.toolVersion, mappingVersion: command.mappingVersion, scope: command.scope, status: 'PREVIEWED',
      inputCount: dispositions.length, acceptedCount: accepted.length, rejectedCount: rejected.length,
      outputHash: hashAccountingReplacementEvidence(dispositions), dispositions, reconciliation: null,
      predecessorRunId: command.predecessorRunId ?? null, successorRunId: null, previewedAt: dependencies.now(), committedAt: null,
      acceptedBy: null, acceptanceReason: null,
    };
    if (command.predecessorRunId) {
      const predecessor = await tx.getMigration(command.predecessorRunId);
      if (!predecessor || predecessor.bookId !== command.bookId || command.mappingVersion <= predecessor.mappingVersion || predecessor.successorRunId) {
        throw new AccountingReplacementError('MIGRATION_SUCCESSOR_INVALID', 'نسخه اصلاحی باید جانشین یکتای یک اجرای قدیمی‌تر در همان دفتر باشد.', 409);
      }
      predecessor.successorRunId = run.id; await tx.saveMigration(predecessor);
    }
    await tx.saveMigration(run); await tx.appendAudit('MIGRATION_PREVIEW', { runId: run.id, outputHash: run.outputHash }); return run;
  }),
  commitMigration: async (command: { runId: string; expectedOutputHash: string; acceptanceReason: string; actor: ReplacementActor }) => repository.transaction(async (tx) => {
    requireManager(command.actor); const run = await tx.getMigration(command.runId);
    if (!run) throw new AccountingReplacementError('MIGRATION_NOT_FOUND', 'اجرای مهاجرت یافت نشد.', 404);
    if (run.status !== 'PREVIEWED') return run;
    if (run.outputHash !== command.expectedOutputHash) throw new AccountingReplacementError('MIGRATION_PREVIEW_CHANGED', 'پیش‌نمایش مهاجرت تغییر کرده است و باید دوباره بررسی شود.', 409);
    if (!command.acceptanceReason.trim()) throw new AccountingReplacementError('ACCEPTANCE_REASON_REQUIRED', 'دلیل پذیرش مهاجرت الزامی است.', 400);
    const accepted = run.dispositions.filter((item) => item.disposition === 'ACCEPTED');
    if (accepted.some((item) => item.kind !== 'LEGACY_ARCHIVE')) {
      throw new AccountingReplacementError('OPERATIONAL_IMPORT_NOT_MATERIALIZED', 'رکوردهای عملیاتی هنوز در دفتر مقصد ساخته و از روی مقصد تطبیق نشده‌اند؛ تأیید مهاجرت مجاز نیست.', 409);
    }
    if (accepted.some((item) => item.debitRials !== 0n || item.creditRials !== 0n)) {
      throw new AccountingReplacementError('ARCHIVE_AMOUNT_NOT_POSTED', 'مبلغ حسابداری را نمی‌توان با بایگانی فقط‌خواندنی تسویه‌شده اعلام کرد.', 409);
    }
    const sourceDebitRials = sum(accepted, 'debitRials'); const sourceCreditRials = sum(accepted, 'creditRials');
    const exact = sourceDebitRials === sourceCreditRials;
    if (!exact) throw new AccountingReplacementError('MIGRATION_RECONCILIATION_FAILED', 'جمع بدهکار و بستانکار پذیرفته‌شده دقیقاً برابر نیست.', 409);
    run.reconciliation = { sourceDebitRials, sourceCreditRials, targetDebitRials: sourceDebitRials, targetCreditRials: sourceCreditRials, sourceCount: accepted.length, targetCount: accepted.length, rejectedCount: run.rejectedCount, exact };
    run.status = 'ARCHIVED'; run.committedAt = dependencies.now(); run.acceptedBy = command.actor.id; run.acceptanceReason = command.acceptanceReason.trim();
    for (const item of accepted.filter((value) => value.kind === 'LEGACY_ARCHIVE')) await tx.saveArchive({
      id: `${run.id}:${item.sourceId}`, bookId: run.bookId, sourceId: item.sourceId, sourceHash: item.sourceHash,
      payload: item.sourcePayload,
      searchText: JSON.stringify(canonicalize(item.sourcePayload)).replace(/["{}:,]/g, ' '),
      readOnly: true, postedVoucherId: null, migrationRunId: run.id,
    });
    await tx.saveMigration(run); await tx.appendAudit('SOURCE_ARCHIVE_COMMIT', { runId: run.id, outputHash: run.outputHash, reconciliation: run.reconciliation }); return run;
  }),
  getMigrationRun: (id: string) => repository.getMigration(id),
  searchLegacyArchive: (query: { bookId: string; query: string }) => repository.searchArchive(query.bookId, query.query),
  recordParallelRun: async (command: { bookId: string; periodIdentity: string; completeMonth: boolean; fullClose: boolean; differences: readonly ParallelDifference[]; actor: ReplacementActor }) => {
    requireManager(command.actor);
    throw new AccountingReplacementError('VERIFIED_PARALLEL_RECONCILIATION_REQUIRED', 'پذیرش دورهٔ موازی تا اتصال به رویدادهای واقعی و تطبیق مستقل منبع و مقصد مسدود است.', 409);
  },
  recordRecoveryProof: async (command: Omit<RecoveryProof, 'id' | 'proven' | 'actorId' | 'recordedAt'> & { actor: ReplacementActor }) => {
    requireManager(command.actor);
    throw new AccountingReplacementError('OBSERVED_RECOVERY_DRILL_REQUIRED', 'ثبت اثبات بازیابی تا اتصال به نتیجهٔ مشاهده‌شدهٔ تمرین بازیابی مسدود است.', 409);
  },
  prepareCutover: async (command: { bookId: string; checkpointIdentity: string; writesBlocked: boolean; servicesDrained: boolean; finalDeltaRunId: string; exactReconciliationHash: string; acceptanceHash: string; actor: ReplacementActor }) => repository.transaction(async (tx) => {
    requireManager(command.actor);
    throw new AccountingReplacementError('OBSERVED_CUTOVER_GATES_REQUIRED', 'آماده‌سازی انتقال مرجعیت تا اتصال به توقف واقعی نوشتن، نقطهٔ بازیابی و تطبیق مستقل مسدود است.', 409);
  }),
  transferAuthority: async (command: { cutoverId: string; confirmed: boolean; reason: string; actor: ReplacementActor }) => repository.transaction(async (tx) => {
    requireManager(command.actor);
    throw new AccountingReplacementError('AUTHORITY_TRANSFER_NOT_IMPLEMENTED', 'انتقال مرجعیت تا تکمیل دروازه‌های عملیاتی و ثبت نخستین سند مرجع مسدود است.', 409);
  }),
  acknowledgeAuthoritativeWrite: async (command: { cutoverId: string; voucherId: string; actor: ReplacementActor }) => repository.transaction(async (tx) => {
    requireWriter(command.actor); const run = await tx.getCutover(command.cutoverId);
    if (!run || run.status !== 'AUTHORITY_TRANSFERRED') throw new AccountingReplacementError('AUTHORITY_NOT_TRANSFERRED', 'ثبت مرجع پس از انتقال مرجعیت مجاز است.', 409);
    if (run.firstAuthoritativeVoucherId && run.firstAuthoritativeVoucherId !== command.voucherId) throw new AccountingReplacementError('FIRST_POSTING_IMMUTABLE', 'اولین ثبت مرجع تغییرپذیر نیست.', 409);
    if (!run.firstAuthoritativeVoucherId) { run.firstAuthoritativeVoucherId = command.voucherId; run.firstAuthoritativePostingAt = dependencies.now(); run.rollbackAllowed = false; await tx.saveCutover(run); await tx.appendAudit('FIRST_AUTHORITATIVE_POSTING', { cutoverId: run.id, voucherId: command.voucherId }); }
    return run;
  }),
  recordCutoverFailure: async (command: { cutoverId: string; code: string; reason: string; actor: ReplacementActor }) => repository.transaction(async (tx) => {
    requireManager(command.actor); const run = await tx.getCutover(command.cutoverId); if (!run) throw new AccountingReplacementError('CUTOVER_NOT_FOUND', 'اجرای انتقال یافت نشد.', 404);
    run.failureCode = command.code; run.failureReason = command.reason; if (run.firstAuthoritativeVoucherId) { run.status = 'PAUSED_FIX_FORWARD'; run.rollbackAllowed = false; } else { run.status = 'ROLLED_BACK'; run.rollbackAllowed = true; }
    await tx.saveCutover(run); await tx.appendAudit('CUTOVER_FAILURE', { cutoverId: run.id, status: run.status, code: command.code }); return run;
  }),
  resumeFixForward: async (command: { cutoverId: string; resolution: string; evidenceHash: string; actor: ReplacementActor }) => repository.transaction(async (tx) => {
    requireManager(command.actor); requireHash(command.evidenceHash, 'اثر انگشت رفع رخداد'); const run = await tx.getCutover(command.cutoverId);
    if (!run || run.status !== 'PAUSED_FIX_FORWARD' || !command.resolution.trim()) throw new AccountingReplacementError('FIX_FORWARD_NOT_READY', 'ادامه عملیات فقط پس از توقف اصلاح رو به جلو و ثبت شاهد رفع رخداد مجاز است.', 409);
    run.status = 'AUTHORITY_TRANSFERRED'; run.failureCode = null; run.failureReason = null;
    await tx.saveCutover(run); await tx.appendAudit('FIX_FORWARD_RESUMED', { cutoverId: run.id, resolution: command.resolution, evidenceHash: command.evidenceHash }); return run;
  }),
  verifyAudit: async () => verifyAccountingReplacementAuditChain(await repository.listAudit()),
});
