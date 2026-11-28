import crypto from 'node:crypto';
import {validateBinding,canonical,type PreservedClamavBinding} from '../../scripts/preserved-clamav-policy.mjs';
import {validateMaintenanceBinding,readMaintenanceRecord,validateMaintenanceResume,type MaintenanceImageBinding} from '../../scripts/maintenance-image-binding.mjs';
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
import {
  firstRoleCutoverPurpose, hasRetainedFirstRoleCutoverEvidence, readRetainedFirstRoleCutoverEvidence, retainFirstRoleCutoverEvidence,
  readFirstRoleCutoverCredential, validateFirstRoleCutoverBinding, type FirstRoleCutoverBinding,
} from '../services/firstRoleCutoverEvidence';
import { changeOwnedFirstSplitRuntimeGrants } from '../services/protectedDatabaseRoleRecovery';
import { checkpointMetadataTransport, readCanonicalCheckpointMetadata } from '../services/deploymentCheckpointMetadataIdentity';
import { archiveFirstRoleOpenIntent, readFirstRoleRollbackGateProof, readFirstRoleRollbackPublicProof,
  retainFirstRoleOpenIntent } from '../services/firstRoleCutoverEvidence';

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
  purpose?: typeof firstRoleCutoverPurpose;
  firstRoleCutover?: FirstRoleCutoverBinding;
  firstRoleRuntime?: { releaseId: string; browserBuildId: string };
  preservedClamav?: PreservedClamavBinding;
  maintenanceImages?: MaintenanceImageBinding;
  clamavOperation?: 'repair' | 'incident-recovery';
  clamavIncidentSnapshotSha256?: string;
  clamavIncidentReceiptSha256?: string;
  rollbackReleaseSet: Record<'backend' | 'frontend' | 'inquiry' | 'nginx' | 'postgres', string> & { clamav?: string };
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
const maintenanceMetadataName = (deploymentId: string) => {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(deploymentId)) throw new Error('Invalid maintenance content deployment identity.');
  return `maintenance-images-${deploymentId}.json`;
};
const environmentMaintenanceImages = (): MaintenanceImageBinding | undefined => {
  const hex = process.env.DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX;
  if (!hex) return undefined;
  if (!/^(?:[a-f0-9]{2}){1,65536}$/.test(hex)) throw new Error('Invalid maintenance image binding.');
  return validateMaintenanceBinding(JSON.parse(Buffer.from(hex, 'hex').toString('utf8')));
};
const firstRoleEvidence = (session: Session, binding: FirstRoleCutoverBinding) => ({
  deploymentId: session.deploymentId,
  reportDir: REPORT_DIR,
  coordinationDir: RECOVERY_COORDINATION_DIR,
  binding,
});
const environmentFirstRoleCutover = (): FirstRoleCutoverBinding | undefined => {
  const raw = process.env.DEPLOYMENT_FIRST_ROLE_CUTOVER_BINDING_HEX;
  if (!raw) return undefined;
  if (!/^(?:[a-f0-9]{2}){1,768}$/.test(raw) || process.env.DEPLOYMENT_MODE !== 'configuration'
    || process.env.BACKEND_RUNTIME_ROLE !== 'control') throw new Error('Invalid first-role cutover owner configuration.');
  return validateFirstRoleCutoverBinding(JSON.parse(Buffer.from(raw, 'hex').toString('utf8')));
};
const terminalJournalPath = (session: Session) => path.join(REPORT_DIR, `${session.deploymentId}.journal.jsonl`);
const readSession = async (allowArchivedRoleJournal = false): Promise<Session> => {
  const session = JSON.parse(await fs.promises.readFile(SESSION_PATH, 'utf8')) as Session;
  const firstRoleCutover = environmentFirstRoleCutover();
  if (session.purpose === firstRoleCutoverPurpose || session.firstRoleCutover || firstRoleCutover
    || await hasRetainedFirstRoleCutoverEvidence({
      reportDir: REPORT_DIR, coordinationDir: RECOVERY_COORDINATION_DIR, deploymentId: session.deploymentId,
    })) {
    let entries = await validateDeploymentHostJournal(JOURNAL_PATH);
    if (allowArchivedRoleJournal && !entries.length && /^[A-Za-z0-9_-]{1,160}$/.test(session.deploymentId)) {
      entries = await validateDeploymentHostJournal(terminalJournalPath(session));
      if (entries.at(-1)?.event !== 'deployment-finished' || entries.at(-1)?.phase !== 'ROLLED_BACK') {
        throw new Error('First-role terminal journal is unavailable.');
      }
    }
    const first = entries[0];
    if (session.purpose !== firstRoleCutoverPurpose || !firstRoleCutover || session.bootstrap !== false
      || canonical(validateFirstRoleCutoverBinding(session.firstRoleCutover)) !== canonical(firstRoleCutover)
      || first?.deploymentId !== session.deploymentId || first.event !== 'deployment-prepared'
      || canonical(first.details?.firstRoleCutover) !== canonical(firstRoleCutover)
      || !session.firstRoleRuntime || canonical(first.details?.firstRoleRuntime) !== canonical(session.firstRoleRuntime)) {
      throw new Error('First-role cutover session binding changed.');
    }
    await readRetainedFirstRoleCutoverEvidence(firstRoleEvidence(session, firstRoleCutover));
  }
  const maintenanceImages = environmentMaintenanceImages();
  if (session.maintenanceImages || maintenanceImages) {
    if (!session.maintenanceImages || !maintenanceImages) throw new Error('Maintenance image session binding missing.');
    const first = (await validateDeploymentHostJournal(JOURNAL_PATH))[0];
    for (const directory of [REPORT_DIR, RECOVERY_COORDINATION_DIR]) {
      const record = readMaintenanceRecord(path.join(directory, maintenanceMetadataName(session.deploymentId)), maintenanceImages);
      validateMaintenanceResume(session, first, record, maintenanceImages);
    }
  }
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

const prepare = async (firstSplit = false) => {
  const clamavOperation = process.env.DEPLOYMENT_CLAMAV_OPERATION || 'repair';
  if (!['repair', 'incident-recovery'].includes(clamavOperation)) throw new Error('Unknown ClamAV operation.');
  const incidentSha = process.env.DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256;
  const incidentReceiptSha = process.env.DEPLOYMENT_CLAMAV_INCIDENT_RECEIPT_SHA256;
  if (clamavOperation === 'incident-recovery' && (process.env.DEPLOYMENT_CLAMAV_REPAIR !== 'true'
    || ![incidentSha, incidentReceiptSha].every(digest => /^[a-f0-9]{64}$/.test(digest || '')))) {
    throw new Error('Incident recovery requires the degraded-instance snapshot and verified target receipt checksums.');
  }
  const rollbackPerformanceEnvironment = JSON.parse(process.env.DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT || '{}');
  const identityKey = /^PERFORMANCE_(RELEASE_(COMMIT|SOURCE_HASH|SCHEMA_HASH|POLICY_HASH|INFRASTRUCTURE_HASH|BACKEND_IMAGE|FRONTEND_IMAGE|INQUIRY_IMAGE)|RUNTIME_INFRASTRUCTURE_HASH)$/;
  if (!rollbackPerformanceEnvironment || typeof rollbackPerformanceEnvironment !== 'object' || Array.isArray(rollbackPerformanceEnvironment)
    || Object.entries(rollbackPerformanceEnvironment).some(([key, value]) => !identityKey.test(key)
      || typeof value !== 'string' || (value !== '' && !/^(sha256:)?[a-f0-9]{40,64}$/.test(value)))) {
    throw new Error('Invalid previous performance runtime identity.');
  }
  const preservedClamav = environmentPreservation();
  const maintenanceImages = environmentMaintenanceImages();
  const firstRoleCutover = environmentFirstRoleCutover();
  const firstRoleRuntime = firstRoleCutover ? {
    releaseId: required('DEPLOYMENT_FIRST_ROLE_ROLLBACK_RELEASE_ID'),
    browserBuildId: required('DEPLOYMENT_FIRST_ROLE_ROLLBACK_BROWSER_BUILD_ID'),
  } : undefined;
  if (firstRoleRuntime && !Object.values(firstRoleRuntime).every(value => /^[A-Za-z0-9_-]{1,160}$/.test(value))) {
    throw new Error('The retained first-role runtime release identity is invalid.');
  }
  if (firstSplit !== Boolean(firstRoleCutover) || (firstSplit && (preservedClamav || maintenanceImages
    || process.env.DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE || process.env.DEPLOYMENT_CLAMAV_REPAIR === 'true'
    || process.env.DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP === 'true' || clamavOperation === 'incident-recovery'))) {
    throw new Error('First-role cutover requires its dedicated existing scanner-free release operation.');
  }
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
    ...(firstRoleCutover ? { purpose: firstRoleCutoverPurpose, firstRoleCutover, firstRoleRuntime } : {}),
    clamavOperation: clamavOperation as 'repair' | 'incident-recovery',
    ...(clamavOperation === 'incident-recovery' ? { clamavIncidentSnapshotSha256: incidentSha, clamavIncidentReceiptSha256: incidentReceiptSha } : {}),
    rollbackPerformanceEnvironment,
    ...(preservedClamav ? {preservedClamav} : {}),
    ...(maintenanceImages ? {maintenanceImages} : {}),
    rollbackReleaseSet: {
      backend: required('DEPLOYMENT_PREVIOUS_BACKEND_IMAGE'),
      frontend: required('DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE'),
      inquiry: required('DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE'),
      nginx: required('DEPLOYMENT_PREVIOUS_NGINX_IMAGE'),
      postgres: required('DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE'),
      ...(clamavOperation === 'incident-recovery' || process.env.DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE
        ? { clamav: required('DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE') } : {}),
    },
  };
  if (firstRoleCutover) {
    await retainFirstRoleCutoverEvidence({
      ...firstRoleEvidence(session, firstRoleCutover),
      sourceDir: '/run/deployment-secrets/first-database-role-cutover',
    });
  }
  if (maintenanceImages) {
    const name = maintenanceMetadataName(session.deploymentId);
    const record = readMaintenanceRecord(path.join(REPORT_DIR, name), maintenanceImages);
    validateMaintenanceResume(session, {deploymentId: session.deploymentId, sequence: 1, event: 'deployment-prepared', details: {maintenanceImages}}, record, maintenanceImages);
    await fs.promises.mkdir(RECOVERY_COORDINATION_DIR, {recursive: true});
    const handle = await fs.promises.open(path.join(RECOVERY_COORDINATION_DIR, name), 'wx', 0o600);
    try { await handle.writeFile(canonical(record)); await handle.sync(); } finally { await handle.close(); }
    const parent = await fs.promises.open(RECOVERY_COORDINATION_DIR, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
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
    ...(firstRoleCutover ? { firstRoleCutover, firstRoleRuntime } : {}),
    ...(maintenanceImages ? {maintenanceImages} : {}),
    ...(preservedClamav ? {preservedClamav} : {}),
    ...(session.clamavIncidentSnapshotSha256 ? { clamavIncidentSnapshotSha256: session.clamavIncidentSnapshotSha256 } : {}),
    ...(session.clamavIncidentReceiptSha256 ? { clamavIncidentReceiptSha256: session.clamavIncidentReceiptSha256 } : {}),
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
  if (command === 'prepare' || command === 'prepare-first-database-role-cutover') {
    console.log(JSON.stringify({ ok: true,
      session: await prepare(command === 'prepare-first-database-role-cutover'), journalPath: JOURNAL_PATH }));
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

  const confirmRoleRollback = command === 'confirm-first-role-rollback';
  const session = await readSession(confirmRoleRollback);
  if (session.purpose === firstRoleCutoverPurpose && ['bootstrap-enable', 'maintenance-off', 'finish'].includes(command || '')) {
    throw new Error('First-role cutover requires its dedicated terminal owner.');
  }
  if (command === 'reopen-first-role-rollback' || confirmRoleRollback) {
    if (session.purpose !== firstRoleCutoverPurpose || session.phase !== 'ROLLBACK_STARTED' || !session.firstRoleCutover
      || session.leaseToken !== required('DEPLOYMENT_LEASE_TOKEN') || session.deploymentId !== required('DEPLOYMENT_ID')
      || session.controlImage !== required('DEPLOYMENT_CONTROL_IMAGE') || session.releaseId !== required('DEPLOYMENT_RELEASE_ID')) {
      throw new Error('Rollback publication requires the original first-role cutover owner.');
    }
    const activeEntries = await validateDeploymentHostJournal(JOURNAL_PATH);
    const entries = activeEntries.length || !confirmRoleRollback ? activeEntries : await validateDeploymentHostJournal(terminalJournalPath(session));
    const restoration = entries.slice().reverse().find(entry => entry.event === 'first-role-cutover-acl'
      && entry.phase === 'ROLLBACK_STARTED' && entry.details?.action === 'restore');
    const checkpoint = readCanonicalCheckpointMetadata(JSON.parse(await fs.promises.readFile(
      path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json'), 'utf8')));
    const { metadata } = checkpoint;
    const operation = await prisma.deploymentOperation.findUnique({ where: { id: session.deploymentId } });
    const receipt = (operation?.reportJson as Record<string, unknown> | null)?.firstRoleCutoverAcl;
    if (!restoration || restoration.deploymentId !== session.deploymentId || !operation
      || operation.leaseToken !== session.leaseToken || operation.releaseId !== session.releaseId
      || operation.targetCommit !== session.targetCommit || operation.owner !== session.owner
      || !operation.checkpointJson || typeof operation.checkpointJson !== 'object' || Array.isArray(operation.checkpointJson)
      || checkpointMetadataTransport(operation.checkpointJson).canonicalMetadataSha256 !== checkpoint.sha256
      || metadata.deploymentId !== session.deploymentId || metadata.releaseId !== session.releaseId
      || metadata.targetCommit !== session.targetCommit || metadata.localVerified !== true || metadata.remoteVerified !== true
      || restoration.details?.checkpointSha256 !== metadata.checksum || canonical(receipt) !== canonical(restoration.details)) {
      throw new Error('The recorded rollback and checkpoint do not prove the first-role recovery.');
    }
    const active = operation.phase === 'ROLLBACK_STARTED' && operation.activeKey === 'production'
      && operation.leaseExpiresAt.getTime() > Date.now();
    const finished = confirmRoleRollback && operation.phase === 'ROLLED_BACK' && operation.activeKey === null
      && operation.completedAt !== null;
    const marker = await readDeploymentMaintenance(RECOVERY_COORDINATION_DIR);
    if ((!active && !finished) || (marker && (confirmRoleRollback || marker.deploymentId !== session.deploymentId
      || marker.releaseId !== session.releaseId))) {
      throw new Error('Rollback publication does not own the maintenance boundary.');
    }
    const { reportSha256, runtimeAddress } = await readFirstRoleRollbackGateProof({
      coordinationDir: RECOVERY_COORDINATION_DIR, deploymentId: session.deploymentId, releaseId: session.releaseId,
      targetCommit: session.targetCommit, checkpointSha256: metadata.checksum!, restoreRecordedAt: restoration.at,
    });
    const [runtimeProof] = await prisma.$queryRaw<Array<{ admitted: boolean }>>`
      SELECT count(*) > 0 AND bool_and(usename = session_user::text)
        AND EXISTS (SELECT 1 FROM pg_authid WHERE rolname = 'sabalan_application_runtime'
          AND NOT rolcanlogin AND rolpassword IS NULL)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE usename = 'sabalan_application_runtime') AS admitted
      FROM pg_catalog.pg_stat_activity
      WHERE client_addr = CAST(${runtimeAddress} AS inet) AND datname = current_database() AND backend_type = 'client backend'
    `;
    if (!runtimeProof?.admitted) throw new Error('The recovered backend no longer proves the original connection.');
    const intentFile = await retainFirstRoleOpenIntent(REPORT_DIR, {
      deploymentId: session.deploymentId, releaseId: session.releaseId, outcome: 'ROLLED_BACK',
      targetCommit: session.targetCommit, checkpointSha256: metadata.checksum!, reportSha256, restorationHash: restoration.hash,
    }, !marker, finished);
    if (confirmRoleRollback) {
      const opening = entries.slice().reverse().find(entry => entry.event === 'first-role-rollback-traffic-open-intent'
        && entry.deploymentId === session.deploymentId && entry.details?.reportSha256 === reportSha256);
      if (!opening) throw new Error('First-role rollback opening was not recorded.');
      const proofSha256 = await readFirstRoleRollbackPublicProof({
        reportDir: REPORT_DIR, intentFile, deploymentId: session.deploymentId, releaseId: session.releaseId,
        targetCommit: session.targetCommit, openedAfter: opening.at, allowStale: finished,
        expectedHosts: [required('DEPLOYMENT_FIRST_ROLE_PRIMARY_HOST'), required('DEPLOYMENT_FIRST_ROLE_INQUIRY_HOST')],
      });
      const completion = entries.at(-1);
      if (completion?.event === 'deployment-finished') {
        if (!finished || completion.phase !== 'ROLLED_BACK' || completion.details?.proofSha256 !== proofSha256) {
          throw new Error('First-role rollback terminal evidence changed.');
        }
      } else {
        if (active) await finishDeployment(store, { ...session, phase: 'ROLLED_BACK', now: new Date() });
        await journal({ ...session, phase: 'ROLLED_BACK' }, 'deployment-finished', { proofSha256, reportSha256 });
      }
      if (activeEntries.length) {
        await fs.promises.rename(JOURNAL_PATH, terminalJournalPath(session));
      }
      await archiveFirstRoleOpenIntent(intentFile, session.deploymentId);
      await fs.promises.rm(SESSION_PATH);
      console.log(JSON.stringify({ ok: true, outcome: 'ROLLED_BACK', proofSha256 }));
      return;
    }
    await heartbeatDeployment(store, { ...session, now: new Date(), leaseMs: LEASE_MS });
    if (marker) {
      await journal(session, 'first-role-rollback-traffic-open-intent', { reportSha256 });
      await deactivateDeploymentMaintenance(RECOVERY_COORDINATION_DIR, session.deploymentId);
    }
    console.log(JSON.stringify({ ok: true, outcome: 'FIRST_ROLE_ROLLBACK_AWAITING_PUBLIC_READBACK', reportSha256 }));
  } else if (command === 'stage-first-role-grants' || command === 'activate-first-role-login' || command === 'restore-first-role-grants') {
    if (session.purpose !== firstRoleCutoverPurpose || !session.firstRoleCutover) {
      throw new Error('Role grants require the dedicated first-role cutover session.');
    }
    const { beforeBytes, stagedBytes } = await readRetainedFirstRoleCutoverEvidence(firstRoleEvidence(session, session.firstRoleCutover));
    const action = command === 'activate-first-role-login' ? 'activate' : command === 'stage-first-role-grants' ? 'stage' : 'restore';
    const credential = action === 'activate' ? await readFirstRoleCutoverCredential(required('DEPLOYMENT_FIRST_ROLE_CREDENTIAL_FILE')) : undefined;
    try {
      const result = await changeOwnedFirstSplitRuntimeGrants({
        action, credential, beforeBytes, stagedBytes, databaseUrl: required('DATABASE_URL'),
        coordinationDir: RECOVERY_COORDINATION_DIR, reportDir: REPORT_DIR, remoteRoot: process.env.DEPLOYMENT_REMOTE_MOUNT,
      });
      await journal(session, 'first-role-cutover-acl', result.receipt);
      console.log(JSON.stringify({ ok: true, ...result }));
    } finally {
      credential?.fill(0);
    }
  } else if (command === 'incident-boundary-state') {
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
    if (session.purpose === firstRoleCutoverPurpose && nextPhase === 'TRAFFIC_OPENED') {
      throw new Error('First-role cutover requires dedicated verification before opening traffic.');
    }
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
