import {readMeasuredFrontendSnapshot} from './production-frontend-snapshot.mjs';
import {randomBytes,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {OriginalOnlineReleaseController} from './online-release-controller.mjs';
import {readOriginalLegacyBrowserDescriptor} from './online-legacy-browser-descriptor.mjs';
import {assertOnlineCarrierRootCoverage,onlineCarrierRootIdentitySource} from './online-carrier-root-coverage.mjs';
import {assertExecutionBindingSelection,assertProductionImageInspection} from './production-image-execution-binding.mjs';

const commands=new WeakMap(),carriers=new WeakMap(),operations=new WeakMap(),failures=new WeakMap();
const phases=['ONLINE_CHECKPOINTING','ONLINE_EXPANDING','ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING'];
const digest=/^[a-f0-9]{64}$/,imageId=/^sha256:[a-f0-9]{64}$/;
const assert=(value,code)=>{if(!value)throw Error(code);};
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const sha=value=>createHash('sha256').update(value).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

/** Translate domains only through the signed full archive graph. The original
 * source descriptor remains available; a mutable tag/version never suffices. */
export function bindTargetBrowserImage(sourceBuild,component,graph,targetImage,executionBinding){
 assert(['frontend','inquiry'].includes(component)&&imageId.test(targetImage),'ONLINE_BROWSER_TARGET_INVALID');
 assert(graph&&sourceBuild.image===graph.index&&(executionBinding?executionBinding.executionImageId===targetImage:graph.config===targetImage)
  &&imageId.test(graph.index)&&imageId.test(graph.platform)&&Array.isArray(graph.rootfsDiffIds)
  &&graph.rootfsDiffIds.length>0&&graph.rootfsDiffIds.every(value=>imageId.test(value)),'ONLINE_BROWSER_IMAGE_GRAPH_REQUIRED');
 if(executionBinding){assert(executionBinding.role===component,'ONLINE_BROWSER_EXECUTION_ROLE_CHANGED');assertExecutionBindingSelection(executionBinding,graph,targetImage);}
 return freeze({sourceBuild:clone(sourceBuild),build:{...clone(sourceBuild),image:targetImage},imageGraph:clone(graph)});
}

async function owned(controller){await OriginalOnlineReleaseController.prototype.assertOwned.call(controller,phases);}
async function docker(controller,args){
 await owned(controller);const token=Object.freeze({});commands.set(token,{controller,args:Object.freeze([...args])});
 return OriginalOnlineReleaseController.prototype.executeOriginalCarrierDockerCommand.call(controller,token);
}
/** Only the genuine original controller's private Docker method consumes this.
 * Neither JSON nor an overrideable runner can manufacture a command. */
export function consumeOriginalCarrierDockerCommand(controller,token){
 const value=commands.get(token);assert(value&&value.controller===controller,'ONLINE_CARRIER_COMMAND_NOT_ORIGINAL');
 commands.delete(token);return [...value.args];
}
export function consumeOriginalCarrierFailure(controller,token){
 const value=failures.get(token);assert(value?.controller===controller,'ONLINE_CARRIER_FAILURE_NOT_ORIGINAL');failures.delete(token);return value.facts;
}
function single(raw){const values=JSON.parse(raw);assert(Array.isArray(values)&&values.length===1,'ONLINE_CARRIER_INSPECT_NOT_SINGLE');return values[0];}
const safe=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\0\r\n,]/.test(value);
const duration=value=>{assert(typeof value==='string'&&/^\d+(?:\.\d+)?(?:ns|us|ms|s|m|h)$/.test(value),'ONLINE_CARRIER_DURATION_INVALID');return value;};
function seconds(value){duration(value);const match=/^(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)$/.exec(value);const result=Number(match[1])*({ns:1e-9,us:1e-6,ms:.001,s:1,m:60,h:3600}[match[2]]);assert(Number.isInteger(result)&&result>0&&result<=600,'ONLINE_CARRIER_STOP_DURATION_INVALID');return result;}
function memory(value){const match=/^(\d+)([bkmg])?$/i.exec(String(value));assert(match,'ONLINE_CARRIER_MEMORY_INVALID');const bytes=Number(match[1])*({b:1,k:1024,m:1024**2,g:1024**3}[(match[2]||'b').toLowerCase()]);assert(Number.isSafeInteger(bytes)&&bytes>=64*1024**2&&bytes<=2*1024**3,'ONLINE_CARRIER_MEMORY_INVALID');return bytes;}

/** Pure validation/translation, NOT admission. Runtime fields we cannot faithfully
 * reproduce are refused; Compose build metadata is never executed. */
