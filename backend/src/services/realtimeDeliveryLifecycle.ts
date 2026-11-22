import type { PrismaClient } from '@prisma/client';
import { parseCookies, readAuthoritativeSession, SESSION_COOKIE } from './identitySessionService';
import { filterCurrentlyAuthorizedNotifications } from './notificationAuthorization';
import { readNotificationAuthorityDeadline } from './notificationAuthorityDeadline';
import { performance } from 'node:perf_hooks';

const CLOCK_SAFETY_MS = 1000;
type AuthorityFence = { snapshot: string; now: Date };

export interface RealtimeSocket {
  handshake: { headers: { cookie?: string }; auth?: { expectedUserId?: unknown } };
  data: { userId?: string };
  connected: boolean;
  emit: (event: string, payload: unknown) => unknown;
  disconnect: (close?: boolean) => unknown;
}

async function completeAll(tasks: Promise<unknown>[]) {
  const completed = await Promise.allSettled(tasks);
  const failed = completed.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Realtime reads have completion ownership too. A response, timer cancellation
 * or client disconnect cannot stand in for completion of authorization queries.
 * Stop this group only after HTTP, recovery tasks and background producers drain. */
export class RealtimeDeliveryLifecycle {
  private stopping = false;
  private tasks = new Set<Promise<unknown>>();
  constructor(private database: PrismaClient, private sockets: () => Iterable<RealtimeSocket>,
    private authorizeHr: (userId: string) => Promise<boolean>, private admit: () => boolean,
    private execute: <T>(work: () => Promise<T>) => Promise<T> = work => work()) {}

  private async submit<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping) throw new Error('REALTIME_DELIVERY_STOPPING');
    if (!this.admit()) throw new Error('REALTIME_DELIVERY_UNAVAILABLE');
    const task = Promise.resolve().then(() => this.execute(work));
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    return task;
  }

  private async session(socket: RealtimeSocket) {
    if (!this.admit()) throw new Error('REALTIME_DELIVERY_UNAVAILABLE');
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    const session = token ? await readAuthoritativeSession(this.database, token) : null;
    if (!session || (socket.data.userId && session.userId !== socket.data.userId)) {
      socket.disconnect(true);
      return null;
    }
    return session;
  }

  async authenticate(socket: RealtimeSocket) {
    return this.submit(async () => {
      const session = await this.session(socket);
      if (!session) throw new Error('REALTIME_AUTHENTICATION_REQUIRED');
      const expectedUser = socket.handshake.auth?.expectedUserId;
      if (expectedUser !== undefined && expectedUser !== session.userId) {
        socket.disconnect(true);
        throw new Error('REALTIME_AUTH_CONTEXT_CHANGED');
      }
      socket.data.userId = session.userId;
    });
  }

  private async authorizedEmit(socket: RealtimeSocket, userId: string, event: string,
    resolve: (session: NonNullable<Awaited<ReturnType<typeof readAuthoritativeSession>>>) => Promise<unknown | null>) {
    if (!userId) return;
    const beganAt = Date.now(), beganMonotonic = performance.now();
    const [before] = await this.database.$queryRaw<AuthorityFence[]>`SELECT pg_current_snapshot()::text AS snapshot, clock_timestamp() AS now`;
    if (!before || !(before.now instanceof Date) || !Number.isFinite(before.now.getTime()) || performance.now() - beganMonotonic > CLOCK_SAFETY_MS
      || before.now.getTime() < beganAt - CLOCK_SAFETY_MS || before.now.getTime() > Date.now() + CLOCK_SAFETY_MS) return;
    // Partner authority uses database time; other current readers use the
    // application clock. Refuse unbounded skew and close validity early by
    // the proven clock margin, rather than guessing a fixed grant lifetime.
    const deadline = await readNotificationAuthorityDeadline(this.database, userId,
      new Date(before.now.getTime() - CLOCK_SAFETY_MS));
    const session = await this.session(socket);
    if (!session) return;
    const payload = await resolve(session);
    if (payload === null) return;
    // Session and resource checks can each wait on the database. An MVCC
    // fence detects a concurrent commit during either check, including
    // session revocation which need not change the user's role. Fail closed
    // on any snapshot change; durable inbox/catch-up owns missed realtime.
    // This final read is the authorization linearization point. A commit
    // after it is concurrent with the admitted emission, not an earlier grant.
    const finalSentAt = performance.now();
    const [after] = await this.database.$queryRaw<AuthorityFence[]>`SELECT pg_current_snapshot()::text AS snapshot, clock_timestamp() AS now`;
    if (!before?.snapshot || before.snapshot !== after?.snapshot) return;
    const roundTrip = performance.now() - finalSentAt;
    if (!(after.now instanceof Date) || !Number.isFinite(after.now.getTime()) || roundTrip > CLOCK_SAFETY_MS || Math.abs(after.now.getTime() - Date.now()) > CLOCK_SAFETY_MS
      || Math.abs((Date.now() - beganAt) - (performance.now() - beganMonotonic)) > CLOCK_SAFETY_MS) return;
    const now = new Date(Math.max(Date.now(), after.now.getTime() + roundTrip) + CLOCK_SAFETY_MS);
    if (deadline && deadline <= now) return;
    if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) { socket.disconnect(true); return; }
    if (this.admit() && socket.connected) socket.emit(event, payload);
  }

  async notify(userId: string, notificationId: string) {
    return this.submit(async () => {
      await completeAll([...this.sockets()].filter(socket => socket.data.userId === userId).map(socket =>
        this.authorizedEmit(socket, userId, 'notification.created', async session => {
          const current = await this.database.notification.findUnique({ where: { id: notificationId }, include: { event: true } });
          if (!current || current.userId !== userId
            || !(await filterCurrentlyAuthorizedNotifications(this.database, session.user, [current])).length) return null;
          const { event: _event, ...payload } = current;
          return payload;
        })));
    });
  }

  async invalidate(event: string) {
    return this.submit(async () => {
      await completeAll([...this.sockets()].map(socket => this.authorizedEmit(socket, socket.data.userId || '', event, async session => {
        if (!await this.authorizeHr(session.userId) || !await this.session(socket)) return null;
        return {};
      })));
    });
  }

  async stop(timeoutMs: number) {
    this.stopping = true;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('REALTIME_DRAIN_TIMEOUT');
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([Promise.allSettled([...this.tasks]), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('REALTIME_DRAIN_TIMEOUT')), timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
