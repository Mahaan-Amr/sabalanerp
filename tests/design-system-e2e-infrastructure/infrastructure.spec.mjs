import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseComposeStatus,
  validateRequiredServices
} from '../../scripts/design-system-e2e-preflight.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the design-system runner only targets the existing sabalanerp-local project', () => {
  const runner = read('scripts/run-design-system-e2e.mjs');
  const preflight = read('scripts/design-system-e2e-preflight.mjs');
  const config = read('playwright.design-system.config.ts');

  assert.match(preflight, /docker-compose\.local\.yml/);
  assert.match(`${runner}\n${preflight}`, /sabalanerp-local/);
  assert.doesNotMatch(`${runner}\n${preflight}`, /embedded-postgres|initdb|pg_ctl|DROP DATABASE|CREATE DATABASE/);
  assert.doesNotMatch(config, /webServer/);
  assert.match(config, /127\.0\.0\.1:3000/);
  assert.match(config, /trace: 'retain-on-failure'/);
  assert.match(config, /screenshot: 'only-on-failure'/);
  assert.match(config, /updateSnapshots: 'none'/);
});

test('Compose preflight accepts healthy required services and rejects missing or unhealthy services actionably', () => {
  const healthy = parseComposeStatus([
    JSON.stringify({ Service: 'postgres', State: 'running', Health: 'healthy' }),
    JSON.stringify({ Service: 'redis', State: 'running', Health: 'healthy' }),
    JSON.stringify({ Service: 'backend', State: 'running', Health: 'healthy' }),
    JSON.stringify({ Service: 'frontend', State: 'running', Health: 'healthy' })
  ].join('\n'));
  assert.doesNotThrow(() => validateRequiredServices(healthy));

  const missing = healthy.filter(({ Service }) => Service !== 'frontend');
  assert.throws(
    () => validateRequiredServices(missing),
    /sabalanerp-local.*frontend.*npm run docker:local:up/s
  );

  const unhealthy = healthy.map((service) => service.Service === 'backend'
    ? { ...service, Health: 'unhealthy' }
    : service);
  assert.throws(
    () => validateRequiredServices(unhealthy),
    /sabalanerp-local.*backend.*unhealthy/s
  );
});

test('shared browser helpers cover the required acceptance dimensions', () => {
  const helpers = read('tests/design-system-e2e/support/design-system.ts');
  const config = read('playwright.design-system.config.ts');
  for (const publicHelper of [
    'loginAsAdmin',
    'isolatedTestNamespace',
    'waitForStableState',
    'setTheme',
    'setViewportAndZoom',
    'assertNoSeriousAxeViolations',
    'assertMinimumTargetSize',
    'assertNoHorizontalOverflow',
    'assertVisibleFocus',
    'assertSemanticSurfaceVisuals',
    'deterministicScreenshotMasks'
  ]) {
    assert.match(helpers, new RegExp(`export (?:const|function) ${publicHelper}`));
  }
  assert.match(config, /reducedMotion: 'reduce'/);
  assert.match(helpers, /critical.*serious|serious.*critical/s);
});

test('CI runs on the approved local-project runner and retains failure evidence', () => {
  const workflow = read('.github/workflows/design-system-e2e.yml');
  assert.match(workflow, /self-hosted, sabalanerp-local/);
  assert.match(workflow, /pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /environment: design-system-e2e/);
  assert.match(workflow, /permissions:\s+contents: read/s);
  assert.match(workflow, /npm run test:design-system:e2e/);
  assert.match(workflow, /npm run docker:local:ps/);
  assert.match(workflow, /npm run docker:local:up/);
  assert.match(workflow, /sabalanerp-local-design-system-browser/);
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /test-results\/design-system\//);
  assert.match(workflow, /test-results\/design-system-report\//);
});
