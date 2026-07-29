import { Client } from 'pg';
import { localDockerDatabaseUrl } from './local-database';

export default async function globalSetup() {
  const runId = process.env.SUPPORT_QA_RUN_ID;
  if (!runId) throw new Error('SUPPORT_QA_RUN_ID is required.');
  const client = new Client({ connectionString: localDockerDatabaseUrl() });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO users (
        id, email, username, password, "firstName", "lastName", role, "isActive", "createdAt", "updatedAt"
      )
      SELECT
        $1, $2, $3, password, 'گزارشگر', 'آزمون پشتیبانی', 'USER', true, NOW(), NOW()
      FROM users
      WHERE username = 'admin'
    `, [
      `support-qa-${runId}`,
      `support-qa-${runId}@example.invalid`,
      `support_qa_${runId}`,
    ]);
    await client.query(`
      INSERT INTO users (
        id, email, username, password, "firstName", "lastName", role, "isActive", "createdAt", "updatedAt"
      )
      SELECT
        $1, $2, $3, password, 'کاربر', 'بدون دسترسی', 'USER', true, NOW(), NOW()
      FROM users
      WHERE username = 'admin'
    `, [
      `support-qa-outsider-${runId}`,
      `support-qa-outsider-${runId}@example.invalid`,
      `support_qa_outsider_${runId}`,
    ]);
    for (const persona of [
      { suffix: 'manager', firstName: 'مدیر', lastName: 'محدوده فروش', role: 'MANAGER' },
      { suffix: 'handler', firstName: 'مسئول', lastName: 'رسیدگی', role: 'USER' },
      { suffix: 'watcher', firstName: 'ناظر', lastName: 'تیکت', role: 'USER' },
      { suffix: 'incident', firstName: 'رسیدگی‌کننده', lastName: 'امنیت', role: 'USER' },
    ]) {
      await client.query(`
        INSERT INTO users (
          id, email, username, password, "firstName", "lastName", role, "isActive", "createdAt", "updatedAt"
        )
        SELECT $1, $2, $3, password, $4, $5, $6, true, NOW(), NOW()
        FROM users
        WHERE username = 'admin'
      `, [
        `support-qa-${persona.suffix}-${runId}`,
        `support-qa-${persona.suffix}-${runId}@example.invalid`,
        `support_qa_${persona.suffix}_${runId}`,
        persona.firstName,
        persona.lastName,
        persona.role,
      ]);
    }
    for (const suffix of ['', 'manager', 'handler', 'watcher']) {
      const userId = suffix ? `support-qa-${suffix}-${runId}` : `support-qa-${runId}`;
      const permissionLevel = suffix === 'manager' ? 'edit' : 'view';
      await client.query(`
        INSERT INTO workspace_permissions (
          id, "userId", workspace, "permissionLevel", "isActive", "createdAt", "updatedAt"
        ) VALUES ($1, $2, 'sales', $3, true, NOW(), NOW())
      `, [`support-qa-workspace-${suffix || 'reporter'}-${runId}`, userId, permissionLevel]);
      await client.query(`
        INSERT INTO feature_permissions (
          id, "userId", workspace, feature, "permissionLevel", "isActive", "createdAt", "updatedAt"
        ) VALUES ($1, $2, 'sales', 'sales_contracts_view', $3, true, NOW(), NOW())
      `, [`support-qa-feature-${suffix || 'reporter'}-${runId}`, userId, permissionLevel]);
    }
    await client.query(`
      INSERT INTO feature_permissions (
        id, "userId", workspace, feature, "permissionLevel", "isActive", "createdAt", "updatedAt"
      ) VALUES ($1, $2, 'security', 'support_security_incident_handle', 'edit', true, NOW(), NOW())
    `, [
      `support-qa-feature-incident-${runId}`,
      `support-qa-incident-${runId}`,
    ]);
  } finally {
    await client.end();
  }
}
