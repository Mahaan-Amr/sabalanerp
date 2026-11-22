import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const sha=value=>createHash('sha256').update(JSON.stringify(sorted(value))+'\n').digest('hex');
const CONFIG_KEYS=['Hostname','Domainname','User','AttachStdin','AttachStdout','AttachStderr','ExposedPorts','Tty','OpenStdin','StdinOnce','Env','Cmd','Healthcheck','Image','Volumes','WorkingDir','Entrypoint','Labels','StopTimeout'];
const IMAGE_KEYS=['ExposedPorts','Env','Entrypoint','Cmd','WorkingDir','Labels','ArgsEscaped','User','Volumes','Healthcheck'];
const OVERRIDES=['APP_COMMIT','DEPLOYMENT_BACKEND_IMAGE','DEPLOYMENT_FRONTEND_IMAGE','DEPLOYMENT_INQUIRY_IMAGE','DEPLOYMENT_RELEASE_ID','PERFORMANCE_RELEASE_BACKEND_IMAGE','PERFORMANCE_RELEASE_COMMIT','PERFORMANCE_RELEASE_FRONTEND_IMAGE','PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH','PERFORMANCE_RELEASE_INQUIRY_IMAGE','PERFORMANCE_RELEASE_POLICY_HASH','PERFORMANCE_RELEASE_SCHEMA_HASH','PERFORMANCE_RELEASE_SOURCE_HASH','PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH'];
const SERVICE_KEYS=['build','command','depends_on','entrypoint','environment','healthcheck','image','networks','restart','stop_grace_period','volumes','labels','hostname','domainname','user','working_dir','stdin_open','tty'];
function exactKeys(value,keys,label){assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`${label}: object required`);assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),`${label}: unsupported or missing fields`);}
function allowedKeys(value,keys,label){assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`${label}: object required`);for(const key of Object.keys(value))assert.ok(keys.includes(key),`${label}: unsupported field ${key}`);}
function envMap(rows){assert.ok(Array.isArray(rows),'Env must be an array');const map={};for(const entry of rows){assert.equal(typeof entry,'string');const i=entry.indexOf('=');assert.ok(i>0,'malformed Env');const key=entry.slice(0,i);assert.ok(!Object.hasOwn(map,key),'duplicate Env key');Object.defineProperty(map,key,{value:entry.slice(i+1),enumerable:true});}return map;}
function seconds(value){if(typeof value==='number'){assert.ok(Number.isFinite(value)&&value>=0);return value;}assert.equal(typeof value,'string');let total=0,end=0;for(const m of value.matchAll(/(\d+(?:\.\d+)?)(h|ms|us|ns|m|s)/g)){assert.equal(m.index,end,'unsupported duration');total+=Number(m[1])*({h:3600,m:60,s:1,ms:.001,us:.000001,ns:.000000001}[m[2]]);end=m.index+m[0].length;}assert.equal(end,value.length);assert.ok(end>0);return total;}
function healthcheck(service,image){if(!service)return image??null;allowedKeys(service,['test','interval','timeout','start_period','start_interval','retries','disable'],'healthcheck');if(service.disable===true)return {Test:['NONE']};assert.ok(Array.isArray(service.test));const out={...(image??{}),Test:service.test};for(const [source,target] of [['interval','Interval'],['timeout','Timeout'],['start_period','StartPeriod'],['start_interval','StartInterval']])if(Object.hasOwn(service,source))out[target]=Math.round(seconds(service[source])*1e9);if(Object.hasOwn(service,'retries'))out.Retries=service.retries;return out;}

/** Pure comparison only. The original owner must obtain every input from its authenticated
 * source/rollback context and collect fresh inspect/bind bytes before opening traffic. */