export function compileOnlineCarrierPlan({configuration,serviceName,project,kind,runtimeId,image,releaseId,network,volumeNames,build,legacyBrowser=false}){
 assert(['backend','frontend','inquiry'].includes(kind)&&digest.test(runtimeId)&&imageId.test(image)&&/^[a-zA-Z0-9_-]{8,128}$/.test(releaseId),'ONLINE_CARRIER_IDENTITY_INVALID');
 assert(/^[a-z0-9_-]+$/.test(project)&&serviceName===kind,'ONLINE_CARRIER_TARGET_INVALID');
 const service=configuration?.services?.[serviceName];assert(service,'ONLINE_CARRIER_SERVICE_MISSING');
 const supported=new Set(['name','image','build','restart','stop_grace_period','environment','volumes','networks','healthcheck','entrypoint','command','depends_on','read_only','cap_drop','security_opt','tmpfs','mem_limit','memswap_limit','cpus','pids_limit','deploy','user','working_dir','init','labels','expose']);
 assert(Object.keys(service).every(key=>supported.has(key)),'ONLINE_CARRIER_UNSUPPORTED_COMPOSE_FIELD');
 assert(service.read_only===true&&same(service.cap_drop,['ALL'])&&same(service.security_opt,['no-new-privileges:true']),'ONLINE_CARRIER_SECURITY_REQUIRED');
 assert(['unless-stopped','no'].includes(service.restart),'ONLINE_CARRIER_RESTART_INVALID');
 const nets=Object.keys(service.networks||{});assert(nets.length===1&&nets[0]==='app_network','ONLINE_CARRIER_PRIVATE_NETWORK_REQUIRED');
 assert(network?.Id&&digest.test(network.Id)&&network.Driver==='bridge'&&network.Scope==='local'&&network.Labels?.['com.docker.compose.project']===project,'ONLINE_CARRIER_NETWORK_NOT_OWNED');
 assert(configuration.networks?.app_network?.name===network.Name,'ONLINE_CARRIER_NETWORK_CHANGED');
 const limits=service.deploy?.resources?.limits||{};
 assert(!service.deploy||Object.keys(service.deploy).every(key=>key==='resources'),'ONLINE_CARRIER_DEPLOY_UNSUPPORTED');
 assert(!service.deploy?.resources||Object.keys(service.deploy.resources).every(key=>key==='limits'),'ONLINE_CARRIER_RESOURCE_UNSUPPORTED');
 assert(Object.keys(limits).every(key=>['cpus','memory','pids'].includes(key)),'ONLINE_CARRIER_RESOURCE_UNSUPPORTED');
 const mem=memory(service.mem_limit??limits.memory),cpus=Number(service.cpus??limits.cpus),pids=Number(service.pids_limit??limits.pids);
 assert(Number.isFinite(cpus)&&cpus>0&&cpus<=2&&Number.isInteger(pids)&&pids>=32&&pids<=512,'ONLINE_CARRIER_RESOURCE_REQUIRED');
 if(service.mem_limit&&limits.memory)assert(mem===memory(limits.memory),'ONLINE_CARRIER_RESOURCE_CONFLICT');
 if(service.cpus&&limits.cpus)assert(cpus===Number(limits.cpus),'ONLINE_CARRIER_RESOURCE_CONFLICT');
 const swap=service.memswap_limit===undefined?mem:memory(service.memswap_limit);assert(swap===mem,'ONLINE_CARRIER_SWAP_POLICY_REQUIRED');
 const name=`${kind}-${runtimeId}`,dnsAlias=`${kind}-${runtimeId.slice(0,48)}`,args=['create','--name',name,'--label',`com.docker.compose.project=${project}`,'--label',`com.docker.compose.service=${name}`,'--label','com.docker.compose.oneoff=True','--label','io.sabalan.online.carrier=true','--label',`io.sabalan.online.release=${releaseId}`,'--label',`io.sabalan.online.runtime=${runtimeId}`,'--network',network.Id,'--network-alias',dnsAlias,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory',String(mem),'--memory-swap',String(mem),'--cpus',String(cpus),'--pids-limit',String(pids),'--restart',service.restart];
 if(service.labels)assert(Object.keys(service.labels).every(key=>!key.startsWith('com.docker.compose.')&&!key.startsWith('io.sabalan.online.')),'ONLINE_CARRIER_LABEL_OVERRIDE');
 for(const [key,value]of Object.entries(service.labels||{})){assert(safe(key)&&safe(String(value)),'ONLINE_CARRIER_LABEL_INVALID');args.push('--label',`${key}=${value}`);}
 const environment={...service.environment};assert(environment&&Object.keys(environment).length<=256,'ONLINE_CARRIER_ENVIRONMENT_INVALID');
 if(kind==='backend')assert(environment.BACKEND_RUNTIME_ROLE==='control'&&same(service.entrypoint,['node','/app/dist/scripts/online-runtime-hold.js'])&&same(service.command,[]),'ONLINE_CARRIER_KEEPER_REQUIRED');
 if(kind==='inquiry'){
  assert(same(service.entrypoint,['node','-e','setInterval(()=>{},1000)'])&&same(service.command,[]),'ONLINE_INQUIRY_KEEPER_REQUIRED');
  assert(!Object.keys(environment).some(key=>key.startsWith('PG')||key.startsWith('BACKEND_')),'ONLINE_INQUIRY_POSTGRES_AUTHORITY_REFUSED');
  assert(/^file:\/data\/[a-zA-Z0-9_-]+\.db\?connection_limit=([1-9][0-9]*)&pool_timeout=([1-9][0-9]*)$/.test(environment.DATABASE_URL),'ONLINE_INQUIRY_SQLITE_URL_REQUIRED');
  const query=new URLSearchParams(environment.DATABASE_URL.split('?')[1]);assert(Number(query.get('connection_limit'))<=16&&Number(query.get('pool_timeout'))<=120,'ONLINE_INQUIRY_SQLITE_BOUNDS_REQUIRED');
 }
 if(kind==='frontend')for(const key of ['SABALAN_BROWSER_BUILD_ID','NEXT_DEPLOYMENT_ID'])assert(environment[key]===undefined||environment[key]===build?.id,'ONLINE_CARRIER_BROWSER_ENV_CONFLICT');
 for(const [key,value]of Object.entries(environment)){assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)&&typeof value==='string'&&!value.includes('\0'),'ONLINE_CARRIER_ENVIRONMENT_INVALID');args.push('--env',`${key}=${value}`);}
 const mounts=[],targets=new Set();assert(Array.isArray(service.volumes||[])&&(service.volumes||[]).length<=32,'ONLINE_CARRIER_MOUNTS_INVALID');
 for(const mount of service.volumes||[]){
  assert(['volume','bind'].includes(mount.type)&&safe(mount.source)&&safe(mount.target)&&mount.target.startsWith('/')&&!targets.has(mount.target),'ONLINE_CARRIER_MOUNT_INVALID');targets.add(mount.target);
  assert(!mount.consistency&&!mount.bind?.propagation&&!mount.volume?.subpath,'ONLINE_CARRIER_MOUNT_OPTION_UNSUPPORTED');
  assert(!mount.source.includes('release-controller-private-key')&&!mount.target.startsWith('/etc/sabalan'),'ONLINE_CARRIER_SIGNER_EXPOSED');
  const source=mount.type==='volume'?configuration.volumes?.[mount.source]?.name:mount.source;
  assert(safe(source),'ONLINE_CARRIER_MOUNT_SOURCE_UNRESOLVED');
  if(mount.type==='volume')assert(volumeNames.includes(source),'ONLINE_CARRIER_VOLUME_NOT_PREEXISTING');
  if(mount.type==='bind')assert(mount.source.startsWith('/')&&mount.read_only===true,'ONLINE_CARRIER_BIND_MUST_BE_READONLY');
  const readOnly=mount.read_only===true;mounts.push({type:mount.type,source,target:mount.target,readOnly});
  args.push('--mount',`type=${mount.type},source=${source},target=${mount.target}${readOnly?',readonly':''}${mount.type==='volume'?',volume-nocopy':''}`);
 }
 if(kind==='backend'||kind==='inquiry')assert(mounts.some(value=>value.target==='/run/sabalan-online'&&value.readOnly&&value.type==='bind'),'ONLINE_CARRIER_READONLY_TRUST_REQUIRED');
 else assert(mounts.length===0,'ONLINE_CARRIER_FRONTEND_MOUNTS_REFUSED');
 if(kind==='inquiry')assert(mounts.length===3&&['/data','/app/recovery-coordination'].every(target=>mounts.some(value=>value.target===target&&value.type==='volume'&&!value.readOnly)),'ONLINE_INQUIRY_VOLUME_PROFILE_REQUIRED');
 assert(Array.isArray(service.tmpfs)&&service.tmpfs.length>0&&service.tmpfs.length<=4,'ONLINE_CARRIER_TMPFS_REQUIRED');
 for(const tmpfs of service.tmpfs){assert(typeof tmpfs==='string'&&(/^\/(?:tmp|app\/runtime\/cache|app\/storage\/(?:reports|sales-reports|bi-reports))(?::[a-zA-Z0-9=,.]+)?$/.test(tmpfs)||legacyBrowser&&kind==='frontend'&&/^\/app\/\.next(?:-build)?\/cache:rw,nosuid,nodev,size=128m$/.test(tmpfs)||kind==='inquiry'&&tmpfs==='/app/.next/cache:rw,nosuid,nodev,size=128m'),'ONLINE_CARRIER_TMPFS_INVALID');assert(!targets.has(tmpfs.split(':')[0]),'ONLINE_CARRIER_TMPFS_OVERLAP');args.push('--tmpfs',tmpfs);}
 if(service.user){assert(safe(service.user),'ONLINE_CARRIER_USER_INVALID');args.push('--user',service.user);}
 if(service.working_dir){assert(safe(service.working_dir)&&service.working_dir.startsWith('/'),'ONLINE_CARRIER_WORKDIR_INVALID');args.push('--workdir',service.working_dir);}
 if(service.init===true)args.push('--init');else assert(service.init===undefined||service.init===false,'ONLINE_CARRIER_INIT_INVALID');
 if(service.stop_grace_period)args.push('--stop-timeout',String(seconds(service.stop_grace_period)));
 const health=service.healthcheck;assert(health&&!health.disable&&Array.isArray(health.test)&&health.test.length>=2,'ONLINE_CARRIER_HEALTH_REQUIRED');
 assert(Object.keys(health).every(key=>['test','interval','timeout','start_period','retries','disable'].includes(key))&&health.test.every(value=>typeof value==='string'&&!value.includes('\0')),'ONLINE_CARRIER_HEALTH_UNSUPPORTED');
 assert(['CMD','CMD-SHELL'].includes(health.test[0]),'ONLINE_CARRIER_HEALTH_INVALID');
 assert(health.test[0]!=='CMD-SHELL'||health.test.length===2,'ONLINE_CARRIER_HEALTH_INVALID');
 // Docker CLI health-cmd invokes a shell; JSON exec-form is represented exactly
 // with POSIX single quoting, never by concatenating unescaped Compose values.
 const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
 args.push('--health-cmd',health.test[0]==='CMD-SHELL'?health.test[1]:health.test.slice(1).map(quote).join(' '));
 for(const [field,flag]of [['interval','--health-interval'],['timeout','--health-timeout'],['start_period','--health-start-period']])if(health[field]!==undefined)args.push(flag,duration(health[field]));
 assert(Number.isInteger(health.retries)&&health.retries>=1&&health.retries<=30,'ONLINE_CARRIER_HEALTH_INVALID');args.push('--health-retries',String(health.retries));
 if(service.entrypoint!==undefined){assert(Array.isArray(service.entrypoint)&&service.entrypoint.length===1||Array.isArray(service.entrypoint)&&service.entrypoint[0]==='node'&&['backend','inquiry'].includes(kind),'ONLINE_CARRIER_ENTRYPOINT_UNSUPPORTED');args.push('--entrypoint',service.entrypoint[0]);}
 args.push(image);
 if(service.entrypoint?.length>1)args.push(...service.entrypoint.slice(1));
 if(service.command!==undefined){assert(Array.isArray(service.command)&&service.command.every(value=>typeof value==='string'&&!value.includes('\0')),'ONLINE_CARRIER_COMMAND_UNSUPPORTED');args.push(...service.command);}
 return freeze({kind,runtimeId,releaseId,image,name,dnsAlias,slotId:`${kind}_${runtimeId}`,project,networkId:network.Id,networkName:network.Name,mounts,tmpfs:[...service.tmpfs],memory:mem,nanoCpus:Math.round(cpus*1e9),pids,environment,args,build:build?clone(build):null});
}

