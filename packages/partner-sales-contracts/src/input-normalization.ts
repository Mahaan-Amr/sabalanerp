import { canonicalHash } from './integrity';

/** Normalize user-entered JSON before hashing a Partner command. Keep the
 * canonical integrity algorithm unchanged for persisted evidence/snapshots. */
export function normalizePartnerInput<T>(value: T): T {
  if (typeof value === 'string') return value
    .replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/\u066B/g, '.')
    .replace(/[\u060C\u066C]/g, ',') as T;
  if (Array.isArray(value)) return value.map(item => normalizePartnerInput(item)) as T;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  // Optional cleared fields are omitted by JSON transport; hash that same payload.
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, normalizePartnerInput(item)])) as T;
}

export const partnerInputHash = (value: unknown): Promise<string> => canonicalHash(normalizePartnerInput(value));
