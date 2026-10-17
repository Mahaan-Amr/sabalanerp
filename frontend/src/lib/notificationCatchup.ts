/** Realtime is a hint. The authorized durable inbox supplies the state after
 * missed events, connection changes and deployment handoffs. Collapse bursts,
 * but perform one trailing read when a hint arrives during an existing read. */
export class NotificationCatchup {
  private stopped = false;
  private dirty = false;
  private running: Promise<void> | null = null;
  constructor(private read: () => Promise<void>) {}

  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.dirty = true;
    if (!this.running) {
      const run = async () => {
        while (this.dirty && !this.stopped) { this.dirty = false; await this.read(); }
      };
      const current = Promise.resolve().then(run);
      this.running = current;
      void current.then(() => { if (this.running === current) this.running = null; },
        () => { if (this.running === current) this.running = null; });
    }
    return this.running;
  }
  stop() { this.stopped = true; this.dirty = false; }
}
