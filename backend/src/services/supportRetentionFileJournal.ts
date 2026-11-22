import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { constants, promises as fs } from 'node:fs';
import type { Prisma, PrismaClient } from '@prisma/client';
import { lockSupportTicket, lockSupportStoredFile } from './supportTicketStorage';
import { supportTicketStorageDirectory, versionedSupportDeletionFiles, removeSupportStoredFile, runOwnedSupportFileWork } from './supportFileRuntime';

type Source = { versionSha256: string | null; sha256: string; bytes: number; device: string | null; inode: string | null };
type Plan = { format: 'sabalan-support-retention-file/v1'; operationId: string; actorNonce: string;
  attachmentId: string; ticketId: string; storageName: string; source: Source; deletedAt: string; policy: string };
const fail = (code = 'SUPPORT_FILE_DELETE_OUTCOME_UNRESOLVED'): never => { throw Object.assign(Error(code), { code }); };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

/** One original invocation owns its nonce and exact SQL/file outcome. Old audit
 * plans are inspection/recovery evidence, never inputs to a successor resume. */
export function removeExpiredSupportAttachment(database: PrismaClient, attachmentId: string, now: Date): Promise<boolean> {
  return runOwnedSupportFileWork(async () => {
  const files = versionedSupportDeletionFiles();
  const candidate = await database.supportTicketAttachment.findUnique({ where: { id: attachmentId } });
  if (!candidate || candidate.deletedAt || !candidate.storageName) return false;
  const operationId = randomUUID(), actorNonce = randomUUID(), completionId = randomUUID();
  let plan: Plan | undefined, removalReceipt: string | undefined;
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => database.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','10000ms',true)`;
    await lockSupportTicket(tx, candidate.ticketId);
    return work(tx);
  }, { isolationLevel: 'ReadCommitted', timeout: 15_000, maxWait: 1000 });
  const source = async (storageName: string, expectedHash: string, expectedBytes: number): Promise<Source> => {
    if (path.basename(storageName) !== storageName || storageName === '.' || storageName === '..') return fail('SUPPORT_FILE_RUNTIME_PATH_INVALID');
    if (files) {
      const read = await files.readSettledDigest(storageName, 25 * 1024 * 1024);
      if (read.head?.operation !== 'PUT' || read.byteLength !== expectedBytes
        || read.sha256 !== expectedHash) return fail('SUPPORT_FILE_DELETE_SOURCE_UNPROVEN');
      return { versionSha256: read.head.versionSha256, sha256: expectedHash, bytes: expectedBytes, device: null, inode: null };
    }
    // Ordinary unconfigured storage still uses the same SQL-first protocol.
    // No version history or native release qualification is inferred from it.
    const target = path.join(supportTicketStorageDirectory(), storageName);
    const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size !== BigInt(expectedBytes) || stat.size > 25n * 1024n * 1024n) return fail('SUPPORT_FILE_DELETE_SOURCE_UNPROVEN');
      const bytes = Buffer.alloc(expectedBytes); let offset = 0;
      while (offset < bytes.length) { const count = (await handle.read(bytes, offset, bytes.length - offset, null)).bytesRead; if (!count) return fail(); offset += count; }
      if ((await handle.read(Buffer.alloc(1), 0, 1, null)).bytesRead || createHash('sha256').update(bytes).digest('hex') !== expectedHash) return fail();
      for (const current of [await handle.stat({ bigint: true }), await fs.lstat(target, { bigint: true })]) {
        for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const) if (current[key] !== stat[key]) return fail();
      }
      return { versionSha256: null, sha256: expectedHash, bytes: expectedBytes, device: String(stat.dev), inode: String(stat.ino) };
    } finally { await handle.close(); }
  };
  let preparationError: unknown;
  try {
    await transaction(async tx => {
      const row = await tx.supportTicketAttachment.findUnique({ where: { id: attachmentId },
        include: { ticket: { include: { legalHolds: { where: { releasedAt: null } } } } } });
      if (!row || row.deletedAt || !row.storageName || !row.ticket.closedAt || row.ticket.legalHolds.length) return;
      const days = row.retentionClass === 'SENSITIVE_90_DAYS' ? 90 : 365;
      if (now.getTime() - row.ticket.closedAt.getTime() < days * 86_400_000) return;
      await lockSupportStoredFile(tx, row.storageName);
      plan = { format: 'sabalan-support-retention-file/v1', operationId, actorNonce, attachmentId,
        ticketId: row.ticketId, storageName: row.storageName, source: await source(row.storageName, row.sha256, row.size),
        deletedAt: now.toISOString(), policy: `${row.retentionClass}:${days}_DAYS_AFTER_CLOSURE` };
      await tx.supportTicketAuditEvent.create({ data: { id: operationId, ticketId: row.ticketId,
        action: 'RETENTION_FILE_REMOVAL_PLANNED', afterData: plan as unknown as Prisma.InputJsonValue } });
      // Commit the logically absent reference together with its exact recovery
      // plan BEFORE any final DELETE. Rollback here cannot lose live bytes.
      await tx.supportTicketAttachment.update({ where: { id: row.id }, data: {
        storageName: null, deletedAt: now, deletionPolicy: plan.policy,
      } });
    });
  } catch (error) { preparationError = error; }
  if (!plan) { if (preparationError) throw preparationError; return false; }
  const ownedPlan = plan;
  const verify = async (tx: Prisma.TransactionClient) => {
    await lockSupportStoredFile(tx, ownedPlan.storageName);
    const audit = await tx.supportTicketAuditEvent.findUnique({ where: { id: operationId } });
    if (!audit) return false;
    if (audit.action !== 'RETENTION_FILE_REMOVAL_PLANNED' || audit.ticketId !== ownedPlan.ticketId || !same(audit.afterData, ownedPlan)) return fail();
    const row = await tx.supportTicketAttachment.findUnique({ where: { id: attachmentId } });
    if (!row || row.ticketId !== ownedPlan.ticketId || row.storageName !== null || row.deletedAt?.toISOString() !== ownedPlan.deletedAt
      || row.deletionPolicy !== ownedPlan.policy || row.sha256 !== ownedPlan.source.sha256 || row.size !== ownedPlan.source.bytes) return fail();
    return true;
  };
  // Acquiring these same locks observes the original transaction's actual end,
  // including when COMMIT succeeded but its acknowledgment did not arrive.
  let finished: { deletionVersionSha256: string | null; physicalErasure: string } | undefined;
  try {
    return await transaction(async tx => {
      if (!await verify(tx)) { if (preparationError) throw preparationError; return fail(); }
      if (await tx.supportTicketLegalHold.count({ where: { ticketId: ownedPlan.ticketId, releasedAt: null } })
        || await tx.supportTicketAttachment.count({ where: { storageName: ownedPlan.storageName, deletedAt: null } })) return false;
      const current = await source(ownedPlan.storageName, ownedPlan.source.sha256, ownedPlan.source.bytes);
      if (!same(current, ownedPlan.source)) return fail('SUPPORT_FILE_DELETE_SOURCE_CHANGED');
      if (files) removalReceipt = await files.removeUpload(ownedPlan.storageName, ownedPlan.source.versionSha256!);
      else await removeSupportStoredFile(ownedPlan.storageName);
      finished = { deletionVersionSha256: removalReceipt ?? null, physicalErasure: 'UNPROVEN_RETAINED_COPIES_PENDING' };
      await tx.supportTicketAuditEvent.create({ data: { id: completionId, ticketId: ownedPlan.ticketId,
        action: 'RETENTION_FILE_DELETED_BY_SYSTEM', afterData: { planId: operationId, actorNonce, attachmentId,
          sha256: ownedPlan.source.sha256, deletedAt: ownedPlan.deletedAt, policy: ownedPlan.policy, ...finished } } });
      return true;
    });
  } catch (error) {
    // Only this original invocation has the exact completed receipt. Readback
    // resolves a lost SQL acknowledgment; absence never grants replay authority.
    if (!finished) throw error;
    const confirmed = await transaction(async tx => {
      if (!await verify(tx)) return false;
      const audit = await tx.supportTicketAuditEvent.findUnique({ where: { id: completionId } });
      const expected = { planId: operationId, actorNonce, attachmentId, sha256: ownedPlan.source.sha256,
        deletedAt: ownedPlan.deletedAt, policy: ownedPlan.policy, ...finished };
      if (!audit || audit.action !== 'RETENTION_FILE_DELETED_BY_SYSTEM' || audit.ticketId !== ownedPlan.ticketId || !same(audit.afterData, expected)) return false;
      if (files) { const read = await files.readSettled(ownedPlan.storageName, 0); if (read.head?.operation !== 'DELETE' || read.head.versionSha256 !== removalReceipt) return fail(); }
      return true;
    });
    if (confirmed) return true;
    return fail();
  }
  });
}

