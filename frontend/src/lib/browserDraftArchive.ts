export type BrowserDraftSnapshot = {
  userId: string;
  buildId: string;
  workflow: string;
  draftId: string;
  schemaVersion: number;
  baseRevision: number;
  payloadJson: string;
};
export type BrowserDraftArchive = BrowserDraftSnapshot & {
  format: 'sabalan-browser-draft/v1'; id: string; capturedAt: string; sha256: string;
};
export type BrowserDraftArchiveCursor = { id: string };
export type BrowserDraftArchivePage = { archives: BrowserDraftArchive[]; next: BrowserDraftArchiveCursor | null };
const databaseName = 'sabalan-browser-draft-archive';
const storeName = 'snapshots';
const fail = () => Error('BROWSER_DRAFT_ARCHIVE_UNVERIFIED');
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const content = (value: BrowserDraftArchive) => JSON.stringify([
  value.format, value.id, value.capturedAt, value.userId, value.buildId, value.workflow,
  value.draftId, value.schemaVersion, value.baseRevision, value.payloadJson,
]);
function valid(value: BrowserDraftSnapshot) {
  if (!value || typeof value.userId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.userId)
    || typeof value.buildId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.buildId)
    || typeof value.workflow !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(value.workflow)
    || typeof value.draftId !== 'string' || value.draftId.length < 1 || value.draftId.length > 256
    || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1
    || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0
    || typeof value.payloadJson !== 'string' || new TextEncoder().encode(value.payloadJson).length > 16 * 1024 * 1024) throw fail();
  JSON.parse(value.payloadJson);
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let refused = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: 'id' });
      store.createIndex('ownerDraft', ['userId', 'workflow', 'draftId']);
    };
    request.onerror = () => reject(fail());
    request.onblocked = () => { refused = true; reject(fail()); };
    request.onsuccess = () => {
      if (refused) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
  });
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(fail());
  });
}
async function verify(value: BrowserDraftArchive, userId: string) {
  valid(value);
  if (value.format !== 'sabalan-browser-draft/v1' || value.userId !== userId
    || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isFinite(Date.parse(value.capturedAt))
    || !/^[a-f0-9]{64}$/.test(value.sha256) || await hash(content(value)) !== value.sha256) throw fail();
  return value;
}

/** Immutable original-version bytes. No migration, expiry deletion, business
 * replay or cross-revision merge. A verified completed strict transaction and
 * independent read-back are required before the caller may navigate. */
export async function archiveBrowserDraft(input: BrowserDraftSnapshot, assertOwner: () => void): Promise<BrowserDraftArchive> {
  assertOwner(); valid(input);
  // Copy all primitive fields before the first await; later caller edits cannot
  // change what was archived or the digest that authorizes navigation.
  const value: BrowserDraftArchive = { ...input, format: 'sabalan-browser-draft/v1', id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(), sha256: '' };
  value.sha256 = await hash(content(value)); assertOwner();
  const database = await open();
  try {
    assertOwner();
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' });
    const written = completed(transaction);
    if (transaction.durability !== 'strict') {
      transaction.abort(); await written.catch(() => {}); throw fail();
    }
    transaction.objectStore(storeName).add(value);
    await written; assertOwner();
    const read = database.transaction(storeName, 'readonly'), done = completed(read);
    const request = read.objectStore(storeName).get(value.id);
    await done;
    const restored = await verify(request.result, input.userId); assertOwner();
    if (content(restored) !== content(value)) throw fail();
    return restored;
  } finally { database.close(); }
}

export async function readBrowserDraftArchive(userId: string, id: string, assertOwner: () => void): Promise<BrowserDraftArchive> {
  assertOwner();
  const database = await open();
  try {
    const transaction = database.transaction(storeName, 'readonly'), done = completed(transaction);
    const request = transaction.objectStore(storeName).get(id); await done; assertOwner();
    const value = await verify(request.result, userId); assertOwner(); return value;
  } finally { database.close(); }
}

export async function readBrowserDraftArchives(userId: string, workflow: string, draftId: string,
  assertOwner: () => void, before?: BrowserDraftArchiveCursor): Promise<BrowserDraftArchivePage> {
  assertOwner();
  const database = await open();
  try {
    const transaction = database.transaction(storeName, 'readonly'), done = completed(transaction);
    const selected: BrowserDraftArchive[] = [];
    let bytes = 0, next: BrowserDraftArchiveCursor | null = null;
    const key = [userId, workflow, draftId];
    // Preserve the original v1 index so retained readers can keep using this
    // database. Pagination follows the immutable primary key, not timestamps.
    // continuePrimaryKey seeks without loading every intervening payload.
    let positioned = !before;
    const request = transaction.objectStore(storeName).index('ownerDraft').openCursor(IDBKeyRange.only(key), 'prev');
    request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      if (!positioned && String(cursor.primaryKey) >= before!.id) {
        if (String(cursor.primaryKey) === before!.id) { positioned = true; cursor.continue(); }
        else cursor.continuePrimaryKey(key, before!.id);
        return;
      }
      positioned = true;
      const value = cursor.value as BrowserDraftArchive;
      const size = typeof value.payloadJson === 'string' ? new TextEncoder().encode(value.payloadJson).length : 0;
      if (selected.length >= 8 || (selected.length > 0 && bytes + size > 32 * 1024 * 1024)) {
        const last = selected[selected.length - 1]; next = { id: last.id }; return;
      }
      bytes += size;
      selected.push(value); cursor.continue();
    };
    await done; assertOwner();
    const verified = await Promise.all(selected.map(value => verify(value, userId))); assertOwner();
    return { archives: verified.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt)), next };
  } finally { database.close(); }
}
