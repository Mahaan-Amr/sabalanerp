import { prisma } from '../lib/prisma';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { isProtectedContractRecovery, publicContractRecovery } from './contractRecoveryProtection';

export const CONTRACT_EDIT_LEASE_TTL_MS = 75_000;
export const CONTRACT_CREATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContractEditSessionRecord {
  readonly draftId: string;
  readonly contractId: string | null;
  readonly ownerUserId: string;
  readonly browserSessionId: string;
  readonly leaseToken: string;
  readonly schemaVersion: number;
  readonly baseRevision: number;
  readonly recovery: unknown | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly takenOverAt: Date | null;
}

export interface ContractEditSessionStore {
  load(draftId: string): Promise<ContractEditSessionRecord | null>;
  create(record: ContractEditSessionRecord): Promise<ContractEditSessionRecord>;
  /** Atomically replace exactly the persisted snapshot that was read. Token-only
   * checks cannot protect two writes from the same live browser. */
  compareAndReplace(
    expected: ContractEditSessionRecord,
    record: ContractEditSessionRecord
  ): Promise<ContractEditSessionRecord | null>;
  remove(draftId: string, leaseToken: string): Promise<boolean>;
  listCreationDrafts(ownerUserId: string): Promise<ContractEditSessionRecord[]>;
  purgeIfUnchanged(expected: ContractEditSessionRecord): Promise<boolean>;
  discardCreationDraft(draftId: string, ownerUserId: string, discardedAt: Date): Promise<boolean>;
}

interface AcquireContractEditSessionInput {
  readonly draftId: string;
  readonly contractId: string | null;
  readonly userId: string;
  readonly browserSessionId: string;
  readonly schemaVersion: number;
  readonly baseRevision: number;
  readonly takeover: boolean;
  readonly now?: Date;
  readonly createToken?: () => string;
}

interface CheckpointContractRecoveryInput {
  readonly draftId: string;
  readonly userId: string;
  readonly browserSessionId: string;
  readonly leaseToken: string;
  readonly schemaVersion: number;
  readonly baseRevision: number;
  readonly recovery: unknown;
  readonly now?: Date;
}

interface AssertContractEditOwnershipInput {
  readonly draftId: string;
  readonly userId: string;
  readonly browserSessionId: string;
  readonly leaseToken: string;
  readonly baseRevision: number;
  readonly now?: Date;
}

interface HeartbeatContractEditSessionInput extends AssertContractEditOwnershipInput {
  readonly now?: Date;
}

interface DiscoverRecoverableContractCreationDraftInput {
  readonly userId: string;
  readonly browserSessionId: string;
  readonly now?: Date;
}

interface DiscardContractCreationDraftInput {
  readonly draftId: string;
  readonly userId: string;
  readonly now?: Date;
}

export interface RecoverableContractCreationDraft {
  readonly draftId: string;
  readonly recovery: unknown;
  readonly activeElsewhere: boolean;
  readonly updatedAt: Date;
}

export type ContractEditOwnershipResult =
  | { readonly ok: true; readonly session: ContractEditSessionRecord }
  | {
      readonly ok: false;
      readonly code: 'edit-session-missing' | 'edit-session-owned-elsewhere' | 'revision-conflict';
      readonly recovery: unknown | null;
      readonly currentBaseRevision?: number;
    };

export type AcquireContractEditSessionResult =
  | {
      readonly ok: true;
      readonly session: ContractEditSessionRecord;
      readonly recovery: unknown | null;
      readonly takenOver: boolean;
    }
  | {
      readonly ok: false;
      readonly code: 'edit-session-owned-elsewhere' | 'revision-conflict' | 'draft-owner-mismatch';
      readonly recovery: unknown | null;
      readonly ownerUserId: string;
      readonly updatedAt: Date;
      readonly currentBaseRevision?: number;
    };