export function verifyInspection(actual,plan,{started=false}={}){
 assert(digest.test(actual?.Id)&&actual.Image===plan.image&&actual.Name===`/${plan.name}`,'ONLINE_CARRIER_CREATED_IDENTITY_CHANGED');
 const config=actual.Config,host=actual.HostConfig;
 assert(config?.Labels?.['com.docker.compose.project']===plan.project&&config.Labels['io.sabalan.online.runtime']===plan.runtimeId&&config.Labels['io.sabalan.online.release']===plan.releaseId,'ONLINE_CARRIER_LABEL_CHANGED');
 assert(host?.ReadonlyRootfs===true&&host.Privileged===false&&same(host.CapDrop,['ALL'])&&host.SecurityOpt?.some(value=>['no-new-privileges','no-new-privileges:true'].includes(value))&&host.Memory===plan.memory&&host.MemorySwap===plan.memory&&host.NanoCpus===plan.nanoCpus&&Number(host.PidsLimit)===plan.pids,'ONLINE_CARRIER_SECURITY_CHANGED');
 assert(!host.PortBindings||Object.keys(host.PortBindings).length===0,'ONLINE_CARRIER_PUBLISHED_PORT_REFUSED');
 assert(!host.PidMode&&!host.IpcMode?.startsWith('host')&&!host.NetworkMode?.startsWith('host')&&!host.Devices?.length&&!host.Binds?.length,'ONLINE_CARRIER_HOST_ACCESS_REFUSED');
 const mounts=actual.Mounts?.filter(value=>value.Type!=='tmpfs');
 assert(mounts?.length===plan.mounts.length&&plan.mounts.every(want=>mounts.some(got=>got.Type===want.type&&got.Destination===want.target&&got.RW===!want.readOnly&&(want.type==='volume'?got.Name===want.source:got.Source===want.source))),'ONLINE_CARRIER_MOUNT_CHANGED');
 assert(same(host.Tmpfs,Object.fromEntries(plan.tmpfs.map(value=>{const split=value.indexOf(':');return split<0?[value,'']:[value.slice(0,split),value.slice(split+1)];}))),'ONLINE_CARRIER_TMPFS_CHANGED');
 for(const [key,value]of Object.entries(plan.environment))assert(config.Env?.includes(`${key}=${value}`),'ONLINE_CARRIER_ENVIRONMENT_CHANGED');
 const networks=Object.values(actual.NetworkSettings?.Networks||{});assert(host.NetworkMode===plan.networkId&&networks.length===1&&(networks[0].NetworkID===plan.networkId||!started&&networks[0].NetworkID===''),'ONLINE_CARRIER_NETWORK_CHANGED');
 if(started)assert(actual.State?.Running===true&&actual.State.Pid>0&&typeof actual.State.StartedAt==='string'&&networks[0].IPAddress&&networks[0].Aliases?.includes(plan.dnsAlias),'ONLINE_CARRIER_NOT_ORIGINAL_RUNNING');
 return {kind:plan.kind,containerId:actual.Id,image:actual.Image,startedAt:actual.State?.StartedAt,project:plan.project,networkId:plan.networkId,privateAddress:networks[0].IPAddress,dnsAlias:plan.dnsAlias,slotId:plan.slotId,runtimeId:plan.runtimeId,releaseId:plan.releaseId,mounts:clone(plan.mounts),readOnlyRootfs:true,originalCreateCode0:true,originalStartCode0:started,...(plan.build?{build:clone(plan.build)}:{})};
}

