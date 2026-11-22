export interface BrowserDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Browser fallback isolation, never authentication. The caller supplies its
 * current tab's established owner. Unknown/legacy bytes remain untouched.
 * Navigation uses sessionStorage so independent tabs cannot overwrite it. */
export function createOwnerScopedBrowserStorage(storage: BrowserDraftStorage,
  currentOwner: () => string | undefined, namespace: string): BrowserDraftStorage {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(namespace)) throw Error('BROWSER_DRAFT_NAMESPACE_INVALID');
  const owner = () => {
    const value = currentOwner();
    return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
  };
  const keyFor = (userId: string, key: string) => `${namespace}:v2:${encodeURIComponent(userId)}:${encodeURIComponent(key)}`;
  const decode = (raw: string | null, userId: string, key: string): string | null => {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      return value.format === 'sabalan-owner-draft/v2' && value.userId === userId && value.key === key
        && typeof value.value === 'string' ? value.value : null;
    } catch { return null; }
  };
  return {
    getItem(key) {
      const userId = owner(); if (!userId) return null;
      const raw = storage.getItem(keyFor(userId, key));
      return owner() === userId ? decode(raw, userId, key) : null;
    },
    setItem(key, value) {
      const userId = owner(); if (!userId) throw Error('BROWSER_DRAFT_OWNER_REQUIRED');
      if (typeof value !== 'string') throw Error('BROWSER_DRAFT_VALUE_INVALID');
      const destination = keyFor(userId, key);
      const previous = storage.getItem(destination);
      if (previous !== null && decode(previous, userId, key) === null) throw Error('BROWSER_DRAFT_EXISTING_VALUE_UNKNOWN');
      const bytes = JSON.stringify({ format: 'sabalan-owner-draft/v2', userId, key, value });
      storage.setItem(destination, bytes);
      if (storage.getItem(destination) !== bytes || owner() !== userId) throw Error('BROWSER_DRAFT_WRITE_UNVERIFIED');
    },
    removeItem(key) {
      const userId = owner(); if (!userId) return;
      const destination = keyFor(userId, key);
      if (decode(storage.getItem(destination), userId, key) !== null && owner() === userId) storage.removeItem(destination);
    },
  };
}
