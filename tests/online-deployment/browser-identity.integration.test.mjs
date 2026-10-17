import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const enabled=process.env.ONLINE_BROWSER_ACCEPTANCE_URL;
const expected=process.env.ONLINE_BROWSER_ACCEPTANCE_BUILD_ID;
const base='D:/sabalanerp/docker-compose.local.yml';
const container='sabalanerp-local-frontend-candidate-1';

function verifyLocal() {
  const rows=execFileSync('docker',['compose','-f',base,'ps','--format','json'],{encoding:'utf8',timeout:30000})
    .trim().split(/\r?\n/).filter(Boolean).flatMap(line=>JSON.parse(line));
  for(const name of ['frontend','backend','postgres']) assert.ok(rows.some(row=>row.Project==='sabalanerp-local'
    && row.Service===name && row.State==='running' && row.Health==='healthy'),`Canonical ${name} must remain healthy`);
}

function candidateDocker(args) {
  verifyLocal();
  return execFileSync('docker',args,{encoding:'utf8',timeout:60000});
}

function verifyCandidate() {
  assert.equal(enabled,'http://127.0.0.1:3101');
  assert.match(expected??'',/^erp_[a-z0-9_-]{8,90}$/);
  const [candidate]=JSON.parse(candidateDocker(['inspect',container]));
  assert.equal(candidate.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
  assert.equal(candidate.Config.Labels['com.docker.compose.service'],'frontend-candidate');
  assert.equal(candidate.State.Status,'running');
  assert.ok(candidate.Mounts.some(mount=>mount.Destination==='/app/.next-build' && mount.RW===false));
  assert.ok(candidate.Mounts.some(mount=>mount.Destination==='/app/public' && mount.RW===false));
}

test('actual installed Next configuration rejects both runtime deployment-identity overrides',
  {skip:!enabled,timeout:90000},()=>{
    verifyCandidate();
    const source='('+function(){
      const assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs');
      const artifact=JSON.parse(fs.readFileSync('/app/.next-build/browser-build-identity.json','utf8'));
      const script="require('next/dist/server/config').default('phase-production-server','/app').then(config=>{if(config.deploymentId!=="
        +JSON.stringify(artifact.browserBuildId)+")throw Error('incorrect built ID'); console.log('BUILT_ID_MATCH')}).catch(e=>{console.error(e.message);process.exitCode=1})";
      const environment={...process.env};delete environment.SABALAN_BROWSER_BUILD_ID;delete environment.NEXT_DEPLOYMENT_ID;
      const valid=cp.spawnSync(process.execPath,['-e',script],{env:environment,encoding:'utf8',timeout:20000});
      assert.equal(valid.status,0,valid.stderr);
      for(const override of [{SABALAN_BROWSER_BUILD_ID:'erp_other_runtime'},{NEXT_DEPLOYMENT_ID:'erp_other_runtime'}]) {
        const result=cp.spawnSync(process.execPath,['-e',script],{env:{...environment,...override},encoding:'utf8',timeout:20000});
        assert.notEqual(result.status,0);assert.match(result.stderr,/BROWSER_BUILD_.*IDENTITY_MISMATCH/);
      }
      console.log(JSON.stringify({next:require('next/package.json').version,browserBuildId:artifact.browserBuildId,passed:true}));
    }.toString()+')()';
    const result=JSON.parse(candidateDocker(['exec',container,'node','-e',source]));
    assert.equal(result.next,'15.5.25');assert.equal(result.browserBuildId,expected);assert.equal(result.passed,true);
  });

test('a real browser loads versioned assets and sends its own build identity on RSC navigation',
  {skip:!enabled,timeout:90000},async()=>{
    verifyCandidate();
    const {chromium}=require('@playwright/test');
    const browser=await chromium.launch({headless:true,channel:process.env.ONLINE_BROWSER_CHANNEL||'msedge'});
    try {
      const page=await browser.newPage();const rsc=[],assets=[],errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{
        const url=new URL(request.url());
        if(url.pathname.startsWith('/_next/static/') && /\.(js|css)$/.test(url.pathname)) assets.push(url.searchParams.get('dpl'));
        if(request.headers().rsc==='1')rsc.push({path:url.pathname,id:request.headers()['x-deployment-id']});
      });
      // Next can retain an unconsumed speculative 404 prefetch even after its
      // server response ends. Global network idleness is not UI readiness.
      const response=await page.goto(enabled+'/',{waitUntil:'domcontentloaded',timeout:60000});
      assert.equal(response.status(),200);
      await page.waitForFunction(()=>Boolean(window.next?.version));
      await page.locator('a[href="/about"]').first().click();
      await page.waitForURL('**/about');
      assert.ok(assets.length>0);assert.ok(assets.every(id=>id===expected));
      assert.ok(rsc.some(request=>request.path==='/about' && request.id===expected));
      assert.ok(rsc.every(request=>request.id===expected));
      assert.deepEqual(errors,[]);
    } finally {await browser.close();}
  });

test('compiled login and session bootstrap send the same immutable producer identity without losing form input on denial',
  {skip:!enabled,timeout:90000},async()=>{
    verifyCandidate();
    const {chromium}=require('@playwright/test');
    const browser=await chromium.launch({headless:true,channel:process.env.ONLINE_BROWSER_CHANNEL||'msedge'});
    try {
      const page=await browser.newPage(),observed=[];
      await page.route(enabled+'/api/**',async route=>{
        const request=route.request(),url=new URL(request.url());
        observed.push({path:url.pathname,method:request.method(),id:request.headers()['x-deployment-id']});
        await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({success:false,error:'اطلاعات ورود آزمایشی پذیرفته نشد.'})});
      });
      const worker=await page.request.get(enabled+'/sw.js');
      assert.equal(worker.status(),200);
      const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
      assert.equal(sha(await worker.body()),sha(fs.readFileSync(new URL('../../frontend/public/sw.js',import.meta.url))));
      await page.goto(enabled+'/login',{waitUntil:'domcontentloaded'});
      await page.locator('input[name="identifier"]').fill('diagnostic-identity-user');
      await page.locator('input[name="password"]').fill('diagnostic-not-a-real-password');
      await page.locator('button[type="submit"]').click();
      await page.getByText('اطلاعات ورود آزمایشی پذیرفته نشد.',{exact:true}).waitFor();
      assert.equal(await page.locator('input[name="identifier"]').inputValue(),'diagnostic-identity-user');
      assert.equal(await page.locator('input[name="password"]').inputValue(),'diagnostic-not-a-real-password');
      assert.ok(observed.some(request=>request.path==='/api/auth/me'));
      assert.ok(observed.some(request=>request.path==='/api/auth/login' && request.method==='POST'));
      assert.ok(observed.every(request=>request.id===expected));
      assert.equal(new URL(page.url()).pathname,'/login');
    } finally {await browser.close();}
  });
