import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {browserBuildIdentity,resolveBrowserBuildIdentity,finalizeBrowserBuild}=require('../../frontend/browser-build-identity.cjs');

test('compiled ERP browser identity is explicit, safe and does not admit a legacy build',async()=>{
  assert.equal(browserBuildIdentity(undefined),'');
  assert.equal(browserBuildIdentity(''),'');
  const id='erp_20261015t061500z_574220c115dd_release';
  assert.equal(browserBuildIdentity(id),id);
  for(const value of ['erp_tiny','../secret','erp_TestingBuild','inquiry_12345678','erp_1234<script>', ['erp_12345678']]) {
    assert.throws(()=>browserBuildIdentity(value),/BUILD_ID_INVALID/);
  }
  const saved=process.env.SABALAN_BROWSER_BUILD_ID;
  const configPath=require.resolve('../../frontend/next.config.js');
  try {
    process.env.SABALAN_BROWSER_BUILD_ID=id;
    delete require.cache[configPath];
    const config=require(configPath)('phase-production-build');
    assert.equal(config.deploymentId,id);
    assert.equal(await config.generateBuildId(),id);
    assert.equal(config.env.NEXT_PUBLIC_BROWSER_BUILD_ID,id);
    delete process.env.SABALAN_BROWSER_BUILD_ID;
    delete require.cache[configPath];
    const legacy=require(configPath)('phase-production-build');
    assert.equal(legacy.deploymentId,undefined);
    assert.equal(legacy.generateBuildId,undefined);
    assert.equal(legacy.env.NEXT_PUBLIC_BROWSER_BUILD_ID,'');
  } finally {
    if(saved===undefined)delete process.env.SABALAN_BROWSER_BUILD_ID;else process.env.SABALAN_BROWSER_BUILD_ID=saved;
    delete require.cache[configPath];
  }
});

test('runtime uses the built artifact and refuses either deployment environment override or changed native bytes',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-browser-build-'));
  const id='erp_20261015t061500z_2b8094d1_release';
  try {
    fs.writeFileSync(path.join(directory,'BUILD_ID'),id);
    const environment={SABALAN_BROWSER_BUILD_ID:id};
    assert.throws(()=>resolveBrowserBuildIdentity({phase:'phase-production-server',directory,environment}),/ARTIFACT_REQUIRED/);
    finalizeBrowserBuild({directory,environment});
    assert.equal(resolveBrowserBuildIdentity({phase:'phase-production-server',directory,environment:{}}),id,
      'a runtime with no override still uses the actual compiled image identity');
    assert.equal(resolveBrowserBuildIdentity({phase:'phase-production-server',directory,environment:{...environment,NEXT_DEPLOYMENT_ID:id}}),id);
    for(const invalid of [
      {SABALAN_BROWSER_BUILD_ID:'erp_different_build'},
      {SABALAN_BROWSER_BUILD_ID:''},
      {NEXT_DEPLOYMENT_ID:'erp_different_build'},
      {NEXT_DEPLOYMENT_ID:''},
    ])assert.throws(()=>resolveBrowserBuildIdentity({phase:'phase-production-server',directory,environment:invalid}),/IDENTITY_MISMATCH/);
    fs.writeFileSync(path.join(directory,'BUILD_ID'),'different_actual_image');
    assert.throws(()=>resolveBrowserBuildIdentity({phase:'phase-production-server',directory,environment:{}}),/ARTIFACT_MISMATCH/);
    assert.throws(()=>finalizeBrowserBuild({directory,environment}),/ARTIFACT_MISMATCH/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('sabalan-browser-build-'));
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
