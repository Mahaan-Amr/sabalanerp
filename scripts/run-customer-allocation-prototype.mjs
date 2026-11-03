import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Refresh only the prototype files in the existing local development service.
// No second server, database or Compose project is created.
const root = path.resolve(import.meta.dirname, '..');
function docker(args) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`Docker exited ${result.status}`);
}
docker(['compose', '-f', 'docker-compose.local.yml', 'ps']);
const state = spawnSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'], { cwd: root, encoding: 'utf8' });
if (state.status !== 0) throw new Error('Cannot verify sabalanerp-local');
const services = state.stdout.trim().startsWith('[') ? JSON.parse(state.stdout) : state.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
if (!services.some(row => row.Service === 'frontend' && row.State === 'running')) throw new Error('Start the existing sabalanerp-local frontend first.');
docker(['compose', '-f', 'docker-compose.local.yml', 'exec', '-T', 'frontend', 'node', '-e', 'if(process.env.NODE_ENV!=="development"||process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES!=="1")process.exit(1)']);
docker(['compose', '-f', 'docker-compose.local.yml', 'cp', 'frontend/src/features/accounting/allocation-prototype', 'frontend:/app/src/features/accounting/']);
docker(['compose', '-f', 'docker-compose.local.yml', 'cp', 'frontend/src/components/erp/PrototypeVariantSwitcher.tsx', 'frontend:/app/src/components/erp/PrototypeVariantSwitcher.tsx']);
docker(['compose', '-f', 'docker-compose.local.yml', 'cp', 'frontend/src/app/dashboard/accounting/customer-accounts/[id]/page.tsx', 'frontend:/app/src/app/dashboard/accounting/customer-accounts/[id]/page.tsx']);
console.log('Ready: open a customer account at http://127.0.0.1:3000 and append ?variant=A (or B/C). Changes are in memory only.');
