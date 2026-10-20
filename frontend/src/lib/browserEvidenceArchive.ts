/** Separate v1 database: retained text-draft readers must never need an upgrade.
 * Local recovery only; these records grant no authentication or upload authority. */
export type BrowserEvidenceScope = Readonly<{ userId: string; sessionId: string; tabId: string; draftId: string }>;
export type BrowserEvidenceReference = BrowserEvidenceScope & Readonly<{
  format: 'sabalan-browser-evidence/v1'; id: string; capturedAt: string;
  name: string; type: string; size: number; lastModified: number; sha256: string; metadataSha256: string;
}>;
type StoredEvidence = BrowserEvidenceReference & { blob: Blob };
const databaseName = 'sabalan-browser-evidence-archive';
const storeName = 'evidence';
const fail = () => Error('BROWSER_EVIDENCE_ARCHIVE_UNVERIFIED');
const scopeKeys = ['userId', 'sessionId', 'tabId', 'draftId'] as const;
const digest = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
function validScope(scope: BrowserEvidenceScope) {
  if (!scope || scopeKeys.some(key => typeof scope[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(scope[key]))) throw fail();
}
function metadata(value: BrowserEvidenceReference): string {
  return JSON.stringify([value.format, value.id, value.capturedAt, ...scopeKeys.map(key => value[key]),
    value.name, value.type, value.size, value.lastModified, value.sha256]);
}
function validReference(value: BrowserEvidenceReference, scope: BrowserEvidenceScope) {
  validScope(scope); validScope(value);
  if (scopeKeys.some(key => value[key] !== scope[key]) || value.format !== 'sabalan-browser-evidence/v1'
    || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isFinite(Date.parse(value.capturedAt))
    || typeof value.name !== 'string' || !value.name || value.name.length > 512
    || typeof value.type !== 'string' || value.type.length > 256
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 25 * 1024 * 1024
    || !Number.isSafeInteger(value.lastModified) || value.lastModified < 0
    || !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{64}$/.test(value.metadataSha256)) throw fail();
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let refused = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onerror = () => reject(fail());
    request.onblocked = () => { refused = true; reject(fail()); };
    request.onsuccess = () => {
      if (refused) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(fail());
  });
}
async function verified(value: StoredEvidence, scope: BrowserEvidenceScope, expected: BrowserEvidenceReference,
  assertOwner: () => void): Promise<File> {
  validReference(value, scope); validReference(expected, scope);
  if (metadata(value) !== metadata(expected) || value.metadataSha256 !== expected.metadataSha256
    || await digest(new TextEncoder().encode(metadata(value))) !== value.metadataSha256
    || !(value.blob instanceof Blob) || value.blob.size !== value.size || value.blob.type !== value.type) throw fail();
  assertOwner();
  if (await digest(await value.blob.arrayBuffer()) !== value.sha256) throw fail();
  assertOwner();
  return new File([value.blob], value.name, { type: value.type, lastModified: value.lastModified });
}
/** Immutable bytes, strict commit, then independent read-back before returning
 * a reference that may be placed in a text draft. No expiry deletion or replay. */
export async function archiveBrowserEvidence(scope: BrowserEvidenceScope, file: File,
  assertOwner: () => void): Promise<BrowserEvidenceReference> {
  assertOwner(); validScope(scope);
  if (!(file instanceof File) || file.size < 1 || file.size > 25 * 1024 * 1024) throw fail();
  const owner = { userId: scope.userId, sessionId: scope.sessionId, tabId: scope.tabId, draftId: scope.draftId };
  const captured = { ...owner, format: 'sabalan-browser-evidence/v1' as const, id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(), name: file.name, type: file.type, size: file.size,
    lastModified: file.lastModified, blob: file.slice(0, file.size, file.type) };
  const sha256 = await digest(await captured.blob.arrayBuffer()); assertOwner();
  const hashed = { ...captured, sha256, metadataSha256: '' };
  const metadataSha256 = await digest(new TextEncoder().encode(metadata(hashed))); assertOwner();
  const value: StoredEvidence = { ...hashed, metadataSha256 };
  validReference(value, owner);
  const { blob: _blob, ...reference } = value;
  const database = await open();
  try {
    assertOwner();
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' });
    const written = completed(transaction);
    if (transaction.durability !== 'strict') { transaction.abort(); await written.catch(() => {}); throw fail(); }
    transaction.objectStore(storeName).add(value); await written; assertOwner();
  } finally { database.close(); }
  await readBrowserEvidence(owner, reference, assertOwner); assertOwner();
  return Object.freeze(reference);
}
export async function readBrowserEvidence(scope: BrowserEvidenceScope, reference: BrowserEvidenceReference,
  assertOwner: () => void): Promise<File> {
  assertOwner();
  const owner = { userId: scope.userId, sessionId: scope.sessionId, tabId: scope.tabId, draftId: scope.draftId };
  const expected = { ...reference }; validReference(expected, owner);
  const database = await open();
  try {
    assertOwner();
    const transaction = database.transaction(storeName, 'readonly'), done = completed(transaction);
    const request = transaction.objectStore(storeName).get(expected.id); await done; assertOwner();
    return await verified(request.result, owner, expected, assertOwner);
  } finally { database.close(); }
}
