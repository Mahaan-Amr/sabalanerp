import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { localDockerDatabaseUrl } from './local-database';

test('six urgent security alerts can be read without security decisions or losing history', async ({ page }) => {
  const runId = process.env.SUPPORT_QA_RUN_ID!;
  const userId = `support-qa-outsider-${runId}`;
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(`support_qa_outsider_${runId}`);
  await page.locator('input[name="password"]').fill('admin123');
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const db = new Client({ connectionString: localDockerDatabaseUrl() });
  await db.connect();
  const ids = Array.from({ length: 6 }, (_, i) => `notification-read-qa-${runId}-${i}`);
  try {
    const { rows: sessions } = await db.query('SELECT id, "revokedAt" FROM auth_sessions WHERE "userId" = $1 ORDER BY "authenticatedAt" DESC', [userId]);
    expect(sessions.length).toBeGreaterThan(0);
    const sessionId = sessions[0].id;
    await db.query('UPDATE security_notifications SET "readAt" = NOW() WHERE "userId" = $1', [userId]);
    for (const [index, id] of ids.entries()) {
      await db.query(`INSERT INTO security_notifications (id, "userId", type, title, message, priority, "referenceId", "actionUrl")
        VALUES ($1, $2, 'NEW_BROWSER_LOGIN', $3, 'آزمون خواندن اعلان امنیتی', 'URGENT', $4, $5)`,
      [id, userId, `ورود آزمایشی ${index + 1}`, sessionId, `/dashboard/personal/security?session=${sessionId}`]);
    }
    const decisions = async () => (await db.query(`SELECT id FROM authentication_events WHERE "userId" = $1 AND type IN ('LOGIN_ACKNOWLEDGED', 'UNRECOGNIZED_LOGIN_HANDLED')`, [userId])).rows;
    const baseline = await decisions();
    await page.reload();
    const badge = page.locator('[data-dynamic="notification-count"]');
    await expect(badge).toHaveText('۶');
    await page.getByRole('button', { name: /اعلان/ }).click();
    const sheet = page.getByRole('dialog', { name: 'اعلان‌ها', exact: true });
    await sheet.getByText('ورود آزمایشی 6', { exact: true }).click();
    await expect(page).toHaveURL(/\/personal\/security\?/);
    await expect(badge).toHaveText('۵');
    await expect(page.getByRole('button', { name: 'این ورود من نبود', exact: true })).toBeVisible();
    await expect.poll(async () => (await db.query('SELECT "readAt" FROM security_notifications WHERE id = $1', [ids[5]])).rows[0].readAt).not.toBeNull();
    expect(await decisions()).toEqual(baseline);

    await page.getByRole('button', { name: /اعلان/ }).click();
    await sheet.getByRole('button', { name: 'خواندن همه', exact: true }).click();
    await expect(badge).toHaveCount(0);
    expect(await decisions()).toEqual(baseline);
    expect((await db.query('SELECT id, "revokedAt" FROM auth_sessions WHERE "userId" = $1 ORDER BY "authenticatedAt" DESC', [userId])).rows).toEqual(sessions);
    const records = (await db.query('SELECT id, "readAt" FROM security_notifications WHERE id = ANY($1::text[])', [ids])).rows;
    expect(records).toHaveLength(6);
    expect(records.every((record) => record.readAt)).toBe(true);

    await sheet.getByRole('link', { name: 'مشاهده همه اعلان‌ها', exact: true }).click();
    await expect(page.getByText('ورود آزمایشی 1', { exact: true })).toBeVisible();
    const row = page.locator('article').filter({ has: page.getByText('ورود آزمایشی 1', { exact: true }) });
    await row.getByRole('button', { name: 'خوانده‌نشده', exact: true }).click();
    await expect(badge).toHaveText('۱');
    await row.getByText('ورود آزمایشی 1', { exact: true }).click();
    await expect(page).toHaveURL(/\/personal\/security\?/);
    await expect(badge).toHaveCount(0);
    expect(await decisions()).toEqual(baseline);
    // A read alert remains actionable; reading is not a security resolution.
    const resolution = await page.evaluate(async (id) => {
      const response = await fetch(`/api/notifications/${id}/security-resolution`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ decision: 'MINE' }),
      });
      return { status: response.status, body: await response.json() };
    }, ids[5]);
    expect(resolution.status).toBe(200);
    expect(resolution.body.data.revoked).toBe(0);
    expect(await decisions()).toHaveLength(baseline.length + 1);
  } finally {
    await db.query('DELETE FROM security_notifications WHERE id = ANY($1::text[])', [ids]);
    await db.end();
  }
});
