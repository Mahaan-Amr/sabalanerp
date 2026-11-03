export class ConcurrencyBarrierTimeoutError extends Error {
  constructor(readonly barrier: string, readonly arrived: readonly string[]) {
    super(`Concurrency barrier "${barrier}" timed out; arrived: ${arrived.join(', ') || 'none'}.`);
    this.name = 'ConcurrencyBarrierTimeoutError';
  }
}

export class TwoPartyBarrier {
  readonly participants: string[] = [];
  private release?: () => void;
  private reject?: (error: Error) => void;
  private readonly waiting: Promise<void>;
  private timer?: NodeJS.Timeout;

  constructor(readonly name: string, private readonly timeoutMs = 10_000) {
    this.waiting = new Promise<void>((resolve, reject) => { this.release = resolve; this.reject = reject; });
  }

  async arrive(participant: string): Promise<void> {
    if (!participant.trim()) throw new Error(`Barrier ${this.name} requires a participant identity.`);
    if (this.participants.includes(participant)) throw new Error(`Participant ${participant} arrived twice at barrier ${this.name}.`);
    if (this.participants.length >= 2) throw new Error(`Barrier ${this.name} already released.`);
    this.participants.push(participant);
    if (this.participants.length === 1) {
      this.timer = setTimeout(() => this.reject?.(new ConcurrencyBarrierTimeoutError(this.name, [...this.participants])), this.timeoutMs);
    } else {
      if (this.timer) clearTimeout(this.timer);
      this.release?.();
    }
    return this.waiting;
  }
}
