import { Client } from 'pg';
import { localDockerDatabaseUrl } from './local-database';

export default async function globalTeardown() {
  const runId = process.env.SUPPORT_QA_RUN_ID;
  if (!runId) throw new Error('SUPPORT_QA_RUN_ID is required.');
  const reporterId = `support-qa-${runId}`;
  const titlePrefix = `QA پشتیبانی ${runId}`;
  const client = new Client({ connectionString: localDockerDatabaseUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DELETE FROM "security_notifications"
      WHERE "eventId" IN (
        SELECT id FROM "notification_events"
        WHERE "resourceType" = 'support-ticket'
          AND "resourceId" IN (
            SELECT id FROM "support_tickets" WHERE title LIKE $1
          )
      )
    `, [`${titlePrefix}%`]);
    await client.query(`
      DELETE FROM "notification_events"
      WHERE "resourceType" = 'support-ticket'
        AND "resourceId" IN (
          SELECT id FROM "support_tickets" WHERE title LIKE $1
        )
    `, [`${titlePrefix}%`]);
    await client.query(`DELETE FROM "support_tickets" WHERE title LIKE $1`, [`${titlePrefix}%`]);
    await client.query(`
      DELETE FROM "api_idempotency_records"
      WHERE scope LIKE '%/support-tickets%'
        AND "userId" = $1
    `, [reporterId]);
    await client.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [[
      reporterId,
      `support-qa-outsider-${runId}`,
      `support-qa-manager-${runId}`,
      `support-qa-handler-${runId}`,
      `support-qa-watcher-${runId}`,
      `support-qa-incident-${runId}`,
    ]]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