export function assertBindSources(plans){
 const key='/etc/sabalan/online/release-controller-private-key.pem',keyStat=fs.statSync(key,{bigint:true});
 for(const mount of plans.flatMap(plan=>plan.mounts).filter(value=>value.type==='bind')){
  const real=fs.realpathSync(mount.source);assert(real===mount.source,'ONLINE_CARRIER_BIND_ALIAS_REFUSED');
  const relative=path.posix.relative(real,key),st=fs.statSync(real,{bigint:true});
  assert(!(relative===''||!relative.startsWith('../')&&relative!=='..')&&!(st.dev===keyStat.dev&&st.ino===keyStat.ino),'ONLINE_CARRIER_SIGNER_EXPOSED');
  assert((st.isFile()||st.isDirectory())&&st.uid===0n&&(st.mode&0o022n)===0n,'ONLINE_CARRIER_BIND_NOT_PROTECTED');
 }
}
export async function assertAliasUnique(controller,plan,ownId=null){
 const network=single(await docker(controller,['network','inspect',plan.networkId]));assert(network.Id===plan.networkId,'ONLINE_CARRIER_NETWORK_CHANGED');
 const ids=Object.keys(network.Containers||{}).filter(id=>id!==ownId);assert(ids.length<=1024&&ids.every(id=>digest.test(id)),'ONLINE_CARRIER_NETWORK_CENSUS_UNBOUNDED');
 if(!ids.length)return;
 const lines=(await docker(controller,['inspect','--format','{{json .NetworkSettings.Networks}}',...ids])).trim().split('\n');assert(lines.length===ids.length,'ONLINE_CARRIER_NETWORK_CENSUS_INCOMPLETE');
 for(const line of lines)for(const endpoint of Object.values(JSON.parse(line)))if(endpoint.NetworkID===plan.networkId)assert(!endpoint.Aliases?.includes(plan.dnsAlias)&&!endpoint.DNSNames?.includes(plan.dnsAlias),'ONLINE_CARRIER_DNS_ALIAS_ALREADY_OWNED');
}

/** Full immutable manifest+asset readback in the NEW UI carrier. This does not
 * convert a diagnostic bundle into production attestation: acceptance supplies
 * semantics, this only proves that exact qualified bytes are actually running. */
const verifyUiSource=String.raw`const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');const input=JSON.parse(process.argv[1]);const hash=b=>crypto.createHash('sha256').update(b).digest('hex');const raw=fs.readFileSync('/app/online-runtime-manifest.json');assert.equal(hash(raw),input.manifestSha256);const manifest=JSON.parse(raw);assert.equal(manifest.format,'sabalan-diagnostic-ui-bundle/v1');assert.equal(manifest.buildId,input.id);assert.ok(Array.isArray(manifest.files)&&manifest.files.length<=20000);let bytes=0;for(const file of manifest.files){assert.ok(typeof file.path==='string'&&!file.path.startsWith('/')&&!file.path.split('/').some(s=>!s||s==='.'||s==='..'));const target=path.join('/app',file.path);const real=fs.realpathSync(target);assert.ok(real.startsWith('/app/'));const st=fs.lstatSync(real);assert.ok(st.isFile());const raw=fs.readFileSync(real);bytes+=raw.length;assert.ok(bytes<=256*1024**2);assert.equal(raw.length,file.bytes);assert.equal(hash(raw),file.sha256);}const root='/app/.next-online-runtime';assert.equal(fs.readFileSync(root+'/BUILD_ID','utf8').trim(),input.id);for(const asset of input.assets){assert.ok(asset.path.startsWith('/_next/static/')&&!asset.path.split('/').some(s=>s==='..'));const raw=fs.readFileSync(root+'/static/'+asset.path.slice('/_next/static/'.length));assert.equal(raw.length,asset.bytes);assert.equal(hash(raw),asset.sha256);}const actions=JSON.parse(fs.readFileSync(root+'/server/server-reference-manifest.json'));assert.deepEqual([...new Set([...Object.keys(actions.node),...Object.keys(actions.edge)])].sort(),input.actionIds);console.log(JSON.stringify({buildId:input.id,manifestSha256:hash(raw),files:manifest.files.length,assets:input.assets.length}));`;

