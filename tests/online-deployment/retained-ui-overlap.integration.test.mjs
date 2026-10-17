import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {prepareRetainedUiBundle} from './retained-ui-bundle.fixture.mjs';

const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const enabled = process.env.ONLINE_RETAINED_UI_ACCEPTANCE === '1';
const repository = path.resolve(import.meta.dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const baseImage = 'sha256:f0a8954596279ccb01c029de7316022daa109b711a297f716cc9367d4bc9ec53';
const proxyImage = 'sha256:33cb69566bb1de4f8895e73486be364ccad1d60e978ba0a30f34c210ecf6f505';
const candidate = '7f4d8f79c29c6d80045ea490e8ddcab156416c072c286467cac1c6ce298ba5e2';
const services = ['frontend-online-old', 'frontend-online-new', 'frontend-online-proxy'];
const names = services.map(service => 'sabalanerp-local-' + service + '-1');

function verify() {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], {encoding: 'utf8'});
  const rows = output.trim().split(/\r?\n/).flatMap(line => JSON.parse(line));
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
}
function docker(args, options = {}) {
  verify(); return execFileSync('docker', args, {encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options});
}
function identities() {
  return JSON.parse(docker(['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(service => 'sabalanerp-local-' + service + '-1')]))
    .map(row => ({id: row.Id, image: row.Image, startedAt: row.State.StartedAt}));
}
const sourceHash = name => sha(fs.readFileSync(path.join(repository, name)));

test('immutable real Next builds preserve old tabs across durable switch, proxy restart, failed new slot and current-code rollback',
  {skip: !enabled || !canonical, timeout: 900000}, async () => {
    assert.equal(path.resolve(canonical).toLowerCase(), path.resolve('D:/sabalanerp').toLowerCase());
    const before = identities(), operation = randomBytes(16).toString('hex');
    const privateRoot = '/app/online-runtime-acceptance/retained-ui-' + operation;
    const stage = path.join(os.tmpdir(), 'sabalan-retained-ui-' + operation);
    const report = {operation, canonical: before, productionAdmission: false, inquiryActionsExercised: false,
      businessApiExercised: false, privateRoot, sources: Object.fromEntries([
        'deploy/scripts/browser-release-routing.mjs', 'deploy/scripts/browser-release-proxy.mjs',
        'deploy/scripts/browser-routing-store.mjs', 'deploy/scripts/browser-operation-journal.mjs',
        'tests/online-deployment/retained-ui-proxy.worker.mjs', 'tests/online-deployment/retained-ui-bundle.fixture.mjs',
        'tests/online-deployment/private-ui-management.fixture.mjs', 'tests/online-deployment/private-ui-management.test.mjs',
        'tests/online-deployment/retained-ui-overlap.integration.test.mjs', 'tests/online-deployment/Dockerfile.retained-ui',
        'docker-compose.retained-ui-acceptance.yml',
      ].map(name => [name, sourceHash(name)]))};
    const reportPath = path.join(repository, 'reports/qa/retained-ui-overlap-' + operation + '.json');
    fs.writeFileSync(reportPath.replace('.json', '-intent.json'), JSON.stringify(report) + '\n', {flag: 'wx'});
    for (const service of services) {
      const prior = docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=sabalanerp-local', '--filter', 'label=com.docker.compose.service=' + service]).trim();
      assert.equal(prior, '', 'Inspect a prior owned diagnostic operation before replacing ' + service);
    }
    const [base] = JSON.parse(docker(['image', 'inspect', baseImage]));
    assert.equal(base.Id, baseImage); assert.deepEqual(Object.keys(base.Config.Volumes ?? {}), []);
    const [helper] = JSON.parse(docker(['inspect', candidate]));
    assert.equal(helper.Image, proxyImage); assert.equal(helper.Config.Env.find(value => value === 'BACKEND_RUNTIME_ROLE=candidate'), 'BACKEND_RUNTIME_ROLE=candidate');
    const frontend = path.join(repository, 'frontend');
    await fsp.mkdir(stage, {mode: 0o700});
    const baseTag = 'sabalan-online-diagnostic-base:' + operation;
    docker(['tag', baseImage, baseTag]);
    const builds = [];
    for (const [name, artifact] of [['old', '.next-online-versioned-r13-20261015'], ['new', '.next-build']]) {
      const directory = path.join(stage, name);
      const bundle = await prepareRetainedUiBundle({frontend, artifact: path.join(frontend, artifact), directory, baseImage});
      await fsp.copyFile(path.join(repository, 'tests/online-deployment/Dockerfile.retained-ui'), path.join(directory, 'Dockerfile'));
      const tag = 'sabalan-online-diagnostic-ui:' + operation + '-' + name;
      const output = docker(['build', '--pull=false', '--network=none', '--build-arg', 'DIAGNOSTIC_BASE=' + baseTag, '-t', tag, directory], {timeout: 300000});
      assert.ok(typeof output === 'string');
      const [image] = JSON.parse(docker(['image', 'inspect', tag]));
      assert.equal(image.Config.Labels['io.sabalan.online-acceptance'], 'retained-ui');
      assert.deepEqual(image.RootFS.Layers.slice(0, base.RootFS.Layers.length), base.RootFS.Layers);
      assert.deepEqual(Object.keys(image.Config.Volumes ?? {}), []);
      builds.push({...bundle, image: image.Id, slotId: 'slot_erp_' + name, application: 'erp',
        id: bundle.buildId, actionIds: [], retiredAt: null, supportUntil: null});
    }
    assert.notEqual(builds[0].id, builds[1].id); assert.notEqual(builds[0].image, builds[1].image);
    report.builds = builds.map(({assets, ...build}) => ({...build, assets: assets.length}));
    const inquiry = {id: 'inquiry_unexercised_fixture', application: 'inquiry', slotId: 'slot_inquiry_unexercised',
      image: before[2].image, manifestSha256: '0'.repeat(64), assets: [], actionIds: [], retiredAt: null, supportUntil: null};
    const configuration = {format: 'sabalan-private-retained-ui-acceptance/v1',
      initialRegistry: {format: 'sabalan-browser-routing/v1', generation: 1,
        current: {erp: builds[0].id, inquiry: inquiry.id}, legacy: {erp: builds[0].id, inquiry: inquiry.id}, builds: [builds[0], inquiry]},
      nextBuild: builds[1], slotEndpoints: builds.map((build, index) => ({slotId: build.slotId, image: build.image,
        host: services[index], port: 3000}))};
    const bytes = Buffer.from(JSON.stringify(configuration) + '\n');
    docker(['exec', candidate, 'node', '-e',
      "const fs=require('node:fs'),p=process.argv[1];fs.mkdirSync(p,{mode:0o700});for(const n of ['publications','operations'])fs.mkdirSync(p+'/'+n,{mode:0o700});", privateRoot]);
    const configurationPath = path.join(stage, 'configuration.json'); await fsp.writeFile(configurationPath, bytes, {flag: 'wx'});
    docker(['cp', configurationPath, candidate + ':' + privateRoot + '/configuration.json']);
    docker(['exec', candidate, 'node', '-e',
      "const fs=require('node:fs'),c=require('node:crypto'),p=process.argv[1];fs.chmodSync(p,0o600);const actual=c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(actual!==process.argv[2])throw Error('configuration changed');const fd=fs.openSync(p,'r');fs.fsyncSync(fd);fs.closeSync(fd);",
      privateRoot + '/configuration.json', sha(bytes)]);
    const environment = {...process.env, RETAINED_UI_OLD_IMAGE: builds[0].image, RETAINED_UI_NEW_IMAGE: builds[1].image,
      RETAINED_UI_PROXY_IMAGE: proxyImage, RETAINED_UI_SOURCE_ROOT: repository.replaceAll('\\', '/'),
      RETAINED_UI_FIXTURE_ROOT: privateRoot, RETAINED_UI_CONFIGURATION_SHA256: sha(bytes)};
    const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), '-f', path.join(repository, 'docker-compose.retained-ui-acceptance.yml'), '--profile', 'retained-ui-acceptance'];
    docker([...compose, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '150', ...services], {env: environment, timeout: 200000});
    const containers = JSON.parse(docker(['inspect', ...names]));
    report.containers = containers.map(row => ({id: row.Id, image: row.Image, startedAt: row.State.StartedAt}));
    for (let index = 0; index < containers.length; index++) {
      const row = containers[index]; assert.equal(row.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
      assert.equal(row.Config.Labels['com.docker.compose.service'], services[index]); assert.equal(row.HostConfig.ReadonlyRootfs, true);
      assert.equal(row.Image, index < 2 ? builds[index].image : proxyImage);
      assert.ok(Object.values(row.HostConfig.PortBindings).flat().every(binding => binding.HostIp === '127.0.0.1'));
      if (index < 2) assert.deepEqual(row.Mounts, []);
    }
    const proxyId = containers[2].Id;
    function control(command) {
      const output = docker(['exec', proxyId, 'node', '-e',
        "const net=require('node:net');const s=net.connect(process.argv[1]);s.on('connect',()=>s.end(process.argv[2]+'\\n'));s.on('data',b=>process.stdout.write(b));s.on('error',e=>{console.error(e.message);process.exitCode=1});",
        privateRoot + '/management.sock', command]);
      const result = JSON.parse(output); assert.equal(result.ok, true, result.error); return result.value;
    }
    const {chromium} = require('@playwright/test');
    const browser = await chromium.launch({headless: true, channel: process.env.ONLINE_BROWSER_CHANNEL || 'msedge'});
    const origin = 'http://127.0.0.1:3104';
    const requests = [], failures = [];
    const page = await browser.newPage();
    page.on('pageerror', failure => failures.push(failure.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/_next/static/')) requests.push({kind: 'asset', id: url.searchParams.get('dpl')});
      if (request.headers().rsc === '1') requests.push({kind: 'rsc', id: request.headers()['x-deployment-id'], path: url.pathname});
    });
    try {
      assert.equal((await page.goto(origin + '/', {waitUntil: 'networkidle'})).status(), 200);
      // A second old tab remains on the actual old Next runtime and performs
      // genuine client navigation while new documents go to the new image.
      const oldNavigator = await browser.newPage({viewport: {width: 390, height: 150}}), nativeAfterSwitch = [];
      let aboutBeforeSwitch = 0, navigationRequests = 0;
      const beforeSwitch = request => {if (new URL(request.url()).pathname === '/about' && request.headers().rsc === '1') aboutBeforeSwitch++;};
      oldNavigator.on('request', beforeSwitch);
      oldNavigator.on('request', request => {if (request.isNavigationRequest()) navigationRequests++;});
      assert.equal((await oldNavigator.goto(origin + '/', {waitUntil: 'networkidle'})).status(), 200);
      // The hero link is below Next's viewport prefetch margin. No router or
      // request is patched; scrolling to click it later creates a real request.
      const aboutLink = oldNavigator.locator('a.public-button-secondary[href="/about"]');
      assert.ok((await aboutLink.boundingBox()).y > 400); assert.equal(aboutBeforeSwitch, 0);
      await page.locator('a[href="/login"]').first().click(); await page.waitForURL('**/login');
      await page.locator('input[name="identifier"]').fill('draft-kept-during-switch');
      await page.locator('input[name="password"]').fill('diagnostic-not-a-real-password');
      const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
      assert.equal(control('next').published.generation, 2);
      oldNavigator.off('request', beforeSwitch);
      oldNavigator.on('request', request => {
        const headers = request.headers();
        if (headers.rsc === '1') {
          nativeAfterSwitch.push({path: new URL(request.url()).pathname, id: headers['x-deployment-id']});
        }
      });
      const nativeResponse = oldNavigator.waitForResponse(response => new URL(response.url()).pathname === '/about'
        && response.request().headers().rsc === '1');
      await aboutLink.click();
      const actualResponse = await nativeResponse;
      assert.equal(actualResponse.status(), 200); assert.match(actualResponse.headers()['content-type'], /text\/x-component/);
      assert.equal(actualResponse.headers()['cache-control'], 'no-store, private');
      const transportOperation = actualResponse.headers()['x-sabalan-proxy-operation-id']; assert.match(transportOperation, /^[a-f0-9]{32}$/);
      const nativeIntent = JSON.parse(docker(['exec', proxyId, 'cat', privateRoot + '/operations/' + transportOperation + '.intent.json']));
      assert.equal(nativeIntent.generation, 2); assert.equal(nativeIntent.buildId, builds[0].id);
      await oldNavigator.waitForURL('**/about'); await oldNavigator.waitForLoadState('networkidle');
      assert.equal(navigationRequests, 1, 'The retained Next app must navigate without a new current-build document');
      assert.ok(nativeAfterSwitch.some(request => request.path === '/about' && request.id === builds[0].id));
      assert.ok(nativeAfterSwitch.every(request => request.id === builds[0].id));
      await oldNavigator.close();
      const next = await browser.newPage();
      const nextAssets = [];
      next.on('request', request => {const url = new URL(request.url()); if (url.pathname.startsWith('/_next/static/')) nextAssets.push(url.searchParams.get('dpl'));});
      assert.equal((await next.goto(origin + '/', {waitUntil: 'networkidle'})).status(), 200);
      assert.ok(nextAssets.length > 0); assert.ok(nextAssets.every(id => id === builds[1].id));
      await next.close();
      assert.equal(await page.locator('input[name="identifier"]').inputValue(), 'draft-kept-during-switch');
      assert.equal(await page.locator('input[name="password"]').inputValue(), 'diagnostic-not-a-real-password');
      assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), navigationCount);
      // Restart only after exact observed transport completion. The immutable
      // publication survives; no replacement pointer or caller PASS is used.
      assert.equal(control('drain').drained, true);
      docker(['stop', '--time', '-1', proxyId]);
      const [stopped] = JSON.parse(docker(['inspect', proxyId])); assert.equal(stopped.State.ExitCode, 0);
      docker(['start', proxyId]);
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        try {const response = await fetch(origin + '/'); if (response.ok) {ready = true; break;}} catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.ok(ready); assert.equal(control('status').publication.generation, 2);
      assert.equal(await page.locator('input[name="identifier"]').inputValue(), 'draft-kept-during-switch');
      const asset = builds[0].assets.find(asset => asset.path.endsWith('.js'));
      assert.ok(asset);
      const oldAsset = await fetch(origin + asset.path + '?dpl=' + builds[0].id);
      assert.equal(oldAsset.status, 200); assert.equal(sha(Buffer.from(await oldAsset.arrayBuffer())), asset.sha256);
      docker(['stop', '--time', '-1', containers[1].Id]);
      const unavailable = await fetch(origin + '/about', {headers: {rsc: '1', 'x-deployment-id': builds[1].id}});
      assert.equal(unavailable.status, 502, 'Unreachable new slot must never retry on the old slot');
      assert.equal((await fetch(origin + '/about', {headers: {rsc: '1', 'x-deployment-id': builds[0].id}})).status, 200);
      const pending = control('status').pending;
      assert.equal(pending.length, 1); assert.equal(pending[0].buildId, builds[1].id);
      assert.equal(control('rollback').published.generation, 3);
      const rolledBack = await fetch(origin + '/'); assert.equal(rolledBack.status, 200);
      const html = await rolledBack.text(); assert.ok(html.includes('dpl=' + builds[0].id));
      assert.equal(await page.locator('input[name="identifier"]').inputValue(), 'draft-kept-during-switch');
      await page.locator('a[href="/"]').first().click(); await page.waitForURL(origin + '/');
      await page.locator('a[href="/about"]').first().click(); await page.waitForURL('**/about'); await page.waitForLoadState('networkidle');
      assert.ok(requests.some(request => request.kind === 'rsc' && request.path === '/about' && request.id === builds[0].id));
      assert.ok(requests.every(request => request.id === builds[0].id)); assert.deepEqual(failures, []);
      report.results = {realOldNewBrowserIdentity: true, originalOpenFormPreserved: true, realRetainedRsc: nativeAfterSwitch,
        proxyRestartGeneration: 2, exactOldAssetHash: true, noCrossSlotRetryOnFailure: true,
        rollbackGeneration: 3, ambiguityRetained: pending.map(({id, buildId, method}) => ({id, buildId, method})),
        measuredSupportPromises: control('status').publication.registry.builds.map(({id, retiredAt, supportUntil}) => ({id, retiredAt, supportUntil})),
        // Real elapsed 24h is not claimed by this bounded run. Clock-bound
        // support selection is separately tested by the native store suite.
        elapsed24HoursExercised: false, draftArchiveExpiryExercised: false};
      // An ambiguous upstream outcome intentionally blocks drain; retain this
      // private diagnostic instance/journal for inspection rather than settle it.
      const drain = docker(['exec', proxyId, 'node', '-e',
        "const net=require('node:net');const s=net.connect(process.argv[1]);s.on('connect',()=>s.end('drain\\n'));s.on('data',b=>process.stdout.write(b));",
        privateRoot + '/management.sock']);
      assert.equal(JSON.parse(drain).error, 'BROWSER_PROXY_DRAIN_NOT_PROVEN');
      report.results.uncertainDrainRefused = true;
      assert.deepEqual(identities(), before);
      report.canonicalUnchanged = true; report.status = 'PASS_PRIVATE_OVERLAP_WITH_RETAINED_UNKNOWN';
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
      console.log(JSON.stringify({operation, report: path.basename(reportPath), results: report.results, builds: report.builds}));
    } finally {await browser.close();}
  });

