import { createHash, verify } from 'node:crypto';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';

const reject = () => { throw new Error('SEPIDAR_OPENING_APPROVAL_REJECTED'); };
const nonempty = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const hash = value => /^[a-f0-9]{64}$/.test(value ?? '');
const image = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');
const sourceId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const rialAmount = value => typeof value === 'string' && /^(0|-?[1-9][0-9]{0,19})$/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

const comparedIdentity = ['releaseId', 'deploymentId', 'buildCommit', 'migrationSha256',
  'candidateImage', 'retainedImage', 'checkpointHash', 'qualificationHash', 'bookId',
  'counterAccountId', 'sourcePackageHash', 'accountingApprovalHash', 'basisAt'];
const commandFields = ['idempotencyKey', 'destinationKey', 'actorId', 'sourceCustomerId',
  'sourceVoucherItemId', 'commandHash', 'totalRials'];

const exactFields = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length
  && fields.every(field => Object.hasOwn(value, field));

/** Verify the signed manifest against independently observed deployment and accounting evidence.
 * Callers register the returned bytes under the owned protected lease.
 */
export function verifySepidarOpeningApproval(envelope, observed, approver) {
  if (!exactFields(envelope, ['payload', 'signature']) || !observed || !approver) reject();
  const { payload, signature } = envelope;
  if (!exactFields(payload, [...comparedIdentity, 'format', 'decision', 'keyId', 'issuedAt',
    'expiresAt', 'commands'])) reject();

  if (payload.format !== 'sepidar-customer-opening-approval-v1' || payload.decision !== 'GO'
    || !nonempty(payload.keyId) || payload.keyId !== approver.keyId
    || approver.publicKey?.asymmetricKeyType !== 'ed25519'
    || !/^[A-Za-z0-9+/]{86}==$/.test(signature ?? '')
    || ![payload.releaseId, payload.deploymentId, payload.bookId, payload.counterAccountId].every(nonempty)
    || !/^[a-f0-9]{40}$/.test(payload.buildCommit ?? '')
    || ![payload.migrationSha256, payload.checkpointHash, payload.qualificationHash,
      payload.accountingApprovalHash, payload.sourcePackageHash].every(hash)
    || ![payload.candidateImage, payload.retainedImage].every(image)
    || comparedIdentity.some(field => payload[field] !== observed[field])
    || ![payload.issuedAt, payload.expiresAt, payload.basisAt, observed.dbClock, observed.leaseExpiresAt].every(timestamp)
    || observed.phase !== 'MIGRATIONS_APPLIED' || observed.activeKey !== 'production') reject();

  const now = Date.parse(observed.dbClock);
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (issuedAt > now || now - issuedAt > 5 * 60_000 || expiresAt <= now
    || expiresAt - issuedAt > 7 * 86_400_000 || Date.parse(payload.basisAt) >= now
    || Date.parse(observed.leaseExpiresAt) <= now + 20_000) reject();

  const commands = payload.commands;
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 500 || commands.some(command =>
    !exactFields(command, commandFields) || !nonempty(command.idempotencyKey) || command.idempotencyKey.length < 8
    || !nonempty(command.destinationKey) || command.destinationKey === 'customer:'
    || !nonempty(command.actorId) || !sourceId(command.sourceCustomerId)
    || !sourceId(command.sourceVoucherItemId) || !hash(command.commandHash) || !rialAmount(command.totalRials))) reject();
  for (const field of ['idempotencyKey', 'destinationKey', 'sourceCustomerId', 'sourceVoucherItemId']) {
    if (new Set(commands.map(command => command[field])).size !== commands.length) reject();
  }

  const bytes = Buffer.from(canonicalGoPayload(payload));
  if (!verify(null, bytes, approver.publicKey, Buffer.from(signature, 'base64'))) reject();

  return {
    manifestText: bytes.toString('utf8'),
    manifestSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
