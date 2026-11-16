/** Validate configuration before a protected role cutover. This is a URL
 * identity check, not evidence of PostgreSQL grants or role attributes. */
export function assertProductionDatabaseRoleConfiguration({ runtimeUrl, controlUrl, bootstrapUser }) {
  const parse = (value, label) => {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${label} must be a PostgreSQL URL.`); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password
      || !url.hostname || url.pathname.length < 2 || url.hash || url.searchParams.has('options')) {
      throw new Error(`${label} must be a bounded PostgreSQL URL.`);
    }
    for (const [key, maximum] of [['connection_limit', 128], ['pool_timeout', 120]]) {
      const values = url.searchParams.getAll(key);
      if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0]) || Number(values[0]) > maximum) {
        throw new Error(`${label} requires bounded ${key}.`);
      }
    }
    let username;
    try { username = decodeURIComponent(url.username); } catch { throw new Error(`${label} has an invalid login name.`); }
    return { url, username };
  };
  const runtime = parse(runtimeUrl, 'BACKEND_DATABASE_URL');
  const control = parse(controlUrl, 'DEPLOYMENT_DATABASE_URL');
  if (!bootstrapUser || runtime.username === control.username || runtime.username === bootstrapUser) {
    throw new Error('Runtime and protected database principals must be distinct.');
  }
  if (runtime.url.host !== control.url.host || runtime.url.pathname !== control.url.pathname) {
    throw new Error('Runtime and control URLs must target the same database.');
  }
  return { runtimeUser: runtime.username, controlUser: control.username };
}