export function verifyCanonicalPreviousReleaseConfiguration(input){
 assert.equal(input.format,'sabalan-canonical-previous-release-config-input/v1');
 assert.equal(input.service,'backend');assert.match(input.sourceCommit,/^[a-f0-9]{40}$/);assert.match(input.snapshotSha256,/^[a-f0-9]{64}$/);
 const {currentInspect:row,immutableImageInspect:image,canonicalService:service,originalOverrides:overrides}=input;
 exactKeys(row.Config,CONFIG_KEYS,'Config');allowedKeys(image.Config,IMAGE_KEYS,'image.Config');allowedKeys(service,SERVICE_KEYS,'compose service');exactKeys(overrides,OVERRIDES,'original overrides');
 // ArgsEscaped is an image-builder compatibility flag, absent from Linux
 // container Config. It cannot substitute for the exact ordered argv below.
 assert.equal(image.Os,'linux');if(Object.hasOwn(image.Config,'ArgsEscaped'))assert.equal(typeof image.Config.ArgsEscaped,'boolean');
 for(const value of [row.Config.Cmd,row.Config.Entrypoint,service.command,service.entrypoint,image.Config.Cmd,image.Config.Entrypoint])if(value!==null&&value!==undefined){assert.ok(Array.isArray(value),'ordered argv array required');for(const arg of value)assert.equal(typeof arg,'string');}
 assert.equal(row.Id,input.expectedIdentity.containerId);assert.equal(row.Image,input.expectedIdentity.imageId);assert.equal(image.Id,row.Image);assert.equal(row.State.StartedAt,input.expectedIdentity.startedAt);
 assert.match(row.Id,/^[a-f0-9]{64}$/);assert.match(row.Image,/^sha256:[a-f0-9]{64}$/);assert.equal(overrides.APP_COMMIT,input.sourceCommit);assert.equal(overrides.DEPLOYMENT_RELEASE_ID,input.releaseId);assert.ok(input.releaseId);
 for(const value of Object.values(overrides))assert.equal(typeof value,'string');
 assert.equal(overrides.DEPLOYMENT_BACKEND_IMAGE,row.Image);assert.equal(service.image,row.Config.Image);
 const originalEnv={...envMap(image.Config.Env??[])};assert.ok(service.environment&&typeof service.environment==='object'&&!Array.isArray(service.environment));for(const [key,value] of Object.entries(service.environment)){assert.equal(typeof value,'string');Object.defineProperty(originalEnv,key,{value,enumerable:true,writable:true,configurable:true});}Object.assign(originalEnv,overrides);
 assert.ok(isDeepStrictEqual(envMap(row.Config.Env),originalEnv),'canonical environment differs');
 assert.ok(input.expectedComposeLabels&&typeof input.expectedComposeLabels==='object');for(const [key,value] of Object.entries(input.expectedComposeLabels)){assert.ok(key.startsWith('com.docker.compose.'));assert.equal(typeof value,'string');}
 const labels={...(image.Config.Labels??{}),...(service.labels??{}),...input.expectedComposeLabels};
 const expected={Hostname:service.hostname??row.Id.slice(0,12),Domainname:service.domainname??'',User:service.user??image.Config.User??'',AttachStdin:service.stdin_open??false,AttachStdout:true,AttachStderr:true,ExposedPorts:image.Config.ExposedPorts??null,Tty:service.tty??false,OpenStdin:service.stdin_open??false,StdinOnce:false,Env:row.Config.Env,Cmd:service.command??image.Config.Cmd??null,Healthcheck:healthcheck(service.healthcheck,image.Config.Healthcheck),Image:service.image,Volumes:image.Config.Volumes??null,WorkingDir:service.working_dir??image.Config.WorkingDir??'',Entrypoint:service.entrypoint??image.Config.Entrypoint??null,Labels:labels,StopTimeout:seconds(service.stop_grace_period??'10s')};
 assert.ok(isDeepStrictEqual(row.Config,expected),'canonical full Config differs');
 const host=input.hostConfigProof;assert.equal(host.bindsPermutationVerified,true);assert.equal(sha(host.expectedHostConfig),host.expectedSha256);assert.equal(sha(row.HostConfig),host.actualSha256);
 const normalizeHost=value=>({...value,Binds:value.Binds===null?null:[...value.Binds].sort()});assert.ok(isDeepStrictEqual(normalizeHost(row.HostConfig),normalizeHost(host.expectedHostConfig)),'HostConfig differs beyond Binds order');
 const bind=input.environmentBindProof;assert.equal(bind.verified,true);assert.match(bind.expectedSha256,/^[a-f0-9]{64}$/);assert.equal(bind.actualSha256,bind.expectedSha256);
 return {format:'sabalan-canonical-previous-release-config-proof/v1',deploymentId:input.deploymentId,releaseId:input.releaseId,sourceCommit:input.sourceCommit,snapshotSha256:input.snapshotSha256,service:input.service,identity:{containerId:row.Id,imageId:row.Image,startedAt:row.State.StartedAt},configSha256:sha(row.Config),semanticConfigSha256:sha({...row.Config,Env:envMap(row.Config.Env)}),hostConfigSha256:sha(row.HostConfig),environmentBindSha256:bind.actualSha256,coveredConfigFields:[...CONFIG_KEYS],repairKind:'CANONICAL_PREVIOUS_RELEASE_CONFIGURATION',originalCaptureGuardPassed:false,releaseIdBinding:'ORIGINAL_FAILED_OPERATION_CURRENT_INCARNATION'};
}

export const canonicalConfigurationSha256=sha;
