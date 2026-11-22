import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
assert.equal(process.argv.length, 3);
const file = fs.realpathSync(process.argv[2]), configuration = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(configuration.format, 'sabalan-private-native-inquiry-next/v1');
assert.equal(configuration.url, 'http://127.0.0.1:3102');
function verify() {
  const output = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  const [candidate] = JSON.parse(execFileSync('docker', ['inspect', configuration.candidate], { encoding: 'utf8' }));
  assert.equal(candidate.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  assert.equal(candidate.Config.Labels['io.sabalan.online-qa.operation'], configuration.operation);
  assert.equal(candidate.Image, configuration.imageIndex); assert.equal(candidate.State.Health.Status, 'healthy');
}
verify();
const seeded = execFileSync('docker', ['exec', configuration.candidate, '/usr/bin/flock', '--exclusive', '--nonblock',
  configuration.coordination + '/deployment-write-admission.lock', '/usr/local/bin/node', '-e', `
const {PrismaClient}=require('@prisma/client'),bcrypt=require('bcryptjs');
if(process.env.DATABASE_URL!==${JSON.stringify(configuration.databaseUrl)})throw Error('QA_DATABASE_MISMATCH');
const client=new PrismaClient();(async()=>{try{
if(await client.admin.count()||await client.user.count()||await client.product.count())throw Error('QA_DATABASE_NOT_EMPTY');
await client.admin.create({data:{id:'native-browser-qa-admin',email:'native-browser@example.invalid',passwordHash:await bcrypt.hash('local-native-browser-only',4)}});
console.log('PRIVATE_ADMIN_SEEDED');}finally{await client.$disconnect();}})().catch(()=>{console.error('PRIVATE_SEED_FAILED');process.exitCode=1;});`],
{ encoding: 'utf8', timeout: 30000 });
assert.match(seeded, /PRIVATE_ADMIN_SEEDED/);
const { chromium } = createRequire(path.join(root, 'frontend/package.json'))('@playwright/test');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ javaScriptEnabled: false });
let passed = false;
try {
  await context.route('**/*', route => new URL(route.request().url()).origin === configuration.url ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(configuration.url + '/admin/login');
  await page.locator('input[name=email]').fill('native-browser@example.invalid');
  await page.locator('input[name=password]').fill('local-native-browser-only');
  await Promise.all([page.waitForURL(configuration.url + '/admin', { timeout: 15000 }), page.locator('form button').click()]);
  await page.goto(configuration.url + '/admin/products/new');
  const form = page.locator('form').filter({ has: page.locator('input[name=rowNumber]') });
  await form.locator('input[name=rowNumber]').fill('NATIVE-NEXT-SMOKE');
  await form.locator('input[name=name]').fill('کالای آزمون فرم واقعی');
  assert.ok(await form.locator('input[name^="$ACTION_ID_"]').count());
  await Promise.all([page.waitForURL(configuration.url + '/admin', { timeout: 15000 }), form.locator('button').last().click()]);
  verify();
  const values = JSON.parse(execFileSync('docker', ['exec', configuration.candidate, 'node', '-e', `
const {PrismaClient}=require('@prisma/client');const client=new PrismaClient();(async()=>{try{console.log(JSON.stringify(await client.product.findMany({select:{rowNumber:true,name:true}})));}finally{await client.$disconnect();}})().catch(()=>{process.exitCode=1;});`], { encoding: 'utf8', timeout: 10000 }));
  assert.deepEqual(values, [{ rowNumber: 'NATIVE-NEXT-SMOKE', name: 'کالای آزمون فرم واقعی' }]);
  passed = true;
} finally {
  await context.close(); await browser.close();
  fs.writeFileSync(path.join(root, 'reports/qa', 'inquiry-native-browser-smoke-' + configuration.operation + '.json'),
    JSON.stringify({ actualNativeNextForm: passed, javaScriptEnabled: false, candidate: configuration.candidate,
      nativeActionOverlap: false, productionAdmission: false }, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ actualNativeNextForm: passed, nativeActionOverlap: false, productionAdmission: false }));
