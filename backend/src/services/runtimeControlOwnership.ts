import fs from 'node:fs';
import path from 'node:path';

/** Development npm processes do not participate in production control handoff. */
export function assertRuntimeControlAdmission(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV === 'production' || environment.BACKEND_RUNTIME_ROLE === 'control') {
    assertRuntimeControlOwnership(environment);
  }
}

/** Prove an already-held kernel lock on this runtime's own inherited FD.
 * Opening a matching file or acquiring an unowned descriptor is not proof.
 * Call before control initialization and every managed control/job admission. */
export function assertRuntimeControlOwnership(environment: NodeJS.ProcessEnv = process.env) {
  const failure = () => Object.assign(new Error('RUNTIME_CONTROL_OWNERSHIP_REQUIRED'), { code: 'RUNTIME_CONTROL_OWNERSHIP_REQUIRED' });
  try {
    const role = environment.BACKEND_RUNTIME_ROLE || 'standalone';
    if (process.platform !== 'linux' || !['standalone', 'control'].includes(role)
      || environment.BACKEND_CONTROL_LOCK_FD !== '9') throw failure();
    const file = environment.BACKEND_CONTROL_LOCK_FILE;
    const directory = environment.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination';
    if (!file || file !== path.join(directory, 'deployment-runtime-control.lock')
      || fs.realpathSync(file) !== file) throw failure();
    const named = fs.statSync(file, { bigint: true });
    const inherited = fs.fstatSync(9, { bigint: true });
    if (!inherited.isFile() || inherited.dev !== named.dev || inherited.ino !== named.ino
      || inherited.nlink !== 1n || (inherited.mode & 0o022n) !== 0n
      || inherited.uid !== BigInt(process.getuid!())) throw failure();
    const info = fs.readFileSync('/proc/self/fdinfo/9', 'utf8');
    const locks = [...info.matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)];
    if (!locks.some(lock => lock[1] === inherited.ino.toString())) throw failure();
  } catch { throw failure(); }
}
