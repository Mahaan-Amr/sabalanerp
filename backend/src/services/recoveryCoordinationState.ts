import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type RecoveryRuntimeState = {
  mode: 'NORMAL' | 'READ_ONLY' | 'MAINTENANCE';
  operationId?: string;
  message?: string;
  updatedAt: string;
};

const invalid = () => Object.assign(new Error('RECOVERY_COORDINATION_INVALID'), { code: 'RECOVERY_COORDINATION_INVALID' });
function validate(value: any): RecoveryRuntimeState {
  if (!value || !['NORMAL', 'READ_ONLY', 'MAINTENANCE'].includes(value.mode)
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || (value.operationId !== undefined && typeof value.operationId !== 'string')
    || (value.message !== undefined && typeof value.message !== 'string')) throw invalid();
  return value;
}

/** All cooperating processes read a complete durable publication. Missing or
 * unreadable authority closes admission instead of retaining stale NORMAL. */
export class RecoveryCoordinationState {
  private readonly file: string;
  constructor(private readonly directory: string) { this.file = path.join(directory, 'state.json'); }

  private readStrict() {
    const stat = fs.lstatSync(this.file);
    if (!stat.isFile() || stat.size > 8192) throw invalid();
    return validate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
  }

  read(): RecoveryRuntimeState {
    try { return this.readStrict(); }
    catch { return { mode: 'MAINTENANCE', message: 'Recovery coordination is unavailable.', updatedAt: new Date().toISOString() }; }
  }

  initialize() {
    fs.mkdirSync(this.directory, { recursive: true });
    try { this.readStrict(); }
    catch (error: any) {
      if (error?.code !== 'ENOENT') throw invalid();
      // Exclusive creation cannot replace authority published by another owner.
      let descriptor: number;
      try { descriptor = fs.openSync(this.file, 'wx', 0o600); }
      catch (creation: any) { if (creation?.code === 'EEXIST') { this.readStrict(); return; } throw creation; }
      try {
        fs.writeFileSync(descriptor, JSON.stringify({ mode: 'NORMAL', updatedAt: new Date().toISOString() }));
        fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      this.syncDirectory();
    }
  }

  write(mode: RecoveryRuntimeState['mode'], operationId?: string, message?: string) {
    const state = validate({ mode, operationId, message, updatedAt: new Date().toISOString() });
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized) > 8192) throw invalid();
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.state-${randomUUID()}.tmp`);
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      try { fs.writeFileSync(descriptor, serialized); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, this.file);
      this.syncDirectory();
    } finally { fs.rmSync(temporary, { force: true }); }
    return state;
  }

  private syncDirectory() {
    // Windows cannot open a directory descriptor; production is Linux.
    if (process.platform === 'win32') return;
    const descriptor = fs.openSync(this.directory, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  }
}
