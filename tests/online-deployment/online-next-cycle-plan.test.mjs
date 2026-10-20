import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {productionImageStore,sanitizeProductionImageInspection,productionInspectionSha256} from '../../deploy/scripts/production-image-execution-binding.mjs';
import {originalOnlineEvidenceReader} from '../../scripts/lib/original-online-evidence-reader.mjs';
const require=createRequire(import.meta.url),ts=require('../../backend/node_modules/typescript');
const source=fs.readFileSync(new URL('../../deploy/scripts/online-release-controller.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('controller.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=tree.statements.find(row=>ts.isClassDeclaration(row)&&row.name.text==='OriginalOnlineReleaseController');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function method(name,context){const node=declaration.members.find(row=>row.name?.getText(tree)===name);assert.ok(node);const adapt=value=>value.replace(/this\.#([A-Za-z][A-Za-z0-9_]*)/g,'this.$1'),body=adapt(node.body.getText(tree).slice(1,-1));const actual=new AsyncFunction(...Object.keys(context),...node.parameters.map(row=>adapt(row.getText(tree))),body);return function(...args){return actual.apply(this,[...Object.values(context),...args]);};}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),check=(value,code)=>{if(!value)throw Error(code);};
const input={deploymentId:'next_deployment',releaseId:'next_release',targetCommit:'b'.repeat(40)};
function harness(){
 const events=[],priorEvidence={immutable:'prior accepted graph'},oldReference={file:'/root/private/old.json',sha256:'a'.repeat(64)};
 const plan={format:'sabalan-prebuilt-protected-release-plan/v1',applicationCommit:input.targetCommit,imageStore:'containerd',images:{}};
 for(const [i,role]of ['backend','frontend','inquiry'].entries()){const index='sha256:'+String(i+1).repeat(64);plan.images[role]={image:index,archiveGraph:{index,platform:'sha256:'+'4'.repeat(64),config:'sha256:'+String(i+5).repeat(64),rootfsDiffIds:['sha256:'+'8'.repeat(64)],archiveSha256:'9'.repeat(64),archiveBytes:10240}};}
 let planRaw=Buffer.from(JSON.stringify(plan)),leaseAcquired=true;
 const reference={file:'/root/private/next.json',sha256:sha(planRaw)};
 const native=role=>{const {image,archiveGraph:g}=plan.images[role];return {Id:image,Descriptor:{mediaType:'application/vnd.oci.image.index.v1+json',digest:image,size:123},RootFS:{Type:'layers',Layers:g.rootfsDiffIds},Os:'linux',Architecture:'amd64',Config:{Labels:null}};};
 const privateRead=(file)=>{if(file==='/key'){events.push('KEY');return {pin:'original-key'};}events.push('PLAN');check(file===reference.file,'OLD_PLAN_SELECTED');return {data:planRaw};};
 const kernel={validateProductionExecutionBindings:(...args)=>{events.push('VALIDATED');return originalOnlineEvidenceReader().validateProductionExecutionBindings(...args);},
  PrismaDeploymentStore:class{},acquireDeploymentLease:async(store,args)=>{events.push('LEASE');assert.equal(Object.hasOwn(args,'prebuiltReleasePlan'),false);return {acquired:leaseAcquired,deployment:{deploymentId:args.deploymentId,releaseId:args.releaseId,leaseToken:'new-original'}};},
  transitionDeployment:async()=>{events.push('TRANSITION');},heartbeatDeployment:async()=>{}};
 const host={advisory:{owned:true},held:null,lock:{assertOwned(){events.push('LOCK');}},parentBirth:{pid:process.ppid,stat:'original-parent'},keyPin:'original-key',database:{},owner:{releaseId:'prior_release'},prebuiltReleasePlan:oldReference,releases:new Map([['prior_release',priorEvidence]]),
  async assertAdvisory(){events.push('ADVISORY');},async beginNextOwnedLease(owner){events.push('BEGIN');this.owner=owner;},
  async docker(args){events.push(args[0]==='info'?'INFO':'INSPECT');if(args[0]==='info')return JSON.stringify({Driver:'overlayfs',DriverStatus:[['driver-type','io.containerd.snapshotter.v1']]});return JSON.stringify([native(Object.keys(plan.images).find(role=>plan.images[role].image===args[2]))]);}};
 const fakeFs={readFileSync(file){if(file.startsWith('/proc/')&&file.endsWith('/stat'))return ') '+Array.from({length:20},(_,i)=>i===19?'original-parent':'x').join(' ');return file.includes('product_uuid')?'11111111-2222-4333-8444-555555555555':'66666666-7777-4888-8999-aaaaaaaaaaaa';}};
 const context={assert:check,fs:fakeFs,path,process,readPrivate:privateRead,PRIVATE_KEY:'/key',require:()=>kernel,randomBytes:()=>Buffer.alloc(32,1),setInterval:()=>17,sha,productionImageStore,sanitizeProductionImageInspection,productionInspectionSha256};
 host.observeProductionExecutionBindings=method('#observeProductionExecutionBindings',context);
 // The actual method body executes with only its external side effects stubbed.
 const invoke=async(value)=>method('acquireNextCycle',context).call(host,value);
 return {events,host,reference,oldReference,priorEvidence,plan,invoke,setRaw(value){planRaw=value;},setLease(value){leaseAcquired=value;}};
}
test('next original cycle validates new immutable plan/native images before lease and retains prior rollback evidence',async()=>{
 const f=harness();await f.invoke({...input,prebuiltReleasePlan:f.reference});
 assert.ok(f.events.indexOf('ADVISORY')<f.events.indexOf('PLAN'));assert.ok(f.events.indexOf('VALIDATED')<f.events.indexOf('LEASE'));
 assert.equal(f.events.filter(x=>x==='INSPECT').length,3);assert.deepEqual(f.host.prebuiltReleasePlan,f.reference);assert.equal(Object.isFrozen(f.host.prebuiltReleasePlan),true);
 assert.equal(f.host.releases.get('prior_release'),f.priorEvidence);assert.equal(f.host.owner.releaseId,input.releaseId);
});
test('held owner, changed plan/hash/source and failed native inspection refuse before lease; no new input adopts a plan',async()=>{
 for(const change of [f=>{f.host.held='lost';},f=>{f.host.lock.assertOwned=()=>{throw Error('lock lost');};},f=>{f.reference.sha256='f'.repeat(64);},
  f=>{f.setRaw(Buffer.from(JSON.stringify({...f.plan,applicationCommit:'f'.repeat(40)})));f.reference.sha256=sha(Buffer.from(JSON.stringify({...f.plan,applicationCommit:'f'.repeat(40)})));},
  f=>{f.host.docker=async()=>{throw Error('native failed');};}]){
  const f=harness();change(f);await assert.rejects(f.invoke({...input,prebuiltReleasePlan:f.reference}));assert.equal(f.events.includes('LEASE'),false);assert.equal(f.host.prebuiltReleasePlan,f.oldReference);
 }
 const absent=harness();await assert.rejects(absent.invoke(input),/OLD_PLAN_SELECTED/);assert.equal(absent.events.includes('LEASE'),false);
 const busy=harness();busy.setLease(false);await assert.rejects(busy.invoke({...input,prebuiltReleasePlan:busy.reference}),/ONLINE_NEXT_LEASE_BUSY/);assert.equal(busy.host.prebuiltReleasePlan,busy.oldReference);assert.equal(busy.host.releases.get('prior_release'),busy.priorEvidence);
});
test('existing original FIFO and CLI forward optional plan in ACQUIRE_NEXT input without another launcher config',()=>{
 const launcher=fs.readFileSync(new URL('../../deploy/scripts/online-release-launcher.py',import.meta.url),'utf8'),cli=fs.readFileSync(new URL('../../deploy/scripts/online-release-controller-cli.mjs',import.meta.url),'utf8');
 assert.ok(launcher.includes("else:result=call(command['command'],**fields)"));assert.ok(cli.includes("case 'ACQUIRE_NEXT':result=await controller.acquireNextCycle(request.input);break;"));
});
