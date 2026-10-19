import type { Prisma, PrismaClient } from '@prisma/client';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RuntimeWorkContext } from './runtimeWorkContext';
import { VersionedFilePublication } from './versionedFilePublication';
import { createDurableVersionedHiringFileTransaction } from './hrVersionedDeletionFileJournal';
import { buildPersonnelErasurePlan, executePersonnelErasureGraph, type PersonnelErasurePlan } from './hrPersonnelErasureGraph';
import { assertArchiveReason, assertPersonnelErasureTarget } from './hrRecordRetentionPolicy';

const protocol = 'sabalan-versioned-hr-erasure/v1';
const failure = (code: string, statusCode = 503) => Object.assign(new Error(statusCode === 409
  ? 'دامنه حذف تغییر کرده است؛ پیش‌نمایش تازه را بررسی کنید.'
  : statusCode === 403 ? 'انجام این عملیات به مدیر فعال سامانه نیاز دارد.'
    : 'وضعیت عملیات حذف نیازمند بررسی است؛ پیش از تلاش دوباره وضعیت ثبت‌شده را بررسی کنید.'), { code, statusCode });
type AccessSnapshot = {
  format: 'sabalan-versioned-personnel-access/v1'; preparedFingerprint: string; revokedAt: string; revocationReason: string;
  users: Array<{ id: string; updatedAt: string }>;
  sessions: Array<{ id: string; updatedAt: string; beforeRevokedById: string | null; beforeRevocationReason: string | null }>;
};
const decodeAccess = (value: Prisma.JsonValue, receiptId: string): AccessSnapshot => {
  const frame = value as { fileProtocol?: unknown; accessRecovery?: unknown } | null;
  const data = frame?.accessRecovery as AccessSnapshot | undefined;
  const iso = (text: unknown) => typeof text === 'string' && Number.isFinite(Date.parse(text)) && new Date(text).toISOString() === text;
  const ids = (rows: Array<{ id: string; updatedAt: string }>) => rows.length <= 50_000
    && rows.every(row => row && typeof row.id === 'string' && row.id.length > 0 && iso(row.updatedAt))
    && new Set(rows.map(row => row.id)).size === rows.length;
  if (frame?.fileProtocol !== protocol || data?.format !== 'sabalan-versioned-personnel-access/v1'
    || !/^[a-f0-9]{64}$/.test(data.preparedFingerprint) || !iso(data.revokedAt)
    || data.revocationReason !== `PERMANENT_PERSONNEL_ERASURE:${receiptId}`
    || !Array.isArray(data.users) || !Array.isArray(data.sessions) || !ids(data.users) || !ids(data.sessions)
    || data.sessions.some(row => (row.beforeRevokedById !== null && typeof row.beforeRevokedById !== 'string')
      || (row.beforeRevocationReason !== null && typeof row.beforeRevocationReason !== 'string'))) {
    throw failure('HR_VERSIONED_PERSONNEL_ACCESS_OUTCOME_UNPROVEN');
  }
  return data;
};

/** Private admitted command. The caller still owns administrator password/name
 * confirmation. All roots must be explicitly enrolled with the same real work
 * owner; no raw-path fallback or lease-expiry successor is available. */

