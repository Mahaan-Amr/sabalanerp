import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../backend/package.json',import.meta.url))('typescript');

// Execute the actual private-state controller method and gate verifier. Only
// native I/O and construction are replaced. These tests grant no ownership or
// production authority; real same-process Linux acceptance remains required.
const source=fs.readFileSync('deploy/scripts/online-release-controller.mjs','utf8');
const tree=ts.createSourceFile('controller.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name.text==='OriginalOnlineReleaseController');
const gateSource=fs.readFileSync('deploy/scripts/online-production-gates.mjs','utf8').replace('export const','const');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value)));
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest='a'.repeat(64),commit='b'.repeat(40);
function fixture(mode='BOOTSTRAP'){
 let text=declaration.getText(tree).replace(/^export /,'').replaceAll('import.meta.url',JSON.stringify(new URL('../../deploy/scripts/online-release-controller.mjs',import.meta.url).href));
 const ctor=declaration.members.find(ts.isConstructorDeclaration);
 text=text.replace(ctor.getText(tree),`constructor(f){
  this.#database=f.database;this.#owner=f.owner;this.#lock={assertOwned:()=>f.lockChecks++};this.#parentBirth={pid:20,stat:'birth20'};
  this.#keyPin='keypin';this.#advisory={pid:99,birth:'dbBirth'};this.#currentServingReleaseId='release01';this.#lastPublicationSha=f.publication.publicationSha256;
  this.#bootstrap=f.mode==='BOOTSTRAP'?{finalized:true}:null;this.#store={readPublication:async()=>f.readPublication()};
  this.#productionGates.set('release01',f.gates);this.#releases.set('release01',{});this.#children=new Map(f.children);this.#inquiryActors=new Map(f.inquiry);this.#edge=f.edge;
  this.#carriers=new Map([['frontslot',{}]]);this.#carrierSnapshots=new Map([['frontslot',f.front]]);this.#observers=f.observers;
  if(f.mode==='FOLLOWING')this.#terminalCycles.set('deploy001',f.terminal);
 }`);
 for(const [name,replacement] of [
  ['#docker',`async #docker(args){return fixtureDocker(args);}`],
  ['#send',`async #send(state,command,input){state.events.push({event:'PUBLICATION_OBSERVED',sequence:++state.sequence,...input});}`],
 ])text=text.replace(declaration.members.find(row=>row.name?.getText(tree)===name).getText(tree),replacement);
 text=text.slice(0,-1)+`__testCaptureBirth(id){return this.#retainOriginalHostBirth(this.#children.get(id));}
 __testRetainedChild(id){return this.#children.get(id);}`+'}';
 const actor=(pid,id,purpose)=>({child:{pid,exitCode:null,signalCode:null},originalHostBirth:'birth'+pid,scope:{runtimeId:id,releaseId:'release01',purpose,image:'image',manifestSha256:digest,coordinationDirectory:'/app/recovery-coordination'},containerId:'container'+pid,closed:false,events:[{event:'READY'},{event:'ACTOR_STARTED'}],pending:'',runtimePending:''});
 const http=actor(101,'runtime01','http'),jobs=actor(102,'runtime02','jobs'),inquiry=actor(103,'runtime03','inquiry');
 Object.assign(inquiry,{ready:{},image:'image',startedAt:'start103'});
 const edge={...actor(104,'edge','edge'),image:'image',startedAt:'start104',sequence:0};
 const front={kind:'frontend',containerId:'front',startedAt:'startfront',image:'image',build:{id:'build01'}};
 const publication={generation:1,publicationSha256:digest,registry:{builds:[{application:'erp',id:'build01',slotId:'frontslot',image:'image',manifestSha256:digest},{application:'inquiry',id:'inquiry01',slotId:'inquiry_runtime03',image:'image'}],apiBindings:[{buildId:'build01',slotId:'backend_runtime01',image:'image',manifestSha256:digest,browserManifestSha256:digest}]}};
 const context={Object,Map,Set,Buffer,URL,fs,structuredClone,Date,clearInterval:()=>{},process:{pid:10,ppid:20},assert:(value,code)=>assert.ok(value,code),bytes,sha,PRIVATE_KEY:'key',readPrivate:()=>({pin:'keypin'}),originalProcessBirth:pid=>'birth'+pid};
 vm.runInNewContext(gateSource,context);const names=vm.runInNewContext('[...ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES]',context);
 const checkpoint={remoteVerified:true},report={deploymentId:'deploy001',releaseId:'release01',checkpointSha256:sha(bytes(checkpoint)),gates:names.map(name=>({name,passed:true}))};
 const operation={id:'deploy001',releaseId:'release01',targetCommit:commit,phase:'COMPLETED',activeKey:null,checkpointJson:checkpoint,reportJson:report};
 const gates={report,sha256:sha(bytes(report)),targets:Object.fromEntries([['backend','container101','start101'],['frontend','front','startfront'],['inquiry','container103','start103'],['nginx','nginx','startnginx']].map(([name,containerId,startedAt])=>[name,{containerId,image:'image',startedAt,url:'http://127.0.0.1/'}])),runtimeId:'runtime01',expiresAt:new Date(Date.now()+600000).toISOString()};
 const f={mode,owner:{deploymentId:'deploy001',releaseId:'release01',leaseToken:'private'},children:[['runtime01',http],['runtime02',jobs]],inquiry:[['token',inquiry]],edge,front,gates,operation,publication,lockChecks:0,observers:[],active:[],epoch:{id:'epoch01',releaseId:'release01',publicationSha256:digest,generation:1},terminal:{repository:{},audit:{publicationSha256:digest},certificate:{signature:'actual-finish-fixture'},terminalEnvelopeSha256:sha(bytes({signature:'actual-finish-fixture'}))},readPublication:()=>publication};
 f.queries=[];f.database={$queryRaw:async strings=>{const sql=strings.join('?');f.queries.push(sql);if(sql.includes('pg_advisory_unlock'))return [{owned:true}];if(sql.includes('pg_backend_pid()'))return [{pid:99,birth:'dbBirth',owned:!f.lostAdvisory}];if(sql.includes('online_serving_epochs'))return [f.epoch];if(sql.includes('SELECT id FROM')&&!sql.includes('WHERE id='))return f.active;if(sql.includes('SELECT "reportJson"'))return [{reportJson:operation.reportJson,checkpointJson:operation.checkpointJson}];return f.operationMissing?[]:[operation];}};
 context.fixtureDocker=async args=>args[0]==='exec'?JSON.stringify(f.terminalObservation??{format:'sabalan-original-client-terminal-observation/v1',maintenanceAbsent:true,readOnly:true,endpoints:['backend','frontend','inquiry','nginx'].map(name=>({name,status:200,bodySha256:digest}))}):JSON.stringify([{Id:args[1],Image:'image',State:{Running:true,StartedAt:'start'+(args[1]==='front'?'front':args[1].replace('container','')),Health:{Status:'healthy'}}}]);
 context.readMountedOriginalCheckpointFile=async()=>JSON.stringify({format:'sabalan-accepted-online-terminal-coverage/v1',envelope:f.mountedEnvelope??f.terminal.certificate});
 const Controller=vm.runInNewContext('(()=>{'+gateSource+';'+text+';return OriginalOnlineReleaseController;})()',context);
 return {f,controller:new Controller(f),http,jobs,inquiry,edge,context};
}

