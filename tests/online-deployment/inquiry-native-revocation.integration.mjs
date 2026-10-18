import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
assert.equal(process.argv.length, 3);
const configuration = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(configuration.format, 'sabalan-private-native-inquiry-next/v1');
assert.equal(configuration.url, 'http://127.0.0.1:3102');
function verify() {
  const output = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  const candidate = JSON.parse(execFileSync('docker', ['inspect', configuration.candidate], { encoding: 'utf8' }))[0];
  assert.equal(candidate.Image, configuration.image);
  assert.equal(candidate.Config.Labels['io.sabalan.online-qa.operation'], configuration.operation);
  assert.equal(candidate.State.Health.Status, 'healthy');
}
const operation = randomBytes(8).toString('hex'), rowNumber = 'REVOKED-' + operation;
const { chromium } = createRequire(path.join(root, 'frontend/package.json'))('@playwright/test');
const browser = await chromium.launch({ headless: true, channel: 'msedge' }), context = await browser.newContext();
let passed = false;
try {
  verify();
  await context.route('**/*', route => new URL(route.request().url()).origin === configuration.url ? route.continue() : route.abort());
  const page = await context.newPage();
  const login = async () => {
    await page.goto(configuration.url + '/admin/login');
    await page.locator('input[name=email]').fill('native-browser@example.invalid');
    await page.locator('input[name=password]').fill('local-native-browser-only');
    await Promise.all([page.waitForURL(configuration.url + '/admin'), page.locator('form button').click()]);
  };
  await login();
  await page.goto(configuration.url + '/admin/products/new');
  const form = page.locator('form').filter({ has: page.locator('input[name=rowNumber]') });
  await form.locator('input[name=rowNumber]').fill(rowNumber);
  await form.locator('input[name=name]').fill('Must never commit with revoked credentials');
  // This changes ONLY a known local test account, under the actual gate.
  // Never restore its old credential version or resurrect the old session.
  verify();
  execFileSync('docker', ['exec', configuration.candidate, '/usr/bin/flock', '--exclusive', '--nonblock',
    configuration.coordination + '/deployment-write-admission.lock', 'node', '-e', `
const {PrismaClient}=require('@prisma/client');const c=new PrismaClient();(async()=>{try{
if(process.env.DATABASE_URL!==${JSON.stringify(configuration.databaseUrl)})throw Error('PRIVATE_DATABASE_MISMATCH');
const a=await c.admin.findUniqueOrThrow({where:{id:'native-browser-qa-admin'}});if(a.email!=='native-browser@example.invalid')throw Error('PRIVATE_ACCOUNT_MISMATCH');
await c.admin.update({where:{id:a.id},data:{updatedAt:new Date(Math.max(Date.now(),a.updatedAt.getTime()+1))}});
}finally{await c.$disconnect();}})().catch(()=>{process.exitCode=1;});`], { encoding: 'utf8', timeout: 15000 });
  await Promise.all([page.waitForURL(configuration.url + '/admin/login'), form.locator('button').last().click()]);
  verify();
  const count = execFileSync('docker', ['exec', configuration.candidate, 'node', '-e', `
const {PrismaClient}=require('@prisma/client');const c=new PrismaClient();(async()=>{try{console.log(await c.product.count({where:{rowNumber:${JSON.stringify(rowNumber)}}}));}finally{await c.$disconnect();}})().catch(()=>{process.exitCode=1;});`], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.equal(count, '0');
  await login();
  passed = true;
} finally {
  await context.close(); await browser.close();
  fs.writeFileSync(path.join(root, 'reports/qa/inquiry-native-revocation-' + operation + '.json'), JSON.stringify({
    actualNativeNextRevocation: passed, credentialVersionRestored: false, draftHandoffProven: false,
    productionAdmission: false, candidate: configuration.candidate, rowNumber,
  }, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ actualNativeNextRevocation: passed, draftHandoffProven: false }));
