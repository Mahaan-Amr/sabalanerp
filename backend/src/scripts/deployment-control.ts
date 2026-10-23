import crypto from 'node:crypto';
import {validateBinding,canonical,type PreservedClamavBinding} from '../../scripts/preserved-clamav-policy.mjs';
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
import { assertProtectedBootstrapBoundary, compileProtectedBootstrapSource, runProtectedBootstrapBaseline } from '../services/protectedBootstrapMigrations';
import { assertBootstrapNativeCompletion } from '../services/protectedBridgeMigrations';

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
  preservedClamav?: PreservedClamavBinding;
  clamavOperation?: 'repair' | 'incident-recovery';
  clamavIncidentSnapshotSha256?: string;
  rollbackReleaseSet: Record<'backend' | 'frontend' | 'inquiry' | 'nginx' | 'postgres' | 'clamav', string>;
  rollbackPerformanceEnvironment?: Record<string, string>;
};

const required = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw Object.assign(new Error(`${name} is required.`), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  return value;
};

const preservationMetadataName = (deploymentId: string) => {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(deploymentId)) throw new Error('Invalid scanner preservation deployment identity.');
  return `preserved-clamav-${deploymentId}.json`;
};
const environmentPreservation = (): PreservedClamavBinding | undefined => {
  const hex = process.env.DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX;
  if (!hex) return undefined;
  if (!/^(?:[a-f0-9]{2}){1,16384}$/.test(hex)) throw new Error('Invalid scanner preservation metadata.');
  return validateBinding(JSON.parse(Buffer.from(hex, 'hex').toString('utf8')));
};
const readSession = async (): Promise<Session> => {
  const session = JSON.parse(await fs.promises.readFile(SESSION_PATH, 'utf8')) as Session;
  const binding = environmentPreservation();
  if (session.preservedClamav || binding) {
    if (!session.preservedClamav || !binding || canonical(validateBinding(session.preservedClamav)) !== canonical(binding)) throw new Error('Scanner preservation session binding changed.');
    const name = preservationMetadataName(session.deploymentId);
    for (const directory of [REPORT_DIR, RECOVERY_COORDINATION_DIR]) {
      const file = path.join(directory, name);
      const st = await fs.promises.lstat(file);
      if (!st.isFile() || st.isSymbolicLink() || st.uid !== 0 || st.nlink !== 1 || (st.mode & 0o077)) throw new Error('Invalid scanner preservation recovery metadata.');
      const metadata = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (canonical(validateBinding(metadata)) !== canonical(binding)) throw new Error('Scanner preservation recovery metadata changed.');
    }
  }
  return session;
};
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
  const clamavOperation = process.env.DEPLOYMENT_CLAMAV_OPERATION || 'repair';
  if (!['repair', 'incident-recovery'].includes(clamavOperation)) throw new Error('Unknown ClamAV operation.');
  const incidentSha = process.env.DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256;
  if (clamavOperation === 'incident-recovery' && (process.env.DEPLOYMENT_CLAMAV_REPAIR !== 'true' || !/^[a-f0-9]{64}$/.test(incidentSha || ''))) {
    throw new Error('Incident recovery requires an explicitly bound degraded-instance snapshot.');
  }
  const rollbackPerformanceEnvironment = JSON.parse(process.env.DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT || '{}');
  const identityKey = /^PERFORMANCE_(RELEASE_(COMMIT|SOURCE_HASH|SCHEMA_HASH|POLICY_HASH|INFRASTRUCTURE_HASH|BACKEND_IMAGE|FRONTEND_IMAGE|INQUIRY_IMAGE)|RUNTIME_INFRASTRUCTURE_HASH)$/;
  if (!rollbackPerformanceEnvironment || typeof rollbackPerformanceEnvironment !== 'object' || Array.isArray(rollbackPerformanceEnvironment)
    || Object.entries(rollbackPerformanceEnvironment).some(([key, value]) => !identityKey.test(key)
      || typeof value !== 'string' || (value !== '' && !/^(sha256:)?[a-f0-9]{40,64}$/.test(value)))) {
    throw new Error('Invalid previous performance runtime identity.');
  }
  const preservedClamav = environmentPreservation();
  if (preservedClamav && (process.env.DEPLOYMENT_CLAMAV_REPAIR === 'true' || clamavOperation === 'incident-recovery')) throw new Error('Scanner preservation cannot perform repair.');
  const session: Session = {
    deploymentId: process.env.DEPLOYMENT_ID || `deploy-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    leaseToken: crypto.randomBytes(32).toString('hex'),
    releaseId: required('DEPLOYMENT_RELEASE_ID'),
    targetCommit: required('DEPLOYMENT_TARGET_COMMIT'),
    owner: required('DEPLOYMENT_OWNER'),
    phase: 'PREFLIGHT',
    bootstrap: false,
    controlImage: required('DEPLOYMENT_CONTROL_IMAGE'),
    clamavOperation: clamavOperation as 'repair' | 'incident-recovery',
    ...(clamavOperation === 'incident-recovery' ? { clamavIncidentSnapshotSha256: incidentSha } : {}),
    rollbackPerformanceEnvironment,
    ...(preservedClamav ? {preservedClamav} : {}),
    rollbackReleaseSet: {
      backend: required('DEPLOYMENT_PREVIOUS_BACKEND_IMAGE'),
      frontend: required('DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE'),
      inquiry: required('DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE'),
      nginx: required('DEPLOYMENT_PREVIOUS_NGINX_IMAGE'),
      postgres: required('DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE'),
      clamav: required('DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE'),
    },
  };
  if (preservedClamav) {
    const name = preservationMetadataName(session.deploymentId);
    for (const directory of [REPORT_DIR, RECOVERY_COORDINATION_DIR]) {
      await fs.promises.mkdir(directory, {recursive: true});
      const handle = await fs.promises.open(path.join(directory, name), 'wx', 0o600);
      try { await handle.writeFile(canonical(preservedClamav)); await handle.sync(); } finally { await handle.close(); }
      const parent = await fs.promises.open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  }
  await writeSession(session, true);
  await fs.promises.rm(JOURNAL_PATH, { force: true });
  await journal(session, 'deployment-prepared', {
    clamavOperation: session.clamavOperation,
    ...(preservedClamav ? {preservedClamav} : {}),
    ...(session.clamavIncidentSnapshotSha256 ? { clamavIncidentSnapshotSha256: session.clamavIncidentSnapshotSha256 } : {}),
  });
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
  if (command === 'incident-boundary-state') {
    if (session.clamavOperation !== 'incident-recovery' || session.deploymentId !== required('DEPLOYMENT_ID')
      || session.clamavIncidentSnapshotSha256 !== required('DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256')) {
      throw new Error('Incident boundary inspection requires its exact prepared operation.');
    }
    const maintenance = await readDeploymentMaintenance(RECOVERY_COORDINATION_DIR);
    if (maintenance && maintenance.deploymentId !== session.deploymentId) throw new Error('A different operation owns maintenance.');
    const entries = await validateDeploymentHostJournal(JOURNAL_PATH);
    if (!entries.length || entries[0].event !== 'deployment-prepared' || entries.some(entry => entry.deploymentId !== session.deploymentId)) {
      throw new Error('Incident boundary history is missing or belongs to another operation.');
    }
    const protectedBoundary = Boolean(maintenance) || !['PREFLIGHT', 'LEASE_ACQUIRED', 'MAINTENANCE_REQUESTED'].includes(session.phase)
      || entries.some(entry => entry.event === 'maintenance-activated');
    console.log(protectedBoundary ? 'PROTECTED' : 'PRE_MAINTENANCE');
  } else if (command === 'cancel-preflight') {
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
  } else if (command === 'bootstrap-migrate-baseline' || command === 'bootstrap-adopt') {
    if (!session.bootstrap || session.phase !== 'MUTATION_STARTED') {
      throw Object.assign(new Error('Bootstrap journal can only be adopted immediately after the deployment-control migration.'), { code: 'DEPLOYMENT_BOOTSTRAP_DENIED' });
    }
    const checkpointJson = assertProtectedBootstrapBoundary(session);
    if (command === 'bootstrap-migrate-baseline') {
      await runProtectedBootstrapBaseline(session);
      await journal(session, 'historical-baseline-applied-before-owned-bridge');
      console.log(JSON.stringify({ ok: true }));
      return;
    }
    const completion = assertBootstrapNativeCompletion(RECOVERY_COORDINATION_DIR);
    if (!completion || completion.deploymentId !== session.deploymentId || completion.releaseId !== session.releaseId
      || completion.nativeStatus !== 0 || completion.failed !== false) {
      throw Object.assign(new Error('Bootstrap native completion requires inspection.'), { code: 'BOOTSTRAP_NATIVE_COMPLETION_UNPROVEN' });
    }
    const baseline = compileProtectedBootstrapSource(path.resolve(__dirname, '../../prisma/migrations'));
    const history = await prisma.$queryRaw<Array<{ name: string; checksum: string; finished: Date | null }>>`
      SELECT migration_name AS name,checksum,finished_at AS finished FROM public._prisma_migrations WHERE rolled_back_at IS NULL`;
    if (history.length !== baseline.length || new Set(history.map(row => row.name)).size !== baseline.length
      || history.some(row => !row.finished || !baseline.some(source => source.name === row.name
        && crypto.createHash('sha256').update(source.bytes).digest('hex') === row.checksum))) {
      throw Object.assign(new Error('Bootstrap baseline history requires inspection.'), { code: 'DEPLOYMENT_BOOTSTRAP_HISTORY_UNPROVEN' });
    }
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
