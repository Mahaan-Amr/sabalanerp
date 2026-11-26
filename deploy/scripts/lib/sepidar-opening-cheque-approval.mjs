import { createHash, verify } from 'node:crypto';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';

const reject = () => { throw new Error('SEPIDAR_CHEQUE_BATCH_APPROVAL_REJECTED'); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const hexadecimal = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const image = value => typeof value === 'string' && value.startsWith('sha256:') && hexadecimal(value.slice(7), 64);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

const deploymentFields = ['releaseId', 'deploymentId', 'buildCommit', 'migrationSha256', 'candidateImage',
  'retainedImage', 'checkpointHash', 'qualificationHash'];
const batchFields = ['bookId', 'actorId', 'fiscalYearId', 'periodId', 'clearingAccountId', 'custodyFinancialAccountId',
  'basisAt', 'sourceSha256', 'planSha256', 'preparationSha256', 'accountingApprovalSha256',
  'instrumentCount', 'eventCount', 'openingRials'];
const identityFields = [...deploymentFields, ...batchFields];

/** Validate a cheque-specific decision against a separately read batch and the owned release. */
export function verifySepidarOpeningChequeBatchApproval(envelope, observed, approver) {
  if (!exact(envelope, ['payload', 'signature']) || !observed || !approver) reject();
  const { payload, signature } = envelope;
  if (!exact(payload, [...identityFields, 'format', 'decision', 'keyId', 'issuedAt', 'expiresAt'])) reject();

  if (payload.format !== 'sepidar-opening-cheque-batch-approval-v1' || payload.decision !== 'GO'
    || !text(payload.keyId) || payload.keyId !== approver.keyId || approver.publicKey?.asymmetricKeyType !== 'ed25519'
    || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)
    || ![payload.releaseId, payload.deploymentId, payload.bookId, payload.actorId, payload.fiscalYearId,
      payload.periodId, payload.clearingAccountId, payload.custodyFinancialAccountId].every(text)
    || !hexadecimal(payload.buildCommit, 40)
    || ![payload.migrationSha256, payload.checkpointHash, payload.qualificationHash, payload.sourceSha256,
      payload.planSha256, payload.preparationSha256, payload.accountingApprovalSha256].every(value => hexadecimal(value, 64))
    || ![payload.candidateImage, payload.retainedImage].every(image)
    || identityFields.some(field => payload[field] !== observed[field])
    || payload.basisAt !== '2026-03-21T00:00:00.000Z'
    || ![payload.issuedAt, payload.expiresAt, observed.dbClock, observed.leaseExpiresAt].every(instant)
    || observed.phase !== 'MIGRATIONS_APPLIED' || observed.activeKey !== 'production') reject();

  if (!Number.isSafeInteger(payload.instrumentCount) || payload.instrumentCount < 1
    || !Number.isSafeInteger(payload.eventCount) || payload.eventCount < payload.instrumentCount
    || typeof payload.openingRials !== 'string' || !/^[1-9][0-9]{0,19}$/.test(payload.openingRials)) reject();

  const now = Date.parse(observed.dbClock);
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (issuedAt > now || now - issuedAt > 5 * 60_000 || expiresAt <= now
    || Date.parse(payload.basisAt) >= now || Date.parse(observed.leaseExpiresAt) <= now + 20_000) reject();

  const manifest = Buffer.from(canonicalGoPayload(payload));
  const signatureBytes = Buffer.from(signature, 'base64');
  if (signatureBytes.toString('base64') !== signature || !verify(null, manifest, approver.publicKey, signatureBytes)) reject();
  return { manifestText: manifest.toString('utf8'), manifestSha256: sha256(manifest) };
}
