import { verifyCustomerAllocationGoManifest } from './customer-allocation-go-manifest.mjs';

const reject = () => { throw new Error('CUSTOMER_ALLOCATION_CONTROLLER_REJECTED'); };

/** `client` is a pg Client connected as sabalan_allocation_controller. */
export function customerAllocationControllerDatabase(client) {
  return { transaction: async work => {
    await client.query('BEGIN');
    try {
      const role = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles AS r
          WHERE r.rolname = 'sabalan_allocation_controller'
            AND r.rolname = session_user AND r.rolname = current_user
            AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
              OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_auth_members AS m
              WHERE m.roleid = r.oid OR m.member = r.oid
            )
        ) AS admitted_controller_session
      `);
      if (role.rows.length !== 1 || role.rows[0].admitted_controller_session !== true) reject();
      const result = await work({
        lock: async (deploymentId, leaseToken) => {
          const { rows } = await client.query(
            'SELECT * FROM public.customer_allocation_controller_lock($1, $2)', [deploymentId, leaseToken]);
          const row = rows[0];
          if (!row) reject();
          return Object.fromEntries(Object.entries(row).map(([key, value]) =>
            [key === 'deployment_id' ? 'deploymentId' : key, value instanceof Date ? value.toISOString() : value]));
        },
        activate: async ({ deploymentId, leaseToken, releaseId, manifestSha256, expiresAt }) => {
          const { rows } = await client.query(
            'SELECT * FROM public.customer_allocation_controller_activate($1, $2, $3, $4, $5)',
            [deploymentId, leaseToken, releaseId, manifestSha256, expiresAt]);
          if (rows.length !== 1) reject();
          return rows[0];
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } };
}

/** Dormant controller seam. The transaction adapter must use the dedicated database
 * login and hold the deployment row lock from lock() through activate(). `expected`
 * must come from independently verified immutable image and evidence custody. */
export async function activateCustomerAllocation({ db, envelope, expected, deploymentId, leaseToken, approver }) {
  if (!db || typeof db.transaction !== 'function' || !expected || !approver ||
    typeof deploymentId !== 'string' || !deploymentId || typeof leaseToken !== 'string' || !leaseToken) reject();
  return db.transaction(async tx => {
    const locked = await tx.lock(deploymentId, leaseToken);
    if (!locked || locked.deploymentId !== deploymentId || locked.leaseToken !== leaseToken) reject();
    const verified = verifyCustomerAllocationGoManifest(envelope, { ...expected, ...locked }, approver);
    const receipt = await tx.activate({ deploymentId, leaseToken, releaseId: verified.releaseId,
      manifestSha256: verified.manifestSha256, expiresAt: verified.expiresAt });
    if (receipt?.state !== 'ACTIVE' || receipt.manifest_sha256 !== verified.manifestSha256) reject();
    return receipt;
  });
}
