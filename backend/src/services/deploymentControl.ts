export type DeploymentPhase =
  | 'PREFLIGHT'
  | 'LEASE_ACQUIRED'
  | 'MAINTENANCE_REQUESTED'
  | 'TRAFFIC_BLOCKED'
  | 'SERVICES_DRAINED'
  | 'LOCAL_CHECKPOINT_VERIFIED'
  | 'REMOTE_CHECKPOINT_VERIFIED'
  | 'MUTATION_STARTED'
  | 'MIGRATIONS_APPLIED'
  | 'RELEASE_STARTED'
  | 'GATES_PASSED'
  | 'TRAFFIC_OPENED'
  | 'COMPLETED'
  | 'ABORTED'
  | 'ROLLBACK_STARTED'
  | 'ROLLED_BACK'
  | 'RECOVERY_REQUIRED'
  | 'COMPLETED_WITH_NOTIFICATION_FAILURE';

export type DeploymentRecord = {
  deploymentId: string;
  releaseId: string;
  targetCommit: string;
  owner: string;
  phase: DeploymentPhase;
  leaseToken: string;
  leaseExpiresAt: Date;
  heartbeatAt: Date;
  startedAt: Date;
  updatedAt: Date;
};

export interface DeploymentStore {
  findActive(): Promise<DeploymentRecord | null>;
  create(record: DeploymentRecord): Promise<DeploymentRecord>;
  replaceExpired(expectedLeaseToken: string, record: DeploymentRecord): Promise<DeploymentRecord | null>;
  updateOwned(deploymentId: string, leaseToken: string, update: Partial<DeploymentRecord>): Promise<DeploymentRecord | null>;
  finishOwned(deploymentId: string, leaseToken: string, phase: DeploymentPhase, now: Date): Promise<DeploymentRecord | null>;
}

export class InMemoryDeploymentStore implements DeploymentStore {
  private active: DeploymentRecord | null = null;

  findActive() {
    return Promise.resolve(this.active);
  }

  create(record: DeploymentRecord) {
    this.active = record;
    return Promise.resolve(record);
  }

  replaceExpired(expectedLeaseToken: string, record: DeploymentRecord) {
    if (!this.active || this.active.leaseToken !== expectedLeaseToken) return Promise.resolve(null);
    this.active = record;
    return Promise.resolve(record);
  }

  updateOwned(deploymentId: string, leaseToken: string, update: Partial<DeploymentRecord>) {
    if (!this.active || this.active.deploymentId !== deploymentId || this.active.leaseToken !== leaseToken) {
      return Promise.resolve(null);
    }
    this.active = { ...this.active, ...update };
    return Promise.resolve(this.active);
  }

  finishOwned(deploymentId: string, leaseToken: string, phase: DeploymentPhase, now: Date) {
    if (!this.active || this.active.deploymentId !== deploymentId || this.active.leaseToken !== leaseToken) {
      return Promise.resolve(null);
    }
    this.active = { ...this.active, phase, updatedAt: now };
    const finished = this.active;
    this.active = null;
    return Promise.resolve(finished);
  }
}

const fromDatabase = (row: DeploymentOperation): DeploymentRecord => ({
  deploymentId: row.id,
  releaseId: row.releaseId,
  targetCommit: row.targetCommit,
  owner: row.owner,
  phase: row.phase as DeploymentPhase,
  leaseToken: row.leaseToken,
  leaseExpiresAt: row.leaseExpiresAt,
  heartbeatAt: row.heartbeatAt,
  startedAt: row.startedAt,
  updatedAt: row.updatedAt,
});

