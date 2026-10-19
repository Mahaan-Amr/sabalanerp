import type { Prisma, PrismaClient } from '@prisma/client';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RuntimeWorkContext } from './runtimeWorkContext';
import { VersionedFilePublication } from './versionedFilePublication';
import { createVersionedHiringFileTransaction, parseVersionedStagedHiringFile, type VersionedStagedHiringFile } from './hrVersionedFileTransaction';

type Phase = 'PLANNED' | 'STAGING' | 'STAGED' | 'RESTORING' | 'RESTORED' | 'REMOVING' | 'LIVE_REMOVED_RETAINED_COPIES_PENDING';
type MoveReceipt = Awaited<ReturnType<VersionedFilePublication['move']>>;
type RemovalReceipt = Awaited<ReturnType<ReturnType<typeof createVersionedHiringFileTransaction>['commit']>>;
type State = Readonly<{ format: 'sabalan-hr-file-cleanup/v1'; storageName: string; operationId: string;
  originalVersionSha256: string; phase: Phase; stageReceipt: VersionedStagedHiringFile | null;
  restoreReceipt?: MoveReceipt; removalReceipt?: RemovalReceipt }>;
type Row = { id: string; receiptId: string; storageName: string; originalPath: string; stagedPath: string;
  status: string; versionedFileState: unknown };
const fail = (code = 'HR_VERSIONED_FILE_JOURNAL_UNRESOLVED'): never => { throw Object.assign(new Error(code), { code }); };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const segment = (value: string) => {
  if (typeof value !== 'string' || !/^[^\\/\u0000-\u001f:]{1,255}$/.test(value)
    || value === '.' || value === '..' || value.startsWith('.sabalan-file-')) fail();
  return value;
};

/** Private domain journal. A plan and an in-flight marker precede file mutation;
 * its exact version receipt is durably stored before stage acknowledges. An
 * ambiguous file/SQL outcome retains that marker. New instances can inspect
 * records but cannot acquire the old actor's work, even after lease expiry.
 * This is not route activation, recovery takeover or physical erasure proof. */