const isOwner = (
  session: ContractEditSessionRecord,
  userId: string,
  browserSessionId: string,
  leaseToken?: string
): boolean => session.ownerUserId === userId &&
  session.browserSessionId === browserSessionId &&
  (leaseToken === undefined || session.leaseToken === leaseToken);

const protectedBindingConflict = (session: ContractEditSessionRecord, input: AcquireContractEditSessionInput):
  Extract<AcquireContractEditSessionResult, { ok: false }> | null => {
  if (!isProtectedContractRecovery(session.recovery) ||
      (session.baseRevision === input.baseRevision && session.schemaVersion === input.schemaVersion &&
       session.contractId === input.contractId)) return null;
  return { ok: false, code: 'revision-conflict', recovery: null,
    ownerUserId: session.ownerUserId, updatedAt: session.updatedAt,
    currentBaseRevision: session.baseRevision };
};

const acquireContractEditSessionInternal = async (
  store: ContractEditSessionStore,
  input: AcquireContractEditSessionInput
): Promise<AcquireContractEditSessionResult> => {
  const now = input.now ?? new Date();
  let existing = await store.load(input.draftId);
  if (!existing) {
    try {
      const session = await store.create({
        draftId: input.draftId,
        contractId: input.contractId,
        ownerUserId: input.userId,
        browserSessionId: input.browserSessionId,
        leaseToken: (input.createToken ?? randomUUID)(),
        schemaVersion: input.schemaVersion,
        baseRevision: input.baseRevision,
        recovery: null,
        createdAt: now,
        updatedAt: now,
        takenOverAt: null
      });
      return { ok: true, session, recovery: session.recovery, takenOver: false };
    } catch (error) {
      // A concurrent tab may have won the unique draftId insert after our read.
      // Resolve through the normal ownership path instead of returning a 500.
      existing = await store.load(input.draftId);
      if (!existing) throw error;
    }
  }

  if (existing.contractId === null && existing.ownerUserId !== input.userId) {
    return {
      ok: false,
      code: 'draft-owner-mismatch',
      recovery: null,
      ownerUserId: input.userId,
      updatedAt: existing.updatedAt
    };
  }

  const bindingConflict = protectedBindingConflict(existing, input);
  if (bindingConflict) return bindingConflict;

  if (existing.baseRevision < input.baseRevision) {
    const replacement: ContractEditSessionRecord = {
      draftId: existing.draftId,
      contractId: input.contractId ?? existing.contractId,
      ownerUserId: input.userId,
      browserSessionId: input.browserSessionId,
      leaseToken: (input.createToken ?? randomUUID)(),
      schemaVersion: input.schemaVersion,
      baseRevision: input.baseRevision,
      recovery: null,
      createdAt: now,
      updatedAt: now,
      takenOverAt: null
    };
    const replaced = await store.compareAndReplace(existing, replacement);
    if (replaced) {
      return {
        ok: true,
        session: replaced,
        recovery: null,
        takenOver: false
      };
    }
    const current = await store.load(input.draftId);
    return {
      ok: false,
      code: current?.baseRevision === input.baseRevision
        ? 'edit-session-owned-elsewhere'
        : 'revision-conflict',
      recovery: null,
      ownerUserId: current?.ownerUserId ?? existing.ownerUserId,
      updatedAt: current?.updatedAt ?? existing.updatedAt,
      currentBaseRevision: current?.baseRevision ?? existing.baseRevision
    };
  }

  if (existing.baseRevision > input.baseRevision) {
    return {
      ok: false,
      code: 'revision-conflict',
      recovery: null,
      ownerUserId: existing.ownerUserId,
      updatedAt: existing.updatedAt,
      currentBaseRevision: existing.baseRevision
    };
  }

  const leaseExpired = now.getTime() - existing.updatedAt.getTime() > CONTRACT_EDIT_LEASE_TTL_MS;
  if (leaseExpired && existing.ownerUserId === input.userId) {
    const replacement: ContractEditSessionRecord = {
      ...existing,
      contractId: input.contractId ?? existing.contractId,
      browserSessionId: input.browserSessionId,
      leaseToken: (input.createToken ?? randomUUID)(),
      schemaVersion: input.schemaVersion,
      updatedAt: now,
      takenOverAt: null
    };
    const replaced = await store.compareAndReplace(existing, replacement);
    if (replaced) {
      return {
        ok: true,
        session: replaced,
        recovery: replaced.recovery,
        takenOver: false
      };
    }
    existing = await store.load(input.draftId) ?? existing;
    const currentBindingConflict = protectedBindingConflict(existing, input);
    if (currentBindingConflict) return currentBindingConflict;
  }

  if (isOwner(existing, input.userId, input.browserSessionId)) {
    return { ok: true, session: existing, recovery: existing.recovery, takenOver: false };
  }

  if (!input.takeover) {
    return {
      ok: false,
      code: 'edit-session-owned-elsewhere',
      recovery: existing.recovery,
      ownerUserId: existing.ownerUserId,
      updatedAt: existing.updatedAt
    };
  }

  const replacement: ContractEditSessionRecord = {
    ...existing,
    contractId: input.contractId ?? existing.contractId,
    ownerUserId: input.userId,
    browserSessionId: input.browserSessionId,
    leaseToken: (input.createToken ?? randomUUID)(),
    schemaVersion: input.schemaVersion,
    updatedAt: now,
    takenOverAt: now
  };
  const replaced = await store.compareAndReplace(existing, replacement);
  if (!replaced) {
    const current = await store.load(input.draftId);
    return {
      ok: false,
      code: 'edit-session-owned-elsewhere',
      recovery: current?.recovery ?? existing.recovery,
      ownerUserId: current?.ownerUserId ?? existing.ownerUserId,
      updatedAt: current?.updatedAt ?? existing.updatedAt
    };
  }
  return {
    ok: true,
    session: replaced,
    recovery: replaced.recovery,
    takenOver: true
  };
};

