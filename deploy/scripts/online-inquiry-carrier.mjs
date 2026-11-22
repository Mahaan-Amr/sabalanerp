import inquiryCompiledBrowser from './inquiry-compiled-browser.cjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {OriginalOnlineReleaseController} from './online-release-controller.mjs';
import {compileOnlineCarrierPlan,verifyInspection,assertBindSources,assertAliasUnique,bindTargetBrowserImage} from './online-release-carriers.mjs';
import {assertProductionImageInspection} from './production-image-execution-binding.mjs';
const commands=new WeakMap(),carriers=new WeakMap(),failures=new WeakMap(),attempts=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const phases=['MIGRATIONS_APPLIED','RELEASE_STARTED','ONLINE_CHECKPOINTING','ONLINE_EXPANDING','ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING','ONLINE_ROLLBACK_PUBLISHING'];
const same=(a,b)=>assert.deepEqual(a,b);
const clone=value=>structuredClone(value);
async function owned(controller){await OriginalOnlineReleaseController.prototype.assertOwned.call(controller,phases);}
async function docker(controller,args){await owned(controller);const token=Object.freeze({});commands.set(token,{controller,args:[...args]});return OriginalOnlineReleaseController.prototype.executeOriginalInquiryCarrierDockerCommand.call(controller,token);}
export function consumeOriginalInquiryCarrierDockerCommand(controller,token){const row=commands.get(token);assert.equal(row?.controller,controller,'ORIGINAL_INQUIRY_COMMAND_REQUIRED');commands.delete(token);return row.args;}
export function consumeOriginalInquiryCarrierFailure(controller,token){const row=failures.get(token);assert.equal(row?.controller,controller,'ORIGINAL_INQUIRY_FAILURE_REQUIRED');failures.delete(token);return clone(row.facts);}
function single(raw){const values=JSON.parse(raw);assert.equal(values.length,1);return values[0];}
function privateScope(file,expected){
 assert.equal(fs.realpathSync(file),file);const named=fs.lstatSync(file,{bigint:true});
 assert.ok(named.isFile()&&named.uid===0n&&named.nlink===1n&&(named.mode&0o777n)===0o400n&&named.size>0n&&named.size<=262144n);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),namedAfter=fs.lstatSync(file,{bigint:true});for(const field of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink']){assert.equal(named[field],after[field]);assert.equal(named[field],namedAfter[field]);}assert.equal(sha(raw),expected);return raw;}finally{fs.closeSync(fd);}
}
const sqliteSource=String.raw`import hashlib,json,os,stat
u=os.environ['DATABASE_URL'];file=u.partition('?')[0][5:];assert u.startswith('file:/data/') and os.path.realpath(file)==file
assert not any(k.startswith('PG') or k.startswith('BACKEND_') for k in os.environ)
p=os.lstat(os.path.dirname(file));assert stat.S_ISDIR(p.st_mode) and p.st_uid==os.getuid() and not p.st_mode&0o022
fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
 s=os.fstat(fd);n=os.lstat(file);assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==os.getuid() and not s.st_mode&0o022 and (s.st_dev,s.st_ino)==(n.st_dev,n.st_ino) and os.read(fd,16)==b'SQLite format 3\x00'
 print(json.dumps(dict(file=file,device=str(s.st_dev),inode=str(s.st_ino),ownerUid=s.st_uid,databaseUrlSha256=hashlib.sha256(u.encode()).hexdigest())))
finally:os.close(fd)
`;

/** Provisioning creates a private keeper only. The original controller owns
 * the distinct SQLite native actor and its READY/closure protocol separately. */
