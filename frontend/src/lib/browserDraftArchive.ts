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

export async function readBrowserDraftArchives(userId: string, workflow: string, draftId: string,
  assertOwner: () => void): Promise<BrowserDraftArchive[]> {
  assertOwner();
  const database = await open();
  try {
    const transaction = database.transaction(storeName, 'readonly'), done = completed(transaction);
    const selected: BrowserDraftArchive[] = [];
    let bytes = 0;
    const request = transaction.objectStore(storeName).index('ownerDraft').openCursor(IDBKeyRange.only([userId, workflow, draftId]));
    request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      const value = cursor.value as BrowserDraftArchive;
      bytes += typeof value.payloadJson === 'string' ? new TextEncoder().encode(value.payloadJson).length : 0;
      if (selected.length >= 256 || bytes > 64 * 1024 * 1024) { transaction.abort(); return; }
      selected.push(value); cursor.continue();
    };
    await done; assertOwner();
    const verified = await Promise.all(selected.map(value => verify(value, userId))); assertOwner();
    return verified.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  } finally { database.close(); }
}
