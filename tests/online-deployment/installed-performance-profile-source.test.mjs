import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{buildSync,transformSync}=require('../../backend/node_modules/esbuild');
const policy=buildSync({entryPoints:[fileURLToPath(new URL('../../backend/src/services/hrAuthorizationPolicy.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {evaluateHrAuthorization}=await import('data:text/javascript;base64,'+Buffer.from(policy).toString('base64'));
const raw=fs.readFileSync(new URL('./installed-performance-disabled-profile.fixture.ts',import.meta.url),'utf8');
const {qualifyInstalledDisabledPerformanceProfile}=await import('data:text/javascript;base64,'+Buffer.from(transformSync(raw,{loader:'ts',format:'esm'}).code).toString('base64'));

test('canonical authorization refuses retired export even with a live legacy grant',()=>{
 for(const role of ['USER','ADMIN']){
  const result=evaluateHrAuthorization({user:{id:'fixture',role,isActive:true},workspaceGrants:[],authorityGrants:[],assignedDutyIds:[],
   featureGrants:[{featureCode:'REQUEST_PERFORMANCE_EXPORT',level:'ADMIN',status:'ACTIVE',effectiveFrom:new Date(0),effectiveTo:null}]},
   {actionPermissionCodes:['REQUEST_PERFORMANCE_EXPORT']},new Date('2026-10-20T00:00:00Z'));
  assert.equal(result.allowed,false);assert.ok(result.missingLayers.includes('ACTION_PERMISSION'));
 }
});

test('pristine profile qualifier refuses diagnostic enabled history before HTTP',async()=>{
 let requests=0;const original=globalThis.fetch;globalThis.fetch=async()=>{requests++;throw Error('HTTP_FORBIDDEN');};
 try{
  await assert.rejects(qualifyInstalledDisabledPerformanceProfile({db:{$queryRaw:async()=>[{name:'qa_application_native_'+'a'.repeat(32),now:new Date()}],
   performanceFeaturePhaseVersion:{findFirst:async()=>({phase:'EXPANSION_RETIREMENT',releaseEnabled:true})}},base:'http://127.0.0.1',actorId:'fixture',sessionToken:'private',exportRoot:'/private'}),/actual absent production phase/);
  assert.equal(requests,0);
 }finally{globalThis.fetch=original;}
});
