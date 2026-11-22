import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards} from './lib/production-backend-base-local-guard.mjs';
import {freshBothHostBackendBasePreflight,stableBackendBaseFile} from './lib/production-backend-base-artifacts.mjs';

const repository=path.resolve(import.meta.dirname,'..'),[mode='--inspect',preflightFile]=process.argv.slice(2);
assert.ok(['--inspect','--run'].includes(mode));assert.equal(process.argv.length,mode==='--inspect'?(process.argv[2]===undefined?2:3):4);
const sourceOperation='7103e6bf357b4314a777a9bd067dbaf7';
const source='D:/sabalanerp-online-qa/compiled-support-catalog-preparation-71252b8661294649a91d36447cf8f246/compiled-support-'+sourceOperation;
const expectedManifest='b7e7b559b078fc275658bf500eda57380feeabc36740240bb613abf565654bbe';
const image='sha256:ac89709245a86a46e99e441c7efbe87a3713ad26d57826d62ab2ef96e88bbc15';
const remote='/app/online-runtime-acceptance/compiled-support-'+sourceOperation;
const sha=value=>createHash('sha256').update(value).digest('hex');
function verifySource(){
 const raw=fs.readFileSync(path.join(source,'source-manifest.json'));assert.equal(sha(raw),expectedManifest);
 const manifest=JSON.parse(raw);assert.equal(manifest.format,'sabalan-compiled-support-source/v1');assert.equal(manifest.operation,sourceOperation);
 assert.equal(Object.keys(manifest.files).length,224);
 for(const [relative,expected]of Object.entries(manifest.files)){
  assert.ok(!path.isAbsolute(relative)&&!relative.split('/').includes('..'));
  const file=path.join(source,relative);assert.equal(fs.realpathSync(file),path.resolve(file));
  const actual=stableBackendBaseFile(file);assert.equal(actual.sha256,expected.sha256);assert.equal(actual.bytes,expected.bytes);
 }
 return {manifestSha256:expectedManifest,files:224,source};
}
if(mode==='--inspect'){
 console.log(JSON.stringify({mode,source,expectedManifest,image,remote,dockerExecuted:false,browserExecuted:false,
  controller:'run-compiled-support-controller.py',requires:'root heavy token after original native closure + fresh both-host preflight',productionAdmission:false}));
}else{
 const sourceIdentity=verifySource(),preflight=freshBothHostBackendBasePreflight(repository,preflightFile);
 const operation='compiled-support-local-'+randomBytes(16).toString('hex'),scratch=path.resolve('D:/sabalanerp-online-qa',operation);
 fs.mkdirSync(scratch,{mode:0o700});const evidence=path.join(repository,'reports/qa',operation);
 const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
 const report={format:'sabalan-compiled-support-local/v1',operation,scratch,phase:'INTENT',pass:false,source:sourceIdentity,
  preflight,image,remote,helperFile:stableBackendBaseFile(import.meta.filename),productionAdmission:false,scope:'compiled UI with controlled auth/API, not native auth/SQL/24h'};
 function publish(suffix,value){const fd=fs.openSync(evidence+suffix+'.json','wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 async function docker(stage,args){
  await guards.status();const result=await commands.run('docker',args,{maximum:8*1024**2});
  publish('-'+stage,result);commands.assertSuccessful(result);return result.stdout;
 }
 let failure;
 try{
  publish('-intent',report);report.servicesBefore=await guards.protectedIdentities();
  assert.equal(report.servicesBefore['frontend-candidate'].image,image);
  const candidate=report.servicesBefore['backend-candidate'].id,frontend=report.servicesBefore['frontend-candidate'].id;
  const networks=JSON.parse(await docker('network',['inspect','--format','{{json .NetworkSettings.Networks}}',frontend]));
  const points=Object.values(networks);assert.equal(points.length,1);const frontendHost=points[0].IPAddress;
  assert.match(frontendHost,/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/);report.frontendHost=frontendHost;
  freshBothHostBackendBasePreflight(repository,preflightFile);assert.deepEqual(verifySource(),sourceIdentity);
  await docker('mkdir',['exec',candidate,'node','-e',"require('fs').mkdirSync(process.argv[1],{mode:448})",remote]);
  await docker('stage',['cp',source+'/.',candidate+':'+remote]);
  await docker('input',['exec',candidate,'node','-e',"require('fs').writeFileSync(process.argv[1],JSON.stringify({format:'sabalan-compiled-support-controller/v1',frontendHost:process.argv[2],operation:process.argv[3]}),{flag:'wx',mode:384})",remote+'/compiled-support-input.json',frontendHost,sourceOperation]);
  // The original exec is awaited even on controller failure; no timeout/signal
  // fabricates browser, test-client or ingress closure.
  await guards.status();report.controller=await commands.run('docker',['exec',candidate,'python3','-I','-B',remote+'/run-compiled-support-controller.py'],{maximum:8*1024**2});
  publish('-controller',report.controller);
  const retrieval=path.join(scratch,'retrieved');fs.mkdirSync(retrieval);
  await docker('retrieve',['cp',candidate+':'+remote+'/.',retrieval]);
  report.result=JSON.parse(fs.readFileSync(path.join(retrieval,'controller-result.json'),'utf8'));
  commands.assertSuccessful(report.controller);assert.equal(report.result.passResult,true);assert.equal(report.result.cliCode,0);
  assert.equal(report.result.ingressCode,0);assert.equal(report.result.allObservedOriginalBrowsersClosed,true);
  assert.equal(report.result.sourceFilesUnchanged,true);assert.equal(report.result.sourceManifestSha256,expectedManifest);
  const closure=JSON.parse(report.result.ingressClosureOutput.trim());
  assert.equal(closure.event,'closed');assert.equal(closure.originalIngressPid,report.result.ingressOriginal.pid);assert.equal(closure.activeConnections,0);
  assert.deepEqual(verifySource(),sourceIdentity);assert.deepEqual(stableBackendBaseFile(import.meta.filename),report.helperFile);
  report.phase='COMPLETE';report.pass=true;
 }catch(error){failure=error;report.phase='FAILED_HELD';report.error=error instanceof Error?error.message:'COMPILED_SUPPORT_FAILED';}
 finally{
  try{if(report.servicesBefore){report.servicesAfter=await guards.protectedIdentities();assert.deepEqual(report.servicesAfter,report.servicesBefore);report.tenServicesUnchanged=true;}}
  catch(error){failure??=error;report.pass=false;report.phase='FAILED_HELD';report.postGuardError=error instanceof Error?error.message:'SERVICE_POSTGUARD_FAILED';}
  report.originalChildren=await commands.close();
  if(report.originalChildren.interrupted){failure??=Error('ORIGINAL_CONTROLLER_INTERRUPTED');report.pass=false;report.phase='FAILED_HELD';}
 }
 publish('',report);console.log(JSON.stringify({phase:report.phase,pass:report.pass,evidence:evidence+'.json',scratch,productionAdmission:false}));if(failure)throw failure;
}
