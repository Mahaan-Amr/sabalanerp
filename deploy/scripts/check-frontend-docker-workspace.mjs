import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compose = readFileSync('docker-compose.prod.yml', 'utf8');
const dockerfile = readFileSync('frontend/Dockerfile', 'utf8');
const frontendPackage = JSON.parse(readFileSync('frontend/package.json', 'utf8'));

assert.equal(
  frontendPackage.dependencies?.['@sabalanerp/contract-product-graph'],
  'file:../packages/contract-product-graph',
  'Frontend must keep using the repository-local canonical graph package.'
);

const frontendBuild = compose.match(
  /frontend:\s*\n\s*build:\s*\n([\s\S]*?)\n\s*restart:/
)?.[1] ?? '';
assert.match(
  frontendBuild,
  /^\s*context:\s*\.\s*$/m,
  'Frontend production build context must be the repository root.'
);
assert.match(
  frontendBuild,
  /^\s*dockerfile:\s*frontend\/Dockerfile\s*$/m,
  'Frontend production build must use frontend/Dockerfile from the root context.'
);

assert.match(
  dockerfile,
  /COPY packages\/contract-product-graph\/package\*\.json \/packages\/contract-product-graph\//,
  'Frontend builder must copy the canonical graph package manifest.'
);
assert.match(
  dockerfile,
  /cd \/packages\/contract-product-graph[\s\S]*npm run build/,
  'Frontend builder must compile the canonical graph package before Next.js.'
);
assert.match(
  dockerfile,
  /COPY frontend\/package\*\.json \.\//,
  'Frontend manifests must be copied from the repository-root build context.'
);
assert.match(
  dockerfile,
  /COPY frontend \./,
  'Frontend source must be copied from the repository-root build context.'
);
assert.match(
  dockerfile,
  /COPY --from=builder \/packages\/contract-product-graph \/packages\/contract-product-graph/,
  'Runtime image must preserve the target of the frontend package symlink.'
);

console.log('frontend Docker workspace dependency check passed');
