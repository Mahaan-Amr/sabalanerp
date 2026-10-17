import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export type KernelGateIdentity = { device: string; inode: string; ownerUid: number };
export type KernelWriteLease = { release(): void };
const failure = (code: string) => Object.assign(new Error(code), { code });

/** Linux shared-open-description lock, not a lease-expiry or promotion API.
 * The owned controller must provision/freeze this inode, reject orphaned work,
 * and prove PostgreSQL completion before declaring a coherent boundary. An
 * inherited flock utility exits after admission; this process retains the same
 * open file description until actual application work has finished.
 */
export class KernelWriteAdmission {
  private readonly owned = new Set<number>();
  private readonly helpers = new Set<Promise<void>>();
  private poisoned = false;

  constructor(private readonly file: string, private readonly expected: KernelGateIdentity,
    private readonly assertOwner: () => void) {
    if (process.platform !== 'linux') throw failure('KERNEL_WRITE_GATE_LINUX_REQUIRED');
    if (!path.isAbsolute(file) || path.basename(file) !== 'deployment-write-admission.lock'
      || !/^[1-9][0-9]{0,24}$/.test(expected.device) || !/^[1-9][0-9]{0,24}$/.test(expected.inode)
      || !Number.isSafeInteger(expected.ownerUid) || expected.ownerUid < 0 || typeof assertOwner !== 'function') {
      throw failure('KERNEL_WRITE_GATE_IDENTITY_REQUIRED');
    }
    this.expected = Object.freeze({ ...expected });
    this.assertNamed();
  }

  identity(): KernelGateIdentity { return { ...this.expected }; }

  private matches(value: fs.BigIntStats) {
    return value.isFile() && value.dev.toString() === this.expected.device && value.ino.toString() === this.expected.inode
      && value.uid === BigInt(this.expected.ownerUid) && value.nlink === 1n && value.size === 0n && (value.mode & 0o022n) === 0n;
  }

  private assertNamed() {
    const parent = path.dirname(this.file), directory = fs.lstatSync(parent, { bigint: true });
    if (fs.realpathSync(this.file) !== this.file || !directory.isDirectory()
      || directory.uid !== BigInt(this.expected.ownerUid) || (directory.mode & 0o022n) !== 0n
      || !this.matches(fs.lstatSync(this.file, { bigint: true }))) throw failure('KERNEL_WRITE_GATE_REPLACED');
  }

  private assertDescriptor(descriptor: number, locked: boolean) {
    if (!this.matches(fs.fstatSync(descriptor, { bigint: true }))) throw failure('KERNEL_WRITE_GATE_DESCRIPTOR_CHANGED');
    if (locked) {
      const details = fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8');
      const locks = [...details.matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+READ\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)];
      if (!locks.some(lock => lock[1] === this.expected.inode)) throw failure('KERNEL_WRITE_GATE_LOCK_UNPROVEN');
    }
  }

  private async lock(descriptor: number) {
    // Descriptor 3 duplicates our open file description, exactly as the control
    // wrapper's inherited FD9. No shell, child command, paths or environment
    // supplied by a request are executed. Never infer reaping from a timeout.
    const helper = new Promise<void>((resolve, reject) => {
      const child = spawn('/usr/bin/flock', ['--shared', '--nonblock', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', descriptor], env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      });
      let error: Error | undefined, late = false;
      const timer = setTimeout(() => { late = true; this.poisoned = true; }, 1000);
      child.once('error', value => { error = value; });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (late) reject(failure('KERNEL_WRITE_GATE_HELPER_DEADLINE'));
        else if (error || signal || (code !== 0 && code !== 1)) reject(failure('KERNEL_WRITE_GATE_HELPER_FAILED'));
        else if (code === 1) reject(failure('KERNEL_WRITE_GATE_BOUNDARY_ACTIVE'));
        else resolve();
      });
    });
    this.helpers.add(helper);
    void helper.then(() => this.helpers.delete(helper), () => this.helpers.delete(helper));
    await helper;
  }

  async acquire(): Promise<KernelWriteLease> {
    if (this.poisoned) throw failure('KERNEL_WRITE_GATE_OWNERSHIP_UNPROVEN');
    this.assertOwner();
    this.assertNamed();
    const descriptor = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      this.assertDescriptor(descriptor, false);
      await this.lock(descriptor);
      this.assertNamed();
      this.assertDescriptor(descriptor, true);
      if (this.poisoned) throw failure('KERNEL_WRITE_GATE_OWNERSHIP_UNPROVEN');
      this.assertOwner();
    } catch (error) {
      // No application work has been admitted. lock() returns/rejects only after
      // the direct helper is reaped; a hung helper keeps this promise pending.
      fs.closeSync(descriptor);
      throw error;
    }
    this.owned.add(descriptor);
    let released = false;
    return { release: () => {
      if (released) throw failure('KERNEL_WRITE_GATE_ALREADY_RELEASED');
      try {
        this.assertNamed();
        this.assertDescriptor(descriptor, true);
        fs.closeSync(descriptor);
        released = true;
        this.owned.delete(descriptor);
      } catch (error) {
        // Do not unlock, close a possibly reused FD or declare retirement on
        // uncertain ownership. The caller's durable operation remains pending.
        this.poisoned = true;
        throw error;
      }
    } };
  }

  async drain(timeoutMs: number) {
    const deadline = performance.now() + timeoutMs;
    while ((this.helpers.size || this.owned.size) && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (this.helpers.size || this.owned.size || this.poisoned) throw failure('KERNEL_WRITE_GATE_DRAIN_UNPROVEN');
  }
}
