import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES} from '../../deploy/scripts/online-production-gates.mjs';
const ts=createRequire(new URL('../../backend/package.json',import.meta.url))('typescript');
const source=fs.readFileSync('deploy/scripts/online-release-controller.mjs','utf8');
const tree=ts.createSourceFile('controller.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='OriginalOnlineReleaseController');
const canonical=v=>Array.isArray(v)?Array.from(v,canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))),sha=v=>createHash('sha256').update(v).digest('hex'),h=c=>c.repeat(64);
function fixture(options={}){
 const old='release_old',current='release_current',image='sha256:'+h('a'),oldImage='sha256:'+h('b'),controlId=h('c'),httpId=h('d');
 const accepted={manifest:{sourceCommit:'e'.repeat(40)},acceptance:{qualification:{schemaSha256:h('f')}},revalidate(){}};
 const oldAccepted={manifest:{sourceCommit:'1'.repeat(40)},revalidate(){}};
 const evidence={deploymentTargetImages:{backend:image},imageGraphs:{backend:{config:image,rootfsDiffIds:['sha256:'+h('2')]}}};
 const carrier=(containerId,privateAddress)=>({containerId,image:oldImage,privateAddress,startedAt:'2026-10-21T00:00:00Z'});
 const control={Id:controlId,Image:image,State:{Running:true,StartedAt:'2026-10-21T01:00:00Z'},HostConfig:{ReadonlyRootfs:true},Mounts:[{Destination:'/run/sabalan-online',RW:false},{Destination:'/remote',RW:true}]};
 if(options.codeOverride)control.Mounts.push({Destination:options.codeOverride,RW:false});
 const f={options,calls:[],decisions:[],ledgerReads:0,catalogReads:0,imageReads:0,accepted,oldAccepted,evidence,control,
  backend:carrier(h('3'),'172.20.0.3'),front:carrier(h('4'),'172.20.0.4'),inquiry:carrier(h('5'),'172.20.0.5'),
  registry:{current:{erp:'erp_old',inquiry:'inquiry_old'},builds:[{id:'erp_old'},{id:'inquiry_old'}],apiBindings:[{buildId:'erp_old',slotId:'backend_'+httpId}]}};
 const native=async(a,input,env)=>{
  f.calls.push({a,env});
  if(a[0]==='image'){f.imageReads++;return JSON.stringify([{Id:options.wrongRunnerImage?oldImage:image,RootFS:{Layers:evidence.imageGraphs.backend.rootfsDiffIds},Config:{Labels:{'io.sabalan.performance.source-commit':accepted.manifest.sourceCommit}}}]);}
  if(a[0]==='ps')return h('6');
  if(a[0]==='inspect'&&a[1]===h('6'))return JSON.stringify([{Id:h('6'),Image:oldImage,State:{StartedAt:'2026-10-21T00:00:00Z'},NetworkSettings:{Networks:{app:{IPAddress:'172.20.0.6'}}}}]);
  if(a[0]==='compose'&&a.includes('config')){assert.equal(env.DEPLOYMENT_BACKEND_IMAGE,image);assert.ok(a.includes('--profile'));return JSON.stringify({services:{deployment:{image,read_only:true,environment:{BACKEND_RUNTIME_ROLE:'control',DEPLOYMENT_REMOTE_MOUNT:'/remote'}}}});}
  if(a[0]==='compose'&&a.includes('run'))return controlId;
  if(a[0]==='inspect')return JSON.stringify([control]);
  if(a[0]==='exec'&&!a.includes('-i')){f.catalogReads++;return JSON.stringify({schemaSha256:options.wrongSchema?h('0'):h('f'),migrationCatalogSha256:options.catalogChanged&&f.catalogReads>1?h('0'):h('7')});}
  if(a[0]==='exec'&&a.includes('-i')){
   const p=JSON.parse(input.toString()),envelope=JSON.parse(p.context),d=envelope.decision;f.decisions.push(d);
   assert.equal(p.environment.DEPLOYMENT_GATE_MODE,'RELEASE');assert.equal(p.environment.DEPLOYMENT_TARGET_COMMIT,oldAccepted.manifest.sourceCommit);
   return JSON.stringify({ok:true,report:{format:'sabalan-deployment-report',mode:'RELEASE',deploymentId:d.deploymentId,releaseId:d.releaseId,targetCommit:p.environment.DEPLOYMENT_TARGET_COMMIT,
    manifestSha256:d.manifestSha256,checkpointSha256:d.checkpointSha256,originalControlRunner:d.controlRunner,originalGateContextSha256:sha(Buffer.from(p.context)),originalTargets:d.targets,
    gates:ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES.map(name=>({name,passed:!(options.failedGate&&name==='migration-history')}))}});
  }
  if(a[0]==='stop'||a[0]==='rm')return '';
  if(a[0]==='wait')return '0';
  throw Error('UNEXPECTED_NATIVE_BOUNDARY');
 };
 let text=declaration.getText(tree).replace(/^export /,'').replaceAll('import.meta.url',JSON.stringify(new URL('../../deploy/scripts/online-release-controller.mjs',import.meta.url).href));
 const replace={constructor:`constructor(){this.#owner={releaseId:current,deploymentId:'deployment_current'};this.#project='sabalanerp';this.#releases=new Map([[old,{input:{evidenceDirectory:'old',manifestSha256:h('8')}}],[current,{input:{evidenceDirectory:'current'}}]]);this.#carriers=new Map([['backend_'+httpId,{}]]);this.#children=new Map([[httpId,{closed:false,events:[{event:'READY'}],scope:{coordinationDirectory:'/coord'}}]]);this.#key=key;this.#databaseUrl='private';this.#database={$queryRaw:async strings=>{if(strings.join('').includes('checkpointJson'))return[{checkpointJson:{checkpoint:'actual'}}];fixture.ledgerReads++;return[{value:JSON.stringify([{id:'migration',migration_name:fixture.options.ledgerChanged&&fixture.ledgerReads>1?'changed':'current'}])}];}};}`,
  assertOwned:`async assertOwned(phases){assert(phases.includes('ONLINE_ROLLBACK_PUBLISHING'),'FIXTURE_LIVE_ROLLBACK_PHASE_REQUIRED');}`,
  prepareOriginalPublicationRegistry:`async prepareOriginalPublicationRegistry(){return fixture.registry;}`,
  '#assertOriginalUiCarrier':`async #assertOriginalUiCarrier(){return fixture.front;}`,
  '#assertOriginalInquiryCarrier':`async #assertOriginalInquiryCarrier(){return fixture.inquiry;}`,
  readCarrierReleaseEvidence:`readCarrierReleaseEvidence(releaseId){assert(releaseId===current,'FIXTURE_CURRENT_ACCEPTED_RUNNER_REQUIRED');return fixture.evidence;}`,
  readCarrierProvisioningTarget:`readCarrierProvisioningTarget(){return{composeFile:'/repo/prod.yml',onlineOverlayFile:'/repo/online.yml',storageOverlayFile:'/repo/storage.yml'};}`,
  '#withOriginalCarrierCensus':`async #withOriginalCarrierCensus(action){return action();}`,
  '#docker':`async #docker(...args){return native(...args);}`};
 for(const [name,value]of Object.entries(replace)){const n=declaration.members.find(m=>name==='constructor'?ts.isConstructorDeclaration(m):m.name?.getText(tree)===name);assert.ok(n,name);text=text.replace(n.getText(tree),value);}
 const env={fixture:f,current,old,httpId,h,key:generateKeyPairSync('ed25519').privateKey,native,Buffer,Date,Map,Set,structuredClone,randomBytes,sign,bytes,sha,ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES,
  assert:(v,c)=>assert.ok(v,c),readOriginalOnlineCarrier:async()=>f.backend,sanitizeProductionImageInspection:v=>v,productionInspectionSha256:v=>sha(bytes(v)),
  require:name=>{assert.equal(name,'./online-release-host-kernel.cjs');return{readOnlineReleaseEvidence:directory=>directory==='old'?oldAccepted:accepted};}};
 const Controller=vm.runInNewContext('('+text+')',env);return{f,controller:new Controller()};
}
test('actual rollback gate method keeps old serving identities and all18 RELEASE checks while current accepted image owns the immutable catalog',async()=>{
 const {f,controller}=fixture(),before=structuredClone([f.backend,f.front,f.inquiry]);
 const result=await controller.runOriginalProductionGates({releaseId:'release_old'});assert.equal(result.originalProductionGatesPassed,true);
 const d=f.decisions[0];assert.equal(d.releaseId,'release_old');assert.equal(d.controlRunner.releaseId,'release_current');assert.notEqual(d.controlRunner.image,d.targets.backend.image);
 assert.equal(f.imageReads,2);assert.equal(f.ledgerReads,2);assert.equal(f.catalogReads,2);assert.deepEqual([f.backend,f.front,f.inquiry],before);
 assert.equal(f.calls.filter(c=>c.a[0]==='stop').length,1);assert.equal(f.calls.filter(c=>c.a[0]==='rm').length,1);
});
test('actual rollback gate method refuses substituted runner/catalog/ledger or any failing RELEASE gate',async()=>{
 for(const options of [{wrongRunnerImage:true},{wrongSchema:true},{catalogChanged:true},{ledgerChanged:true},{failedGate:true},{codeOverride:'/'},{codeOverride:'/app'},{codeOverride:'/app/prisma'},{codeOverride:'/app/dist'}]){
  const {f,controller}=fixture(options);await assert.rejects(controller.runOriginalProductionGates({releaseId:'release_old'}));
  assert.ok(!f.calls.some(c=>c.a[0]==='stop'||c.a[0]==='rm'),'unproven original is retained');
 }
});

