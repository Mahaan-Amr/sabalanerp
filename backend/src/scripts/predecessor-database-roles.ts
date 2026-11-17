import { isIPv4 } from 'node:net';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { verifyPredecessorDatabaseRoles } from '../services/predecessorDatabaseRoles';

async function main() {
  const [controlUser, runtimeAddress] = process.argv.slice(2);
  if (!/^[a-zA-Z0-9_]+$/.test(controlUser ?? '') || !isIPv4(runtimeAddress ?? '')
    || process.env.BACKEND_RUNTIME_ROLE !== 'control') throw new Error('PREDECESSOR_DATABASE_ROLES_UNPROVEN');
  console.log(JSON.stringify(await verifyPredecessorDatabaseRoles(prisma, controlUser, runtimeAddress)));
}

main().catch(() => {
  console.error('PREDECESSOR_DATABASE_ROLES_UNPROVEN');
  process.exitCode = 1;
}).finally(() => disconnectDatabase());