export async function provisionOriginalOnlineReleaseCarriers(controller,input){
 await owned(controller);
 assert(input&&Array.isArray(input.backendRuntimeIds)&&input.backendRuntimeIds.length>0&&input.backendRuntimeIds.length<=8&&new Set(input.backendRuntimeIds).size===input.backendRuntimeIds.length,'ONLINE_CARRIER_RUNTIME_SET_INVALID');
 const target=await OriginalOnlineReleaseController.prototype.readCarrierProvisioningTarget.call(controller);
 assert(target.backendService==='backend'&&target.frontendService==='frontend','ONLINE_CARRIER_TARGET_INVALID');
 const evidence=await OriginalOnlineReleaseController.prototype.readCarrierReleaseEvidence.call(controller,input.releaseId);
 assert(evidence.manifest.releaseId===input.releaseId&&imageId.test(evidence.manifest.image),'ONLINE_CARRIER_RELEASE_NOT_QUALIFIED');
 const builds=evidence.browserRegistries.flatMap(registry=>registry.builds).filter(build=>build.id===input.buildId&&build.application==='erp');
 assert(builds.length>0&&builds.every(build=>same({...build,slotId:null,retiredAt:null,supportUntil:null},{...builds[0],slotId:null,retiredAt:null,supportUntil:null})),'ONLINE_CARRIER_UI_NOT_QUALIFIED');
 const browserBinding=bindTargetBrowserImage(builds[0],'frontend',evidence.imageGraphs?.frontend,evidence.executionImages?.frontend??evidence.deploymentTargetImages?.frontend,evidence.productionExecutionBindings?.frontend),build=browserBinding.build;
 const scopes=input.backendRuntimeIds.map(id=>{assert(digest.test(id),'ONLINE_CARRIER_RUNTIME_INVALID');const matches=evidence.scopes?.filter(entry=>entry.scope.runtimeId===id);assert(matches?.length===1&&matches[0].scope.releaseId===input.releaseId&&matches[0].scope.image===evidence.manifest.image,'ONLINE_CARRIER_RUNTIME_NOT_ENROLLED');return matches[0].scope;});
 const previous=operations.get(controller)||new Set();const keys=[...input.backendRuntimeIds,`frontend:${input.buildId}`];assert(keys.every(key=>!previous.has(key)),'ONLINE_CARRIER_ORIGINAL_CREATION_ALREADY_ATTEMPTED');keys.forEach(key=>previous.add(key));operations.set(controller,previous);
 assert(typeof target.storageOverlayFile==='string','ONLINE_CARRIER_STORAGE_PROFILE_REQUIRED');
 const raw=await docker(controller,['compose','-p',target.project,'-f',target.composeFile,'-f',target.onlineOverlayFile,'-f',target.storageOverlayFile,'config','--format','json']);const configuration=JSON.parse(raw),configSha256=sha(raw);
 const networkName=configuration.networks?.app_network?.name;assert(safe(networkName),'ONLINE_CARRIER_NETWORK_MISSING');
 const network=single(await docker(controller,['network','inspect',networkName]));
 const volumeNames=[];for(const name of [...new Set(['backend','frontend'].flatMap(kind=>(configuration.services[kind]?.volumes||[]).filter(value=>value.type==='volume').map(value=>configuration.volumes?.[value.source]?.name)))]){assert(safe(name),'ONLINE_CARRIER_VOLUME_INVALID');const volume=single(await docker(controller,['volume','inspect',name]));assert(volume.Name===name&&volume.Driver==='local'&&(!volume.Options||Object.keys(volume.Options).length===0)&&volume.Labels?.['com.docker.compose.project']===target.project,'ONLINE_CARRIER_VOLUME_NOT_OWNED');volumeNames.push(name);}
 const plans=[...scopes.map(scope=>compileOnlineCarrierPlan({configuration,serviceName:'backend',project:target.project,kind:'backend',runtimeId:scope.runtimeId,image:evidence.manifest.image,releaseId:input.releaseId,network,volumeNames})),compileOnlineCarrierPlan({configuration,serviceName:'frontend',project:target.project,kind:'frontend',runtimeId:randomBytes(32).toString('hex'),image:build.image,releaseId:input.releaseId,network,volumeNames,build})];
 for(const plan of plans.filter(value=>value.kind==='backend'))assertOnlineCarrierRootCoverage(plan,evidence.manifest);
 assertBindSources(plans);
 // Plan every carrier and inspect EVERY image before first mutation. No pull,
 // build, pruning, or touching an existing service/container is available here.
 for(const plan of plans){const image=single(await docker(controller,['image','inspect',plan.image]));assert(image.Id===plan.image&&(!image.Config?.Volumes||Object.keys(image.Config.Volumes).length===0),'ONLINE_CARRIER_IMAGE_OR_ANONYMOUS_VOLUME_INVALID');
  const graph=plan.kind==='frontend'?browserBinding.imageGraph:evidence.imageGraphs?.backend;
  const binding=evidence.productionExecutionBindings?.[plan.kind];
  if(binding)assertProductionImageInspection(binding,image,graph);
  else assert(graph?.config===plan.image,'ONLINE_CARRIER_EXECUTION_BINDING_REQUIRED');
  assert(same(image.RootFS?.Layers,graph.rootfsDiffIds),'ONLINE_CARRIER_ORDERED_LAYERS_CHANGED');}
 const result={backends:[],frontend:null},originalCreations=[];
 try{
 for(const plan of plans){
  await assertAliasUnique(controller,plan);
  const creation={containerId:null,runtimeId:plan.runtimeId,image:plan.image,name:plan.name,createAttempted:true,created:false,started:false};originalCreations.push(creation);
  await owned(controller);const id=(await docker(controller,plan.args)).trim();assert(digest.test(id),'ONLINE_CARRIER_CREATE_ID_UNKNOWN');
  creation.containerId=id;creation.created=true;
  const created=single(await docker(controller,['inspect',id]));assert(created.Id===id,'ONLINE_CARRIER_CREATE_ID_CHANGED');verifyInspection(created,plan);
  await docker(controller,['start',id]);const actual=single(await docker(controller,['inspect',id]));assert(actual.Id===id,'ONLINE_CARRIER_START_ID_CHANGED');const facts=verifyInspection(actual,plan,{started:true});
  creation.started=true;creation.startedAt=facts.startedAt;
  await assertAliasUnique(controller,plan,id);
  if(plan.kind==='backend'){const verified=JSON.parse(await docker(controller,['exec',id,'node','-e',onlineCarrierRootIdentitySource,JSON.stringify({roots:evidence.manifest.roots,ephemeralRoots:evidence.manifest.ephemeralRoots})]));assert(verified.existingIdentityVerified===true&&verified.baselineAdoptionAuthorized===false,'ONLINE_CARRIER_ROOT_IDENTITY_UNPROVEN');facts.rootIdentityVerified=true;}
  if(plan.build){const verified=JSON.parse(await docker(controller,['exec',id,'node','-e',verifyUiSource,JSON.stringify(plan.build)]));assert(verified.buildId===plan.build.id&&verified.manifestSha256===plan.build.manifestSha256&&verified.assets===plan.build.assets.length,'ONLINE_CARRIER_UI_BYTES_UNVERIFIED');facts.compiledBytesVerified=true;facts.uiManifestSha256=plan.build.manifestSha256;}
  if(plan.kind==='frontend'){
   for(;;){const observed=single(await docker(controller,['inspect',id]));verifyInspection(observed,plan,{started:true});assert(observed.Id===id&&observed.State.StartedAt===facts.startedAt,'ONLINE_CARRIER_ORIGINAL_BIRTH_CHANGED');
    if(observed.State.Health?.Status==='healthy'){facts.originalHealthyObserved=true;break;}
    assert(observed.State.Health?.Status==='starting','ONLINE_CARRIER_FRONTEND_NOT_HEALTHY');await pause(250);
   }
  }
  facts.resolvedConfigurationSha256=configSha256;const token=Object.freeze({});carriers.set(token,{controller,plan,containerId:id,startedAt:facts.startedAt,facts:freeze(facts)});if(plan.kind==='backend')result.backends.push(token);else result.frontend=token;
 }
 return Object.freeze({backends:Object.freeze(result.backends),frontend:result.frontend});
 }catch(error){
  const token=Object.freeze({});failures.set(token,{controller,facts:freeze({format:'sabalan-original-carrier-failure/v1',releaseId:input.releaseId,originalCreations:clone(originalCreations),outcomeUnproven:true,cleanupPerformed:false})});
  await OriginalOnlineReleaseController.prototype.retainOriginalCarrierFailure.call(controller,token);
  throw error;
 }
}

/** Revalidates the SAME daemon-created ID/birth; never recovers or adopts an
 * existing carrier from persisted JSON, a DNS alias or a mutable image tag. */
export async function readOriginalOnlineCarrier(controller,token){
 const original=carriers.get(token);assert(original?.controller===controller,'ONLINE_CARRIER_NOT_ORIGINAL');await owned(controller);
 const actual=single(await docker(controller,['inspect',original.containerId]));const facts=verifyInspection(actual,original.plan,{started:true});
 assert(actual.Id===original.containerId&&facts.startedAt===original.startedAt,'ONLINE_CARRIER_ORIGINAL_BIRTH_CHANGED');
 if(original.plan.kind==='frontend')assert(actual.State.Health?.Status==='healthy','ONLINE_CARRIER_FRONTEND_NOT_HEALTHY');
 await assertAliasUnique(controller,original.plan,original.containerId);
 return original.facts;
}


/** UI-only bootstrap carrier. The descriptor is genuine original-controller
 * custody; this never starts/adopts an uninstrumented legacy backend or jobs. */
