/** Explicitly refuse non-local databases. The runner must first verify the
 * existing sabalanerp-local Compose project; no disposable database is created. */
export function partnerNotificationsTestDatabaseUrl(): string {
  const value = process.env.PARTNER_NOTIFICATIONS_TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!value) throw new Error('PARTNER_NOTIFICATION_LOCAL_TEST_DATABASE_REQUIRED');
  const url = new URL(value);
  if (!['postgresql:', 'postgres:'].includes(url.protocol)
    || !['postgres', '127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/sabalanerp') {
    throw new Error('PARTNER_NOTIFICATION_NONLOCAL_DATABASE_REFUSED');
  }
  url.searchParams.set('connection_limit', '4');
  url.searchParams.set('pool_timeout', '10');
  return url.toString();
}