const assertContractEditOwnershipInternal = async (
  store: ContractEditSessionStore,
  input: AssertContractEditOwnershipInput
): Promise<ContractEditOwnershipResult> => {
  const session = await store.load(input.draftId);
  if (!session) {
    return { ok: false, code: 'edit-session-missing', recovery: null };
  }
  if (session.ownerUserId !== input.userId) {
    return { ok: false, code: 'edit-session-owned-elsewhere', recovery: null };
  }
  const now = input.now ?? new Date();
  if (now.getTime() - session.updatedAt.getTime() > CONTRACT_EDIT_LEASE_TTL_MS) {
    return { ok: false, code: 'edit-session-owned-elsewhere', recovery: session.recovery };
  }
  if (session.baseRevision !== input.baseRevision) {
    return {
      ok: false,
      code: 'revision-conflict',
      recovery: session.recovery,
      currentBaseRevision: session.baseRevision
    };
  }
  if (!isOwner(session, input.userId, input.browserSessionId, input.leaseToken)) {
    return {
      ok: false,
      code: 'edit-session-owned-elsewhere',
      recovery: session.recovery
    };
  }
  return { ok: true, session };
};

const checkpointContractRecoveryInternal = async (
  store: ContractEditSessionStore,
  input: CheckpointContractRecoveryInput
): Promise<ContractEditOwnershipResult> => {
  let ownership = await assertContractEditOwnershipInternal(store, input);
  if (!ownership.ok) return ownership;
  if (isProtectedContractRecovery(input.recovery) || isProtectedContractRecovery(ownership.session.recovery)) {
    return { ok: false, code: 'revision-conflict', recovery: null,
      currentBaseRevision: ownership.session.baseRevision };
  }
  const initial = ownership.session;
  // Heartbeats change presence, not recovery. Retry only that benign conflict;
  // a different recovery checkpoint must never be overwritten automatically.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next: ContractEditSessionRecord = {
      ...ownership.session,
      schemaVersion: input.schemaVersion,
      recovery: input.recovery,
      updatedAt: input.now ?? new Date()
    };
    const replaced = await store.compareAndReplace(ownership.session, next);
    if (replaced) return { ok: true, session: replaced };
    ownership = await assertContractEditOwnershipInternal(store, input);
    if (!ownership.ok) return ownership;
    if (ownership.session.schemaVersion !== initial.schemaVersion ||
        !isDeepStrictEqual(ownership.session.recovery, initial.recovery)) {
      break;
    }
  }
  return { ok: false, code: 'revision-conflict', recovery: ownership.session.recovery,
    currentBaseRevision: ownership.session.baseRevision };
};

