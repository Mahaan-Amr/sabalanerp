/** UNEXECUTED test-only lifecycle coordinator. This creates a fresh test DB
 * only when separately reviewed and invoked. No automatic DROP or retry.
 * Its observations do not establish production deployment authority. */
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {runProtectedTemporaryDatabase,type ChildRunner,type Result} from './protectedTemporaryDatabase';
import {makeProtectedTemporaryRunner} from './protectedTemporaryPostgresRunner';
import {seedSyntheticCandidateOwner} from './protectedCandidateSyntheticOwner';
import {candidateProvisionScript} from './protectedCandidateProvision';
import {nativeStageProvisionPayload} from './protectedCandidateNativeStageProvision';
import {consumeCandidateWorker} from './protectedCandidateWorkerConsumer';

type Input=Readonly<{databaseUrl:string;candidateId:string;candidateImage:string;targetCommit:string;sourceHash:string;manifest:Readonly<Record<string,string>>;projectionSource:string;fixtureSource:string}>;
const root=path.resolve(__dirname,'../../../..');
const idPattern=/^[a-f0-9]{64}$/;
// A fixed read-only /proc and receipt observation, not a cleanup mechanism.
const closureProgram=String.raw`const fs=require('fs'),crypto=require('crypto'),root=process.argv[1];
if(!/^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/.test(root))throw Error('ROOT');
const out=[];for(const phase of ['rollback','resume-fault','complete']){const p=root+'/receipt-'+phase+'.json';const s=fs.lstatSync(p);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077))throw Error('RECEIPT');const b=fs.readFileSync(p);const v=JSON.parse(b);if(v.format!=='sabalan-native-stage-fixture-phase/v1'||v.phase!==phase||v.state!=='OBSERVED')throw Error('RECEIPT');out.push(crypto.createHash('sha256').update(b).digest('hex'));}
for(const n of fs.readdirSync('/proc'))if(/^\d+$/.test(n)&&Number(n)!==process.pid){try{const b=fs.readFileSync('/proc/'+n+'/cmdline');if(b.includes(Buffer.from(root)))throw Error('ACTOR');}catch(e){if(e.code!=='ENOENT')throw e;}}
process.stdout.write(JSON.stringify({closed:true,receiptHashes:out}));`;

