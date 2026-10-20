import {onlineRuntimeDeploymentMatches} from './onlineReleaseDeploymentBinding';
import type { PrismaClient, Prisma } from '@prisma/client';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { applicationRuntimeDatabaseUrl } from './runtimeNativeAuthority';
import { deploymentMaintenanceActive } from './deploymentMaintenance';
import { readOnlineReleaseEvidence } from './onlineReleaseEvidence';
import { assertOriginalOnlineControllerAuthority, type OnlineControllerAuthority } from './onlineReleaseControllerAuthority';
import { snapshotOnlineSupportWindow, type OnlineSupportWindow } from './onlineReleaseSupportWindow';
import {openProtectedBootstrapRuntimeAuthority,assertProtectedBootstrapRuntimeAuthority,activateProtectedBootstrapRuntimeAuthority,
 protectedBootstrapRealtimeSuspended,type ProtectedBootstrapRuntimeAuthority} from './onlineProtectedBootstrapAuthority';

declare const admissionBrand: unique symbol;
export type OnlineRuntimeAdmission = Readonly<{ [admissionBrand]: true }>;
type State = { input: NonNullable<ReturnType<typeof loadOnlineRuntimeScope>>;
  evidence: ReturnType<typeof readOnlineReleaseEvidence>; supportWindow: OnlineSupportWindow;
  authority: OnlineControllerAuthority; stopped: boolean; database:PrismaClient; protectedBootstrap?:ProtectedBootstrapRuntimeAuthority };
const admitted = new WeakMap<OnlineRuntimeAdmission, State>();
function fail(): never { throw new Error('ONLINE_RELEASE_ADMISSION_UNPROVEN'); }
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = (value: any) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** The native scope proves execution custody, not public release acceptance.
 * This second step binds the actual single application client and SQL registry
 * to retrievable evidence whose hashes belong to immutable release identity.
 * There is no flag, phase-only path, arbitrary verifier or reset/registration
 * hook. The original controller must issue the accepted chain separately. */