const heartbeatContractEditSessionInternal = async (
  store: ContractEditSessionStore,
  input: HeartbeatContractEditSessionInput
): Promise<ContractEditOwnershipResult> => {
  const now = input.now ?? new Date();
  const session = await store.load(input.draftId);
  if (!session) return { ok: false, code: 'edit-session-missing', recovery: null };
  if (session.ownerUserId !== input.userId) {
    return { ok: false, code: 'edit-session-owned-elsewhere', recovery: null };
  }
  if (now.getTime() - session.updatedAt.getTime() > CONTRACT_EDIT_LEASE_TTL_MS) {
    return { ok: false, code: 'edit-session-owned-elsewhere', recovery: session.recovery };
  }
  if (
    session.baseRevision !== input.baseRevision ||
    !isOwner(session, input.userId, input.browserSessionId, input.leaseToken)
  ) {
    return session.baseRevision !== input.baseRevision
      ? {
          ok: false,
          code: 'revision-conflict',
          recovery: session.recovery,
          currentBaseRevision: session.baseRevision
        }
      : { ok: false, code: 'edit-session-owned-elsewhere', recovery: session.recovery };
  }
  const renewed = await store.compareAndReplace(session, { ...session, updatedAt: now });
  if (!renewed) {
    // A concurrent checkpoint/heartbeat may already have renewed this lease.
    // Revalidate the current owner; never retry the stale recovery snapshot.
    return assertContractEditOwnershipInternal(store, input);
  }
  return { ok: true, session: renewed };
};

const recoveryTimestamp = (recovery: unknown): number | null => {
  if (!recovery || typeof recovery !== 'object') return null;
  const updatedAt = Number((recovery as { updatedAt?: unknown }).updatedAt);
  return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null;
};

export const discoverRecoverableContractCreationDraft = async (
  store: ContractEditSessionStore,
  input: DiscoverRecoverableContractCreationDraftInput
): Promise<RecoverableContractCreationDraft | null> => {
  const now = input.now ?? new Date();
  const records = await store.listCreationDrafts(input.userId);
  const candidates = records
    .map(record => ({ record, recoveryUpdatedAt: recoveryTimestamp(record.recovery) }))
    .sort((left, right) => (right.recoveryUpdatedAt ?? 0) - (left.recoveryUpdatedAt ?? 0));

  for (const candidate of candidates) {
    // A Partner producer reads its own safe projection. Never feed its private
    // record into the ordinary priced wizard or purge it during that discovery.
    if (isProtectedContractRecovery(candidate.record.recovery)) continue;
    if (
      candidate.recoveryUpdatedAt === null ||
      now.getTime() - candidate.recoveryUpdatedAt > CONTRACT_CREATION_DRAFT_TTL_MS
    ) {
      await store.purgeIfUnchanged(candidate.record);
      continue;
    }
    const leaseActive = now.getTime() - candidate.record.updatedAt.getTime() <= CONTRACT_EDIT_LEASE_TTL_MS;
    return {
      draftId: candidate.record.draftId,
      recovery: candidate.record.recovery,
      activeElsewhere: leaseActive && candidate.record.browserSessionId !== input.browserSessionId,
      updatedAt: new Date(candidate.recoveryUpdatedAt)
    };
  }
  return null;
};

