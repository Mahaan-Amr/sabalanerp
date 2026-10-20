import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import type { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { runSupportTicketMaintenance } from '../../backend/src/services/supportTicketMaintenance';
import { lockSupportTicket, lockSupportStoredFile } from '../../backend/src/services/supportTicketStorage';
import { removeExpiredSupportAttachment, supportRetentionPlanProtectsStagedFile } from '../../backend/src/services/supportRetentionFileJournal';
import { runOwnedSupportFileWork, supportTicketStorageDirectory } from '../../backend/src/services/supportFileRuntime';

type Case = { mode: string; attachmentId: string; ticketId: string; storageName: string;
  sha256: string; size: number; originalVersionSha256: string; logicalDeleted: boolean; liveDeleted: boolean;
  completionRecorded: boolean; pendingPlan: boolean; headVersionSha256: string };
type StagedHold = { reason: string; storageName: string; originalVersionSha256: string; sha256: string; size: number;
  ticketId: string; attachmentId?: string; holdId?: string; auditId?: string; auditData?: unknown;
  auditRolledBack?: boolean; independentProtectionVerified?: boolean;
  independentRefusals?: Array<{ kind: string; auditId: string; target: string; claimedName: string; sourceSha256: string;
    visibleRowsBefore: number; visibleRowsDuring: number; visibleRowsAfterRollback: number }> };
type HistoryScan = { completedHistoricalAuditFixtures: number; planIdPrefix: string; completionIdPrefix: string; malformedAuditId: string;
  unrelatedTarget: string; unrelatedProtected: boolean; malformedProtected: boolean; planRowsDuring: number; planRowsAfterRollback: number };
export type SupportRetentionQualification = { format: 'sabalan-native-support-retention/v2'; cases: Case[]; stagedHolds: StagedHold[]; historyScan: HistoryScan };

/** Actual native HTTP purpose/context must not stand in for worker/FD12 authority. */
export async function qualifySupportMaintenanceHttpDenial(input: { boundary: RuntimeWorkBoundary }) {
  let dispatched = false;
  await input.boundary.context.run(async () => {
    await assert.rejects(runOwnedSupportFileWork(async () => { dispatched = true; }), /WORKER_OWNERSHIP_REQUIRED/);
  });
  assert.equal(dispatched, false);
  return { nativeHttpMaintenanceDeniedBeforeSql: true };
}

/** Fixture-only fault adapter: every query uses the supplied actual singleton.
 * Rollback throws INSIDE its real SQL transaction; lost ACK throws only AFTER
 * PostgreSQL COMMIT returned. There is no runtime hook, mock SQL or extra client. */
function faultAtTransaction(db: PrismaClient, phase: number, kind: 'rollback' | 'lost-ack', afterCommit?: () => Promise<unknown>) {
  let transactions = 0, injected = false;
  const original = db.$transaction.bind(db);
  const proxy = new Proxy(db, { get(target, property) {
    if (property !== '$transaction') return Reflect.get(target, property, target);
    return async (body: (tx: unknown) => Promise<unknown>, options: unknown) => {
      const current = ++transactions;
      const result = await (original as any)(async (tx: unknown) => {
        const value = await body(tx);
        if (current === phase && kind === 'rollback') {
          injected = true; throw Object.assign(Error('PRIVATE_SUPPORT_SQL_ROLLBACK'), { code: 'PRIVATE_SUPPORT_SQL_ROLLBACK' });
        }
        return value;
      }, options);
      if (current === phase && kind === 'lost-ack') {
        if (afterCommit) await afterCommit();
        injected = true; throw Object.assign(Error('PRIVATE_SUPPORT_COMMIT_ACK_LOST'), { code: 'PRIVATE_SUPPORT_COMMIT_ACK_LOST' });
      }
      return result;
    };
  } });
  return { db: proxy, wasInjected: () => injected };
}

/** Caller composes the genuine jobs scope, same existing Support root/store,
 * current-schema isolated database and canonical Prisma singleton. Retain rows
 * and versions for the subsequent actual coherent cut/restore verification. */
export async function qualifySupportRetention(input: {
  db: PrismaClient; boundary: RuntimeWorkBoundary; publication: VersionedFilePublication; reporterId: string;
}): Promise<SupportRetentionQualification> {
  const { db, boundary, publication } = input;
  const root = supportTicketStorageDirectory();
  assert.ok(publication.ownsRoot(root) && publication.ownsWork(boundary.context));
  const files = await publication.bindRoot(root);
  const now = new Date(), cases: Case[] = [], stagedHolds: StagedHold[] = [];
  let historyScan: HistoryScan | undefined;
  await boundary.runBackground(async () => {
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
    assert.match(name, /^qa_[a-z_]+_[a-f0-9]{32}$/);
    const runCase = async (mode: string) => {
      const storageName = randomUUID() + '-' + mode + '.txt';
      const bytes = Buffer.from('PRIVATE ORIGINAL SUPPORT EVIDENCE ' + mode), sha256 = createHash('sha256').update(bytes).digest('hex');
      const originalVersionSha256 = await files.publish(storageName, bytes);
      const ticket = await db.supportTicket.create({ data: {
        referenceCode: 'SUP-QA-' + randomUUID(), reporterId: input.reporterId,
        title: 'Private native retention ' + mode, type: 'TECHNICAL_ERROR', impact: 'MINOR', workaroundExists: true,
        originRoute: '/dashboard/support', diagnosticSnapshot: {}, effectiveAccessSnapshot: {}, suggestedPriority: 'NORMAL',
        status: 'CLOSED', closedAt: new Date(now.getTime() - 400 * 86_400_000),
      } });
      const attachment = await db.supportTicketAttachment.create({ data: {
        ticketId: ticket.id, storageName, originalName: storageName, mimeType: 'text/plain', kind: 'DOCUMENT',
        size: bytes.length, sha256, retentionClass: 'ORDINARY_ONE_YEAR', malwareScanStatus: 'CLEAN',
      } });
      const phase = mode.startsWith('phase-a') ? 1 : 2;
      const fault = mode === 'normal' ? undefined : faultAtTransaction(db, phase, mode.endsWith('rollback') ? 'rollback' : 'lost-ack');
      const work = () => removeExpiredSupportAttachment(fault?.db ?? db, attachment.id, now);
      if (mode === 'phase-a-rollback') await assert.rejects(work(), /PRIVATE_SUPPORT_SQL_ROLLBACK/);
      else if (mode === 'phase-b-rollback') await assert.rejects(work(), /SUPPORT_FILE_DELETE_OUTCOME_UNRESOLVED/);
      else assert.equal(await work(), true);
      if (fault) assert.equal(fault.wasInjected(), true);
      const row = await db.supportTicketAttachment.findUniqueOrThrow({ where: { id: attachment.id } });
      const plans = await db.supportTicketAuditEvent.findMany({ where: { ticketId: ticket.id, action: 'RETENTION_FILE_REMOVAL_PLANNED' } });
      const completed = await db.supportTicketAuditEvent.findMany({ where: { ticketId: ticket.id, action: 'RETENTION_FILE_DELETED_BY_SYSTEM' } });
      const head = await files.inspect(storageName); assert.ok(head);
      const logicalDeleted = mode !== 'phase-a-rollback', pendingPlan = mode === 'phase-b-rollback';
      assert.equal(row.deletedAt !== null, logicalDeleted); assert.equal(row.storageName, logicalDeleted ? null : storageName);
      assert.equal(plans.length, logicalDeleted ? 1 : 0); assert.equal(completed.length, logicalDeleted && !pendingPlan ? 1 : 0);
      if (logicalDeleted) {
        const plan = plans[0].afterData as any;
        assert.equal(plan.format, 'sabalan-support-retention-file/v1'); assert.equal(plan.storageName, storageName);
        assert.equal(plan.source.versionSha256, originalVersionSha256); assert.equal(plan.source.sha256, sha256);
        assert.equal(plan.attachmentId, attachment.id); assert.equal(plan.operationId, plans[0].id);
        assert.match(plan.actorNonce, /^[a-f0-9-]{36}$/);
        assert.equal(head.operation, 'DELETE');
        await assert.rejects(fs.readFile(path.join(root, storageName)), { code: 'ENOENT' });
      } else {
        assert.equal(head.operation, 'PUT'); assert.equal(head.versionSha256, originalVersionSha256);
        assert.deepEqual(await fs.readFile(path.join(root, storageName)), bytes);
      }
      assert.deepEqual(await files.readVersion(storageName, originalVersionSha256), bytes);
      if (pendingPlan) {
        // A fresh call sees the committed logical deletion; it cannot adopt the
        // old actor nonce or manufacture the missing completion audit.
        assert.equal(await removeExpiredSupportAttachment(db, attachment.id, now), false);
        assert.deepEqual(await files.inspect(storageName), head);
        assert.equal(await db.supportTicketAuditEvent.count({ where: { ticketId: ticket.id, action: 'RETENTION_FILE_DELETED_BY_SYSTEM' } }), 0);
      }
      cases.push({ mode, attachmentId: attachment.id, ticketId: ticket.id, storageName, sha256, size: bytes.length,
        originalVersionSha256, logicalDeleted, liveDeleted: logicalDeleted, completionRecorded: completed.length === 1,
        pendingPlan, headVersionSha256: head.versionSha256 });
    };
    await runCase('normal');
    // Stress the actual database reader with completed historical AUDIT
    // fixtures, not 1,153 claimed file operations. All fixture-only inserts
    // roll back; only the real successful domain operation enters the cut.
    const historicalCount = 1153, planIdPrefix = randomUUID().slice(0, 24), completionIdPrefix = randomUUID().slice(0, 24);
    const normal = cases[0], unrelatedTarget = 'staged-unrelated-history-' + randomUUID() + '.txt';
    const originalPlan = (await db.supportTicketAuditEvent.findFirstOrThrow({ where: { ticketId: normal.ticketId, action: 'RETENTION_FILE_REMOVAL_PLANNED' } })).afterData as Record<string, any>;
    const originalCompletion = (await db.supportTicketAuditEvent.findFirstOrThrow({ where: { ticketId: normal.ticketId, action: 'RETENTION_FILE_DELETED_BY_SYSTEM' } })).afterData as Record<string, any>;
    const malformedAuditId = 'ffffffff-ffff-4fff-8fff-' + randomUUID().replace(/-/g, '').slice(0, 12);
    const rollbackHistory = Object.assign(Error('PRIVATE_HISTORICAL_AUDIT_TRANSACTION_ROLLBACK'), { code: 'PRIVATE_HISTORICAL_AUDIT_TRANSACTION_ROLLBACK' });
    let unrelatedProtected = true, malformedProtected = false, planRowsDuring = 0;
    await assert.rejects(db.$transaction(async tx => {
      await lockSupportTicket(tx, normal.ticketId); await lockSupportStoredFile(tx, unrelatedTarget);
      assert.equal(await tx.supportTicketAuditEvent.count({ where: { id: { startsWith: planIdPrefix } } }), 0);
      assert.equal(await tx.supportTicketAuditEvent.count({ where: { id: { startsWith: completionIdPrefix } } }), 0);
      for (let start = 0; start < historicalCount; start += 128) {
        const rows: Prisma.SupportTicketAuditEventCreateManyInput[] = [];
        for (let i = start; i < Math.min(start + 128, historicalCount); i++) {
          const id = planIdPrefix + i.toString(16).padStart(12, '0'), actorNonce = randomUUID();
          rows.push({ id, ticketId: normal.ticketId, action: 'RETENTION_FILE_REMOVAL_PLANNED', afterData: {
            ...originalPlan, operationId: id, actorNonce, storageName: 'retired-history-' + id + '.txt',
          } });
          rows.push({ id: completionIdPrefix + i.toString(16).padStart(12, '0'), ticketId: normal.ticketId,
            action: 'RETENTION_FILE_DELETED_BY_SYSTEM', afterData: { ...originalCompletion, planId: id, actorNonce } });
        }
        await tx.supportTicketAuditEvent.createMany({ data: rows });
      }
      planRowsDuring = await tx.supportTicketAuditEvent.count({ where: { id: { startsWith: planIdPrefix } } });
      assert.equal(planRowsDuring, historicalCount);
      unrelatedProtected = await supportRetentionPlanProtectsStagedFile(tx, unrelatedTarget);
      assert.equal(unrelatedProtected, false, 'Completed unrelated history must not permanently disable staged cleanup');
      await tx.supportTicketAuditEvent.create({ data: { id: malformedAuditId, ticketId: normal.ticketId,
        action: 'RETENTION_FILE_REMOVAL_PLANNED', afterData: { format: 'sabalan-support-retention-file/v1', source: 'UNPROVEN' } } });
      malformedProtected = await supportRetentionPlanProtectsStagedFile(tx, unrelatedTarget);
      assert.equal(malformedProtected, true, 'Malformed evidence must still hold after the last validated page');
      throw rollbackHistory;
    }, { isolationLevel: 'ReadCommitted', timeout: 30_000 }), error => error === rollbackHistory);
    const planRowsAfterRollback = await db.supportTicketAuditEvent.count({ where: { id: { startsWith: planIdPrefix } } });
    assert.equal(planRowsAfterRollback, 0);
    assert.equal(await db.supportTicketAuditEvent.count({ where: { id: { startsWith: completionIdPrefix } } }), 0);
    assert.equal(await db.supportTicketAuditEvent.count({ where: { id: malformedAuditId } }), 0);
    historyScan = { completedHistoricalAuditFixtures: historicalCount, planIdPrefix, completionIdPrefix, malformedAuditId,
      unrelatedTarget, unrelatedProtected, malformedProtected, planRowsDuring, planRowsAfterRollback };
    // Exercise the actual staged-* janitor before seeding the other fault cases.
    // The explicit service policy time makes these files eligible without
    // modifying their pinned live inode/mtime or bypassing version ownership.
    const stagedName = 'staged-' + randomUUID() + '.txt', stagedBytes = Buffer.from('PRIVATE PROMOTED STAGED SUPPORT EVIDENCE');
    const stagedHash = createHash('sha256').update(stagedBytes).digest('hex');
    const stagedVersion = await files.publish(stagedName, stagedBytes);
    const stagedTicket = await db.supportTicket.create({ data: {
      referenceCode: 'SUP-QA-' + randomUUID(), reporterId: input.reporterId,
      title: 'Private staged retention hold', type: 'TECHNICAL_ERROR', impact: 'MINOR', workaroundExists: true,
      originRoute: '/dashboard/support', diagnosticSnapshot: {}, effectiveAccessSnapshot: {}, suggestedPriority: 'NORMAL',
      status: 'CLOSED', closedAt: new Date(now.getTime() - 400 * 86_400_000),
    } });
    const stagedAttachment = await db.supportTicketAttachment.create({ data: {
      ticketId: stagedTicket.id, storageName: stagedName, originalName: stagedName, mimeType: 'text/plain', kind: 'DOCUMENT',
      size: stagedBytes.length, sha256: stagedHash, retentionClass: 'ORDINARY_ONE_YEAR', malwareScanStatus: 'CLEAN',
    } });
    let holdId = '';
    const holdAfterLogicalCommit = faultAtTransaction(db, 1, 'lost-ack', () => db.$transaction(async tx => {
      await lockSupportTicket(tx, stagedTicket.id);
      const hold = await tx.supportTicketLegalHold.create({ data: { ticketId: stagedTicket.id, actorId: input.reporterId,
        reason: 'Private new hold committed between logical removal and physical deletion' } });
      holdId = hold.id;
    }));
    assert.equal(await removeExpiredSupportAttachment(holdAfterLogicalCommit.db, stagedAttachment.id, now), false);
    assert.equal(holdAfterLogicalCommit.wasInjected(), true); assert.ok(holdId);
    assert.equal((await db.supportTicketAttachment.findUniqueOrThrow({ where: { id: stagedAttachment.id } })).storageName, null);
    const sweepTime = new Date(now.getTime() + 2 * 60 * 60_000);
    await runSupportTicketMaintenance(db, sweepTime);
    assert.deepEqual(await fs.readFile(path.join(root, stagedName)), stagedBytes);
    assert.equal((await files.inspect(stagedName))?.versionSha256, stagedVersion);
    stagedHolds.push({ reason: 'new-legal-hold-after-logical-commit', storageName: stagedName,
      originalVersionSha256: stagedVersion, sha256: stagedHash, size: stagedBytes.length,
      ticketId: stagedTicket.id, attachmentId: stagedAttachment.id, holdId });
    // Isolate each invalid-evidence classification in its own real SQL
    // transaction. Neither case can be masked by the other committed audit.
    const basePlan = (await db.supportTicketAuditEvent.findFirstOrThrow({ where: { ticketId: stagedTicket.id, action: 'RETENTION_FILE_REMOVAL_PLANNED' } })).afterData as Record<string, any>;
    for (const reason of ['unknown-plan', 'malformed-plan']) {
      const storageName = 'staged-' + randomUUID() + '.txt', bytes = Buffer.from('PRIVATE ' + reason);
      const version = await files.publish(storageName, bytes), sha256 = createHash('sha256').update(bytes).digest('hex');
      const auditId = randomUUID(), claimedName = 'different-staged-' + randomUUID() + '.txt';
      assert.notEqual(claimedName, storageName);
      const auditData = { ...basePlan, operationId: auditId, actorNonce: randomUUID(), storageName: claimedName,
        ...(reason === 'unknown-plan' ? { format: 'sabalan-support-retention-file/v999' } : { source: { versionSha256: 'MALFORMED' } }) };
      const action = 'RETENTION_FILE_REMOVAL_PLANNED';
      const independentRefusals: NonNullable<StagedHold['independentRefusals']> = [];
      const proveIndependentRefusal = async (kind: string, id: string, eventAction: string, data: Record<string, any>) => {
        const rollback = Object.assign(Error('PRIVATE_INVALID_PLAN_TRANSACTION_ROLLBACK'), { code: 'PRIVATE_INVALID_PLAN_TRANSACTION_ROLLBACK' });
        let visibleRowsBefore = -1, visibleRowsDuring = -1;
        await assert.rejects(db.$transaction(async tx => {
          await lockSupportTicket(tx, stagedTicket.id);
          for (const name of [claimedName, storageName].sort()) await lockSupportStoredFile(tx, name);
          visibleRowsBefore = await tx.supportTicketAuditEvent.count({ where: { id } }); assert.equal(visibleRowsBefore, 0);
          await tx.supportTicketAuditEvent.create({ data: { id, ticketId: stagedTicket.id, action: eventAction, afterData: data } });
          visibleRowsDuring = await tx.supportTicketAuditEvent.count({ where: { id } }); assert.equal(visibleRowsDuring, 1);
          // This invalid plan alone must protect a DIFFERENT target filename;
          // ordinary exact-name matching cannot mask a removed validation rule.
          assert.equal(await supportRetentionPlanProtectsStagedFile(tx, storageName), true);
          throw rollback;
        }, { isolationLevel: 'ReadCommitted' }), error => error === rollback);
        const visibleRowsAfterRollback = await db.supportTicketAuditEvent.count({ where: { id } }); assert.equal(visibleRowsAfterRollback, 0);
        independentRefusals.push({ kind, auditId: id, target: storageName, claimedName, sourceSha256: sha256,
          visibleRowsBefore, visibleRowsDuring, visibleRowsAfterRollback });
      };
      await proveIndependentRefusal(reason === 'unknown-plan' ? 'unknown-format-with-known-action' : 'malformed-source-with-known-format', auditId, action, auditData);
      if (reason === 'unknown-plan') {
        const unknownId = randomUUID();
        await proveIndependentRefusal('unknown-action-with-known-format', unknownId, 'RETENTION_FILE_REMOVAL_UNKNOWN',
          { ...basePlan, operationId: unknownId, actorNonce: randomUUID(), storageName: claimedName });
      }
      const auditRolledBack = reason === 'unknown-plan';
      if (!auditRolledBack) {
        // One committed invalid case additionally exercises the full janitor.
        // The other independently checked audit remains rolled back, not erased.
        await db.supportTicketAuditEvent.create({ data: { id: auditId, ticketId: stagedTicket.id, action, afterData: auditData } });
        await runSupportTicketMaintenance(db, sweepTime);
      }
      assert.deepEqual(await fs.readFile(path.join(root, storageName)), bytes);
      assert.equal((await files.inspect(storageName))?.versionSha256, version);
      stagedHolds.push({ reason, storageName, originalVersionSha256: version, sha256, size: bytes.length,
        ticketId: stagedTicket.id, auditId, auditData, auditRolledBack, independentProtectionVerified: true, independentRefusals });
    }
    for (const mode of ['phase-a-rollback', 'phase-a-lost-ack', 'phase-b-rollback', 'phase-b-lost-ack']) await runCase(mode);
  });
  assert.ok(historyScan);
  return { format: 'sabalan-native-support-retention/v2', cases, stagedHolds, historyScan };
}

/** Read actual restored SQL/live files after the common native coherent cut.
 * Historical version bytes are verified separately by its sealed-file reader. */
export async function verifyRestoredSupportRetention(input: { db: PrismaClient; qualification: SupportRetentionQualification }) {
  const { db, qualification } = input;
  assert.equal(qualification.format, 'sabalan-native-support-retention/v2'); assert.equal(qualification.cases.length, 5);
  assert.equal(qualification.stagedHolds.length, 3);
  assert.equal(qualification.historyScan.completedHistoricalAuditFixtures, 1153);
  assert.equal(qualification.historyScan.unrelatedProtected, false); assert.equal(qualification.historyScan.malformedProtected, true);
  assert.equal(qualification.historyScan.planRowsDuring, 1153); assert.equal(qualification.historyScan.planRowsAfterRollback, 0);
  for (const prefix of [qualification.historyScan.planIdPrefix, qualification.historyScan.completionIdPrefix]) {
    assert.equal(await db.supportTicketAuditEvent.count({ where: { id: { startsWith: prefix } } }), 0);
  }
  assert.equal(await db.supportTicketAuditEvent.count({ where: { id: qualification.historyScan.malformedAuditId } }), 0);
  for (const value of qualification.stagedHolds) {
    const bytes = await fs.readFile(path.join(supportTicketStorageDirectory(), value.storageName));
    assert.equal(bytes.length, value.size); assert.equal(createHash('sha256').update(bytes).digest('hex'), value.sha256);
    if (value.attachmentId) {
      const row = await db.supportTicketAttachment.findUniqueOrThrow({ where: { id: value.attachmentId } });
      assert.equal(row.storageName, null); assert.ok(row.deletedAt); assert.ok(value.holdId);
      assert.equal((await db.supportTicketLegalHold.findUniqueOrThrow({ where: { id: value.holdId } })).releasedAt, null);
    }
    if (value.auditId) {
      if (value.auditRolledBack) assert.equal(await db.supportTicketAuditEvent.count({ where: { id: value.auditId } }), 0);
      else assert.deepEqual((await db.supportTicketAuditEvent.findUniqueOrThrow({ where: { id: value.auditId } })).afterData, value.auditData);
    }
    for (const refusal of value.independentRefusals ?? []) {
      assert.equal(refusal.visibleRowsBefore, 0); assert.equal(refusal.visibleRowsDuring, 1); assert.equal(refusal.visibleRowsAfterRollback, 0);
      const intentionallyCommitted = value.auditRolledBack === false && refusal.auditId === value.auditId;
      assert.equal(await db.supportTicketAuditEvent.count({ where: { id: refusal.auditId } }), intentionallyCommitted ? 1 : 0);
    }
  }
  for (const value of qualification.cases) {
    const row = await db.supportTicketAttachment.findUniqueOrThrow({ where: { id: value.attachmentId } });
    assert.equal(row.deletedAt !== null, value.logicalDeleted); assert.equal(row.storageName, value.logicalDeleted ? null : value.storageName);
    const plans = await db.supportTicketAuditEvent.findMany({ where: { ticketId: value.ticketId, action: 'RETENTION_FILE_REMOVAL_PLANNED' } });
    assert.equal(plans.length, value.logicalDeleted ? 1 : 0);
    if (plans.length) {
      const plan = plans[0].afterData as any; assert.equal(plan.storageName, value.storageName);
      assert.equal(plan.source.versionSha256, value.originalVersionSha256); assert.equal(plan.source.sha256, value.sha256);
    }
    assert.equal(await db.supportTicketAuditEvent.count({ where: { ticketId: value.ticketId, action: 'RETENTION_FILE_DELETED_BY_SYSTEM' } }), value.completionRecorded ? 1 : 0);
    const target = path.join(supportTicketStorageDirectory(), value.storageName);
    if (value.liveDeleted) await assert.rejects(fs.readFile(target), { code: 'ENOENT' });
    else {
      const bytes = await fs.readFile(target); assert.equal(bytes.length, value.size);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), value.sha256);
    }
  }
  return { supportRestoredLogicalReferencesAndPendingPlansVerified: true, cases: qualification.cases.length, stagedHolds: qualification.stagedHolds.length };
}
