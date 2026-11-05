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

// Inspect only this mapping's indented children. Sibling keys such as image
// and restart may occur before or after build without changing its meaning.
function mappingBody(source, key, indentation) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(line => new RegExp(`^ {${indentation}}${key}:\\s*(?:#.*)?$`).test(line));
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && !line.trimStart().startsWith('#') && line.search(/\S/) <= indentation) break;
    end++;
  }
  return lines.slice(start + 1, end).join('\n');
}
const frontendBuild = mappingBody(mappingBody(compose, 'frontend', 2), 'build', 4);
assert.match(
  frontendBuild,
  /^ {6}context:\s*\.\s*$/m,
  'Frontend production build context must be the repository root.'
);
assert.match(
  frontendBuild,
  /^ {6}dockerfile:\s*frontend\/Dockerfile\s*$/m,
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
const runtimePackageStage = dockerfile.match(
  /^COPY --from=(\S+) \/packages\/contract-product-graph \/packages\/contract-product-graph\s*$/m
)?.[1];
assert.ok(
  runtimePackageStage === 'builder' || runtimePackageStage === 'production-builder',
  'Runtime image must preserve the target of the frontend package symlink from its compiled builder.'
);
if (runtimePackageStage === 'production-builder') {
  assert.match(dockerfile, /^FROM builder AS production-builder\s*$/im,
    'Production builder must inherit the canonical packages compiled by builder.');
}

console.log('frontend Docker workspace dependency check passed');
