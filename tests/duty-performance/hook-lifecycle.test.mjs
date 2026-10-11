import test from 'node:test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const frontendRequire = createRequire(path.resolve('frontend/package.json'));
const backendRequire = createRequire(path.resolve('backend/package.json'));
const { chromium, expect } = frontendRequire('@playwright/test');

test('actual count hooks isolate workspace/auth changes, unmounts, failures and mutation refresh', async () => {
  const status = execFileSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'],
    { encoding: 'utf8', windowsHide: true }).trim();
  const services = status.startsWith('[') ? JSON.parse(status) : status.split(/\r?\n/).map(line => JSON.parse(line));
  const frontend = services.find(service => service.Service === 'frontend');
  assert.equal(frontend?.Project, 'sabalanerp-local');
  assert.equal(frontend?.State, 'running');
  assert.equal(frontend?.Health, 'healthy');
  const output = path.resolve('reports/qa/server-response-20261011');
  await mkdir(output, { recursive: true });
  const bundle = path.join(output, 'hook-browser-fixture.js');
  backendRequire('esbuild').buildSync({ entryPoints: ['frontend/e2e/fixtures/duty-count-hook.tsx'],
    bundle: true, platform: 'browser', format: 'iife', tsconfig: 'frontend/tsconfig.json', outfile: bundle,
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const user = { id: 'fixture-session', username: 'fixture', role: 'ADMIN' };
    await page.route('**/api/auth/**', route => route.fulfill({ json: { success: true,
      data: route.request().url().endsWith('/login') ? { user } : user } }));
    const pending = [];
    await page.route('**/api/duties/workspaces/*/summary', route => new Promise(resolve => {
      pending.push(async (attention, status = 200) => { await route.fulfill({ status,
        json: { success: status === 200, data: { attention } } }); resolve(); });
    }));
    // Use the approved existing application's origin; no additional test server.
    await page.goto('http://127.0.0.1:3000/login');
    await page.setContent('<html dir="rtl"><body><div id="fixture"></div></body></html>');
    await page.addScriptTag({ path: bundle });
    const count = async value => {
      await expect(page.locator('output')).toHaveCount(2);
      await expect(page.locator('output').nth(0)).toHaveText(String(value));
      await expect(page.locator('output').nth(1)).toHaveText(String(value));
    };
    const waitRequests = length => expect.poll(() => pending.length).toBe(length);
    const focus = () => page.evaluate(() => { for (let i = 0; i < 6; i++) window.dispatchEvent(new Event('focus')); });
    await waitRequests(1);
    await pending[0](7); await count(7);
    await focus(); await waitRequests(2);
    await pending[1](0, 503); await count(7);
    await focus(); await waitRequests(3);
    await page.getByRole('button', { name: 'accounting', exact: true }).click();
    await waitRequests(4); await count(0);
    await pending[2](99); await pending[3](4); await count(4);
    await focus(); await waitRequests(5);
    await page.getByRole('button', { name: 'logout', exact: true }).click(); await count(0);
    await page.getByRole('button', { name: 'login', exact: true }).click(); await waitRequests(6);
    await pending[4](88); await count(0);
    await pending[5](3); await count(3);
    await focus(); await waitRequests(7);
    await page.getByRole('button', { name: 'mount', exact: true }).click();
    await expect(page.locator('output')).toHaveCount(0); await pending[6](60);
    await page.getByRole('button', { name: 'mount', exact: true }).click();
    await waitRequests(8); await count(0); await pending[7](9); await count(9);
    await focus(); await waitRequests(9);
    await page.evaluate(() => window.dispatchEvent(new Event('cross-workspace-duty:changed')));
    await pending[8](10); await waitRequests(10); await count(9);
    await pending[9](11); await count(11);
    await page.setViewportSize({ width: 390, height: 844 });
    await count(11);
    await page.screenshot({ path: path.join(output, 'hook-lifecycle.png') });
  } finally { await browser.close(); }
});
