import { verifySepidarOpeningApproval } from './sepidar-opening-approval.mjs';

/**
 * Enroll an Accounting-approved manifest on the connection owned by the
 * protected release controller. Qualification is independently measured by
 * the caller before entering this transaction.
 */
export async function enrollSepidarOpening({ client, deploymentId, releaseId, leaseToken, qualification, envelope, approver }) {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      'SELECT * FROM public.sepidar_customer_opening_lock($1, $2, $3)',
      [deploymentId, releaseId, leaseToken],
    );
    if (rows.length !== 1) throw new Error('SEPIDAR_OPENING_DEPLOYMENT_NOT_QUALIFIED');

    const deployment = rows[0];
    const approval = verifySepidarOpeningApproval(envelope, {
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
      'SELECT public.sepidar_customer_opening_register_manifest($1, $2, $3, $4, $5)',
      [deploymentId, releaseId, leaseToken, approval.manifestText, approval.manifestSha256],
    );
    await client.query('COMMIT');
    return { manifestSha256: approval.manifestSha256 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
