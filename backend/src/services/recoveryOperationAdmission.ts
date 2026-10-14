/** A control task reserves retirement before its asynchronous callback starts.
 * Snapshot mutation drain excludes its own owner; process retirement includes it. */
export class RecoveryOperationAdmission {
  private active = false;
  private closing = false;
  private readonly completed = new Set<() => void>();
  acquire() {
    if (this.active || this.closing) return false;
    this.active = true;
    return true;
  }
  release() {
    this.active = false;
    for (const complete of this.completed) complete();
    this.completed.clear();
  }
  async drain(timeoutMs: number) {
    this.closing = true;
    if (!this.active) return;
    let timer: NodeJS.Timeout | undefined;
    let complete: () => void = () => undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        complete = resolve;
        this.completed.add(complete);
        timer = setTimeout(() => reject(new Error('RECOVERY_OPERATION_DRAIN_TIMEOUT')), timeoutMs);
      });
    } finally { if (timer) clearTimeout(timer); this.completed.delete(complete); }
  }
}
