import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';

export type CanonicalJsonPrimitive = string | boolean | null | CanonicalDecimal;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | CanonicalJsonObject;
export type CanonicalJsonObject = {
  readonly [key: string]: CanonicalJsonValue;
};

export const cloneCanonicalJson = <T extends CanonicalJsonValue>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => cloneCanonicalJson(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneCanonicalJson(item)])
    ) as T;
  }
  return value;
};

export const normalizeLegacyJson = (value: unknown): CanonicalJsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Legacy numeric value must be finite.');
    }
    return parseCanonicalDecimal(String(value));
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeLegacyJson(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, normalizeLegacyJson(item)])
    );
  }
  throw new TypeError(`Unsupported legacy JSON value: ${typeof value}`);
};

const stableJsonValue = (value: unknown): string => {
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new TypeError(`Unsupported stable JSON value: ${typeof value}`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Stable JSON numeric metadata must be finite.');
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJsonValue(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const objectValue = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(objectValue)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJsonValue(objectValue[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const stableCanonicalJson = (value: unknown): string =>
  stableJsonValue(value);
