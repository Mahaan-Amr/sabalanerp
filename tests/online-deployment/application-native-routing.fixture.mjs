import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import dns from 'node:dns';
import {createHash} from 'node:crypto';
import {BrowserRoutingStore,BrowserRoutingPublicationLock} from '../../deploy/scripts/browser-routing-store.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {createCommonReleaseEdge} from '../../deploy/scripts/common-release-edge.mjs';
import {runNativeBrowserAcceptance} from './application-native-browser.fixture.mjs';
import {enrollOriginalReadonlyTransportChannel,publishOriginalBrowserBusinessReadyAndWaitCapture,
  holdOriginalStoppedEdgeForReadonlyRetirement} from './readonly-transport-retirement-edge.fixture.mjs';
import {apiRoutingSnapshot} from '../../deploy/scripts/api-release-routing.mjs';
import {assertNativePrivateIPv4,assertNativePrivateInterface} from './native-private-network.fixture.mjs';
import {openOriginalRemoteBrowserConnection} from '../../deploy/scripts/original-remote-browser-capability.mjs';

// Diagnostic controller only: the real two native HTTP actors retain their own
// request/SQL/file ownership. The inherited lock owns routing publication, not
// production release admission or either application's execution authority.
const root=process.argv[2];
assert.match(root,/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(root),root);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function privateRead(file,maximum=65536) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    const before=fs.fstatSync(fd,{bigint:true});
    assert.ok(before.isFile() && before.nlink===1n && before.uid===BigInt(process.getuid())
      && (before.mode&0o077n)===0n && before.size>0n && before.size<=BigInt(maximum));
    const bytes=Buffer.alloc(Number(before.size));let offset=0;
    while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);assert.ok(count>0);offset+=count;}
    assert.equal(fs.readSync(fd,Buffer.alloc(1),0,1,null),0);
    const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
    for(const value of [after,named])for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(value[key],before[key]);
    return bytes;
  } finally {fs.closeSync(fd);}
}
const input=JSON.parse(privateRead(path.join(root,'routing-input.json'),512*1024)),index=JSON.parse(privateRead(path.join(root,'index.json')));
const config=JSON.parse(privateRead(path.join(root,'config.json'),512*1024)),seedBytes=privateRead(path.join(root,'app/acceptance-seed.json'));
const edgeHost=assertNativePrivateInterface(input.edgeHost);
assert.equal(edgeHost,config.roleTopology.main.host);
assert.equal(sha(seedBytes),input.seedSha256);const seed=JSON.parse(seedBytes);
assert.equal(seed.database,index.database);assert.equal(seed.root,path.join(root,'app'));
assert.match(seed.apiApplicationId,/^[a-z0-9]{20,32}$/);
assert.equal(input.observations.length,2);assert.equal(new Set(input.observations.map(value=>value.port)).size,2);
for(const actor of input.observations){assertNativePrivateIPv4(actor.host);assert.equal(actor.host,config.roleTopology.main.host);}
const httpGrants=index.grants.filter(value=>value.scope.purpose==='http');assert.equal(httpGrants.length,2);
const runtimeIds=httpGrants.map(value=>value.scope.runtimeId);
const assertActors=()=>{
  for(const [ordinal,grant] of httpGrants.entries()) {
    const current=JSON.parse(privateRead(path.join(grant.scope.nativeDirectory,'deployment-runtime-native.json')));
    assert.equal(current.phase,'ACTIVE');assert.deepEqual(current.onlineScope.scope,grant.scope);
    assert.equal(current.onlineScope.sha256,grant.sha256);
    assert.equal(input.observations[ordinal].runtimeId,grant.scope.runtimeId);
    assert.equal(input.observations[ordinal].namespace,current.namespace);
    const birth=fs.readFileSync(`/proc/${current.guardian.pid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ');
    assert.equal(birth[19],current.guardian.startTicks);assert.notEqual(birth[0],'Z');
  }
};
assertActors();
const lockFile=path.join(root,'routing-publication.lock'),lockStat=fs.fstatSync(20,{bigint:true});
const publicationLock=new BrowserRoutingPublicationLock({file:lockFile,descriptor:20,
  identity:{device:String(lockStat.dev),inode:String(lockStat.ino),ownerUid:process.getuid()}});
const directory=path.join(root,'routing-publications');
const store=new BrowserRoutingStore({directory,publicationLock,assertReleaseOwnership:assertActors});
const uiArtifacts=input.uiArtifacts;assert.ok(uiArtifacts?.old&&uiArtifacts?.new);
const oldBuild=uiArtifacts.old.buildId,newBuild=uiArtifacts.new.buildId;
assert.notEqual(oldBuild,newBuild);assert.notEqual(uiArtifacts.old.image,uiArtifacts.new.image);
for(const artifact of Object.values(uiArtifacts)) {
  assert.match(artifact.buildId,/^erp_[a-z0-9_-]{8,90}$/);assert.match(artifact.image,/^sha256:[a-f0-9]{64}$/);
  assert.match(artifact.manifestSha256,/^[a-f0-9]{64}$/);assert.ok(Array.isArray(artifact.assets));
}
const browserBuild=id=>{
  const artifact=id===oldBuild?uiArtifacts.old:id===newBuild?uiArtifacts.new:null;
  if(artifact)return {id,application:'erp',slotId:artifact.slotId,image:artifact.image,
    manifestSha256:artifact.manifestSha256,actionIds:[],assets:artifact.assets,retiredAt:null,supportUntil:null};
  return {id,application:'inquiry',slotId:'slot_inquiry_native',image:config.image,
    manifestSha256:config.bundleSha256,actionIds:[],assets:[],retiredAt:null,supportUntil:null};
};
let registry={format:'sabalan-browser-routing/v2',generation:1,current:{erp:oldBuild,inquiry:'inquiry_native'},
  legacy:{erp:oldBuild,inquiry:null},builds:[browserBuild(oldBuild),browserBuild('inquiry_native')],
  apiBindings:[{buildId:oldBuild,browserManifestSha256:uiArtifacts.old.manifestSha256,slotId:'backend_native_a',image:config.image,manifestSha256:config.bundleSha256}]};
let publication=await store.publish(registry,null);
const journalRoot=path.join(root,'routing-journal'),journalDirectories={ui:journalRoot+'-ui',api:journalRoot,socket:journalRoot+'-socket'};
const journals={};
for(const name of ['ui','api','socket']) {
  journals[name]=new BrowserOperationJournal({directory:journalDirectories[name],
    instanceId:name==='socket'?input.transportInstanceId:sha(Buffer.from(root+':'+name))});
  await journals[name].initialize();
}
const journal=journals.api;
const retirementChannel=await enrollOriginalReadonlyTransportChannel();
const browserConnection=await openOriginalRemoteBrowserConnection(retirementChannel);
function durableJson(file,value) {
  const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
const originalAgent=http.globalAgent,enrolled=new Map(input.observations.map((actor,ordinal)=>[ordinal?'backend-native-b':'backend-native-a',actor.host]));
const localAgent=new http.Agent({lookup:(hostname,options,done)=>dns.lookup(enrolled.get(hostname)??hostname,options,done)});
http.globalAgent=localAgent;
let proxy,transportStopped=false;
const observations=[];
async function closeProxy() {
  proxy.beginDrain();
  const deadline=Date.now()+5000;
  let drainFailure;
  for(;;) {
    try {await proxy.assertDrained();break;}
    catch(error) {if(Date.now()>=deadline){drainFailure=error;break;}await new Promise(resolve=>setTimeout(resolve,20));}
  }
  await new Promise(resolve=>proxy.server.close(resolve));
  if(drainFailure)throw drainFailure;
}
try {
  proxy=createCommonReleaseEdge({loadSnapshot:async()=>apiRoutingSnapshot((await new BrowserRoutingStore({directory}).readPublication()).registry),
    uiEndpoints:[{slotId:uiArtifacts.old.slotId,host:'frontend-retained',port:3000,image:uiArtifacts.old.image},
      {slotId:uiArtifacts.new.slotId,host:'frontend-candidate',port:3000,image:uiArtifacts.new.image}],
    backendEndpoints:input.observations.map((actor,ordinal)=>({slotId:ordinal?'backend_native_b':'backend_native_a',
      host:ordinal?'backend-native-b':'backend-native-a',port:actor.port,image:config.image,manifestSha256:config.bundleSha256})),
    applicationsByHost:{'erp.native.invalid':'erp','localhost:3199':'erp',[edgeHost+':3199']:'erp'},journals,
    bodyLimit:96*1024*1024,totalBodyLimit:128*1024*1024});
  await new Promise((resolve,reject)=>{proxy.server.once('error',reject);proxy.server.listen(3199,edgeHost,resolve);});
  const port=proxy.server.address().port;
  async function request(route,build,slot,generation,init={}) {
    const prepared=new Request('http://erp.native.invalid'+route,init),bytes=init.body===undefined?undefined:Buffer.from(await prepared.arrayBuffer());
    const headers={...Object.fromEntries(prepared.headers),host:'erp.native.invalid',cookie:'sabalan_session='+seed.sessionToken};
    if(build!==null)headers['x-deployment-id']=build;if(bytes)headers['content-length']=String(bytes.length);
    const result=await new Promise((resolve,reject)=>{
      const req=http.request({hostname:edgeHost,port,path:route,method:prepared.method,headers},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.once('error',reject);
        res.once('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));
      });req.once('error',reject);req.end(bytes);
    });
    const id=result.headers['x-sabalan-proxy-operation-id'];assert.match(id,/^[a-f0-9]{32}$/);
    const intent=JSON.parse(privateRead(path.join(journalRoot,id+'.intent.json')));
    assert.equal(intent.slotId,slot);assert.equal(intent.generation,generation);assert.equal(intent.buildId,build??oldBuild);
    observations.push({operationId:id,generation,buildId:intent.buildId,slotId:slot,method:prepared.method,status:result.status});return result;
  }
  async function reads(build,slot,generation) {
    const me=await request('/api/auth/me',build,slot,generation);assert.equal(me.status,200);assert.equal(JSON.parse(me.bytes).data.id,seed.adminId);
    const account=await request('/api/accounting/ledger/customer-accounts/'+encodeURIComponent(seed.customerId),build,slot,generation);
    assert.equal(account.status,200);assert.equal(String(JSON.parse(account.bytes).data.netBalanceRials),'123456800');
  }
  const uploads=[];
  async function write(build,slot,generation,label) {
    const bytes='%PDF-1.4\nPRIVATE DURABLE API SWITCH '+label+'\n',form=new FormData();
    form.append('category','NATIONAL_ID_FRONT');form.append('inspectionSource','COPY_RECEIVED');
    form.append('file',new Blob([bytes],{type:'application/pdf'}),label+'.pdf');
    const result=await request(`/api/hr-hiring/applications/${seed.apiApplicationId}/documents`,build,slot,generation,{method:'POST',body:form});
    assert.equal(result.status,201,result.bytes.toString());const row=JSON.parse(result.bytes).data;
    assert.equal(row.sha256,sha(Buffer.from(bytes)));assert.equal(row.applicationId,seed.apiApplicationId);
    const download=await request(`/api/hr-hiring/applications/${seed.apiApplicationId}/documents/${row.id}/download`,build,slot,generation);
    assert.equal(download.status,200);assert.equal(download.bytes.toString(),bytes);
    uploads.push({id:row.id,sha256:row.sha256,storageName:row.storageName,bytes:Buffer.byteLength(bytes)});
  }
  await reads(oldBuild,'backend_native_a',1);await write(null,'backend_native_a',1,'before-switch');
  registry=structuredClone(registry);registry.generation=2;registry.current.erp=newBuild;
  const retired=registry.builds.find(value=>value.id===oldBuild);retired.retiredAt=new Date().toISOString();retired.supportUntil=new Date(Date.now()+86400000).toISOString();
  registry.builds.push(browserBuild(newBuild));registry.apiBindings.push({...registry.apiBindings[0],buildId:newBuild,browserManifestSha256:uiArtifacts.new.manifestSha256,slotId:'backend_native_b'});
  publication=await store.publish(registry,publication.publicationSha256);
  for(const [build,slot] of [[oldBuild,'backend_native_a'],[newBuild,'backend_native_b'],[null,'backend_native_a']])await reads(build,slot,2);
  await write(oldBuild,'backend_native_a',2,'old-after-switch');await write(newBuild,'backend_native_b',2,'new-after-switch');
  registry=structuredClone(registry);registry.generation=3;registry.current.erp=oldBuild;
  Object.assign(registry.builds.find(value=>value.id===oldBuild),{retiredAt:null,supportUntil:null});
  Object.assign(registry.builds.find(value=>value.id===newBuild),{retiredAt:new Date().toISOString(),supportUntil:new Date(Date.now()+86400000).toISOString()});
  publication=await store.publish(registry,publication.publicationSha256);
  for(const [build,slot] of [[oldBuild,'backend_native_a'],[newBuild,'backend_native_b'],[null,'backend_native_a']])await reads(build,slot,3);
  await write(null,'backend_native_a',3,'after-code-rollback');
  for(const uploaded of uploads)for(const [build,slot] of [[oldBuild,'backend_native_a'],[newBuild,'backend_native_b']]) {
    const result=await request(`/api/hr-hiring/applications/${seed.apiApplicationId}/documents/${uploaded.id}/download`,build,slot,3);
    assert.equal(result.status,200);assert.equal(result.bytes.length,uploaded.bytes);assert.equal(sha(result.bytes),uploaded.sha256);
  }
  async function publishGeneration(direction) {
    assertActors();registry=structuredClone(registry);registry.generation++;
    const current=direction==='next'?newBuild:oldBuild,retired=direction==='next'?oldBuild:newBuild;
    registry.current.erp=current;
    Object.assign(registry.builds.find(value=>value.id===current),{retiredAt:null,supportUntil:null});
    const now=Date.now();Object.assign(registry.builds.find(value=>value.id===retired),
      {retiredAt:new Date(now).toISOString(),supportUntil:new Date(now+86400000).toISOString()});
    publication=await store.publish(registry,publication.publicationSha256);return {registry,...publication};
  }
  const browser=await runNativeBrowserAcceptance({edge:proxy,root,seed,uiArtifacts,journalDirectories,browserConnection,
    actors:input.observations.map((actor,ordinal)=>({...actor,scopeSha256:httpGrants[ordinal].sha256,
      slotId:ordinal?'backend_native_b':'backend_native_a'})),publishGeneration,readSocketPending:()=>journals.socket.pending(),
    whileBrowsersIdle:async browserStage=>{
      const stage={format:'sabalan-native-browser-business-ready/v1',...browserStage,uploads,
        publicationSha256:publication.publicationSha256};
      await publishOriginalBrowserBusinessReadyAndWaitCapture({root,channel:retirementChannel,businessStage:stage});
    }});
  const retirement=await holdOriginalStoppedEdgeForReadonlyRetirement({root,edge:proxy,channel:retirementChannel,
    businessStage:{browser,uploads,observations,publicationSha256:publication.publicationSha256}});
  transportStopped=true;
  assert.deepEqual(await journals.ui.pending(),[]);assert.deepEqual(await journal.pending(),[]);
  console.log(JSON.stringify({format:'sabalan-native-application-routing/v2',passResult:true,productionAdmission:false,
    immutableDifferentUiImagesQualified:true,immutableDifferentBackendImagesQualified:false,elapsed24HoursQualified:false,
    currentDataRoutingRollback:true,differentCodeRollbackQualified:false,browser,retirement,
    publicationSha256:publication.publicationSha256,generations:[1,2,3,4,5],runtimeIds,uploads,observations,
    uiPending:0,apiPending:0,readonlySocketUnknown:(await journals.socket.pending()).length}));
} finally {
  // No unknown business operation is erased or relabeled. The original backend
  // controller alone owns native closure; this original edge owns transport.
  if(proxy?.server.listening&&!transportStopped)await closeProxy();
  localAgent.destroy();http.globalAgent=originalAgent;
}