test('actual terminal barrier enumerates serving originals without closing or disconnecting them',async()=>{
 for(const mode of ['BOOTSTRAP','FOLLOWING']){
  const {f,controller,http,jobs,inquiry,edge}=fixture(mode);const result=await controller.readClientDetachBarrier({mode});
  assert.equal(result.format,'sabalan-original-client-terminal-barrier/v1');assert.equal(result.phase,'COMPLETED');assert.equal(result.requiredGateNames.length,18);
  assert.equal(result.liveOriginals.length,5);assert.equal(result.releaseAdmissionGranted,false);assert.equal(result.terminalWal===null,mode==='BOOTSTRAP');
  assert.ok(f.lockChecks>=2);for(const row of [http,jobs,inquiry,edge])assert.equal(row.closed,false);
 }
});
test('actual terminal barrier refuses incomplete lease, gates, publication, actor and independent terminal evidence',async()=>{
 const cases=[
  ['active lease',({f})=>f.active.push({id:'other'})],
  ['missing operation',({f})=>f.operationMissing=true],
  ['lost advisory',({f})=>f.lostAdvisory=true],
  ['missing gate',({f})=>f.gates.report.gates.pop()],
  ['failed gate',({f})=>f.gates.report.gates[0].passed=false],
  ['expired gates',({f})=>f.gates.expiresAt='2000-01-01T00:00:00Z'],
  ['checkpoint mismatch',({f})=>f.operation.checkpointJson={remoteVerified:false}],
  ['epoch generation changed',({f})=>f.epoch.generation++],
  ['native owner exited',({http})=>http.child.exitCode=0],
  ['native birth changed',({http})=>http.originalHostBirth='other'],
  ['partial frame',({http})=>http.pending='{'],
  ['jobs stopped',({jobs})=>jobs.closed=true],
  ['retained inquiry missing',({inquiry})=>inquiry.ready=null],
  ['unclosed observer',({f})=>f.observers.push({closed:false})],
  ['failed observer',({f})=>f.observers.push({closed:true,result:{code:1,signal:null}})],
  ['terminal certificate changed',({f})=>f.mountedEnvelope={signature:'other'}],
  ['maintenance still active',({f})=>f.terminalObservation={format:'sabalan-original-client-terminal-observation/v1',maintenanceAbsent:false,readOnly:true,endpoints:[]}],
  ['publication changed during observation',({f})=>{let count=0;f.readPublication=()=>({...f.publication,publicationSha256:++count===1?digest:'c'.repeat(64)});}],
 ];
 for(const [name,change] of cases){const state=fixture('FOLLOWING');change(state);await assert.rejects(state.controller.readClientDetachBarrier({mode:'FOLLOWING'}),undefined,name);}
});
test('terminal observation refuses caller pass bits and wrong lifecycle mode',async()=>{
 const {controller}=fixture();await assert.rejects(controller.readClientDetachBarrier({mode:'BOOTSTRAP',passed:true}));await assert.rejects(controller.readClientDetachBarrier({mode:'FOLLOWING'}));
});
test('service exit requires actual actor closure, a separate prepared close and terminal database before advisory release',async()=>{
 const {f,controller,http,jobs,inquiry,edge}=fixture('FOLLOWING');
 await assert.rejects(controller.prepareOriginalControllerClose());
 await assert.rejects(controller.closeOriginalController());
 assert.equal(f.queries.some(sql=>sql.includes('pg_advisory_unlock')),false);
 for(const row of [http,jobs,inquiry,edge]){row.closed=true;row.code=0;row.signal=null;row.nativeClosureVerified=true;row.events.push({event:'CLOSED'});}
 f.active.push({id:'other'});await assert.rejects(controller.prepareOriginalControllerClose());f.active=[];
 const prepared=await controller.prepareOriginalControllerClose();assert.equal(prepared.originalControllerClosePrepared,true);
 const closed=await controller.closeOriginalController();assert.equal(closed.originalControllerClosed,true);
 assert.equal(f.queries.filter(sql=>sql.includes('pg_advisory_unlock')).length,1);
});
test('post-spawn birth observation failure holds the same already-enrolled original',async()=>{
 const {controller,http,context}=fixture();context.originalProcessBirth=()=>{throw Error('ACTUAL_BIRTH_READ_FAULT');};
 assert.throws(()=>controller.__testCaptureBirth('runtime01'),/ACTUAL_BIRTH_READ_FAULT/);
 assert.equal(controller.__testRetainedChild('runtime01'),http);
 assert.equal(http.closed,false);
 await assert.rejects(controller.readClientDetachBarrier({mode:'BOOTSTRAP'}),/ONLINE_CLIENT_TERMINAL_STATE_REQUIRED/);
 for(const [name,enroll] of [['startInquiryRuntime','this.#inquiryActors.set(token,state)'],['startCommonEdge','this.#edge=state'],['startRuntime','this.#children.set(runtimeId,state)']]){
  const body=declaration.members.find(row=>row.name?.getText(tree)===name).getText(tree);
  assert.ok(body.indexOf(enroll)>=0&&body.indexOf(enroll)<body.indexOf('this.#retainOriginalHostBirth(state)'),name);
  assert.ok(body.indexOf("child.once('close'")<body.indexOf('this.#retainOriginalHostBirth(state)'),name);
 }
});
