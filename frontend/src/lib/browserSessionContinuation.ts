export type BrowserSessionIdentity = { userId: string; sessionId: string };
export type BrowserSessionLease = BrowserSessionIdentity & { generation: number };
export type BrowserLoginAttempt = { generation: number; userId?: string };
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
const changed = () => Object.assign(new Error('برای ادامهٔ همین فرم دوباره وارد حساب خود شوید.'), { code: 'AUTH_CONTEXT_CHANGED' });
const valid = (identity: BrowserSessionIdentity) => identity && typeof identity.userId === 'string' && typeof identity.sessionId === 'string'
  && identifier.test(identity.userId) && identifier.test(identity.sessionId);

/** Tab-local denial scope. It grants no authentication and persists no tokens.
 * The backend must compare these constraints against its authoritative cookie.
 * A blocked tab retains its mounted form; recovery may only restore its owner.
 */
export class BrowserSessionContinuation {
  private owner?: string;
  private generation = 0;
  private blocked = false;
  private probing?: Promise<BrowserSessionIdentity>;
  private recoveryLease?: BrowserSessionLease;
  private listeners = new Set<() => void>();
  constructor(private readonly readSession: (expectedUserId?: string) => Promise<BrowserSessionIdentity>) {}
  snapshot = () => this.blocked ? this.owner || null : null;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { this.listeners.forEach(listener => listener()); }
  expectedUserId() { return this.owner; }
  /** A prior successful probe's tab identity for local archival only. It never
   * authorizes a network operation or substitutes for acquire(). */
  localRecoveryLease(): BrowserSessionLease | undefined {
    if (!this.recoveryLease || this.blocked || this.recoveryLease.generation !== this.generation
      || this.recoveryLease.userId !== this.owner) return undefined;
    return { ...this.recoveryLease };
  }
  beginLogin(): BrowserLoginAttempt { return { generation: this.generation, userId: this.owner }; }
  acceptBootstrap(identity: BrowserSessionIdentity, attempt: BrowserLoginAttempt) {
    if (attempt.generation !== this.generation || (attempt.userId && attempt.userId !== this.owner)) throw changed();
    return this.acceptIdentity(identity);
  }
  completeLogin(identity: BrowserSessionIdentity, attempt: BrowserLoginAttempt) {
    if (!valid(identity) || attempt.generation !== this.generation || attempt.userId !== this.owner
      || (this.owner && identity.userId !== this.owner)) throw changed();
    this.owner ??= identity.userId;
    this.generation++; this.blocked = false; this.probing = undefined; this.recoveryLease = undefined; this.notify();
  }

  invalidate(attempt?: BrowserLoginAttempt) {
    if (attempt && (attempt.generation !== this.generation || (attempt.userId && attempt.userId !== this.owner))) return;
    this.recoveryLease = undefined;
    if (!this.blocked) { this.blocked = true; this.generation++; this.notify(); }
  }

  acceptIdentity(identity: BrowserSessionIdentity) {
    if (!valid(identity) || (this.owner && this.owner !== identity.userId)) {
      this.invalidate(); throw changed();
    }
    if (this.blocked) throw changed();
    if (this.recoveryLease?.sessionId !== identity.sessionId) this.recoveryLease = undefined;
    this.owner ??= identity.userId;
    return { ...identity };
  }

  async acquire(): Promise<BrowserSessionLease> {
    if (this.blocked) throw changed();
    const generation = this.generation;
    if (!this.probing) {
      const probe = this.readSession(this.owner).then(identity => {
        if (generation !== this.generation || this.blocked) throw changed();
        return this.acceptIdentity(identity);
      });
      this.probing = probe;
      void probe.then(() => { if (this.probing === probe) this.probing = undefined; },
        () => { if (this.probing === probe) this.probing = undefined; });
    }
    try {
      const identity = await this.probing;
      if (generation !== this.generation || this.blocked) throw changed();
      const lease = { ...identity, generation }; this.recoveryLease = { ...lease }; return lease;
    } catch (error: any) {
      if (generation === this.generation && this.owner
        && (error?.code === 'AUTH_CONTEXT_CHANGED' || error?.response?.status === 401)) this.invalidate();
      throw error;
    }
  }

  assertCurrent(lease: BrowserSessionLease) {
    if (this.blocked || lease.generation !== this.generation || lease.userId !== this.owner) throw changed();
  }

  clear() {
    this.generation++; this.owner = undefined; this.blocked = false; this.probing = undefined; this.recoveryLease = undefined; this.notify();
  }
}
