import fs from 'fs';
import path from 'path';
import { NextFunction, Request, Response } from 'express';

export const RECOVERY_ROOT = process.env.RECOVERY_STORAGE_DIR || path.join(process.cwd(), 'storage', 'recovery');
export const RECOVERY_COORDINATION_DIR = process.env.RECOVERY_COORDINATION_DIR || path.join(RECOVERY_ROOT, 'coordination');
const STATE_FILE = path.join(RECOVERY_COORDINATION_DIR, 'state.json');

type RecoveryRuntimeState = {
  mode: 'NORMAL' | 'READ_ONLY' | 'MAINTENANCE';
  operationId?: string;
  message?: string;
  updatedAt: string;
};

let memoryState: RecoveryRuntimeState = { mode: 'NORMAL', updatedAt: new Date().toISOString() };
let operationLocked = false;
let activeWrites = 0;

export const initializeRecoveryRuntime = () => {
  fs.mkdirSync(RECOVERY_COORDINATION_DIR, { recursive: true });
  try {
    memoryState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    setRecoveryRuntimeState('NORMAL');
  }
};

export const getRecoveryRuntimeState = () => {
  try {
    memoryState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    // Retain the last known in-memory state when the coordination file is transiently unavailable.
  }
  return memoryState;
};

export const setRecoveryRuntimeState = (mode: RecoveryRuntimeState['mode'], operationId?: string, message?: string) => {
  memoryState = { mode, operationId, message, updatedAt: new Date().toISOString() };
  fs.mkdirSync(RECOVERY_COORDINATION_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(memoryState), { encoding: 'utf8', mode: 0o600 });
};

export const acquireRecoveryOperation = () => {
  if (operationLocked) return false;
  operationLocked = true;
  return true;
};

export const releaseRecoveryOperation = () => {
  operationLocked = false;
};

const allowedDuringMaintenance = (req: Request) =>
  req.originalUrl.startsWith('/api/system-recovery')
  || req.originalUrl.startsWith('/api/health')
  || req.originalUrl.startsWith('/api/ready')
  || req.originalUrl.startsWith('/api/auth/logout');

export const recoveryWriteGuard = (req: Request, res: Response, next: NextFunction) => {
  const state = getRecoveryRuntimeState();
  if (allowedDuringMaintenance(req)) return next();
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
  while (activeWrites > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (activeWrites > 0) {
    throw Object.assign(new Error('Active writes did not drain before the recovery snapshot.'), { code: 'RECOVERY_WRITE_DRAIN_TIMEOUT' });
  }
};
