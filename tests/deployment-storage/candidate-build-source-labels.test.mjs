import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('normal protected build binds all candidate images to the selected source before building', () => {
  const deploy = readFileSync(new URL('../../deploy/scripts/deploy.sh', import.meta.url), 'utf8');
  const compose = readFileSync(new URL('../../docker-compose.prod.yml', import.meta.url), 'utf8');
  const beforeBuild = deploy.slice(0, deploy.indexOf('for release_service in backend frontend inquiry; do'));
  assert.match(beforeBuild, /PERFORMANCE_SOURCE_COMMIT="\$\{DEPLOYMENT_TARGET_COMMIT\}"/);
  assert.match(beforeBuild, /PERFORMANCE_SOURCE_HASH="\$\(node --input-type=module -e .*performanceSourceHash/);
  assert.match(beforeBuild, /export PERFORMANCE_SOURCE_COMMIT PERFORMANCE_SOURCE_HASH/);
  assert.match(deploy, /for release_image in "\$\{DEPLOYMENT_BACKEND_IMAGE\}" "\$\{DEPLOYMENT_FRONTEND_IMAGE\}" "\$\{DEPLOYMENT_INQUIRY_IMAGE\}"; do[\s\S]*?io\.sabalan\.performance\.source-commit[\s\S]*?io\.sabalan\.performance\.source-hash/);
  assert.match(deploy, /PERFORMANCE_RELEASE_SOURCE_HASH="\$\{PERFORMANCE_SOURCE_HASH\}"/);
  for (const service of ['backend', 'frontend', 'inquiry']) {
    const block = compose.match(new RegExp(`^  ${service}:\\n(?:(?!^  [a-z]).|\\n)*`, 'gm'))?.[0];
    assert.ok(block, `${service} Compose service exists`);
    assert.match(block, /PERFORMANCE_SOURCE_COMMIT: \$\{PERFORMANCE_SOURCE_COMMIT\}/);
    assert.match(block, /PERFORMANCE_SOURCE_HASH: \$\{PERFORMANCE_SOURCE_HASH\}/);
  }
});
