import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = path.join(root, 'tmp/qa/customer-output-325');
const remote = '/tmp/customer-output-325';
const compose = ['compose', '-f', 'docker-compose.local.yml'];
function docker(args) {
  execFileSync('docker', [...compose, 'ps'], { cwd: root, stdio: 'inherit' });
  return execFileSync('docker', [...compose, ...args], { cwd: root, stdio: 'inherit' });
}
fs.mkdirSync(scratch, { recursive: true });
// An isolated source tree in the existing service; no runtime/package/schema writes.
const archive = path.join(scratch, 'source.tar');
execFileSync('tar', ['-cf', archive,
  'backend/src', 'backend/public', 'backend/tsconfig.json',
  'packages/partner-sales-contracts/dist', 'packages/partner-sales-contracts/package.json',
  'packages/partner-sales-contracts/node_modules/zod',
  'frontend/node_modules/typescript',
  'frontend/node_modules/@types/node', 'frontend/node_modules/undici-types',
  'tests/partner-sales/output'], { cwd: root, stdio: 'inherit' });
docker(['exec', '-T', 'backend', 'mkdir', '-p', remote]);
docker(['cp', archive, `backend:${remote}/source.tar`]);
docker(['exec', '-T', 'backend', 'sh', '-c',
  `cd ${remote} && tar -xf source.tar && ln -sfn /app/node_modules backend/node_modules && mkdir -p packages/partner-sales-contracts/node_modules/@sabalanerp && ln -sfn /packages/contract-product-graph packages/partner-sales-contracts/node_modules/@sabalanerp/contract-product-graph`]);
docker(['exec', '-T', 'backend', 'node', '-r', `${remote}/tests/partner-sales/output/typescript-loader.cjs`,
  '--test', `${remote}/backend/src/services/__tests__/partnerCustomerOutput.test.ts`]);