export async function eraseVersionedPersonnel(input: {
  database: PrismaClient; work: RuntimeWorkContext;
  roots: readonly { root: string; publication: VersionedFilePublication }[];
  personnelId: string; actorUserId: string; reason: string; expectedFingerprint: string;
}): Promise<{ receiptId: string; status: 'FILE_CLEANUP_PENDING' }> {
  const { database, work, personnelId, actorUserId, expectedFingerprint } = input;
  if (!(work instanceof RuntimeWorkContext) || !personnelId || !actorUserId || !/^[a-f0-9]{64}$/.test(expectedFingerprint)
    || !Array.isArray(input.roots) || input.roots.length < 1 || input.roots.length > 16) throw failure('HR_VERSIONED_PERSONNEL_SCOPE_INVALID');
  const roots = new Map(input.roots.map(scope => {
    if (!path.isAbsolute(scope.root) || path.resolve(scope.root) !== scope.root
      || !(scope.publication instanceof VersionedFilePublication) || !scope.publication.ownsRoot(scope.root)
      || !scope.publication.ownsWork(work)) throw failure('HR_VERSIONED_PERSONNEL_SCOPE_INVALID');
    return [scope.root, scope.publication] as const;
  }));
  if (roots.size !== input.roots.length) throw failure('HR_VERSIONED_PERSONNEL_SCOPE_INVALID');
  const reason = assertArchiveReason(input.reason);
  const transaction = <T>(body: (tx: Prisma.TransactionClient) => Promise<T>, isolationLevel: 'Serializable' | 'ReadCommitted' = 'Serializable') => database.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','10000ms',true)`;
    return body(tx);
  }, { isolationLevel, timeout: 60_000, maxWait: 1000 });
  const guard = async (tx: Prisma.TransactionClient, plan: PersonnelErasurePlan) => {
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true, isActive: true, erasedAt: true } });
    if (!actor || actor.role !== 'ADMIN' || !actor.isActive || actor.erasedAt) throw failure('HR_VERSIONED_PERSONNEL_ADMIN_REQUIRED', 403);
    const userIds = plan.nodes.User || [];
    if (userIds.includes(actorUserId)) assertPersonnelErasureTarget({ actorUserId, targetUserId: actorUserId,
      targetIsActiveAdmin: true, activeAdminCount: 1 });
    const remaining = await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null, id: { notIn: userIds } } });
    if (remaining < 1) throw failure('HR_VERSIONED_PERSONNEL_ADMIN_REQUIRED', 403);
  };
  return work.run(async () => {
    const receiptId = randomUUID(), operationToken = randomUUID();
    const lock = async (tx: Prisma.TransactionClient, status: 'PREPARING' | 'ACCESS_PREPARED' | 'COMPENSATING') => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.hr_deletion_receipts
        WHERE id=${receiptId} AND "targetType"='PERSONNEL' AND "targetId"=${personnelId}
          AND status=${status} AND "operationToken"=${operationToken} AND "leaseExpiresAt">clock_timestamp() FOR UPDATE`;
      if (rows.length !== 1) throw failure('HR_VERSIONED_PERSONNEL_OWNER_LOST');
    };
    const plan = await transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sabalan:personnel-erasure:${personnelId}`},0))`;
      if (await tx.hrDeletionReceipt.count({ where: { targetType: 'PERSONNEL', targetId: personnelId,
        status: { notIn: ['ABORTED', 'COMPLETED'] } } })) throw failure('HR_VERSIONED_PERSONNEL_OPERATION_UNRESOLVED');
      const current = await buildPersonnelErasurePlan(tx, personnelId); await guard(tx, current);
      if (current.fingerprint !== expectedFingerprint) throw failure('HR_PERSONNEL_PREVIEW_CHANGED', 409);
      if (current.files.some(file => !roots.has(file.storageRoot))) throw failure('HR_VERSIONED_PERSONNEL_FILE_ROOT_UNENROLLED');
      const fileCounts = current.files.reduce<Record<string, number>>((counts, file) => {
        counts[file.category] = (counts[file.category] || 0) + 1; return counts;
      }, {});
      await tx.hrDeletionReceipt.create({ data: { id: receiptId, targetType: 'PERSONNEL', targetId: personnelId,
        actorUserId, reason, previewFingerprint: expectedFingerprint, status: 'PREPARING', operationToken,
        leaseExpiresAt: new Date(Date.now() + 300_000), recordCounts: { fileProtocol: protocol, counts: current.counts }, fileCounts } });
      return current;
    }, 'ReadCommitted');
    const files: Array<{ journal: Awaited<ReturnType<typeof createDurableVersionedHiringFileTransaction>>; id: string }> = [];
    // Persist the complete multi-root plan before any source is moved.
    for (const [root, publication] of roots) {
      const names = [...new Set(plan.files.filter(file => file.storageRoot === root).map(file => file.storageName))].sort();
      if (!names.length) continue;
      const journal = await createDurableVersionedHiringFileTransaction({ database, root, publication, work,
        receiptId, operationToken, targetType: 'PERSONNEL' });
      for (const name of names) files.push({ journal, id: (await journal.plan(name, receiptId)).id });
    }
    for (const file of files) await file.journal.stage(file.id);
    const resolve = (phase: 'PREPARING' | 'ACCESS_PREPARED') => transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ status: string; operationToken: string | null;
        leaseExpiresAt: Date | null; recordCounts: Prisma.JsonValue }>>`SELECT status,"operationToken","leaseExpiresAt","recordCounts"
        FROM public.hr_deletion_receipts WHERE id=${receiptId} AND "targetType"='PERSONNEL'
          AND "targetId"=${personnelId} AND "previewFingerprint"=${expectedFingerprint} FOR UPDATE`;
      const row = rows[0];
      if (rows.length !== 1 || (row.recordCounts as { fileProtocol?: unknown })?.fileProtocol !== protocol) {
        throw failure('HR_VERSIONED_PERSONNEL_OUTCOME_UNPROVEN');
      }
      if (phase === 'ACCESS_PREPARED' && row.status === 'FILE_CLEANUP_PENDING'
        && row.operationToken === null && row.leaseExpiresAt === null) return { kind: 'COMMITTED' as const };
      if (row.operationToken !== operationToken) throw failure('HR_VERSIONED_PERSONNEL_OUTCOME_UNPROVEN');
      if (phase === 'PREPARING' && row.status === 'ACCESS_PREPARED') return { kind: 'PREPARED' as const, access: decodeAccess(row.recordCounts, receiptId) };
      if (row.status !== phase) throw failure('HR_VERSIONED_PERSONNEL_OUTCOME_UNPROVEN');
      const access = phase === 'ACCESS_PREPARED' ? decodeAccess(row.recordCounts, receiptId) : null;
      const changed = await tx.hrDeletionReceipt.updateMany({ where: { id: receiptId, status: phase, operationToken }, data: { status: 'COMPENSATING' } });
      if (changed.count !== 1) throw failure('HR_VERSIONED_PERSONNEL_OUTCOME_UNPROVEN');
      return { kind: 'COMPENSATING' as const, access };
    }, 'ReadCommitted').catch(cause => { throw Object.assign(failure('HR_VERSIONED_PERSONNEL_OUTCOME_UNPROVEN'), { receiptId, cause }); });
    const compensate = async (access: AccessSnapshot | null) => {
      try {
        for (const file of [...files].reverse()) await file.journal.restore(file.id);
        await transaction(async tx => {
          // The original actor may finish a fenced compensation after expiry;
          // no new actor is admitted and no destructive graph can pass this state.
          const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.hr_deletion_receipts
            WHERE id=${receiptId} AND status='COMPENSATING' AND "targetType"='PERSONNEL'
              AND "targetId"=${personnelId} AND "operationToken"=${operationToken} FOR UPDATE`;
          if (rows.length !== 1) throw failure('HR_VERSIONED_PERSONNEL_COMPENSATION_UNRESOLVED');
          if (access) {
            for (const session of access.sessions) {
              const restored = await tx.authSession.updateMany({ where: { id: session.id, updatedAt: new Date(session.updatedAt),
                revokedAt: new Date(access.revokedAt), revokedById: actorUserId, revocationReason: access.revocationReason },
              data: { revokedAt: null, revokedById: session.beforeRevokedById, revocationReason: session.beforeRevocationReason } });
              if (restored.count !== 1) throw failure('HR_VERSIONED_PERSONNEL_ACCESS_CHANGED');
            }
            for (const user of access.users) {
              const restored = await tx.user.updateMany({ where: { id: user.id, isActive: false, updatedAt: new Date(user.updatedAt) }, data: { isActive: true } });
              if (restored.count !== 1) throw failure('HR_VERSIONED_PERSONNEL_ACCESS_CHANGED');
            }
          }
          await tx.hrDeletionReceipt.update({ where: { id: receiptId }, data: { status: 'ABORTED', operationToken: null,
            leaseExpiresAt: null, recordCounts: { fileProtocol: protocol, aborted: true }, fileCounts: { restored: files.length } } });
        }, 'ReadCommitted');
      } catch (cause) { throw Object.assign(failure('HR_VERSIONED_PERSONNEL_COMPENSATION_UNRESOLVED'), { receiptId, cause }); }
    };
    let access: AccessSnapshot;
    try {
      access = await transaction(async tx => {
        await lock(tx, 'PREPARING');
        const current = await buildPersonnelErasurePlan(tx, personnelId); await guard(tx, current);
        if (current.fingerprint !== expectedFingerprint) throw failure('HR_PERSONNEL_PREVIEW_CHANGED', 409);
        const targetUsers = current.nodes.User || [];
        const users = await tx.user.findMany({ where: { id: { in: targetUsers }, isActive: true }, select: { id: true } });
        const sessions = await tx.authSession.findMany({ where: { userId: { in: targetUsers }, revokedAt: null },
          select: { id: true, revokedById: true, revocationReason: true } });
        const revokedAt = new Date(), revocationReason = `PERMANENT_PERSONNEL_ERASURE:${receiptId}`;
        const changedUsers = await tx.user.updateMany({ where: { id: { in: users.map(user => user.id) } }, data: { isActive: false } });
        const changedSessions = await tx.authSession.updateMany({ where: { id: { in: sessions.map(session => session.id) } }, data: { revokedAt, revokedById: actorUserId, revocationReason } });
        const afterUsers = await tx.user.findMany({ where: { id: { in: users.map(user => user.id) } }, select: { id: true, updatedAt: true } });
        const afterSessions = await tx.authSession.findMany({ where: { id: { in: sessions.map(session => session.id) } }, select: { id: true, updatedAt: true } });
        if (changedUsers.count !== users.length || changedSessions.count !== sessions.length
          || afterUsers.length !== users.length || afterSessions.length !== sessions.length) throw failure('HR_VERSIONED_PERSONNEL_ACCESS_CHANGED');
        const beforeSessions = new Map(sessions.map(session => [session.id, session]));
        const prepared = await buildPersonnelErasurePlan(tx, personnelId);
        const snapshot: AccessSnapshot = { format: 'sabalan-versioned-personnel-access/v1', preparedFingerprint: prepared.fingerprint,
          revokedAt: revokedAt.toISOString(), revocationReason,
          users: afterUsers.map(user => ({ id: user.id, updatedAt: user.updatedAt.toISOString() })),
          sessions: afterSessions.map(session => { const before = beforeSessions.get(session.id)!;
            return { id: session.id, updatedAt: session.updatedAt.toISOString(), beforeRevokedById: before.revokedById, beforeRevocationReason: before.revocationReason }; }) };
        await tx.hrDeletionReceipt.update({ where: { id: receiptId }, data: { status: 'ACCESS_PREPARED',
          recordCounts: { fileProtocol: protocol, counts: plan.counts, accessRecovery: snapshot } } });
        return snapshot;
      });
    } catch (error) {
      const resolution = await resolve('PREPARING');
      if (resolution.kind === 'COMPENSATING') { await compensate(resolution.access); throw error; }
      if (resolution.kind !== 'PREPARED') throw failure('HR_VERSIONED_PERSONNEL_OUTCOME_UNPROVEN');
      access = resolution.access;
    }
    try {
      await transaction(async tx => {
        await lock(tx, 'ACCESS_PREPARED');
        const current = await buildPersonnelErasurePlan(tx, personnelId); await guard(tx, current);
        if (current.fingerprint !== access.preparedFingerprint) throw failure('HR_PERSONNEL_PREPARED_SCOPE_CHANGED', 409);
        await executePersonnelErasureGraph(tx, current);
        await tx.hrDeletionReceipt.update({ where: { id: receiptId }, data: { status: 'FILE_CLEANUP_PENDING',
          operationToken: null, leaseExpiresAt: null, deletedAt: new Date(), recordCounts: { fileProtocol: protocol, counts: current.counts } } });
      });
    } catch (error) {
      const resolution = await resolve('ACCESS_PREPARED');
      if (resolution.kind === 'COMPENSATING') { await compensate(resolution.access); throw error; }
      if (resolution.kind !== 'COMMITTED') throw failure('HR_VERSIONED_PERSONNEL_OUTCOME_UNPROVEN');
    }
    for (const file of files) await file.journal.commit(file.id);
    return { receiptId, status: 'FILE_CLEANUP_PENDING' as const };
  });
}