export class PrismaDeploymentStore implements DeploymentStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findActive() {
    const row = await this.prisma.deploymentOperation.findUnique({ where: { activeKey: 'production' } });
    return row ? fromDatabase(row) : null;
  }

  async create(record: DeploymentRecord) {
    const blocker = await this.prisma.deploymentOperation.findFirst({
      where: { phase: { in: ['RECOVERY_REQUIRED', 'COMPLETED_WITH_NOTIFICATION_FAILURE'] } },
      orderBy: { completedAt: 'desc' },
      select: { id: true, phase: true },
    });
    if (blocker) {
      throw Object.assign(new Error(`Deployment is blocked by unresolved operation ${blocker.id} (${blocker.phase}).`), {
        code: 'DEPLOYMENT_BLOCKED_BY_UNRESOLVED_FAILURE',
      });
    }
    return fromDatabase(await this.prisma.deploymentOperation.create({
        data: {
          id: record.deploymentId,
          activeKey: 'production',
          releaseId: record.releaseId,
          targetCommit: record.targetCommit,
          owner: record.owner,
          phase: record.phase,
          leaseToken: record.leaseToken,
          leaseExpiresAt: record.leaseExpiresAt,
          heartbeatAt: record.heartbeatAt,
          startedAt: record.startedAt,
        },
      }));
  }

  async replaceExpired(expectedLeaseToken: string, record: DeploymentRecord) {
    return this.prisma.$transaction(async (tx) => {
      const released = await tx.deploymentOperation.updateMany({
        where: {
          activeKey: 'production',
          leaseToken: expectedLeaseToken,
          leaseExpiresAt: { lte: record.startedAt },
        },
        data: {
          activeKey: null,
          phase: 'RECOVERY_REQUIRED',
          completedAt: record.startedAt,
          errorCode: 'EXPIRED_LEASE_REPLACED_AFTER_PREFLIGHT',
        },
      });
      if (released.count !== 1) return null;
      return fromDatabase(await tx.deploymentOperation.create({
        data: {
          id: record.deploymentId,
          activeKey: 'production',
          releaseId: record.releaseId,
          targetCommit: record.targetCommit,
          owner: record.owner,
          phase: record.phase,
          leaseToken: record.leaseToken,
          leaseExpiresAt: record.leaseExpiresAt,
          heartbeatAt: record.heartbeatAt,
          startedAt: record.startedAt,
        },
      }));
    });
  }

  async updateOwned(deploymentId: string, leaseToken: string, update: Partial<DeploymentRecord>) {
    const result = await this.prisma.deploymentOperation.updateMany({
      where: { id: deploymentId, leaseToken, activeKey: 'production' },
      data: {
        ...(update.phase ? { phase: update.phase } : {}),
        ...(update.leaseExpiresAt ? { leaseExpiresAt: update.leaseExpiresAt } : {}),
        ...(update.heartbeatAt ? { heartbeatAt: update.heartbeatAt } : {}),
      },
    });
    if (result.count !== 1) return null;
    const row = await this.prisma.deploymentOperation.findUnique({ where: { id: deploymentId } });
    return row ? fromDatabase(row) : null;
  }

  async finishOwned(deploymentId: string, leaseToken: string, phase: DeploymentPhase, now: Date) {
    const result = await this.prisma.deploymentOperation.updateMany({
      where: { id: deploymentId, leaseToken, activeKey: 'production' },
      data: { phase, activeKey: null, completedAt: now },
    });
    if (result.count !== 1) return null;
    const row = await this.prisma.deploymentOperation.findUnique({ where: { id: deploymentId } });
    return row ? fromDatabase(row) : null;
  }
}

type AcquireDeploymentInput = {
  deploymentId: string;
  releaseId: string;
  targetCommit: string;
  owner: string;
  leaseToken: string;
  now: Date;
  leaseMs: number;
  recoveryPreflightPassed?: boolean;
};

const newDeploymentRecord = (input: AcquireDeploymentInput): DeploymentRecord => ({
  deploymentId: input.deploymentId,
  releaseId: input.releaseId,
  targetCommit: input.targetCommit,
  owner: input.owner,
  phase: 'LEASE_ACQUIRED',
  leaseToken: input.leaseToken,
  leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
  heartbeatAt: input.now,
  startedAt: input.now,
  updatedAt: input.now,
});

export const acquireDeploymentLease = async (
  store: DeploymentStore,
  input: AcquireDeploymentInput,
): Promise<{ acquired: true; deployment: DeploymentRecord } | { acquired: false; active: DeploymentRecord }> => {
  const active = await store.findActive();
  if (active) {
    const expired = active.leaseExpiresAt.getTime() <= input.now.getTime();
    if (!expired || !input.recoveryPreflightPassed) return { acquired: false, active };
    const replacement = await store.replaceExpired(active.leaseToken, newDeploymentRecord(input));
    return replacement ? { acquired: true, deployment: replacement } : { acquired: false, active: (await store.findActive()) || active };
  }

  try {
    const deployment = await store.create(newDeploymentRecord(input));
    return { acquired: true, deployment };
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    const concurrent = await store.findActive();
    if (!concurrent) throw error;
    return { acquired: false, active: concurrent };
  }
};

