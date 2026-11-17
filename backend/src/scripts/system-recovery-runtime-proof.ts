import { disconnectDatabase, prisma } from '../lib/prisma';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const commit = fs.readFileSync(path.resolve(__dirname, '../../.allocation-build-commit'), 'utf8').trim();
  const releaseId = process.env.DEPLOYMENT_RELEASE_ID || '';
  if (!/^[a-f0-9]{40}$/.test(commit) || !releaseId) throw new Error('SYSTEM_RECOVERY_RUNTIME_IDENTITY_REQUIRED');
  const [proof] = await prisma.$queryRaw<Array<{ role: string; authenticated: boolean; admitted: boolean; address: string }>>`
    SELECT session_user AS role, current_user = session_user AS authenticated,
      inet_client_addr()::text AS address,
      public.customer_allocation_runtime_admitted(${commit}, ${releaseId}) AS admitted
  `;
  if (proof?.role !== 'sabalan_application_runtime' || !proof.authenticated) throw new Error('SYSTEM_RECOVERY_RUNTIME_ROLE_REQUIRED');
  console.log(JSON.stringify({ role: proof.role, commit, releaseId, admitted: proof.admitted, address: proof.address }));
}
void main().catch(() => { console.error('SYSTEM_RECOVERY_RUNTIME_PROOF_FAILED'); process.exitCode = 1; })
  .finally(() => disconnectDatabase());
