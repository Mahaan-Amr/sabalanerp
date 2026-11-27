import { readSepidarOpeningChequeBatchEvidence, verifySepidarOpeningChequeBatchApproval } from './sepidar-opening-cheque-approval.mjs';
import { createHash, createPublicKey } from 'node:crypto';
import { verifySepidarOpeningApproval } from './sepidar-opening-approval.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const rejectedEvidence = () => { throw new Error('SEPIDAR_OPENING_EVIDENCE_REJECTED'); };
const limit = 4 * 1024 * 1024;
const canonicalRials = /^(0|-?[1-9][0-9]{0,19})$/;

export function readSepidarChequeOpeningEvidence(read, { approvalKeySha256, qualificationSha256, prepareOnly, describe }, readAuthority) {
  const source = read('source.json', limit);
  const preparation = read('preparation.json', limit);
  const qualificationBytes = read('qualification.json', limit);
  const qualificationHash = sha256(qualificationBytes);
  if (qualificationHash !== qualificationSha256) rejectedEvidence();
  const { buildCommit, migrationSha256, candidateImage, retainedImage } = JSON.parse(qualificationBytes);
  if (!prepareOnly && typeof describe !== 'function') rejectedEvidence();
  const target = JSON.parse(preparation);
  const reproducedPreparation = describe
    ? Buffer.from(JSON.stringify(describe(source, target), null, 2) + '\n') : preparation;
  const batch = readSepidarOpeningChequeBatchEvidence({
    source, preparation, reproducedPreparation, accountingApproval: read('accounting-approval.json', limit),
  });
  const key = JSON.parse(readAuthority('approver.json', 16 * 1024));
  if (typeof key.publicKeyPem !== 'string' || sha256(key.publicKeyPem) !== approvalKeySha256) rejectedEvidence();
  const publicKey = createPublicKey(key.publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') rejectedEvidence();
  return {
    approver: { publicKey, keyId: key.keyId },
    ...(prepareOnly ? {} : { envelope: JSON.parse(read('decision.json', limit)) }),
    qualification: { ...batch, buildCommit, migrationSha256, candidateImage, retainedImage, qualificationHash },
  };
}

/** Resolve the verified preparation and signed decision without exposing any customer data. */
export function readSepidarOpeningEvidence(read, { approvalKeySha256, qualificationSha256, prepareOnly }, readAuthority = read) {
  const source = read('source.json', limit);
  const preparationBytes = read('preparation.json', limit);
  const accountingBytes = read('accounting-approval.json', limit);
  const qualificationBytes = read('qualification.json', limit);
  const qualificationHash = sha256(qualificationBytes);
  if (qualificationHash !== qualificationSha256) rejectedEvidence();
  const { buildCommit, migrationSha256, candidateImage, retainedImage } = JSON.parse(qualificationBytes);
  const prepared = JSON.parse(preparationBytes);
  const accounting = JSON.parse(accountingBytes);
  const { bookId, counterAccountId, basisAt, sourcePackageHash } = prepared;
  if (prepared.format !== 'sepidar-customer-opening-preparation-v1'
    || accounting.format !== 'sepidar-opening-accounting-review-v1' || accounting.decision !== 'APPROVED'
    || typeof accounting.reviewReference !== 'string' || !accounting.reviewReference.trim()
    || sourcePackageHash !== sha256(source) || accounting.preparationSha256 !== sha256(preparationBytes)
    || basisAt !== '2026-03-21T00:00:00.000Z'
    || accounting.bookId !== bookId || accounting.counterAccountId !== counterAccountId || accounting.basisAt !== basisAt
    || !Array.isArray(prepared.prepared) || !Array.isArray(prepared.excluded) || prepared.excluded.length !== 0
    || prepared.prepared.length !== accounting.customerCount) rejectedEvidence();
  const commands = prepared.prepared.map(row => row?.manifestLine);
  if (!commands.length || commands.some(command => typeof command?.totalRials !== 'string'
    || !canonicalRials.test(command.totalRials))) rejectedEvidence();
  const sourcePackage = JSON.parse(source.toString('utf8').replace(/^\uFEFF/, ''));
  if (sourcePackage.format !== 'sepidar-reviewed-opening-evidence-v1' || sourcePackage.transferStatus !== 'UNPOSTED'
    || sourcePackage.currency !== 'IRR' || sourcePackage.basisPersian !== '1405-01-01'
    || !Array.isArray(sourcePackage.rows) || sourcePackage.receivableCustomerCount !== commands.length) rejectedEvidence();
  const receivables = sourcePackage.rows.filter(row => row?.receivable);
  const byVoucherItem = new Map(receivables.map(row => [String(row.receivable.openingVoucherItemId), row]));
  if (receivables.length !== commands.length || byVoucherItem.size !== commands.length
    || commands.some(command => {
      const row = byVoucherItem.get(command.sourceVoucherItemId);
      return !row || String(row.sourcePartyId) !== command.sourceCustomerId
        || row.targetWorkspaceKey !== command.destinationKey || row.receivable.signedRials !== command.totalRials;
    })) rejectedEvidence();
  const total = commands.reduce((sum, command) => sum + BigInt(command.totalRials), 0n);
  if (prepared.preparedNetRials !== total.toString() || prepared.clearingNetRials !== (-total).toString()
    || accounting.clearingNetRials !== prepared.clearingNetRials) rejectedEvidence();

  const key = JSON.parse(readAuthority('approver.json', 16 * 1024));
  if (typeof key.publicKeyPem !== 'string' || sha256(key.publicKeyPem) !== approvalKeySha256) rejectedEvidence();
  const publicKey = createPublicKey(key.publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') rejectedEvidence();
  return {
    approver: { publicKey, keyId: key.keyId },
    preparedRows: prepared.prepared,
    ...(prepareOnly ? {} : { envelope: JSON.parse(read('decision.json', limit)) }),
    qualification: {
      buildCommit, migrationSha256, candidateImage, retainedImage, qualificationHash,
      bookId, counterAccountId, basisAt, sourcePackageHash, accountingApprovalHash: sha256(accountingBytes), commands,
    },
  };
}

/**
 * Enroll an Accounting-approved manifest on the connection owned by the
 * protected release controller. Qualification is independently measured by
 * the caller before entering this transaction.
 */
export async function enrollSepidarOpening({ client, deploymentId, releaseId, leaseToken, qualification, envelope, approver, scope = 'customers' }) {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      'SELECT * FROM public.sepidar_customer_opening_lock($1, $2, $3)',
      [deploymentId, releaseId, leaseToken],
    );
    if (rows.length !== 1) throw new Error('SEPIDAR_OPENING_DEPLOYMENT_NOT_QUALIFIED');

    const deployment = rows[0];
    if (qualification.buildCommit !== deployment.build_commit) throw new Error('SEPIDAR_OPENING_DEPLOYMENT_NOT_QUALIFIED');
    const isChequeBatch = scope === 'cheques';
    const verifyApproval = isChequeBatch ? verifySepidarOpeningChequeBatchApproval : verifySepidarOpeningApproval;
    const approval = verifyApproval(envelope, {
      ...qualification,
      deploymentId,
      releaseId,
      buildCommit: deployment.build_commit,
      checkpointHash: deployment.checkpoint_hash,
      phase: deployment.phase,
      activeKey: deployment.active_key,
      dbClock: deployment.database_clock.toISOString(),
      leaseExpiresAt: deployment.lease_expiry.toISOString(),
    }, approver);

    await client.query(
      isChequeBatch
        ? 'SELECT public.sepidar_cheque_batch_register($1, $2, $3, $4, $5)'
        : 'SELECT public.sepidar_customer_opening_register_manifest($1, $2, $3, $4, $5)',
      [deploymentId, releaseId, leaseToken, approval.manifestText, approval.manifestSha256],
    );
    await client.query('COMMIT');
    return { manifestSha256: approval.manifestSha256 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