export async function admitOnlineRuntime(authority: OnlineControllerAuthority, database: PrismaClient): Promise<OnlineRuntimeAdmission> {
  const decision = assertOriginalOnlineControllerAuthority(authority);
  if (Date.parse(decision.expiresAt) <= Date.now()) fail();
  const input = loadOnlineRuntimeScope();
  if (!input || input.scope.format !== 'sabalan-online-runtime-scope/v2'
    || !((input.scope.purpose === 'http' && input.scope.role === 'serving')
      || (input.scope.purpose === 'jobs' && input.scope.role === 'control'))
    || !applicationRuntimeDatabaseUrl()) fail();
  const { prisma } = await import('../lib/prisma');
  if (database !== prisma) fail();
  const acceptedState = await database.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<Array<any>>`SELECT r.*, to_jsonb(s) AS slot, to_jsonb(d) AS deployment
      FROM online_releases r JOIN online_runtime_slots s ON s."releaseId"=r.id
      JOIN deployment_operations d ON d.id=r."deploymentId"
      WHERE r.id=${input.scope.releaseId} AND s.id=${input.scope.runtimeId} FOR SHARE OF r,s,d`;
    if (rows.length !== 1) fail();
    const row = rows[0], slot = row.slot, deployment = row.deployment, identity = row.identityJson;
    if (row.sourceCommit !== input.scope.sourceCommit
      || !['READY', 'SERVING', 'RETAINED'].includes(row.phase) || slot.component !== 'backend'
      || slot.role !== input.scope.role || !['STARTING', 'READY', 'SERVING'].includes(slot.phase)
      || slot.stoppedAt !== null || slot.imageIdentity !== input.scope.image
      || slot.nonceSha256 !== createHash('sha256').update(input.scope.nonce).digest('hex')
      || !onlineRuntimeDeploymentMatches(deployment,input.scope)
      || !identity || identity.format !== 'sabalan-online-release-identity/v1'
      || Object.keys(identity).sort().join(',') !== 'acceptanceSha256,compatibilitySha256,format,manifestSha256,recoverySha256'
      || !digest(identity.manifestSha256) || row.manifestSha256 !== identity.manifestSha256
      || identity.manifestSha256 !== decision.manifestSha256 || identity.acceptanceSha256 !== decision.acceptanceSha256
      || ![identity.acceptanceSha256, identity.compatibilitySha256, identity.recoverySha256].every(digest)
      || sha(row.compatibilityJson) !== identity.compatibilitySha256 || sha(row.recoveryJson) !== identity.recoverySha256) fail();
    const protectedBootstrap=['MIGRATIONS_APPLIED','RELEASE_STARTED','GATES_PASSED'].includes(deployment.phase)
      ?openProtectedBootstrapRuntimeAuthority(authority,{deploymentId:deployment.id,checkpointSha256:sha(deployment.checkpointJson)}):undefined;
    if(!['ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING','GATES_PASSED','TRAFFIC_OPENED','COMPLETED'].includes(deployment.phase)
      &&!protectedBootstrap)fail();
    // READY is private HTTP preparation only. It does not start a second jobs
    // owner and cannot make a slot visible in the public routing census.
    if (row.phase === 'READY' && (input.scope.purpose !== 'http'
      || (!['ONLINE_READY', 'ONLINE_PUBLISHING'].includes(deployment.phase)&&!protectedBootstrap)
      || !['STARTING', 'READY'].includes(slot.phase))) fail();
    // A live deployment still needs its original unexpired lease. A completed
    // accepted release can restart without pretending its old lease is active.
    if (deployment.phase !== 'COMPLETED') {
      const leases = await tx.$queryRaw<Array<{ owned: boolean }>>`SELECT true AS owned FROM deployment_operations
        WHERE id=${deployment.id} AND "activeKey"='production' AND "leaseToken"=${deployment.leaseToken}
          AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR SHARE`;
      if (leases.length !== 1) fail();
    }
    const accepted = readOnlineReleaseEvidence(path.join(input.scope.nativeDirectory, 'release-acceptance'), {
      manifestSha256: identity.manifestSha256, acceptanceSha256: identity.acceptanceSha256,
    });
    const manifest = accepted.manifest;
    const checkpoint = deployment.checkpointJson;
    if (manifest.releaseId !== input.scope.releaseId || manifest.runtimeBundleSha256 !== input.scope.manifestSha256
      || manifest.sourceCommit !== input.scope.sourceCommit
      || manifest.image !== input.scope.image || manifest.database.name !== input.scope.database.name
      || manifest.database.systemIdentifier !== input.scope.database.systemIdentifier
      || accepted.acceptance.deploymentId !== deployment.id || sha(row.acceptanceJson) !== sha(accepted.acceptance)
      || !checkpoint || checkpoint.deploymentId !== deployment.id || checkpoint.releaseId !== manifest.releaseId
      || checkpoint.localVerified !== true || checkpoint.remoteVerified !== true || checkpoint.restoreVerified !== true
      || checkpoint.manifestReadable !== true || checkpoint.compatibility?.local?.compatible !== true
      || checkpoint.compatibility?.remote?.compatible !== true || !digest(checkpoint.checksum)
      || !Number.isSafeInteger(checkpoint.size) || checkpoint.size < 1
      || typeof checkpoint.localPath !== 'string' || typeof checkpoint.remotePath !== 'string'
      || sha(checkpoint) !== accepted.acceptance.checkpointSha256) fail();
    const [actual] = await tx.$queryRaw<Array<{ database: string; namespace: string }>>`
      SELECT current_database()::text AS database,current_setting('application_name')::text AS namespace`;
    if (actual?.database !== manifest.database.name || actual.namespace !== process.env.BACKEND_NATIVE_POSTGRES_APPLICATION_NAME) fail();
    if (loadOnlineRuntimeScope() !== input || !applicationRuntimeDatabaseUrl()
      || (deploymentMaintenanceActive(input.scope.coordinationDirectory)&&!protectedBootstrap)) fail();
    accepted.revalidate(); assertOriginalOnlineControllerAuthority(authority);
    if (Date.parse(decision.expiresAt) <= Date.now()) fail();
    // Reread actual database time after potentially slow evidence validation.
    // The original release row remains locked throughout this transaction.
    const windows = await tx.$queryRaw<Array<{ phase: string; now: Date; retiredAt: Date | null; browserSupportUntil: Date | null }>>`
      SELECT r.phase,clock_timestamp() AS now,
        CASE WHEN e.id IS NOT NULL THEN e."retiredAt" ELSE r."retiredAt" END AS "retiredAt",
        CASE WHEN e.id IS NOT NULL THEN e."supportUntil" ELSE r."browserSupportUntil" END AS "browserSupportUntil"
      FROM online_releases r LEFT JOIN LATERAL (SELECT * FROM online_serving_epochs
        WHERE "releaseId"=r.id ORDER BY generation DESC LIMIT 1) e ON true WHERE r.id=${input.scope.releaseId}`;
    if (windows.length !== 1 || windows[0].phase !== row.phase) fail();
    return { evidence: accepted, supportWindow: snapshotOnlineSupportWindow(windows[0]),protectedBootstrap };
  }, { timeout: 30_000, maxWait: 1000 });
  const capability = Object.freeze({}) as OnlineRuntimeAdmission;
  admitted.set(capability, { input, ...acceptedState, authority,database, stopped: false }); return capability;
}

export function assertOnlineRuntimeAdmission(capability: OnlineRuntimeAdmission, purpose?: 'http' | 'jobs') {
  const state = admitted.get(capability);
  if (!state || state.stopped || (purpose && state.input.scope.purpose !== purpose)
    || loadOnlineRuntimeScope() !== state.input || !applicationRuntimeDatabaseUrl()
    || (deploymentMaintenanceActive(state.input.scope.coordinationDirectory)&&!state.protectedBootstrap)) fail();
  if(state.protectedBootstrap)assertProtectedBootstrapRuntimeAuthority(state.protectedBootstrap);
  assertOriginalOnlineControllerAuthority(state.authority);
  return state.evidence.manifest;
}

/** Fixed original-parent command; a caller boolean cannot activate a runtime. */
export async function activateOnlineProtectedBootstrap(capability:OnlineRuntimeAdmission){
 assertOnlineRuntimeAdmission(capability,'http');const state=admitted.get(capability)!;
 if(!state.protectedBootstrap)fail();
 await activateProtectedBootstrapRuntimeAuthority(state.protectedBootstrap,state.database);
}
export function onlineRealtimeSuspendedForProtectedBootstrap(capability:OnlineRuntimeAdmission){
 assertOnlineRuntimeAdmission(capability,'http');const state=admitted.get(capability)!;
 return state.protectedBootstrap?protectedBootstrapRealtimeSuspended(state.protectedBootstrap):false;
}

export function stopOnlineRuntimeAdmission(capability: OnlineRuntimeAdmission) {
  const state = admitted.get(capability); if (!state) fail(); state.stopped = true;
}

/** Immutable observation from admission; it cannot extend support or confer
 * ownership. The SQL registry remains authoritative for later routing/drain. */
export function readOnlineRuntimeSupportWindow(capability: OnlineRuntimeAdmission): OnlineSupportWindow {
  assertOnlineRuntimeAdmission(capability);
  return admitted.get(capability)!.supportWindow;
}