test('online deployment overlay explicitly seals its control root and supplies only bounded scratch',()=>{
 const overlay=fs.readFileSync('docker-compose.online.yml','utf8'),deployment=overlay.slice(overlay.indexOf('\n  deployment:'));
 assert.match(deployment,/\n    read_only: true\r?\n/);assert.match(deployment,/\/tmp:rw,nosuid,nodev,size=256m/);
 assert.doesNotMatch(deployment,/\/app\/(?:prisma|dist)(?::|\s)/);
});

test('real existing-project Compose resolves read-only deployment control with writable coordination and bounded scratch',{
 skip:process.env.SABALAN_GATE_COMPOSE_CONFIG_TEST!=='1'?'Set SABALAN_GATE_COMPOSE_CONFIG_TEST=1 for existing-project read-only Compose validation':false,
},()=>{
 const run=args=>{const r=spawnSync('docker',args,{encoding:'utf8',maxBuffer:8*1024**2,windowsHide:true});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);return r.stdout;};
 const ps=run(['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--format','json']);
 const rows=ps.trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows.length,10);assert.ok(rows.every(row=>row.Project==='sabalanerp-local'&&row.State==='running'));
 const config=JSON.parse(run(['compose','-f','docker-compose.prod.yml','-f','docker-compose.online.yml','--profile','deployment','config','--format','json','--no-interpolate'])),service=config.services.deployment;
 assert.equal(service.read_only,true);assert.deepEqual(service.tmpfs,['/tmp:rw,nosuid,nodev,size=256m']);
 assert.ok(service.volumes.some(row=>row.target==='/app/recovery-coordination'&&!row.read_only));
 assert.ok(service.volumes.some(row=>row.target==='/run/sabalan-online'&&row.read_only));
 assert.ok(!service.volumes.some(row=>['/app/prisma','/app/dist'].some(file=>file===row.target||file.startsWith(row.target+'/'))));
});
