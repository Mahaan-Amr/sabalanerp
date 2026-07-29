import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

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
  replace(
    expectedToken: string,
    record: ContractEditSessionRecord
  ): Promise<ContractEditSessionRecord | null>;
  remove(draftId: string, leaseToken: string): Promise<boolean>;
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
      readonly code: 'edit-session-owned-elsewhere' | 'revision-conflict';
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

export const acquireContractEditSession = async (
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
    const replaced = await store.replace(existing.leaseToken, replacement);
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
  const replaced = await store.replace(existing.leaseToken, replacement);
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

export const assertContractEditOwnership = async (
  store: ContractEditSessionStore,
  input: AssertContractEditOwnershipInput
): Promise<ContractEditOwnershipResult> => {
  const session = await store.load(input.draftId);
  if (!session) {
    return { ok: false, code: 'edit-session-missing', recovery: null };
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

export const checkpointContractRecovery = async (
  store: ContractEditSessionStore,
  input: CheckpointContractRecoveryInput
): Promise<ContractEditOwnershipResult> => {
  const ownership = await assertContractEditOwnership(store, input);
  if (!ownership.ok) return ownership;
  const next: ContractEditSessionRecord = {
    ...ownership.session,
    schemaVersion: input.schemaVersion,
    recovery: input.recovery,
    updatedAt: input.now ?? new Date()
  };
  const replaced = await store.replace(input.leaseToken, next);
  if (!replaced) {
    return {
      ok: false,
      code: 'edit-session-owned-elsewhere',
      recovery: (await store.load(input.draftId))?.recovery ?? null
    };
  }
  return { ok: true, session: replaced };
};

export const releaseContractEditSession = async (
  store: ContractEditSessionStore,
  input: AssertContractEditOwnershipInput
): Promise<ContractEditOwnershipResult> => {
  const ownership = await assertContractEditOwnership(store, input);
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

const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

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

  async replace(
    expectedToken: string,
    record: ContractEditSessionRecord
  ): Promise<ContractEditSessionRecord | null> {
    const updated = await this.prisma.salesContractEditSession.updateMany({
      where: {
        draftId: record.draftId,
        leaseToken: expectedToken
      },
      data: {
        contractId: record.contractId,
        ownerUserId: record.ownerUserId,
        browserSessionId: record.browserSessionId,
        leaseToken: record.leaseToken,
        schemaVersion: record.schemaVersion,
        baseRevision: record.baseRevision,
        recovery: record.recovery === null ? Prisma.JsonNull : toJson(record.recovery),
        updatedAt: record.updatedAt,
        takenOverAt: record.takenOverAt
      }
    });
    if (updated.count !== 1) return null;
    return this.load(record.draftId);
  }

  async remove(draftId: string, leaseToken: string): Promise<boolean> {
    const removed = await this.prisma.salesContractEditSession.deleteMany({
      where: { draftId, leaseToken }
    });
    return removed.count === 1;
  }
}

const prisma = new PrismaClient();
const prismaStore = new PrismaContractEditSessionStore(prisma);

export const acquireSalesContractEditSession = (
  input: AcquireContractEditSessionInput
) => acquireContractEditSession(prismaStore, input);

export const checkpointSalesContractRecovery = (
  input: CheckpointContractRecoveryInput
) => checkpointContractRecovery(prismaStore, input);

export const assertSalesContractEditOwnership = (
  input: AssertContractEditOwnershipInput
) => assertContractEditOwnership(prismaStore, input);

export const releaseSalesContractEditSession = (
  input: AssertContractEditOwnershipInput
) => releaseContractEditSession(prismaStore, input);