export async function provisionOriginalBootstrapLegacyFrontend(controller,{releaseId,descriptor}){
 await owned(controller);const source=readOriginalLegacyBrowserDescriptor(controller,descriptor),build=source.browser;
 const target=await OriginalOnlineReleaseController.prototype.readCarrierProvisioningTarget.call(controller);
 const release=await OriginalOnlineReleaseController.prototype.readCarrierReleaseEvidence.call(controller,releaseId);assert(release.manifest.releaseId===releaseId,'ONLINE_CARRIER_RELEASE_NOT_QUALIFIED');
 const key='legacy-frontend:'+build.id,previous=operations.get(controller)||new Set();assert(!previous.has(key),'ONLINE_CARRIER_ORIGINAL_CREATION_ALREADY_ATTEMPTED');previous.add(key);operations.set(controller,previous);
 const original=single(await docker(controller,['inspect',source.originalFrontend.id]));assert(original.Id===source.originalFrontend.id&&original.Image===build.image&&original.State.StartedAt===source.originalFrontend.startedAt,'ONLINE_ORIGINAL_LEGACY_FRONTEND_CHANGED');
 assert(original.Config.Labels?.['com.docker.compose.project']===target.project&&original.Config.Labels?.['com.docker.compose.service']==='frontend'&&original.Mounts.length===0,'ONLINE_ORIGINAL_LEGACY_FRONTEND_CHANGED');
 const image=single(await docker(controller,['image','inspect',build.image]));assert(image.Id===build.image&&same(image.RootFS.Layers,source.source.layers)&&Object.keys(image.Config.Volumes||{}).length===0,'ONLINE_ORIGINAL_LEGACY_IMAGE_CHANGED');
 const raw=await docker(controller,['compose','-p',target.project,'-f',target.composeFile,'-f',target.onlineOverlayFile,'-f',target.storageOverlayFile,'config','--format','json']);const configuration=JSON.parse(raw);
 const service=configuration.services.frontend;assert((service.volumes||[]).length===0&&service.entrypoint===undefined&&service.command===undefined,'ONLINE_LEGACY_UI_RUNTIME_OVERRIDE_REFUSED');
 assert(!service.environment?.NEXT_DIST_DIR&&!service.environment?.SABALAN_BROWSER_BUILD_ID&&!service.environment?.NEXT_DEPLOYMENT_ID,'ONLINE_LEGACY_UI_RUNTIME_OVERRIDE_REFUSED');
 assert(service.tmpfs?.includes('/app/runtime/cache:rw,nosuid,nodev,size=128m'),'ONLINE_LEGACY_CACHE_PROFILE_REQUIRED');
 service.tmpfs=service.tmpfs.map(value=>value==='/app/runtime/cache:rw,nosuid,nodev,size=128m'?'/app/'+source.manifest.dist+'/cache:rw,nosuid,nodev,size=128m':value);
 const network=single(await docker(controller,['network','inspect',configuration.networks.app_network.name]));
 const plan=compileOnlineCarrierPlan({configuration,serviceName:'frontend',project:target.project,kind:'frontend',runtimeId:randomBytes(32).toString('hex'),image:build.image,releaseId,network,volumeNames:[],build,legacyBrowser:true});
 assertBindSources([plan]);await assertAliasUnique(controller,plan);let creation;
 try{
  creation={containerId:null,runtimeId:plan.runtimeId,image:plan.image,name:plan.name,createAttempted:true,created:false,started:false};
  const id=(await docker(controller,plan.args)).trim();assert(digest.test(id),'ONLINE_CARRIER_CREATE_ID_UNKNOWN');creation.containerId=id;creation.created=true;
  verifyInspection(single(await docker(controller,['inspect',id])),plan);await docker(controller,['start',id]);
  const facts=verifyInspection(single(await docker(controller,['inspect',id])),plan,{started:true});creation.started=true;creation.startedAt=facts.startedAt;
  await assertAliasUnique(controller,plan,id);
  const verified=JSON.parse(await docker(controller,['exec',id,'node','-e',legacyUiVerificationSource,JSON.stringify({manifestSha256:build.manifestSha256,nativeBuildId:build.nativeBuildId,image:build.image,dist:source.manifest.dist,files:source.manifest.files.length,bytes:source.manifest.files.reduce((sum,row)=>sum+row.bytes,0),inventorySha256:sha(JSON.stringify(source.manifest.files)),actionIds:build.actionIds})]));
  assert(verified.manifestSha256===build.manifestSha256&&verified.nativeBuildId===build.nativeBuildId,'ONLINE_LEGACY_UI_BYTES_UNVERIFIED');
  for(;;){const row=single(await docker(controller,['inspect',id]));verifyInspection(row,plan,{started:true});assert(row.Id===id&&row.State.StartedAt===facts.startedAt,'ONLINE_CARRIER_ORIGINAL_BIRTH_CHANGED');if(row.State.Health?.Status==='healthy')break;assert(row.State.Health?.Status==='starting','ONLINE_CARRIER_FRONTEND_NOT_HEALTHY');await pause(250);}
  facts.compiledBytesVerified=true;facts.originalHealthyObserved=true;facts.uiManifestSha256=build.manifestSha256;facts.nativeBuildId=build.nativeBuildId;facts.handoffPolicy='MANUAL_SAVE_REQUIRED';facts.resolvedConfigurationSha256=sha(raw);facts.legacyFrontendOnly=true;
  const token=Object.freeze({});carriers.set(token,{controller,plan,containerId:id,startedAt:facts.startedAt,facts:freeze(facts)});return token;
 }catch(error){const token=Object.freeze({});failures.set(token,{controller,facts:freeze({format:'sabalan-original-carrier-failure/v1',releaseId,originalCreations:creation?[clone(creation)]:[],outcomeUnproven:true,cleanupPerformed:false})});await OriginalOnlineReleaseController.prototype.retainOriginalCarrierFailure.call(controller,token);throw error;}
}