export async function createDurableVersionedHiringFileTransaction(input: {
  database: PrismaClient; root: string; publication: VersionedFilePublication; work: RuntimeWorkContext;
  receiptId: string; operationToken: string;
}) {
  const { database, root, publication, work, receiptId, operationToken } = input;
  if (!(work instanceof RuntimeWorkContext) || !(publication instanceof VersionedFilePublication)
    || !publication.ownsRoot(root) || !publication.ownsWork(work) || !path.isAbsolute(root) || path.resolve(root) !== root
    || !receiptId || !operationToken) fail('HR_VERSIONED_FILE_JOURNAL_SCOPE_INVALID');
  const files = createVersionedHiringFileTransaction(root, publication), live = await publication.bindRoot(root);
  const ownPlans = new Set<string>();
  const ownedQuery = <T>(query: (tx: Prisma.TransactionClient) => Promise<T>) => database.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','10000ms',true)`;
    return query(tx);
  }, { isolationLevel: 'ReadCommitted', timeout: 15_000, maxWait: 1000 });
  const checked = (row: Row) => {
    const value = row.versionedFileState as State;
    const keys = ['format', 'storageName', 'operationId', 'originalVersionSha256', 'phase', 'stageReceipt'];
    if (value?.phase === 'RESTORED') keys.push('restoreReceipt');
    if (value?.phase === 'LIVE_REMOVED_RETAINED_COPIES_PENDING') keys.push('removalReceipt');
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'sabalan-hr-file-cleanup/v1'
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))
      || !['PLANNED', 'STAGING', 'STAGED', 'RESTORING', 'RESTORED', 'REMOVING', 'LIVE_REMOVED_RETAINED_COPIES_PENDING'].includes(value.phase)
      || !sha(value.originalVersionSha256)
      || row.receiptId !== receiptId || row.storageName !== value.storageName || row.status !== `VERSIONED_${value.phase}`
      || row.originalPath !== path.join(root, segment(value.storageName))
      || row.stagedPath !== path.join(root, '.deletion-trash', segment(value.operationId), value.storageName)) fail();
    if (!['PLANNED', 'STAGING'].includes(value.phase)) {
      const receipt = parseVersionedStagedHiringFile(value.stageReceipt);
      if (receipt.storageName !== value.storageName || receipt.operationId !== value.operationId
        || receipt.originalVersionSha256 !== value.originalVersionSha256) fail();
    } else if (value.stageReceipt !== null) fail();
    if (value.phase === 'RESTORED') {
      const move = value.restoreReceipt;
      if (!move || typeof move !== 'object' || Array.isArray(move) || Object.keys(move).length !== 3
        || !['sourceVersionSha256', 'destinationVersionSha256', 'receiptSha256'].every(key => Object.prototype.hasOwnProperty.call(move, key))
        || !Object.values(move).every(sha)) fail();
    }
    if (value.phase === 'LIVE_REMOVED_RETAINED_COPIES_PENDING') {
      const removal = value.removalReceipt;
      if (!removal || typeof removal !== 'object' || Array.isArray(removal) || Object.keys(removal).length !== 3
        || !['status', 'physicalErasure', 'deletedVersionSha256'].every(key => Object.prototype.hasOwnProperty.call(removal, key))
        || removal.status !== 'LIVE_REMOVED_RETAINED_COPIES_PENDING' || removal.physicalErasure !== 'UNPROVEN'
        || !sha(removal.deletedVersionSha256)) fail();
    }
    return Object.freeze({ id: row.id, status: row.status, state: Object.freeze(value) });
  };
  const read = async (id: string) => {
    const rows = await database.$queryRaw<Row[]>`SELECT id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"
      FROM public.hr_deletion_file_cleanups WHERE id=${id} AND "receiptId"=${receiptId}`;
    if (rows.length !== 1) return fail();
    return checked(rows[0]);
  };
  return {
    read: (id: string) => work.run(() => read(id)),
    plan: (storageName: string, operationId: string) => work.run(async () => {
      segment(storageName); segment(operationId);
      const head = await live.inspect(storageName);
      if (head?.operation !== 'PUT') return fail('HR_VERSIONED_FILE_SOURCE_REQUIRED');
      const state: State = { format: 'sabalan-hr-file-cleanup/v1', storageName, operationId,
        originalVersionSha256: head.versionSha256, phase: 'PLANNED', stageReceipt: null };
      const id = randomUUID(), originalPath = path.join(root, storageName), stagedPath = path.join(root, '.deletion-trash', operationId, storageName);
      const rows = await ownedQuery(tx => tx.$queryRaw<Row[]>`WITH owner AS (
          SELECT id FROM public.hr_deletion_receipts WHERE id=${receiptId} AND "targetType"='PERSONNEL'
            AND status='PREPARING' AND "operationToken"=${operationToken} AND "leaseExpiresAt">clock_timestamp() FOR UPDATE
        ) INSERT INTO public.hr_deletion_file_cleanups
          (id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState","createdAt","updatedAt")
        SELECT ${id},${receiptId},${storageName},${originalPath},${stagedPath},'VERSIONED_PLANNED',${JSON.stringify(state)}::jsonb,
          clock_timestamp(),clock_timestamp() FROM owner
        RETURNING id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"`);
      if (rows.length !== 1) return fail('HR_VERSIONED_FILE_OWNER_LOST');
      const result = checked(rows[0]); ownPlans.add(id); return result;
    }),
    stage: (id: string) => work.run(async () => {
      if (!ownPlans.has(id)) return fail('HR_VERSIONED_FILE_ORIGINAL_ACTOR_REQUIRED');
      const before = await read(id);
      if (before.state.phase !== 'PLANNED') return fail();
      const staging: State = { ...before.state, phase: 'STAGING' };
      const claimed = await ownedQuery(tx => tx.$queryRaw<Row[]>`WITH owner AS (
          SELECT id FROM public.hr_deletion_receipts WHERE id=${receiptId} AND status='PREPARING'
            AND "operationToken"=${operationToken} AND "leaseExpiresAt">clock_timestamp() FOR UPDATE
        ) UPDATE public.hr_deletion_file_cleanups SET status='VERSIONED_STAGING',"versionedFileState"=${JSON.stringify(staging)}::jsonb,
          "updatedAt"=clock_timestamp() WHERE id=${id} AND "receiptId"=${receiptId} AND status='VERSIONED_PLANNED'
          AND "versionedFileState"=${JSON.stringify(before.state)}::jsonb AND EXISTS(SELECT 1 FROM owner)
        RETURNING id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"`);
      if (claimed.length !== 1) return fail('HR_VERSIONED_FILE_OWNER_LOST');
      checked(claimed[0]);
      const stageReceipt = await files.stage(before.state.storageName, before.state.operationId, before.state.originalVersionSha256);
      const staged: State = { ...staging, phase: 'STAGED', stageReceipt };
      // Completion recording must survive an elapsed business lease. The same
      // actor/token must still own PREPARING; expiry never grants a successor.
      const saved = await ownedQuery(tx => tx.$queryRaw<Row[]>`WITH owner AS (
          SELECT id FROM public.hr_deletion_receipts WHERE id=${receiptId} AND status='PREPARING' AND "operationToken"=${operationToken} FOR UPDATE
        ) UPDATE public.hr_deletion_file_cleanups SET status='VERSIONED_STAGED',"versionedFileState"=${JSON.stringify(staged)}::jsonb,
          "updatedAt"=clock_timestamp() WHERE id=${id} AND "receiptId"=${receiptId} AND status='VERSIONED_STAGING'
          AND "versionedFileState"=${JSON.stringify(staging)}::jsonb AND EXISTS(SELECT 1 FROM owner)
        RETURNING id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"`);
      if (saved.length !== 1) return fail();
      return checked(saved[0]);
    }),
    restore: (id: string) => work.run(async () => {
      if (!ownPlans.has(id)) return fail('HR_VERSIONED_FILE_ORIGINAL_ACTOR_REQUIRED');
      const before = await read(id);
      if (before.state.phase !== 'STAGED' || !before.state.stageReceipt) return fail();
      const restoring: State = { ...before.state, phase: 'RESTORING' };
      const claimed = await ownedQuery(tx => tx.$queryRaw<Row[]>`WITH owner AS (
          SELECT id FROM public.hr_deletion_receipts WHERE id=${receiptId} AND status IN ('PREPARING','ACCESS_PREPARED')
            AND "operationToken"=${operationToken} FOR UPDATE
        ) UPDATE public.hr_deletion_file_cleanups SET status='VERSIONED_RESTORING',"versionedFileState"=${JSON.stringify(restoring)}::jsonb,
          "updatedAt"=clock_timestamp() WHERE id=${id} AND "receiptId"=${receiptId} AND status='VERSIONED_STAGED'
          AND "versionedFileState"=${JSON.stringify(before.state)}::jsonb AND EXISTS(SELECT 1 FROM owner)
        RETURNING id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"`);
      if (claimed.length !== 1) return fail('HR_VERSIONED_FILE_OWNER_LOST');
      checked(claimed[0]);
      const restoreReceipt = await files.restore(before.state.stageReceipt);
      const restored: State = { ...restoring, phase: 'RESTORED', restoreReceipt };
      const saved = await ownedQuery(tx => tx.$queryRaw<Row[]>`WITH owner AS (
          SELECT id FROM public.hr_deletion_receipts WHERE id=${receiptId} AND status IN ('PREPARING','ACCESS_PREPARED')
            AND "operationToken"=${operationToken} FOR UPDATE
        ) UPDATE public.hr_deletion_file_cleanups SET status='VERSIONED_RESTORED',"versionedFileState"=${JSON.stringify(restored)}::jsonb,
          "updatedAt"=clock_timestamp() WHERE id=${id} AND "receiptId"=${receiptId} AND status='VERSIONED_RESTORING'
          AND "versionedFileState"=${JSON.stringify(restoring)}::jsonb AND EXISTS(SELECT 1 FROM owner)
        RETURNING id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"`);
      if (saved.length !== 1) return fail();
      return checked(saved[0]);
    }),
    commit: (id: string) => work.run(async () => {
      if (!ownPlans.has(id)) return fail('HR_VERSIONED_FILE_ORIGINAL_ACTOR_REQUIRED');
      const before = await read(id);
      if (before.state.phase !== 'STAGED' || !before.state.stageReceipt) return fail();
      const removing: State = { ...before.state, phase: 'REMOVING' };
      const claimed = await ownedQuery(tx => tx.$queryRaw<Row[]>`WITH owner AS (
          SELECT id FROM public.hr_deletion_receipts WHERE id=${receiptId} AND status='FILE_CLEANUP_PENDING'
            AND "operationToken" IS NULL AND "leaseExpiresAt" IS NULL FOR UPDATE
        ) UPDATE public.hr_deletion_file_cleanups SET status='VERSIONED_REMOVING',"versionedFileState"=${JSON.stringify(removing)}::jsonb,
          "updatedAt"=clock_timestamp() WHERE id=${id} AND "receiptId"=${receiptId} AND status='VERSIONED_STAGED'
          AND "versionedFileState"=${JSON.stringify(before.state)}::jsonb AND EXISTS(SELECT 1 FROM owner)
        RETURNING id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"`);
      if (claimed.length !== 1) return fail('HR_VERSIONED_FILE_OWNER_LOST');
      checked(claimed[0]);
      const removalReceipt = await files.commit(before.state.stageReceipt);
      const removed: State = { ...removing, phase: 'LIVE_REMOVED_RETAINED_COPIES_PENDING', removalReceipt };
      const saved = await ownedQuery(tx => tx.$queryRaw<Row[]>`WITH owner AS (
          SELECT id FROM public.hr_deletion_receipts WHERE id=${receiptId} AND status='FILE_CLEANUP_PENDING'
            AND "operationToken" IS NULL AND "leaseExpiresAt" IS NULL FOR UPDATE
        ) UPDATE public.hr_deletion_file_cleanups SET status='VERSIONED_LIVE_REMOVED_RETAINED_COPIES_PENDING',"versionedFileState"=${JSON.stringify(removed)}::jsonb,
          "updatedAt"=clock_timestamp() WHERE id=${id} AND "receiptId"=${receiptId} AND status='VERSIONED_REMOVING'
          AND "versionedFileState"=${JSON.stringify(removing)}::jsonb AND EXISTS(SELECT 1 FROM owner)
        RETURNING id,"receiptId","storageName","originalPath","stagedPath",status,"versionedFileState"`);
      if (saved.length !== 1) return fail();
      return checked(saved[0]);
    }),
  };
}
