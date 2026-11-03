import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import {
  acquireDeploymentLease,
  finishDeployment,
  heartbeatDeployment,
  PrismaDeploymentStore,
  transitionDeployment,
  type DeploymentPhase,
} from '../services/deploymentControl';
import { appendDeploymentHostJournal, validateDeploymentHostJournal } from '../services/deploymentHostJournal';
import {
  activateDeploymentMaintenance,
  deactivateDeploymentMaintenance,
  readDeploymentMaintenance,
} from '../services/deploymentMaintenance';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';

const REPORT_DIR = process.env.DEPLOYMENT_REPORT_DIR || '/app/deployment-reports';
const SESSION_PATH = path.join(REPORT_DIR, 'active-deployment-session.json');
const JOURNAL_PATH = path.join(REPORT_DIR, 'active-deployment.jsonl');
const LEASE_MS = Number(process.env.DEPLOYMENT_LEASE_MS || 60_000);

type Session = {
  deploymentId: string;
  leaseToken: string;
  releaseId: string;
  targetCommit: string;
  owner: string;
  phase: DeploymentPhase;
  bootstrap: boolean;
  controlImage: string;
  rollbackReleaseSet: Record<'backend' | 'frontend' | 'inquiry' | 'nginx' | 'postgres' | 'clamav', string>;
};

const required = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw Object.assign(new Error(`${name} is required.`), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  return value;
};

const readSession = async (): Promise<Session> => JSON.parse(await fs.promises.readFile(SESSION_PATH, 'utf8')) as Session;
const writeSession = async (session: Session, createOnly = false) => {
  await fs.promises.mkdir(REPORT_DIR, { recursive: true });
  const temporary = `${SESSION_PATH}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(session)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  if (createOnly) {
    try {
      await fs.promises.link(temporary, SESSION_PATH);
      await fs.promises.rm(temporary, { force: true });
      return;
    } catch (error) {
      await fs.promises.rm(temporary, { force: true });
      throw Object.assign(new Error('A deployment session already exists on this host.'), { code: 'DEPLOYMENT_HOST_SESSION_ACTIVE', cause: error });
    }
  }
  await fs.promises.rename(temporary, SESSION_PATH);
};

const journal = async (session: Session, event: string, details?: Record<string, unknown>) =>
  appendDeploymentHostJournal(JOURNAL_PATH, {
    deploymentId: session.deploymentId,
    phase: session.phase,
    event,
    details,
  });

const prepare = async () => {
  const session: Session = {
    deploymentId: process.env.DEPLOYMENT_ID || `deploy-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    leaseToken: crypto.randomBytes(32).toString('hex'),
    releaseId: required('DEPLOYMENT_RELEASE_ID'),
    targetCommit: required('DEPLOYMENT_TARGET_COMMIT'),
    owner: required('DEPLOYMENT_OWNER'),
    phase: 'PREFLIGHT',
    bootstrap: false,
    controlImage: required('DEPLOYMENT_CONTROL_IMAGE'),
    rollbackReleaseSet: {
      backend: required('DEPLOYMENT_PREVIOUS_BACKEND_IMAGE'),
      frontend: required('DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE'),
      inquiry: required('DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE'),
      nginx: required('DEPLOYMENT_PREVIOUS_NGINX_IMAGE'),
      postgres: required('DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE'),
      clamav: required('DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE'),
    },
  };
  await writeSession(session, true);
  await fs.promises.rm(JOURNAL_PATH, { force: true });
  await journal(session, 'deployment-prepared');
  return session;
};

const localTransitions: Partial<Record<DeploymentPhase, DeploymentPhase[]>> = {
  PREFLIGHT: ['LEASE_ACQUIRED', 'ABORTED'],
  LEASE_ACQUIRED: ['MAINTENANCE_REQUESTED', 'ABORTED'],
  MAINTENANCE_REQUESTED: ['TRAFFIC_BLOCKED', 'ABORTED'],
  TRAFFIC_BLOCKED: ['SERVICES_DRAINED', 'ABORTED'],
  SERVICES_DRAINED: ['LOCAL_CHECKPOINT_VERIFIED', 'ABORTED'],
  LOCAL_CHECKPOINT_VERIFIED: ['REMOTE_CHECKPOINT_VERIFIED', 'ABORTED'],
  REMOTE_CHECKPOINT_VERIFIED: ['MUTATION_STARTED', 'ABORTED'],
  MUTATION_STARTED: ['MIGRATIONS_APPLIED', 'ROLLBACK_STARTED'],
  ROLLBACK_STARTED: ['ROLLED_BACK', 'RECOVERY_REQUIRED'],
};

