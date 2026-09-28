/** Translate a cloned Prisma URI for native libpq tools without changing the application's pool URI. */
export const nativePostgresCliConnection = (databaseUrl: string, databaseName?: string) => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
    if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('Unsupported protocol');
  } catch {
    throw Object.assign(new Error('A valid PostgreSQL connection identity is required.'), { code: 'NATIVE_POSTGRES_URL_INVALID' });
  }
  if (databaseName !== undefined) url.pathname = `/${databaseName}`;
  // These are Prisma client options, not libpq connection parameters. SSL and native options remain untouched.
  for (const key of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'statement_cache_size', 'socket_timeout']) url.searchParams.delete(key);
  const password = url.searchParams.get('password') ?? decodeURIComponent(url.password);
  url.password = '';
  url.searchParams.delete('password');
  return { url: url.toString(), environment: { PGPASSWORD: password } };
};