export async function provisionOriginalInquiryCarrier(controller,input){
 await owned(controller);assert.match(input.releaseId,/^[A-Za-z0-9_-]{8,128}$/);assert.match(input.scopeSha256,/^[a-f0-9]{64}$/);
 const evidence=await OriginalOnlineReleaseController.prototype.readInquiryReleaseEvidence.call(controller,input.releaseId);
 const candidates=evidence.browserRegistries.flatMap(value=>value.builds).filter(value=>value.application==='inquiry'&&value.id===input.buildId);
 assert.ok(candidates.length>0);const sourceBuild=candidates[0];for(const value of candidates)same({...value,slotId:null,retiredAt:null,supportUntil:null},{...sourceBuild,slotId:null,retiredAt:null,supportUntil:null});
 const binding=bindTargetBrowserImage(sourceBuild,'inquiry',evidence.component.imageGraph,evidence.component.image,evidence.component.executionBinding);
 const scope=input.scope;assert.equal(scope.format,'sabalan-online-runtime-scope/v2');assert.equal(scope.purpose,'http');assert.equal(scope.role,'serving');assert.equal(scope.worker,null);
 assert.equal(scope.releaseId,input.releaseId);assert.equal(scope.image,binding.build.image);assert.equal(scope.sourceCommit,evidence.component.sourceCommit);
 const enrolled=evidence.scopes.filter(value=>value.scope.runtimeId===scope.runtimeId);assert.equal(enrolled.length,1);same(enrolled[0].scope,scope);assert.equal(enrolled[0].sha256,input.scopeSha256);
 same(JSON.parse(privateScope(input.scopeFile,input.scopeSha256)),scope);
 const previous=attempts.get(controller)||new Set();assert.ok(!previous.has(scope.runtimeId),'ORIGINAL_INQUIRY_ALREADY_ATTEMPTED');previous.add(scope.runtimeId);attempts.set(controller,previous);
 const target=await OriginalOnlineReleaseController.prototype.readCarrierProvisioningTarget.call(controller);
 const raw=await docker(controller,['compose','-p',target.project,'-f',target.composeFile,'-f',target.onlineOverlayFile,'-f',target.storageOverlayFile,'config','--format','json']);
 const configuration=JSON.parse(raw),network=single(await docker(controller,['network','inspect',configuration.networks.app_network.name]));
 const volumeNames=[];
 for(const name of new Set(configuration.services.inquiry.volumes.filter(value=>value.type==='volume').map(value=>configuration.volumes[value.source].name))){
  const actual=single(await docker(controller,['volume','inspect',name]));assert.equal(actual.Name,name);assert.equal(actual.Driver,'local');assert.ok(!actual.Options||Object.keys(actual.Options).length===0);assert.equal(actual.Labels?.['com.docker.compose.project'],target.project);volumeNames.push(name);
 }
 const plan=compileOnlineCarrierPlan({configuration,serviceName:'inquiry',project:target.project,kind:'inquiry',runtimeId:scope.runtimeId,image:binding.build.image,releaseId:input.releaseId,network,volumeNames,build:binding.build});
 assertBindSources([plan]);
 const image=single(await docker(controller,['image','inspect',plan.image]));assert.equal(image.Id,plan.image);same(image.RootFS.Layers,binding.imageGraph.rootfsDiffIds);assert.ok(!image.Config?.Volumes||Object.keys(image.Config.Volumes).length===0);
 if(evidence.component.executionBinding)assertProductionImageInspection(evidence.component.executionBinding,image,binding.imageGraph);
 assert.ok(!(image.Config?.Env||[]).some(value=>/^(?:PG|BACKEND_)/.test(value)),'INQUIRY_IMAGE_POSTGRES_AUTHORITY_REFUSED');
 await assertAliasUnique(controller,plan);
 const creation={runtimeId:scope.runtimeId,image:plan.image,containerId:null,createAttempted:true,started:false};
 try{
  const id=(await docker(controller,plan.args)).trim();assert.match(id,/^[a-f0-9]{64}$/);creation.containerId=id;
  verifyInspection(single(await docker(controller,['inspect',id])),plan);
  await docker(controller,['start',id]);creation.started=true;
  const facts=verifyInspection(single(await docker(controller,['inspect',id])),plan,{started:true});
  const sqlite=JSON.parse(await docker(controller,['exec',id,'/usr/bin/python3','-I','-B','-c',sqliteSource]));
  const helperFile=fileURLToPath(new URL('./inquiry-compiled-browser.cjs',import.meta.url));
  const helper=fs.readFileSync(helperFile,'utf8');
  const runtimeBundleSha256=(await docker(controller,['exec',id,'node','-e',"const f=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha256').update(f.readFileSync('/app/online-runtime/entry.cjs')).digest('hex')); "])).trim();
  assert.equal(runtimeBundleSha256,scope.manifestSha256,'INQUIRY_ACTUAL_RUNTIME_BUNDLE_CHANGED');
  const compiled=JSON.parse(await docker(controller,['exec',id,'node','-e',helper+'\nconsole.log(JSON.stringify(readInquiryCompiledBrowser()));']));
  assert.equal(compiled.id,sourceBuild.id);assert.equal(compiled.manifestSha256,sourceBuild.manifestSha256);same(compiled.assets,sourceBuild.assets);same(compiled.actionIds,sourceBuild.actionIds);
  assert.equal(compiled.deploymentId,input.buildId,'INQUIRY_CURRENT_DEPLOYMENT_ID_REQUIRED');
  const imageEnvironment={};for(const entry of image.Config.Env||[]){const offset=entry.indexOf('=');const key=entry.slice(0,offset);if(['SABALAN_INQUIRY_BUILD_ID','NEXT_PUBLIC_INQUIRY_BUILD_ID','NEXT_DEPLOYMENT_ID'].includes(key)){assert.ok(offset>0&&!Object.hasOwn(imageEnvironment,key),'INQUIRY_IMAGE_BUILD_ID_DUPLICATE');imageEnvironment[key]=entry.slice(offset+1);}}
  const runtimeEnvironment=inquiryCompiledBrowser.inquiryRuntimeBuildEnvironment(compiled,imageEnvironment);inquiryCompiledBrowser.inquiryRuntimeBuildEnvironment(compiled,plan.environment);
  const runtimeBuildIdentity={deploymentId:compiled.deploymentId,manifestSha256:compiled.manifestSha256,environment:runtimeEnvironment};
  const token=Object.freeze({});carriers.set(token,{controller,plan,facts,sqlite,binding,runtimeBuildIdentity,scope:clone(scope),scopeFile:input.scopeFile,scopeSha256:input.scopeSha256,compiled:{frameworkBuildId:compiled.frameworkBuildId,manifestSha256:compiled.manifestSha256},configurationSha256:sha(raw),helperSha256:sha(Buffer.from(helper))});
  return token;
 }catch(error){
  const token=Object.freeze({});failures.set(token,{controller,facts:{format:'sabalan-original-inquiry-carrier-failure/v1',releaseId:input.releaseId,creation,outcomeUnproven:true,cleanupPerformed:false}});
  await OriginalOnlineReleaseController.prototype.retainOriginalInquiryCarrierFailure.call(controller,token);throw error;
 }
}
export async function readProvisionedInquiryCarrier(controller,token){
 await owned(controller);const row=carriers.get(token);assert.equal(row?.controller,controller,'ORIGINAL_INQUIRY_CARRIER_REQUIRED');
 const facts=verifyInspection(single(await docker(controller,['inspect',row.facts.containerId])),row.plan,{started:true});assert.equal(facts.startedAt,row.facts.startedAt);
 const sqlite=JSON.parse(await docker(controller,['exec',facts.containerId,'/usr/bin/python3','-I','-B','-c',sqliteSource]));same(sqlite,row.sqlite);
 same(JSON.parse(privateScope(row.scopeFile,row.scopeSha256)),row.scope);
 return {...facts,sqlite,scope:clone(row.scope),scopeFile:row.scopeFile,scopeSha256:row.scopeSha256,
  runtimeBuildIdentity:clone(row.runtimeBuildIdentity),databaseUrl:row.plan.environment.DATABASE_URL,build:clone(row.binding.build),sourceBuild:clone(row.binding.sourceBuild),imageGraph:clone(row.binding.imageGraph),compiled:clone(row.compiled),compiledBytesVerified:true,configurationSha256:row.configurationSha256};
}
export async function readOriginalInquiryCarrier(controller,token){
 const facts=await readProvisionedInquiryCarrier(controller,token);
 const native=await OriginalOnlineReleaseController.prototype.readOriginalInquiryNativeCapability.call(controller,token);
 assert.equal(native.runtimeId,facts.runtimeId);assert.equal(native.containerId,facts.containerId);assert.equal(native.image,facts.image);assert.equal(native.originalReady,true);same(native.sqlite,facts.sqlite);
 return {...facts,native:clone(native)};
}
