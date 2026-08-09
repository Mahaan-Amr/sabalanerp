import { createHash } from 'node:crypto';

export const stableCanonicalEvidenceJson = (value: unknown): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical evidence contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableCanonicalEvidenceJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${stableCanonicalEvidenceJson(record[key])}`).join(',')}}`;
  }
  throw new Error('Canonical evidence contains an unsupported value.');
};

export const hashCanonicalEvidence = (value: unknown): string =>
  createHash('sha256').update(stableCanonicalEvidenceJson(value)).digest('hex');