/** The staged janitor is not a recovery actor. Under its existing filename
 * mutex it must retain every planned filename, including completed plans.
 * Unknown/malformed evidence protects the whole sweep. No
 * ticket lock is taken here: filename -> ticket would invert writer ordering. */
export async function supportRetentionPlanProtectsStagedFile(tx: Prisma.TransactionClient, storageName: string): Promise<boolean> {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const id = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
  const segment = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 255
    && value !== '.' && value !== '..' && !/[\\/\u0000-\u001f]/.test(value);
  // A transaction-local cursor fixes the immutable inventory snapshot while
  // the filename mutex excludes new plans for this candidate. Validate every
  // historical plan with bounded pages; completed history has no count ceiling.
  // Unknown-size metadata is projected to NULL and therefore holds the sweep.
  const cursor = 'support_retention_' + randomUUID().replace(/-/g, '');
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(cursor)) return fail();
  await tx.$executeRawUnsafe(`DECLARE ${cursor} NO SCROLL CURSOR FOR
    SELECT id, "ticketId", action,
      CASE WHEN octet_length("afterData"::text)<=16384 THEN "afterData" ELSE NULL END AS "afterData"
    FROM public.support_ticket_audit_events
    WHERE left(action,length('RETENTION_FILE_REMOVAL_'))='RETENTION_FILE_REMOVAL_'
       OR left(coalesce("afterData"->>'format',''),length('sabalan-support-retention-file/'))='sabalan-support-retention-file/'
    ORDER BY id`);
  try {
    for (;;) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; ticketId: string; action: string; afterData: unknown }>>(`FETCH FORWARD 128 FROM ${cursor}`);
      if (!rows.length) return false;
      for (const row of rows) {
        const plan = row.afterData;
        if (row.action !== 'RETENTION_FILE_REMOVAL_PLANNED' || !record(plan)
          || !exact(plan, ['format', 'operationId', 'actorNonce', 'attachmentId', 'ticketId', 'storageName', 'source', 'deletedAt', 'policy'])
          || plan.format !== 'sabalan-support-retention-file/v1' || plan.operationId !== row.id || !id(plan.operationId)
          || !id(plan.actorNonce) || plan.ticketId !== row.ticketId || typeof plan.attachmentId !== 'string' || !plan.attachmentId
          || !segment(plan.storageName) || typeof plan.policy !== 'string' || !plan.policy || typeof plan.deletedAt !== 'string'
          || !Number.isFinite(Date.parse(plan.deletedAt)) || new Date(plan.deletedAt).toISOString() !== plan.deletedAt
          || !record(plan.source) || !exact(plan.source, ['versionSha256', 'sha256', 'bytes', 'device', 'inode'])
          || !sha(plan.source.sha256) || !Number.isSafeInteger(plan.source.bytes) || (plan.source.bytes as number) < 0
          || (plan.source.bytes as number) > 25 * 1024 * 1024) return true;
        const source = plan.source;
        if (source.versionSha256 === null ? ![source.device, source.inode].every(value => typeof value === 'string' && /^[0-9]+$/.test(value))
          : !sha(source.versionSha256) || source.device !== null || source.inode !== null) return true;
        if (plan.storageName === storageName) return true;
      }
    }
  } finally {
    // The owning SQL transaction and actual jobs promise also retain closure;
    // a failed fetch/close never authorizes staged deletion.
    await tx.$executeRawUnsafe(`CLOSE ${cursor}`);
  }
}
