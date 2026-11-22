import path from 'path';
import { NextFunction, Request, Response } from 'express';
import { deploymentMaintenanceActive } from './deploymentMaintenance';
import { bindRuntimeHttpWriteAdmission, runtimeHttpRequests } from './httpRequestLifecycle';
import { RecoveryCoordinationState, RecoveryRuntimeState } from './recoveryCoordinationState';
import { RecoveryOperationAdmission } from './recoveryOperationAdmission';
import { assertRuntimeControlAdmission } from './runtimeControlOwnership';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { applicationRuntimeDatabaseUrl } from './runtimeNativeAuthority';

export const RECOVERY_ROOT = process.env.RECOVERY_STORAGE_DIR || path.join(process.cwd(), 'storage', 'recovery');
export const RECOVERY_COORDINATION_DIR = process.env.RECOVERY_COORDINATION_DIR || path.join(RECOVERY_ROOT, 'coordination');
const coordinationState = new RecoveryCoordinationState(RECOVERY_COORDINATION_DIR);
const recoveryOperations = new RecoveryOperationAdmission();
let activeWrites = 0;
let backgroundObserved = false;
let scopedBackground: { boundary: RuntimeWorkBoundary; assertOwner: () => void } | undefined;

/** Private native composition, before any background admission. This does not
 * start jobs, initialize coordination, publish a role or grant control access. */
export const bindScopedRecoveryBackgroundOwner = (boundary: RuntimeWorkBoundary) => {
  const failure = () => new Error('SCOPED_BACKGROUND_OWNER_UNPROVEN');
  const input = loadOnlineRuntimeScope();
  if (backgroundObserved || scopedBackground || !(boundary instanceof RuntimeWorkBoundary)
    || boundary.requests !== runtimeHttpRequests || !input || input.scope.purpose !== 'jobs'
    || input.scope.role !== 'control' || RECOVERY_COORDINATION_DIR !== input.scope.coordinationDirectory) throw failure();
  const assertOwner = () => {
    if (loadOnlineRuntimeScope() !== input || !applicationRuntimeDatabaseUrl()) throw failure();
    const gate = boundary.context.gateIdentity();
    if (gate.device !== input.scope.gate.device || gate.inode !== input.scope.gate.inode
      || gate.ownerUid !== input.scope.gate.ownerUid) throw failure();
  };
  assertOwner();
  scopedBackground = { boundary, assertOwner };
};

/** Background mutations share the same maintenance admission and drain as HTTP writes.
 * Check and register synchronously, before awaiting work; recovery cannot see a
 * drained system while an admitted background write is still running. */
export const withRecoveryBackgroundWrite = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
  backgroundObserved = true;
  if (scopedBackground) {
    const owner = scopedBackground;
    owner.assertOwner();
    return owner.boundary.runBackground(async () => {
      owner.assertOwner();
      if (getRecoveryRuntimeState().mode !== 'NORMAL' || deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR)) return undefined;
      activeWrites += 1;
      try { return await work(); }
      finally { activeWrites -= 1; }
    });
  }
  if (getRecoveryRuntimeState().mode !== 'NORMAL' || deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR)) return undefined;
  assertRuntimeControlAdmission();
  activeWrites += 1;
  try { return await work(); }
  finally { activeWrites = Math.max(0, activeWrites - 1); }
};

export const initializeRecoveryRuntime = () => {
  coordinationState.initialize();
};

export const getRecoveryRuntimeState = () => {
  return coordinationState.read();
};

export const setRecoveryRuntimeState = (mode: RecoveryRuntimeState['mode'], operationId?: string, message?: string) => {
  coordinationState.write(mode, operationId, message);
};

export const acquireRecoveryOperation = () => {
  assertRuntimeControlAdmission();
  return recoveryOperations.acquire();
};

export const releaseRecoveryOperation = () => {
  recoveryOperations.release();
};

export const waitForRecoveryOperationDrain = (timeoutMs = 240_000) => recoveryOperations.drain(timeoutMs);

const allowedDuringMaintenance = (req: Request) =>
  req.originalUrl.startsWith('/api/system-recovery')
  || req.originalUrl.startsWith('/api/health')
  || req.originalUrl.startsWith('/api/ready')
  || req.originalUrl.startsWith('/api/auth/logout');

export const recoveryWriteGuard = (req: Request, res: Response, next: NextFunction) => {
  const state = getRecoveryRuntimeState();
  if (allowedDuringMaintenance(req)) return next();
  if (deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR)) {
    res.status(503).json({
      success: false,
      error: 'DEPLOYMENT_MAINTENANCE',
      message: 'A verified deployment is in progress.',
    });
    return;
  }
  if (state.mode === 'NORMAL') {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      activeWrites += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        activeWrites = Math.max(0, activeWrites - 1);
      };
      res.once('finish', release);
      res.once('close', release);
    }
    return next();
  }
  if (state.mode === 'READ_ONLY' && ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  res.status(503).json({
    success: false,
    error: state.mode === 'READ_ONLY' ? 'SYSTEM_RECOVERY_READ_ONLY' : 'SYSTEM_RECOVERY_MAINTENANCE',
    message: state.message || 'System recovery is in progress.',
    recovery: state,
  });
};

export const waitForActiveWrites = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  await runtimeHttpRequests.waitForWriteDrain(timeoutMs);
  while (activeWrites > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (activeWrites > 0) {
    throw Object.assign(new Error('Active writes did not drain before the recovery snapshot.'), { code: 'RECOVERY_WRITE_DRAIN_TIMEOUT' });
  }
};

bindRuntimeHttpWriteAdmission(() => getRecoveryRuntimeState().mode === 'NORMAL'
  && !deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR));
