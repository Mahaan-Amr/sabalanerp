/** Validate configuration before a protected role cutover. This is a URL
 * identity check, not evidence of PostgreSQL grants or role attributes. */
export function assertProductionDatabaseRoleConfiguration({ runtimeUrl, controlUrl, allocationControllerUrl, bootstrapUser }) {
  const parse = (value, label) => {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${label} must be a PostgreSQL URL.`); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password
      || !url.hostname || !/^\/[a-zA-Z0-9_]+$/.test(url.pathname) || url.hash
      || [...url.searchParams.keys()].some(key => !['schema', 'connection_limit', 'pool_timeout', 'application_name'].includes(key))
      || url.searchParams.getAll('schema').join(',') !== 'public') {
      throw new Error(`${label} must be a bounded PostgreSQL URL.`);
    }
    for (const key of ['connection_limit', 'pool_timeout']) {
      const values = url.searchParams.getAll(key);
      if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0])) throw new Error(`${label} requires ${key}.`);
    }
    let username;
    try { username = decodeURIComponent(url.username); } catch { throw new Error(`${label} has an invalid login name.`); }
    return { url, username };
  };
  const runtime = parse(runtimeUrl, 'BACKEND_DATABASE_URL');
  const control = parse(controlUrl, 'DEPLOYMENT_DATABASE_URL');
  const allocation = parse(allocationControllerUrl, 'CUSTOMER_ALLOCATION_CONTROLLER_DATABASE_URL');
  if (!bootstrapUser || runtime.username === control.username || runtime.username === bootstrapUser
    || allocation.username === bootstrapUser || allocation.username === control.username
    || runtime.username !== 'sabalan_application_runtime' || allocation.username !== 'sabalan_allocation_controller') {
    throw new Error('Runtime and protected database principals must be distinct.');
  }
  if ([control, allocation].some(role => role.url.host !== runtime.url.host || role.url.pathname !== runtime.url.pathname)) {
    throw new Error('All database roles must target the same database.');
  }
  return { runtimeUser: runtime.username, controlUser: control.username, allocationControllerUser: allocation.username };
}