export const discardContractCreationDraft = (
  store: ContractEditSessionStore,
  input: DiscardContractCreationDraftInput
) => store.discardCreationDraft(input.draftId, input.userId, input.now ?? new Date());

const releaseContractEditSessionInternal = async (
  store: ContractEditSessionStore,
  input: AssertContractEditOwnershipInput
): Promise<ContractEditOwnershipResult | { readonly ok: true; readonly alreadyReleased: true }> => {
  const ownership = await assertContractEditOwnershipInternal(store, input);
  if (!ownership.ok && ownership.code === 'edit-session-missing') {
    return { ok: true, alreadyReleased: true };
  }
  if (!ownership.ok) return ownership;
  const removed = await store.remove(input.draftId, input.leaseToken);
  if (!removed) {
    return {
      ok: false,
      code: 'edit-session-owned-elsewhere',
      recovery: (await store.load(input.draftId))?.recovery ?? null
    };
  }
  return ownership;
};

type SessionResult = AcquireContractEditSessionResult | ContractEditOwnershipResult |
  { readonly ok: true; readonly alreadyReleased: true };

/** One projection for every public success/error path, including the nested
 * session returned by acquire/checkpoint/release. Internal CAS keeps raw JSON. */
function publicSessionResult<T extends SessionResult>(result: T): T {
  return { ...result,
    ...('recovery' in result ? { recovery: publicContractRecovery(result.recovery) } : {}),
    ...('session' in result ? { session: { ...result.session,
      recovery: publicContractRecovery(result.session.recovery) } } : {}),
  };
}

export const acquireContractEditSession = async (store: ContractEditSessionStore, input: AcquireContractEditSessionInput) =>
  publicSessionResult(await acquireContractEditSessionInternal(store, input));
export const assertContractEditOwnership = async (store: ContractEditSessionStore, input: AssertContractEditOwnershipInput) =>
  publicSessionResult(await assertContractEditOwnershipInternal(store, input));
export const checkpointContractRecovery = async (store: ContractEditSessionStore, input: CheckpointContractRecoveryInput) =>
  publicSessionResult(await checkpointContractRecoveryInternal(store, input));
export const heartbeatContractEditSession = async (store: ContractEditSessionStore, input: HeartbeatContractEditSessionInput) =>
  publicSessionResult(await heartbeatContractEditSessionInternal(store, input));
export const releaseContractEditSession = async (store: ContractEditSessionStore, input: AssertContractEditOwnershipInput) =>
  publicSessionResult(await releaseContractEditSessionInternal(store, input));

const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const snapshotWhere = (expected: ContractEditSessionRecord): Prisma.SalesContractEditSessionWhereInput => ({
  draftId: expected.draftId, leaseToken: expected.leaseToken, ownerUserId: expected.ownerUserId,
  browserSessionId: expected.browserSessionId, contractId: expected.contractId,
  baseRevision: expected.baseRevision, schemaVersion: expected.schemaVersion,
  createdAt: expected.createdAt, updatedAt: expected.updatedAt, takenOverAt: expected.takenOverAt,
  // JSON equality matters even when both updates share a millisecond.
  recovery: { equals: expected.recovery === null ? Prisma.AnyNull : toJson(expected.recovery) },
});

const fromPrismaRecord = (record: {
  draftId: string;
  contractId: string | null;
  ownerUserId: string;
  browserSessionId: string;
  leaseToken: string;
  schemaVersion: number;
  baseRevision: number;
  recovery: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  takenOverAt: Date | null;
}): ContractEditSessionRecord => ({
  ...record,
  recovery: record.recovery
});