const legacyUiVerificationSource=String.raw`const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');const expected=JSON.parse(process.argv[1]),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),files=[];let total=0;
function read(file){assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const before=fs.fstatSync(fd,{bigint:true});assert(before.isFile()&&before.nlink===1n&&before.size<=128n*1024n**2n);const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','nlink']){assert.equal(before[key],after[key]);assert.equal(before[key],named[key]);}return raw;}finally{fs.closeSync(fd);}}
function add(file){const raw=read(file);total+=raw.length;assert(total<=256*1024**2&&files.length<20000);files.push({path:file.slice(5),bytes:raw.length,sha256:hash(raw)});}
function walk(folder){const before=fs.lstatSync(folder,{bigint:true});assert(before.isDirectory()&&fs.realpathSync(folder)===folder);for(const name of fs.readdirSync(folder).sort()){const file=path.join(folder,name),st=fs.lstatSync(file);assert(!st.isSymbolicLink());if(st.isDirectory())walk(file);else{assert(st.isFile());add(file);}}const after=fs.lstatSync(folder,{bigint:true});for(const key of ['dev','ino','mtimeNs','ctimeNs'])assert.equal(before[key],after[key]);}
const root='/app/'+expected.dist;walk(root+'/server');walk(root+'/static');for(const name of fs.readdirSync(root).sort())if(name==='BUILD_ID'||name.endsWith('.json'))add(root+'/'+name);walk('/app/public');for(const name of ['next.config.js','browser-build-identity.cjs','package.json'])if(fs.existsSync('/app/'+name))add('/app/'+name);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);assert.equal(files.length,expected.files);assert.equal(total,expected.bytes);assert.equal(hash(JSON.stringify(files)),expected.inventorySha256);assert.equal(read(root+'/BUILD_ID').toString().trim(),expected.nativeBuildId);const actions=JSON.parse(read(root+'/server/server-reference-manifest.json'));assert.deepEqual([...new Set([...Object.keys(actions.node),...Object.keys(actions.edge)])].sort(),expected.actionIds);const manifest={format:'sabalan-production-legacy-browser-manifest/v1',image:expected.image,buildId:expected.nativeBuildId,dist:expected.dist,files};assert.equal(hash(JSON.stringify(manifest)+'\n'),expected.manifestSha256);console.log(JSON.stringify({nativeBuildId:expected.nativeBuildId,manifestSha256:hash(JSON.stringify(manifest)+'\n'),files:files.length}));`;

const legacySources=new WeakMap(),legacySourceControllers=new WeakMap();
const legacyOriginalLayers=["sha256:29df493baa13de438d6d2ece3a8333032e0b7b9b9d8cce4ee82194da255f61e1", "sha256:4983b93ee7967564f02cbf6162b75010ce557404a539fba05ee19a0eae01acbc", "sha256:e10358715ead9b47009dd04bcd77ac1c8e247f7249ab06517ff913c473a8e38e", "sha256:afa543f85b4685a84338df3e2c429edca49bb372b0f49e0c5cc9724c820ad094", "sha256:5b3cbae5c5f7632ff3202a9e80f283c62346fcb6c12906a02bc961cb77c0fe06", "sha256:1c398dc00b7d018dd3e23d86bc66e0bc26479dc12f26b86d19f702b4a42e7180", "sha256:5e891ffa8d8c06418f6970ed5c57e6e6489366681b3b32aa0ba0496e9c35864e", "sha256:4f43f4903c7909562d390a6514cc6f5527d6bb12337462c8f266947a569b03d4", "sha256:4cdf57e8e6e46f9b207115e41a1ca53d2b08caf5c325f1e40293943991a2d029", "sha256:acbf268b511b7b0eef4ea0af4987c3a7c5f24b731e839efe3c3efcd542ccf95e", "sha256:b3ec99cb534768d371eadaef44a05f8cdcda15959738fcd0c5c98336bc3d567c", "sha256:c6355dd8ed0564fa035fbd5938278fb0ef459f1f76e1349b052db4dc6bfcea43"];
const legacyRootFiles=[".next-build/BUILD_ID", ".next-build/app-build-manifest.json", ".next-build/app-path-routes-manifest.json", ".next-build/build-manifest.json", ".next-build/export-marker.json", ".next-build/images-manifest.json", ".next-build/next-minimal-server.js.nft.json", ".next-build/next-server.js.nft.json", ".next-build/package.json", ".next-build/prerender-manifest.json", ".next-build/react-loadable-manifest.json", ".next-build/required-server-files.json", ".next-build/routes-manifest.json"];