const allowedTransitions: Record<DeploymentPhase, DeploymentPhase[]> = {
  PREFLIGHT: ['LEASE_ACQUIRED', 'ABORTED'],
  LEASE_ACQUIRED: ['MAINTENANCE_REQUESTED', 'ABORTED'],
  MAINTENANCE_REQUESTED: ['TRAFFIC_BLOCKED', 'ABORTED'],
  TRAFFIC_BLOCKED: ['SERVICES_DRAINED', 'ABORTED'],
  SERVICES_DRAINED: ['LOCAL_CHECKPOINT_VERIFIED', 'ABORTED'],
  LOCAL_CHECKPOINT_VERIFIED: ['REMOTE_CHECKPOINT_VERIFIED', 'ABORTED'],
  REMOTE_CHECKPOINT_VERIFIED: ['MUTATION_STARTED', 'ABORTED'],
  MUTATION_STARTED: ['MIGRATIONS_APPLIED', 'ROLLBACK_STARTED'],
  MIGRATIONS_APPLIED: ['RELEASE_STARTED', 'ROLLBACK_STARTED'],
  RELEASE_STARTED: ['GATES_PASSED', 'ROLLBACK_STARTED'],
  GATES_PASSED: ['TRAFFIC_OPENED', 'ROLLBACK_STARTED'],
  TRAFFIC_OPENED: ['COMPLETED', 'ROLLBACK_STARTED'],
  COMPLETED: [],
  ABORTED: [],
  ROLLBACK_STARTED: ['ROLLED_BACK', 'RECOVERY_REQUIRED'],
  ROLLED_BACK: [],
  RECOVERY_REQUIRED: [],
  COMPLETED_WITH_NOTIFICATION_FAILURE: [],
};

export const transitionDeployment = async (
  store: DeploymentStore,
  input: { deploymentId: string; leaseToken: string; nextPhase: DeploymentPhase; now: Date },
) => {
  const active = await store.findActive();
  if (!active || active.deploymentId !== input.deploymentId || active.leaseToken !== input.leaseToken) {
    throw Object.assign(new Error('Deployment lease ownership was lost.'), { code: 'DEPLOYMENT_LEASE_LOST' });
  }
  if (!allowedTransitions[active.phase].includes(input.nextPhase)) {
    throw Object.assign(new Error(`Invalid deployment transition ${active.phase} -> ${input.nextPhase}.`), { code: 'DEPLOYMENT_TRANSITION_INVALID' });
  }
  const updated = await store.updateOwned(input.deploymentId, input.leaseToken, {
    phase: input.nextPhase,
    updatedAt: input.now,
  });
  if (!updated) throw Object.assign(new Error('Deployment lease ownership was lost.'), { code: 'DEPLOYMENT_LEASE_LOST' });
  return updated;
};

export const heartbeatDeployment = async (
  store: DeploymentStore,
  input: { deploymentId: string; leaseToken: string; now: Date; leaseMs: number },
) => {
  const updated = await store.updateOwned(input.deploymentId, input.leaseToken, {
    heartbeatAt: input.now,
    leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
    updatedAt: input.now,
  });
  if (!updated) throw Object.assign(new Error('Deployment lease ownership was lost.'), { code: 'DEPLOYMENT_LEASE_LOST' });
  return updated;
};

const terminalPhases = new Set<DeploymentPhase>(['COMPLETED', 'ABORTED', 'ROLLED_BACK', 'RECOVERY_REQUIRED', 'COMPLETED_WITH_NOTIFICATION_FAILURE']);

export const finishDeployment = async (
  store: DeploymentStore,
  input: { deploymentId: string; leaseToken: string; phase: DeploymentPhase; now: Date },
) => {
  if (!terminalPhases.has(input.phase)) {
    throw Object.assign(new Error('Deployment can only be released in a terminal phase.'), { code: 'DEPLOYMENT_TERMINAL_PHASE_REQUIRED' });
  }
  const updated = await store.finishOwned(input.deploymentId, input.leaseToken, input.phase, input.now);
  if (!updated) throw Object.assign(new Error('Deployment lease ownership was lost.'), { code: 'DEPLOYMENT_LEASE_LOST' });
  return updated;
};

const phasesBeforeMutation = new Set<DeploymentPhase>([
  'PREFLIGHT', 'LEASE_ACQUIRED', 'MAINTENANCE_REQUESTED', 'TRAFFIC_BLOCKED',
  'SERVICES_DRAINED', 'LOCAL_CHECKPOINT_VERIFIED', 'REMOTE_CHECKPOINT_VERIFIED',
]);

export const deploymentFailureAction = (phase: DeploymentPhase, rollbackAlreadyAttempted: boolean) => {
  if (phasesBeforeMutation.has(phase)) return 'ABORT_AND_REOPEN_PREVIOUS' as const;
  if (phase === 'COMPLETED' || phase === 'ROLLED_BACK') return 'NONE' as const;
  if (rollbackAlreadyAttempted || phase === 'ROLLBACK_STARTED' || phase === 'RECOVERY_REQUIRED') return 'FAIL_CLOSED_RECOVERY_REQUIRED' as const;
  return 'AUTOMATIC_ROLLBACK_ONCE' as const;
};
import type { DeploymentOperation, PrismaClient } from '@prisma/client';