const main = async () => {
  const command = process.argv[2];
  const store = new PrismaDeploymentStore(prisma);
  if (command === 'prepare') {
    console.log(JSON.stringify({ ok: true, session: await prepare(), journalPath: JOURNAL_PATH }));
    return;
  }
  if (command === 'verify-host-journal') {
    console.log(JSON.stringify({ ok: true, entries: await validateDeploymentHostJournal(JOURNAL_PATH) }));
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify({ ok: true, active: await store.findActive(), maintenance: await readDeploymentMaintenance(RECOVERY_COORDINATION_DIR) }));
    return;
  }

  const session = await readSession();
  if (command === 'cancel-preflight') {
    if (session.phase !== 'PREFLIGHT') {
      throw Object.assign(new Error('Only an owned pre-lease session may be cancelled locally.'), { code: 'DEPLOYMENT_PREFLIGHT_CANCEL_DENIED' });
    }
    session.phase = 'ABORTED';
    await writeSession(session);
    await journal(session, 'preflight-cancelled-before-database-lease');
    const finalJournalPath = path.join(path.dirname(JOURNAL_PATH), `${session.deploymentId}.journal.jsonl`);
    await fs.promises.rename(JOURNAL_PATH, finalJournalPath);
    await fs.promises.rm(SESSION_PATH, { force: true });
    console.log(JSON.stringify({ ok: true, hostJournal: finalJournalPath }));
  } else if (command === 'acquire') {
    const result = await acquireDeploymentLease(store, {
      ...session,
      now: new Date(),
      leaseMs: LEASE_MS,
      recoveryPreflightPassed: process.env.DEPLOYMENT_RECOVERY_PREFLIGHT_PASSED === 'true',
    });
    if (!result.acquired) {
      console.error(JSON.stringify({ ok: false, code: 'DEPLOYMENT_ACTIVE', active: result.active }));
      process.exitCode = 2;
      return;
    }
    session.phase = 'LEASE_ACQUIRED';
    await writeSession(session);
    await journal(session, 'database-lease-acquired', { leaseExpiresAt: result.deployment.leaseExpiresAt.toISOString() });
    console.log(JSON.stringify({ ok: true, deployment: result.deployment }));
  } else if (command === 'bootstrap-enable') {
    if (process.env.DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP !== 'true' || session.phase !== 'PREFLIGHT') {
      throw Object.assign(new Error('Initial deployment journal bootstrap was not explicitly and safely detected.'), { code: 'DEPLOYMENT_BOOTSTRAP_DENIED' });
    }
    session.bootstrap = true;
    session.phase = 'LEASE_ACQUIRED';
    await writeSession(session);
    await journal(session, 'initial-schema-bootstrap-using-host-and-advisory-leases');
    console.log(JSON.stringify({ ok: true, session }));
  } else if (command === 'bootstrap-adopt') {
    if (!session.bootstrap || session.phase !== 'MIGRATIONS_APPLIED') {
      throw Object.assign(new Error('Bootstrap journal can only be adopted immediately after the deployment-control migration.'), { code: 'DEPLOYMENT_BOOTSTRAP_DENIED' });
    }
    const checkpointPath = path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json');
    const checkpointJson = JSON.parse(await fs.promises.readFile(checkpointPath, 'utf8'));
    await prisma.deploymentOperation.create({
      data: {
        id: session.deploymentId,
        activeKey: 'production',
        releaseId: session.releaseId,
        targetCommit: session.targetCommit,
        owner: session.owner,
        phase: session.phase,
        leaseToken: session.leaseToken,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        heartbeatAt: new Date(),
        startedAt: new Date(checkpointJson.createdAt),
        checkpointJson,
      },
    });
    session.bootstrap = false;
    await writeSession(session);
    await journal(session, 'database-journal-adopted-after-initial-schema-migration');
    console.log(JSON.stringify({ ok: true, session }));
  } else if (command === 'local-transition') {
    if (!session.bootstrap) throw Object.assign(new Error('Local transitions are restricted to the initial schema bootstrap.'), { code: 'DEPLOYMENT_BOOTSTRAP_DENIED' });
    const nextPhase = required('DEPLOYMENT_PHASE') as DeploymentPhase;
    if (!localTransitions[session.phase]?.includes(nextPhase)) {
      throw Object.assign(new Error(`Invalid local deployment transition ${session.phase} -> ${nextPhase}.`), { code: 'DEPLOYMENT_TRANSITION_INVALID' });
    }
    session.phase = nextPhase;
    await writeSession(session);
    await journal(session, 'bootstrap-phase-transition');
    console.log(JSON.stringify({ ok: true, session }));
  } else if (command === 'heartbeat') {
    const deployment = await heartbeatDeployment(store, { ...session, now: new Date(), leaseMs: LEASE_MS });
    await journal(session, 'lease-heartbeat', { leaseExpiresAt: deployment.leaseExpiresAt.toISOString() });
    console.log(JSON.stringify({ ok: true, deployment }));
  } else if (command === 'transition') {
    const nextPhase = required('DEPLOYMENT_PHASE') as DeploymentPhase;
    const deployment = await transitionDeployment(store, { ...session, nextPhase, now: new Date() });
    session.phase = nextPhase;
    await writeSession(session);
    await journal(session, 'phase-transition');
    console.log(JSON.stringify({ ok: true, deployment }));
  } else if (command === 'maintenance-on') {
    const maintenance = await activateDeploymentMaintenance(RECOVERY_COORDINATION_DIR, {
      deploymentId: session.deploymentId,
      releaseId: session.releaseId,
      message: 'سامانه در حال به‌روزرسانی امن است.',
      activatedAt: new Date(),
    });
    await journal(session, 'maintenance-activated');
    console.log(JSON.stringify({ ok: true, maintenance }));
  } else if (command === 'maintenance-off') {
    await journal(session, 'maintenance-deactivation-requested');
    await deactivateDeploymentMaintenance(RECOVERY_COORDINATION_DIR, session.deploymentId);
    console.log(JSON.stringify({ ok: true }));
  } else if (command === 'finish') {
    const phase = required('DEPLOYMENT_PHASE') as DeploymentPhase;
    const deployment = session.bootstrap
      ? null
      : await finishDeployment(store, { ...session, phase, now: new Date() });
    if (deployment && phase === 'COMPLETED_WITH_NOTIFICATION_FAILURE') {
      const originalResult = required('DEPLOYMENT_ORIGINAL_RESULT');
      if (!['COMPLETED', 'ABORTED', 'ROLLED_BACK'].includes(originalResult)) {
        throw Object.assign(new Error('Original deployment result is invalid.'), { code: 'DEPLOYMENT_RESULT_INVALID' });
      }
      await prisma.deploymentOperation.update({
        where: { id: session.deploymentId },
        data: { errorCode: 'DEPLOYMENT_NOTIFICATION_PENDING', errorMessage: originalResult },
      });
    }
    session.phase = phase;
    await writeSession(session);
    await journal(session, 'deployment-finished');
    const finalJournalPath = path.join(path.dirname(JOURNAL_PATH), `${session.deploymentId}.journal.jsonl`);
    await fs.promises.rename(JOURNAL_PATH, finalJournalPath);
    await fs.promises.rm(SESSION_PATH, { force: true });
    console.log(JSON.stringify({ ok: true, deployment, hostJournal: finalJournalPath }));
  } else {
    throw Object.assign(new Error('Unknown deployment control command.'), { code: 'DEPLOYMENT_COMMAND_INVALID' });
  }
};

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_CONTROL_FAILED', message: error?.message }));
    process.exitCode = error?.code === 'P2021' ? 4 : 1;
  })
  .finally(() => disconnectDatabase());