export class PrismaContractEditSessionStore implements ContractEditSessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async load(draftId: string): Promise<ContractEditSessionRecord | null> {
    const record = await this.prisma.salesContractEditSession.findUnique({ where: { draftId } });
    return record ? fromPrismaRecord(record) : null;
  }

  async create(record: ContractEditSessionRecord): Promise<ContractEditSessionRecord> {
    const created = await this.prisma.salesContractEditSession.create({
      data: {
        draftId: record.draftId,
        contractId: record.contractId,
        ownerUserId: record.ownerUserId,
        browserSessionId: record.browserSessionId,
        leaseToken: record.leaseToken,
        schemaVersion: record.schemaVersion,
        baseRevision: record.baseRevision,
        recovery: record.recovery === null ? Prisma.JsonNull : toJson(record.recovery),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        takenOverAt: record.takenOverAt
      }
    });
    return fromPrismaRecord(created);
  }

  async compareAndReplace(
    expected: ContractEditSessionRecord,
    record: ContractEditSessionRecord
  ): Promise<ContractEditSessionRecord | null> {
    if (expected.draftId !== record.draftId) return null;
    return this.prisma.$transaction(async tx => {
      const updated = await tx.salesContractEditSession.updateMany({
        where: snapshotWhere(expected),
        data: {
          contractId: record.contractId,
          ownerUserId: record.ownerUserId,
          browserSessionId: record.browserSessionId,
          leaseToken: record.leaseToken,
          schemaVersion: record.schemaVersion,
          baseRevision: record.baseRevision,
          recovery: record.recovery === null ? Prisma.JsonNull : toJson(record.recovery),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          takenOverAt: record.takenOverAt
        }
      });
      if (updated.count !== 1) return null;
      // Read under the write lock so the acknowledgement belongs to this write,
      // not a later checkpoint or takeover that wins between two DB requests.
      const current = await tx.salesContractEditSession.findUnique({ where: { draftId: record.draftId } });
      return current ? fromPrismaRecord(current) : null;
    });
  }

  async remove(draftId: string, leaseToken: string): Promise<boolean> {
    const removed = await this.prisma.salesContractEditSession.deleteMany({
      where: { draftId, leaseToken }
    });
    return removed.count === 1;
  }

  async listCreationDrafts(ownerUserId: string): Promise<ContractEditSessionRecord[]> {
    const records = await this.prisma.salesContractEditSession.findMany({
      where: { ownerUserId, contractId: null },
      orderBy: { updatedAt: 'desc' }
    });
    return records.map(fromPrismaRecord);
  }

  async purgeIfUnchanged(expected: ContractEditSessionRecord): Promise<boolean> {
    const removed = await this.prisma.salesContractEditSession.deleteMany({ where: snapshotWhere(expected) });
    return removed.count === 1;
  }

  async discardCreationDraft(draftId: string, ownerUserId: string, discardedAt: Date): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const removed = await tx.salesContractEditSession.deleteMany({
        where: { draftId, ownerUserId, contractId: null }
      });
      if (removed.count !== 1) return false;
      await tx.salesContractDraftAudit.create({
        data: { draftId, ownerUserId, action: 'DISCARDED', createdAt: discardedAt }
      });
      return true;
    });
  }
}

const prismaStore = new PrismaContractEditSessionStore(prisma);

export const acquireSalesContractEditSession = (
  input: AcquireContractEditSessionInput
) => acquireContractEditSession(prismaStore, input);

export const checkpointSalesContractRecovery = (
  input: CheckpointContractRecoveryInput
) => checkpointContractRecovery(prismaStore, input);

export const heartbeatSalesContractEditSession = (
  input: HeartbeatContractEditSessionInput
) => heartbeatContractEditSession(prismaStore, input);

export const discoverRecoverableSalesContractCreationDraft = (
  input: DiscoverRecoverableContractCreationDraftInput
) => discoverRecoverableContractCreationDraft(prismaStore, input);

export const discardSalesContractCreationDraft = (
  input: DiscardContractCreationDraftInput
) => discardContractCreationDraft(prismaStore, input);

export const assertSalesContractEditOwnership = (
  input: AssertContractEditOwnershipInput
) => assertContractEditOwnership(prismaStore, input);

export const releaseSalesContractEditSession = (
  input: AssertContractEditOwnershipInput
) => releaseContractEditSession(prismaStore, input);
