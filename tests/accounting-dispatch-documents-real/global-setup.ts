import { qaUsers, removeQaIdentities, withQaDatabase } from './qa-identities';

export default async function globalSetup() {
  await withQaDatabase(async (client) => {
    await client.query('BEGIN');
    try {
      await removeQaIdentities(client);
      const admin = await client.query<{ password: string }>(
        'SELECT password FROM users WHERE username = $1 AND "isActive" = true',
        ['admin'],
      );
      if (admin.rowCount !== 1) throw new Error('The sabalanerp-local admin seed is required for authenticated QA.');

      for (const [role, user] of Object.entries(qaUsers)) {
        await client.query(
          `INSERT INTO users (id, email, username, password, "firstName", "lastName", role, "isActive", "updatedAt")
           VALUES ($1, $2, $1, $3, $4, $5, 'USER', true, CURRENT_TIMESTAMP)`,
          [user.id, `${user.id}@qa.invalid`, admin.rows[0].password, 'کنترل', role],
        );
        if (!user.permission) continue;
        await client.query(
          `INSERT INTO workspace_permissions (id, "userId", workspace, "permissionLevel", "isActive", "updatedAt")
           VALUES ($1, $2, 'accounting', $3, true, CURRENT_TIMESTAMP)`,
          [`${user.id}-workspace`, user.id, user.permission],
        );
        await client.query(
          `INSERT INTO feature_permissions (id, "userId", workspace, feature, "permissionLevel", "isActive", "updatedAt")
           VALUES ($1, $2, 'accounting', 'accounting_dispatch_candidates_view', 'view', true, CURRENT_TIMESTAMP)`,
          [`${user.id}-dispatch-view`, user.id],
        );
        if (role === 'manage') {
          await client.query(
            `INSERT INTO feature_permissions (id, "userId", workspace, feature, "permissionLevel", "isActive", "updatedAt")
             VALUES ($1, $2, 'accounting', 'accounting_dispatch_candidates_manage', 'edit', true, CURRENT_TIMESTAMP)`,
            [`${user.id}-dispatch-manage`, user.id],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
