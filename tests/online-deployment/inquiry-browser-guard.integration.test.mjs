import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const enabled = process.env.INQUIRY_HTTP_QA_URL;
const container = 'sabalanerp-local-inquiry-candidate-1';
const base = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const expectedImage = process.env.INQUIRY_HTTP_QA_IMAGE;
const root = process.env.INQUIRY_HTTP_QA_ROOT;

function docker(args) {
  const rows = execFileSync('docker', ['compose', '-f', path.join(base, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' })
    .trim().split(/\r?\n/).map(JSON.parse);
  for (const service of ['backend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'), `Canonical ${service} must be healthy`);
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 });
}

function verify() {
  assert.equal(enabled, 'http://127.0.0.1:3102');
  assert.match(expectedImage || '', /^sha256:[a-f0-9]{64}$/);
  assert.ok(root && path.dirname(path.resolve(root)) === os.tmpdir());
  assert.match(path.basename(root), /^sabalan-inquiry-http-qa-[a-z0-9-]+$/);
  assert.equal(fs.realpathSync(root), path.resolve(root));
  const [candidate] = JSON.parse(docker(['inspect', container]));
  assert.equal(candidate.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  assert.equal(candidate.Config.Labels['com.docker.compose.service'], 'inquiry-candidate');
  assert.equal(candidate.Image, expectedImage);
  assert.equal(candidate.State.Health.Status, 'healthy');
  const normalized = value => value.replaceAll('\\', '/').toLowerCase();
  assert.ok(candidate.Mounts.some(m => m.Destination === '/data' && m.RW && normalized(m.Source) === normalized(root + '/data')));
  assert.ok(candidate.Mounts.some(m => m.Destination === '/app/recovery-coordination' && !m.RW
    && normalized(m.Source) === normalized(root + '/coordination')));
  assert.equal(candidate.HostConfig.ReadonlyRootfs, true);
}

function database(operation) {
  verify();
  assert.ok(['read', 'revoke', 'restore'].includes(operation));
  const script = `const {PrismaClient}=require('@prisma/client'),bcrypt=require('bcryptjs');
    if(process.env.DATABASE_URL!=='file:/data/inquiry.db?connection_limit=2&pool_timeout=5')throw Error('wrong QA database');
    const db=new PrismaClient();(async()=>{try{
      if(${JSON.stringify(operation)}!=='read')await db.admin.update({where:{id:'http-qa-admin'},data:{passwordHash:await bcrypt.hash(
        ${JSON.stringify(operation)}==='restore'?'local-inquiry-http-only':'changed-local-http-only',4)}});
      console.log(JSON.stringify(await db.product.findMany({orderBy:{rowNumber:'asc'},select:{rowNumber:true,name:true,listPrice:true,finalPrice:true}})));
    }finally{await db.$disconnect();}})().catch(error=>{console.error(error.code||'QA_DATABASE_FAILED');process.exitCode=1});`;
  return JSON.parse(docker(['exec', container, 'node', '-e', script]));
}

test('real Inquiry native forms commit normally and refuse maintenance or revoked-account writes',
  { skip: !enabled, timeout: 120000 }, async () => {
    verify();
    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch({ headless: true, channel: process.env.ONLINE_BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext({ javaScriptEnabled: false });
    const marker = path.join(root, 'coordination/deployment-maintenance.json');
    try {
      const page = await context.newPage();
      const login = async () => {
        await page.goto(enabled + '/admin/login');
        await page.locator('input[name=email]').fill('http-qa@example.invalid');
        await page.locator('input[name=password]').fill('local-inquiry-http-only');
        await page.locator('form button').click();
        await page.waitForURL(enabled + '/admin');
      };
      await login();
      const fill = async (rowNumber, name) => {
        await page.goto(enabled + '/admin/products/new');
        const form = page.locator('form').filter({ has: page.locator('input[name=rowNumber]') });
        await form.locator('input[name=rowNumber]').fill(rowNumber);
        await form.locator('input[name=name]').fill(name);
        assert.ok(await form.locator('input[name^="$ACTION_ID_"]').count(), 'native server-action identity must be present');
        return form;
      };
      const successful = await fill('NATIVEQA2', 'NATIVE_HTTP_QA_CREATED');
      await successful.locator('button').last().click();
      await page.waitForURL(enabled + '/admin');
      const committed = database('read');
      assert.equal(committed.filter(row => row.rowNumber === 'NATIVEQA2').length, 1);
      assert.equal(committed.find(row => row.rowNumber === 'NATIVEQA2').name, 'NATIVE_HTTP_QA_CREATED');

      const blocked = await fill('NATIVEQA3', 'MUST_NOT_COMMIT_DURING_MAINTENANCE');
      verify();
      fs.writeFileSync(marker, '{}', { flag: 'wx' });
      await blocked.locator('button').last().click();
      await page.waitForLoadState('load');
      assert.deepEqual(database('read'), committed);
      fs.unlinkSync(marker);

      const stale = await fill('NATIVEQA4', 'MUST_NOT_COMMIT_REVOKED_ACCOUNT');
      database('revoke');
      await stale.locator('button').last().click();
      await page.waitForURL('**/admin/login*');
      assert.deepEqual(database('read'), committed);
      const protectedPage = await context.request.get(enabled + '/admin/users', { maxRedirects: 0 });
      assert.equal(protectedPage.status(), 307);
      assert.match(protectedPage.headers().location, /\/admin\/login/);
    } finally {
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      database('restore');
      await context.close();
      await browser.close();
    }
  });