export async function runNativeStageFixture(input:Input):Promise<{state:'OBSERVED_RETAINED'|'UNKNOWN';database?:string;fixtureRoot?:string;receiptHashes?:string[]}>{
 if(!idPattern.test(input.candidateId)||!/^sha256:[a-f0-9]{64}$/.test(input.candidateImage)||!/^[a-f0-9]{40}$/.test(input.targetCommit)||!idPattern.test(input.sourceHash)||!path.isAbsolute(input.projectionSource)||!path.isAbsolute(input.fixtureSource))return {state:'UNKNOWN'};
 const inventory=await consumeCandidateWorker('docker',['compose','-p','sabalanerp-local','-f',path.join(root,'docker-compose.local.yml'),'ps','--all','--no-trunc','--format','json']);
 if(inventory.state!=='SUCCESS')return {state:'UNKNOWN'};
 try{const rows=inventory.stdout.trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{const value=JSON.parse(line);return Array.isArray(value)?value:[value];});
  if(!rows.some((v:any)=>v.Project==='sabalanerp-local'&&v.ID===input.candidateId&&v.State==='running'))return {state:'UNKNOWN'};
 }catch{return {state:'UNKNOWN'};}
 const docker=async(args:string[],stdin?:string,deadline=30000)=>{
  const before=await consumeCandidateWorker('docker',['compose','-p','sabalanerp-local','-f',path.join(root,'docker-compose.local.yml'),'ps','--all','--no-trunc','--format','json']);
  if(before.state!=='SUCCESS')return {state:'UNKNOWN' as const};
  try{const rows=before.stdout.trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{const v=JSON.parse(line);return Array.isArray(v)?v:[v];});
   if(!rows.some((v:any)=>v.Project==='sabalanerp-local'&&v.ID===input.candidateId&&v.State==='running'))return {state:'UNKNOWN' as const};
  }catch{return {state:'UNKNOWN' as const};}
  return consumeCandidateWorker('docker',args,stdin,deadline);
 };
 const checkImage=await docker(['image','inspect',input.candidateImage]);
 if(checkImage.state!=='SUCCESS')return {state:'UNKNOWN'};
 let image:any;
 try{
  [image]=JSON.parse(checkImage.stdout);
  if(image.Id!==input.candidateImage||image.Os!=='linux'||image.Architecture!=='amd64'||image.RootFS?.Type!=='layers'||!Array.isArray(image.RootFS.Layers)||!image.RootFS.Layers.length||
   image.Config?.Labels?.['io.sabalan.performance.source-commit']!==input.targetCommit||image.Config?.Labels?.['io.sabalan.performance.source-hash']!==input.sourceHash)return {state:'UNKNOWN'};
 }catch{return {state:'UNKNOWN'};}
 let baseline:string|undefined;
 const inspect=async()=>{
  const r=await docker(['inspect',input.candidateId]);if(r.state!=='SUCCESS')return false;
  try{const [v]=JSON.parse(r.stdout),m=v.Mounts||[];
   if(v.Id!==input.candidateId||v.Image!==input.candidateImage||v.State?.Running!==true||v.Config?.Labels?.['com.docker.compose.project']!=='sabalanerp-local'||v.Config?.Labels?.['com.docker.compose.service']!=='backend'||String(v.Config?.Labels?.['com.docker.compose.oneoff']).toLowerCase()!=='true'||m.length!==2||
    m.filter((x:any)=>x.Destination==='/app/online-runtime-acceptance'&&x.Type==='bind'&&x.Source===input.fixtureSource&&x.RW===true).length!==1||
    m.filter((x:any)=>x.Destination==='/run/deployment-migration-projection.json'&&x.Type==='bind'&&x.Source===input.projectionSource&&x.RW===false).length!==1||
    m.some((x:any)=>['/app/dist','/app/prisma','/app/scripts'].some(t=>x.Destination==='/'||x.Destination===t||t.startsWith(x.Destination+'/')||x.Destination.startsWith(t+'/'))))return false;
   const current=JSON.stringify({id:v.Id,image:v.Image,startedAt:v.State.StartedAt,entrypoint:v.Config.Entrypoint,command:v.Config.Cmd,mounts:m,layers:image.RootFS.Layers});
   if(baseline===undefined)baseline=current;return baseline===current;
  }catch{return false;}
 };
 if(!await inspect())return {state:'UNKNOWN'};
 const base=makeProtectedTemporaryRunner(input.databaseUrl);let reachedRetention=false,fixtureRoot:string|undefined,receiptHashes:string[]|undefined;
 const runner:ChildRunner={...base,drop:async()=>{reachedRetention=true;return {state:'UNKNOWN'};}};
 const outcome=await runProtectedTemporaryDatabase(runner,async(name,identity):Promise<Result<void>>=>{
  if(!await inspect())return {state:'UNKNOWN'};
  const owner=await seedSyntheticCandidateOwner(input.databaseUrl,name,identity,input.targetCommit);if(owner.state!=='SUCCESS')return {state:'UNKNOWN'};
  fixtureRoot='/app/online-runtime-acceptance/protected-bridge-'+randomBytes(16).toString('hex');
  let payload:string;try{payload=nativeStageProvisionPayload(root,fixtureRoot,name,identity,owner.value,input.manifest);}catch{return {state:'UNKNOWN'};}
  const provision=await docker(['exec','-i',input.candidateId,'node','-e',candidateProvisionScript],payload);
  if(provision.state!=='SUCCESS'||!await inspect())return {state:'UNKNOWN'};
  const command=['exec','-e','BACKEND_RUNTIME_ROLE=control','-e','RECOVERY_COORDINATION_DIR='+fixtureRoot+'/coordination','-e','DEPLOYMENT_CONTROL_IMAGE='+input.candidateImage,
   input.candidateId,'sh',fixtureRoot+'/scripts/with-backend-control-ownership.sh','node',fixtureRoot+'/native-stage-sequence.cjs',fixtureRoot];
  const executed=await docker(command,undefined,480000);
  if(executed.state!=='SUCCESS'||executed.stdout.trim()!=='NATIVE_STAGE_SEQUENCE_OBSERVED'||!await inspect())return {state:'UNKNOWN'};
  const closure=await docker(['exec',input.candidateId,'node','-e',closureProgram,fixtureRoot]);
  if(closure.state!=='SUCCESS'||!await inspect())return {state:'UNKNOWN'};
  try{const value=JSON.parse(closure.stdout);if(value.closed!==true||!Array.isArray(value.receiptHashes)||value.receiptHashes.length!==3||!value.receiptHashes.every((h:unknown)=>typeof h==='string'&&idPattern.test(h)))return {state:'UNKNOWN'};receiptHashes=value.receiptHashes;}catch{return {state:'UNKNOWN'};}
  return {state:'SUCCESS',value:undefined};
 });
 return {state:reachedRetention&&receiptHashes?'OBSERVED_RETAINED':'UNKNOWN',database:outcome.name,...(fixtureRoot?{fixtureRoot}:{}),...(receiptHashes?{receiptHashes}:{})};
}
