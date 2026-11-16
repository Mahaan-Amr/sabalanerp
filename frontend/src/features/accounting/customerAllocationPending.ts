import { strictDraftJson } from '@/lib/modelDraft';
import type { AllocationDraft } from './customerAllocationPlan';

/** The persistent record is a denial lock, not permission to submit or replay. */
export type PendingAllocation = {
  format: 'sabalan-allocation-pending/v1'; owner: string; bookId: string; customerId: string;
  accountId: string; command: Record<string, unknown>; draft: AllocationDraft; digest: string;
};
type PendingInput = Omit<PendingAllocation, 'format' | 'digest'>;
const databaseName = 'sabalan-allocation-pending';
const storeName = 'commands';
const fail = () => new Error('ALLOCATION_PENDING_UNVERIFIED');
const key = (bookId: string, customerId: string) => JSON.stringify([bookId, customerId]);
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (row: PendingInput) => strictDraftJson(row);
function validate(value: unknown): PendingAllocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  const row = value as PendingAllocation;
  if (Object.keys(row).sort().join(',') !== 'accountId,bookId,command,customerId,digest,draft,format,owner'
    || row.format !== 'sabalan-allocation-pending/v1' || !/^[a-f0-9]{64}$/.test(row.digest)) throw fail();
  for (const id of [row.owner, row.bookId, row.customerId, row.accountId]) if (typeof id !== 'string' || !id || id.length > 256) throw fail();
  const command = row.command;
  if (!command || typeof command !== 'object' || Array.isArray(command)
    || Object.keys(command).sort().join(',') !== 'allocations,amountRials,confirmed,idempotencyKey,kind,occurredAt,periodId,postingRuleId,reason,reference,sourceAllocations'
    || command.kind !== 'ALLOCATION' || command.amountRials !== '0' || command.confirmed !== true
    || typeof command.idempotencyKey !== 'string' || !/^[a-f0-9-]{36}$/.test(command.idempotencyKey)
    || !Array.isArray(command.allocations) || command.allocations.length !== 0 || !Array.isArray(command.sourceAllocations)) throw fail();
  for (const field of ['occurredAt', 'periodId', 'postingRuleId', 'reason', 'reference']) if (typeof command[field] !== 'string' || !command[field] || (command[field] as string).length > 4096) throw fail();
  if (!row.draft || Object.keys(row.draft).sort().join(',') !== 'amounts,budgets,enabled,selected'
    || !Array.isArray(row.draft.selected) || !Array.isArray(row.draft.enabled)
    || !row.draft.selected.every(value => typeof value === 'string') || !row.draft.enabled.every(value => typeof value === 'string')
    || !row.draft.amounts || !row.draft.budgets || typeof row.draft.amounts !== 'object' || typeof row.draft.budgets !== 'object'
    || Array.isArray(row.draft.amounts) || Array.isArray(row.draft.budgets)
    || !Object.values(row.draft.amounts).every(value => typeof value === 'string') || !Object.values(row.draft.budgets).every(value => typeof value === 'string')) throw fail();
  strictDraftJson({ owner: row.owner, bookId: row.bookId, customerId: row.customerId, accountId: row.accountId, command, draft: row.draft });
  return row;
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let refused = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(fail());
    request.onblocked = () => { refused = true; reject(fail()); };
    request.onsuccess = () => { if (refused) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(fail()); });
}
async function verified(row: unknown, assertOwner: () => void): Promise<PendingAllocation> {
  const result = validate(row); const { format: _format, digest: expected, ...input } = result;
  if (await digest(bytes(input)) !== expected) throw fail();
  assertOwner(); return result;
}

export async function readPendingAllocation(bookId: string, customerId: string, assertOwner: () => void): Promise<PendingAllocation | null> {
  assertOwner(); const database = await open();
  try {
    const transaction = database.transaction(storeName, 'readonly'), done = completed(transaction);
    const request = transaction.objectStore(storeName).get(key(bookId, customerId)); await done; assertOwner();
    if (request.result === undefined) return null;
    const row = await verified(request.result, assertOwner);
    if (row.bookId !== bookId || row.customerId !== customerId) throw fail();
    return row;
  } finally { database.close(); }
}

/** Persist and independently verify the exact request before any network dispatch. */
export async function reservePendingAllocation(input: PendingInput, assertOwner: () => void): Promise<PendingAllocation> {
  assertOwner(); const payload = bytes(input);
  const row: PendingAllocation = { ...input, format: 'sabalan-allocation-pending/v1', digest: await digest(payload) };
  validate(row); assertOwner(); const database = await open();
  try {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' }), done = completed(transaction);
    if (transaction.durability !== 'strict') { transaction.abort(); await done.catch(() => {}); throw fail(); }
    transaction.objectStore(storeName).add(row, key(input.bookId, input.customerId)); await done; assertOwner();
  } finally { database.close(); }
  const saved = await readPendingAllocation(input.bookId, input.customerId, assertOwner);
  if (!saved || saved.digest !== row.digest || bytes(input) !== payload) throw fail();
  return saved;
}

/** Only the exact previously verified record can be retired after a proven outcome. */
export async function retirePendingAllocation(row: PendingAllocation, assertOwner: () => void): Promise<void> {
  assertOwner(); const expected = await verified(row, assertOwner); const database = await open();
  try {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' }), done = completed(transaction);
    if (transaction.durability !== 'strict') { transaction.abort(); await done.catch(() => {}); throw fail(); }
    const store = transaction.objectStore(storeName), request = store.get(key(row.bookId, row.customerId));
    request.onsuccess = () => { try { if (!request.result || strictDraftJson(request.result) !== strictDraftJson(expected)) transaction.abort(); else store.delete(key(row.bookId, row.customerId)); } catch { transaction.abort(); } };
    await done; assertOwner();
  } finally { database.close(); }
}
