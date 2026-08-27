import { z } from 'zod';
import { HashSchema, IdSchema } from './primitives';

/** sha256-v1: UTF-8 JSON, UTF-16 sorted object keys, array order preserved.
 * Monetary/quantity values MUST already be canonical decimal strings. No coercion.
 * Hashes prove byte integrity, not authenticity; verify provenance in the owner.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw new TypeError('Expected canonical JSON with exact decimal strings');
}
export async function canonicalHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return 'sha256-v1:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const IdempotencySchema = z.object({ actorId: IdSchema, operation: IdSchema, targetId: IdSchema, key: IdSchema, payloadHash: HashSchema }).strict();
export type IdempotencyIdentity = z.infer<typeof IdempotencySchema>;
export function compareIdempotency(previous: IdempotencyIdentity, incoming: IdempotencyIdentity): 'REPLAY' | 'CONFLICT' | 'DISTINCT' {
  IdempotencySchema.parse(previous); IdempotencySchema.parse(incoming);
  if (previous.actorId !== incoming.actorId || previous.operation !== incoming.operation || previous.targetId !== incoming.targetId || previous.key !== incoming.key) return 'DISTINCT';
  return previous.payloadHash === incoming.payloadHash ? 'REPLAY' : 'CONFLICT';
}