function inventoryLegacyCopiedSource(root,measured=null){
 const files=[];let total=0;
 function read(file){assert(fs.realpathSync(file)===file,'ONLINE_LEGACY_SOURCE_ALIAS');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const before=fs.fstatSync(fd,{bigint:true});assert(before.isFile()&&before.nlink===1n&&before.uid===0n&&before.size<=128n*1024n**2n,'ONLINE_LEGACY_SOURCE_FILE_UNSAFE');const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert(before[key]===after[key]&&before[key]===named[key],'ONLINE_LEGACY_SOURCE_CHANGED');return raw;}finally{fs.closeSync(fd);}}
 function add(file){const raw=read(file);total+=raw.length;assert(total<=256*1024**2&&files.length<20000,'ONLINE_LEGACY_SOURCE_CAPACITY');files.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:raw.length,sha256:sha(raw)});}
 function walk(folder){const before=fs.lstatSync(folder,{bigint:true});assert(before.isDirectory()&&fs.realpathSync(folder)===folder,'ONLINE_LEGACY_SOURCE_ALIAS');for(const name of fs.readdirSync(folder).sort()){const target=path.join(folder,name),st=fs.lstatSync(target);assert(!st.isSymbolicLink(),'ONLINE_LEGACY_SOURCE_ALIAS');if(st.isDirectory())walk(target);else{assert(st.isFile(),'ONLINE_LEGACY_SOURCE_FILE_UNSAFE');add(target);}}const after=fs.lstatSync(folder,{bigint:true});for(const key of ['dev','ino','mtimeNs','ctimeNs'])assert(before[key]===after[key],'ONLINE_LEGACY_SOURCE_CHANGED');}
 const dist=measured?.manifest.dist??'.next-build',rootFiles=measured?measured.manifest.files.filter(row=>row.path.startsWith(dist+'/')&&!row.path.slice(dist.length+1).includes('/')).map(row=>row.path):legacyRootFiles,configFiles=measured?measured.manifest.files.filter(row=>!row.path.includes('/')).map(row=>row.path):['next.config.js','package.json'];walk(path.join(root,dist+'/server'));walk(path.join(root,dist+'/static'));for(const file of rootFiles)add(path.join(root,file));walk(path.join(root,'public'));for(const file of configFiles)add(path.join(root,file));files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(measured)assert(same(files,measured.manifest.files),'ONLINE_MEASURED_LEGACY_BYTES_CHANGED');else assert(files.length===1377&&total===36086294&&sha(JSON.stringify(files))==='124d044c0332062152df4617b2b48e126d4c8e6a9329ca64b7886f1337afa19a','ONLINE_ORIGINAL_LEGACY_BYTES_CHANGED');
 const nativeBuildId=read(path.join(root,dist+'/BUILD_ID')).toString().trim();assert(nativeBuildId===(measured?.browser.nativeBuildId??'B3FQSLBH439Vaf6knWbsb'),'ONLINE_ORIGINAL_LEGACY_BUILD_CHANGED');const actions=JSON.parse(read(path.join(root,dist+'/server/server-reference-manifest.json'))),actionIds=[...new Set([...Object.keys(actions.node),...Object.keys(actions.edge)])].sort();assert(measured?same(actionIds,measured.browser.actionIds):!actionIds.length,'ONLINE_ORIGINAL_LEGACY_ACTIONS_CHANGED');
 const manifest={format:'sabalan-production-legacy-browser-manifest/v1',image:measured?.manifest.image??'sha256:348ceb11008abf840a878bd28c32c2910fd52649af6d04d0f1961870f57b3004',buildId:nativeBuildId,dist,files};return{manifest,browser:{id:'erp_legacy_'+sha(nativeBuildId),nativeBuildId,handoffPolicy:'MANUAL_SAVE_REQUIRED',application:'erp',image:manifest.image,manifestSha256:sha(JSON.stringify(manifest)+'\n'),assets:files.filter(file=>file.path.startsWith(dist+'/static/')).map(file=>({...file,path:'/_next/static/'+file.path.slice((dist+'/static/').length)})),actionIds,...(measured?{sourceSnapshot:measured.browser.sourceSnapshot}:{})}};
}
async function assertOriginalLegacySource(controller,source){
 await owned(controller);const value=single(await docker(controller,['inspect',source.originalFrontend.id]));assert(value.Id===source.originalFrontend.id&&value.Image===source.originalFrontend.image&&value.State.StartedAt===source.originalFrontend.startedAt&&!value.State.Running&&value.State.Pid===0&&!value.State.OOMKilled&&value.Mounts.length===0,'ONLINE_ORIGINAL_LEGACY_SOURCE_CHANGED');
 const image=single(await docker(controller,['image','inspect',value.Image]));assert(image.Id===source.originalFrontend.image&&same(image.RootFS.Layers,source.source.layers),'ONLINE_ORIGINAL_LEGACY_IMAGE_CHANGED');
 if(source.snapshotSelection)readMeasuredFrontendSnapshot(source.snapshotSelection.file,source.snapshotSelection.sha256);
 assert(same(inventoryLegacyCopiedSource(source.privateCopyRoot,source.snapshotSelection?{manifest:source.manifest,browser:source.browser}:null),{manifest:source.manifest,browser:source.browser}),'ONLINE_ORIGINAL_LEGACY_PRIVATE_COPY_CHANGED');
}
export async function acquireOriginalBootstrapLegacyBrowserSource(controller,frontendSnapshot=null){
 frontendSnapshot=frontendSnapshot?structuredClone(frontendSnapshot):null;
 await owned(controller);assert(!legacySourceControllers.has(controller),'ONLINE_ORIGINAL_LEGACY_SOURCE_ALREADY_ACQUIRED');
 const target=await OriginalOnlineReleaseController.prototype.readCarrierProvisioningTarget.call(controller),ids=(await docker(controller,['compose','-p',target.project,'-f',target.composeFile,'ps','--all','--quiet','frontend'])).trim().split(/\r?\n/);assert(ids.length===1&&digest.test(ids[0]),'ONLINE_ORIGINAL_LEGACY_SOURCE_NOT_SINGLE');
 const measured=frontendSnapshot?readMeasuredFrontendSnapshot(frontendSnapshot.file,frontendSnapshot.sha256):null;
 const original=single(await docker(controller,['inspect',ids[0]]));assert(original.Id===ids[0]&&original.Image===(measured?.manifest.image??'sha256:348ceb11008abf840a878bd28c32c2910fd52649af6d04d0f1961870f57b3004')&&!original.State.Running&&original.State.Pid===0&&!original.State.OOMKilled&&original.Mounts.length===0&&original.Config.Labels?.['com.docker.compose.project']===target.project&&original.Config.Labels?.['com.docker.compose.service']==='frontend','ONLINE_ORIGINAL_LEGACY_SOURCE_NOT_STOPPED');
 if(measured)assert(original.Id===measured.originalFrontend.id&&original.State.StartedAt===measured.originalFrontend.startedAt,'ONLINE_MEASURED_LEGACY_INCARNATION_CHANGED');
 const image=single(await docker(controller,['image','inspect',original.Image]));assert(image.Id===original.Image&&same(image.RootFS.Layers,measured?.source.layers??legacyOriginalLayers),'ONLINE_ORIGINAL_LEGACY_IMAGE_CHANGED');
 const parent=path.join(path.dirname(target.composeFile),'.deploy-state');assert(fs.realpathSync(parent)===parent,'ONLINE_ORIGINAL_LEGACY_COPY_ALIAS');const pst=fs.lstatSync(parent);assert(pst.isDirectory()&&pst.uid===0&&!(pst.mode&0o022),'ONLINE_ORIGINAL_LEGACY_COPY_UNSAFE');
 const privateCopyRoot=fs.mkdtempSync(path.join(parent,'original-legacy-browser-'));fs.chmodSync(privateCopyRoot,0o700);const token=Object.freeze({});legacySourceControllers.set(controller,token);
 const pending={controller,privateCopyRoot,complete:false};legacySources.set(token,pending);
 try{const dist=measured?.manifest.dist??'.next-build';fs.mkdirSync(path.join(privateCopyRoot,dist),{mode:0o700});const copyFiles=measured?[dist+'/server',dist+'/static','public',...measured.manifest.files.filter(row=>!row.path.includes('/')||(row.path.startsWith(dist+'/')&&!row.path.slice(dist.length+1).includes('/'))).map(row=>row.path)]:['.next-build/server','.next-build/static',...legacyRootFiles,'public','next.config.js','package.json'];
 for(const relative of copyFiles)await docker(controller,['cp',original.Id+':/app/'+relative,path.join(privateCopyRoot,path.dirname(relative))]);
 const inventory=inventoryLegacyCopiedSource(privateCopyRoot,measured),source=freeze({...inventory,...(measured?{snapshotSelection:structuredClone(frontendSnapshot)}:{}),originalFrontend:{id:original.Id,image:original.Image,startedAt:original.State.StartedAt,mounts:[]},privateCopyRoot,
 source:measured?measured.source:{sourceIndex:original.Image,configIdentity:'sha256:55ae5c9b07716b503c6b941755003afa9fca983cb4d4fe49540ddf3af4831046',layers:legacyOriginalLayers,compressedArchiveSha256:'bd5210ff1854512e1f228f6c9a3746828400b728b920d7b303c7fdc97cbbf8bc',compressedArchiveBytes:269816525,rawArchiveSha256:'6f9ea8abb152edf2f6dbc6786a73292eede332423acbc17f909be2c85130c14b',originalExportReceipt:'production-image-export-b39dbefcc66448449f62d93159a31151.json'}});
 await assertOriginalLegacySource(controller,source);pending.complete=true;pending.source=source;return token;
 }catch(error){const failure=Object.freeze({});failures.set(failure,{controller,facts:freeze({format:'sabalan-original-carrier-failure/v1',originalCreations:[],sourceCopyRoot:privateCopyRoot,outcomeUnproven:true,cleanupPerformed:false})});await OriginalOnlineReleaseController.prototype.retainOriginalCarrierFailure.call(controller,failure);throw error;}
}
export async function readOriginalBootstrapLegacyBrowserSource(controller,token){const selected=legacySources.get(token);assert(selected?.controller===controller&&selected.complete,'ONLINE_ORIGINAL_LEGACY_SOURCE_REQUIRED');await assertOriginalLegacySource(controller,selected.source);return selected.source;}
