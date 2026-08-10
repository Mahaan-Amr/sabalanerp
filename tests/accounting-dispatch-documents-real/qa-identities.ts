import { Client } from 'pg';

const allowedHosts = new Set(['127.0.0.1', 'localhost']);

export const qaDatabaseUrl = (raw = process.env.ACCOUNTING_DISPATCH_DOCUMENTS_DATABASE_URL
  || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp') => {
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
  ) throw new Error('Accounting dispatch QA may connect only to the existing sabalanerp-local PostgreSQL service.');
  return `postgresql://postgres:sabalanerp-local-only@${parsed.hostname}:55432/sabalanerp`;
};

export const qaUsers = {
  manage: { id: 'issue256-dispatch-manage', permission: 'edit' },
  view: { id: 'issue256-dispatch-view', permission: 'view' },
  unauthorized: { id: 'issue256-dispatch-unauthorized', permission: null },
} as const;

const ids = Object.values(qaUsers).map((user) => user.id);

export const withQaDatabase = async (run: (client: Client) => Promise<void>) => {
  const client = new Client({ connectionString: qaDatabaseUrl() });
  await client.connect();
  try { await run(client); } finally { await client.end(); }
};

export const removeQaIdentities = async (client: Client) => {
  await client.query('DELETE FROM authentication_events WHERE "userId" = ANY($1) OR "actorId" = ANY($1)', [ids]);
  await client.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
};
