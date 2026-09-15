type SessionStoragePort = Pick<Storage, 'getItem' | 'setItem'>;

const sessionKey = (actorId: string) => `sabalan-partner-editor-location:${actorId}`;
const BrowserSessionIdPattern = /^partner-browser-[A-Za-z0-9:_-]+$/;

export function getPartnerBrowserSessionId(storage: SessionStoragePort, actorId: string,
  createId: () => string = () => `partner-browser-${crypto.randomUUID()}`): string {
  const key = sessionKey(actorId);
  const existing = storage.getItem(key);
  if (existing && existing.length <= 160 && BrowserSessionIdPattern.test(existing)) return existing;
  const created = createId();
  storage.setItem(key, created);
  return created;
}
