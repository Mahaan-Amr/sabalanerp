type Methods = Record<string, (...args: any[]) => Promise<any>>;
type SessionIdentity = { userId: string; sessionId: string };
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
export const isPrivateClientScopeFailure = (error: any) => error?.code === 'AUTH_CONTEXT_CHANGED'
  || [401, 403].includes(Number(error?.response?.status));
const changed = () => Object.assign(new Error('نشست این صفحه تغییر کرده است؛ نوشته‌هایتان را نگه دارید و دوباره وارد شوید.'), { code: 'AUTH_CONTEXT_CHANGED' });

/** The scope is a denial constraint, never authentication. Each operation gets
 * fresh authoritative identity; the backend binds the subsequent read/write to
 * that exact cookie session. Only simultaneous probes are coalesced, not data. */
export function createPrivateClient<T extends Methods>(expectedUserId: string,
  readSession: () => Promise<SessionIdentity>, factory: (headers: Record<string, string>) => T): T {
  if (typeof expectedUserId !== 'string' || !identifier.test(expectedUserId)) throw new Error('PRIVATE_CLIENT_OWNER_INVALID');
  let probing: Promise<SessionIdentity> | undefined;
  let generation = 0;
  const probe = () => {
    if (!probing) {
      const current = readSession().then(identity => {
        if (!identity || identity.userId !== expectedUserId || typeof identity.sessionId !== 'string' || !identifier.test(identity.sessionId)) {
          throw changed();
        }
        return identity;
      });
      probing = current;
      void current.then(() => { if (probing === current) probing = undefined; },
        () => { if (probing === current) probing = undefined; });
    }
    return probing;
  };
  const shape = factory({});
  return new Proxy(shape, { get(target, property) {
    if (typeof property !== 'string' || typeof target[property] !== 'function') return Reflect.get(target, property);
    return async (...args: any[]) => {
      const lease = generation;
      try {
        const identity = await probe();
        if (lease !== generation) throw changed();
        const scoped = factory({ 'x-sabalan-expected-user': expectedUserId, 'x-sabalan-expected-session': identity.sessionId });
        const result = await Reflect.apply(scoped[property], scoped, args);
        if (lease !== generation) throw changed();
        return result;
      } catch (error) {
        if (isPrivateClientScopeFailure(error)) generation++;
        throw error;
      }
    };
  } });
}
