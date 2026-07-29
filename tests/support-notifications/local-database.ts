const allowedHosts = new Set(['127.0.0.1', 'localhost']);

export const localDockerDatabaseUrl = () => {
  const raw = process.env.SABALAN_LOCAL_DATABASE_URL
    || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp';
  const parsed = new URL(raw);
  if (
    parsed.protocol !== 'postgresql:'
    || !allowedHosts.has(parsed.hostname)
    || parsed.port !== '55432'
    || parsed.pathname !== '/sabalanerp'
    || decodeURIComponent(parsed.username) !== 'postgres'
    || decodeURIComponent(parsed.password) !== 'sabalanerp-local-only'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new Error('Support QA may connect only to the existing local sabalanerp-local PostgreSQL service.');
  }
  return `postgresql://postgres:sabalanerp-local-only@${parsed.hostname}:55432/sabalanerp`;
};
