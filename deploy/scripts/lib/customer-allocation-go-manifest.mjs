import { createHash, verify } from 'node:crypto';

const reject = () => { throw new Error('CUSTOMER_ALLOCATION_GO_REJECTED'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, keys) => object(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const nonempty = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const images = value => object(value) && Object.keys(value).length > 0 &&
  Object.keys(value).every(name => nonempty(name) && /^sha256:[0-9a-f]{64}$/.test(value[name]));
const evidence = value => exactKeys(value, ['reader', 'populatedQa', 'rollback']) &&
  Object.values(value).every(hash => hex(hash, 64));
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Canonical bytes are the signature domain. No JSON whitespace or property order is trusted.
export function canonicalGoPayload(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalGoPayload).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalGoPayload(value[key])}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isSafeInteger(value))) return JSON.stringify(value);
  reject();
}

/** Offline decision check only. The caller must obtain `observed` from one locked
 * deployment_operations read and sample dbClock with clock_timestamp() after the lock.
 * This function does not mutate or authorize the durable control row. */
export function verifyCustomerAllocationGoManifest(envelope, observed, trustedApprover) {
  if (!exactKeys(envelope, ['payload', 'signature']) || !object(observed) || !object(trustedApprover)) reject();
  const p = envelope.payload;
  if (!exactKeys(p, ['schemaVersion', 'decision', 'operation', 'keyId', 'issuedAt', 'expiresAt',
    'releaseId', 'deploymentId', 'candidateCommit', 'candidateTree', 'inquiryCommit', 'migrationSha256',
    'candidateImages', 'predecessorImages', 'cohortSha256', 'evidence'])) reject();
  if (p.schemaVersion !== 1 || p.decision !== 'GO' || p.operation !== 'GROUPED_ALLOCATION' ||
    !nonempty(p.keyId) || p.keyId !== trustedApprover.keyId || !trustedApprover.publicKey ||
    !timestamp(p.issuedAt) || !timestamp(p.expiresAt) || !timestamp(observed.dbClock) ||
    !timestamp(observed.leaseExpiresAt) || !nonempty(p.releaseId) || !nonempty(p.deploymentId) ||
    !hex(p.candidateCommit, 40) || !hex(p.candidateTree, 40) || !hex(p.inquiryCommit, 40) ||
    !hex(p.migrationSha256, 64) || !hex(p.cohortSha256, 64) || !images(p.candidateImages) ||
    !images(p.predecessorImages) || !evidence(p.evidence)) reject();
  const now = Date.parse(observed.dbClock), issued = Date.parse(p.issuedAt), expires = Date.parse(p.expiresAt);
  if (issued > now || expires <= now || expires <= issued || expires - issued > 5 * 60_000 ||
    Date.parse(observed.leaseExpiresAt) <= now + 20_000 || observed.phase !== 'MIGRATIONS_APPLIED' ||
    observed.activeKey !== 'production' || observed.controlState !== 'CLOSED' || !nonempty(observed.leaseToken)) reject();
  if (observed.targetCommit !== p.candidateCommit) reject();
  for (const key of ['releaseId', 'deploymentId', 'candidateCommit', 'candidateTree', 'inquiryCommit',
    'migrationSha256', 'cohortSha256']) if (p[key] !== observed[key]) reject();
  for (const key of ['candidateImages', 'predecessorImages', 'evidence']) {
    if (!exactKeys(p[key], Object.keys(observed[key] ?? {})) ||
      canonicalGoPayload(p[key]) !== canonicalGoPayload(observed[key])) reject();
  }
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) reject();
  const bytes = Buffer.from(canonicalGoPayload(p));
  try {
    if (!verify(null, bytes, trustedApprover.publicKey, Buffer.from(envelope.signature, 'base64'))) reject();
  } catch { reject(); }
  return Object.freeze({ manifestSha256: createHash('sha256').update(bytes).digest('hex'),
    releaseId: p.releaseId, deploymentId: p.deploymentId, expiresAt: p.expiresAt });
}
