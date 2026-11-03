import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {runProtectedTemporaryDatabase,type ChildRunner,type Result} from './protectedTemporaryDatabase';
import {makeProtectedTemporaryRunner} from './protectedTemporaryPostgresRunner';
import {seedSyntheticCandidateOwner} from './protectedCandidateSyntheticOwner';
import {observeSyntheticCandidate} from './protectedCandidateSnapshot';
import {candidateProvisionPayload,candidateProvisionScript} from './protectedCandidateProvision';
import {consumeCandidateWorker,negativeCandidateExercise} from './protectedCandidateWorkerConsumer';

type Input=Readonly<{databaseUrl:string;candidateId:string;candidateImage:string;targetCommit:string;manifest:Readonly<Record<string,string>>}>;
/** Source-only, NOT qualified for execution. The test owner must first review
 * the exact manifest, Compose/container identities and all process custody.
 * This run always retains the created database and private fixture directory. */
export async function runNegativeProjectionFixture(input:Input):Promise<{state:'OBSERVED'|'UNKNOWN';database?:string}>{
 if(!/^[a-f0-9]{64}$/.test(input.candidateId)||!/^sha256:[a-f0-9]{64}$/.test(input.candidateImage)||!/^[a-f0-9]{40}$/.test(input.targetCommit))return {state:'UNKNOWN'};
 const checkout=path.resolve(__dirname,'../../../..');
 const inventory=await consumeCandidateWorker('docker',['compose','-p','sabalanerp-local','-f',path.join(checkout,'docker-compose.local.yml'),'ps','--no-trunc','--format','json']);
 if(inventory.state!=='SUCCESS')return {state:'UNKNOWN'};
 try{
  const rows=inventory.stdout.trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{const row=JSON.parse(line);return Array.isArray(row)?row:[row];});
  if(!rows.some((row:any)=>row.Project==='sabalanerp-local'&&row.Service==='backend-candidate'&&row.ID===input.candidateId&&row.State==='running'&&row.Health==='healthy'))return {state:'UNKNOWN'};
 }catch{return {state:'UNKNOWN'};}
 const inspect=async()=>{
  const result=await consumeCandidateWorker('docker',['inspect',input.candidateId]);
  if(result.state!=='SUCCESS')return false;
  try{const [v]=JSON.parse(result.stdout);return v.Id===input.candidateId&&v.Image===input.candidateImage&&v.State?.Running===true&&v.State?.Health?.Status==='healthy'&&
   v.Config?.Labels?.['com.docker.compose.project']==='sabalanerp-local'&&v.Config?.Labels?.['com.docker.compose.service']==='backend-candidate'&&
   v.Mounts?.some((m:any)=>m.Destination==='/app/online-runtime-acceptance'&&m.Type==='volume'&&m.Name==='sabalanerp-local_online_runtime_acceptance'&&m.RW===true)&&
   !v.Mounts?.some((m:any)=>m.Destination==='/run/deployment-migration-projection.json');}catch{return false;}
 };
 if(!await inspect())return {state:'UNKNOWN'};
 const delegate=makeProtectedTemporaryRunner(input.databaseUrl);
 // No automatic cleanup: direct-process close alone cannot prove all native
 // descendants have stopped. Preserve DB and evidence after every outcome.
 let reachedRetention=false;
 const runner:ChildRunner={...delegate,drop:async()=>{reachedRetention=true;return {state:'UNKNOWN'};}};
 let observed=false;
 const operation=await runProtectedTemporaryDatabase(runner,async(name,identity):Promise<Result<void>>=>{
  if(!await inspect())return {state:'UNKNOWN'};
  const seeded=await seedSyntheticCandidateOwner(input.databaseUrl,name,identity,input.targetCommit);
  if(seeded.state!=='SUCCESS')return {state:'UNKNOWN'};
  const root='/app/online-runtime-acceptance/protected-bridge-'+randomBytes(16).toString('hex');
  let payload:string;
  try{payload=candidateProvisionPayload(checkout,root,name,seeded.value,input.manifest);}catch{return {state:'UNKNOWN'};}
  if(!await inspect())return {state:'UNKNOWN'};
  const provision=await consumeCandidateWorker('docker',['exec','-i',input.candidateId,'node','-e',candidateProvisionScript],payload);
  if(provision.state!=='SUCCESS'||!await inspect())return {state:'UNKNOWN'};
  const exercise=negativeCandidateExercise(async()=>{
   const script='set -eu; umask 077; export RECOVERY_COORDINATION_DIR="$1/coordination"; export BACKEND_RUNTIME_ROLE=control; export BACKEND_CONTROL_LOCK_FILE="$1/coordination/deployment-runtime-control.lock"; export BACKEND_CONTROL_LOCK_FD=9; export DEPLOYMENT_CONTROL_IMAGE="$2"; exec 9>>"$BACKEND_CONTROL_LOCK_FILE"; flock --nonblock 9; exec node "$1/cli-worker.cjs" "$1/configuration.json"';
   return consumeCandidateWorker('docker',['exec',input.candidateId,'sh','-c',script,'synthetic-candidate-fixture',root,input.candidateImage]);
  },()=>observeSyntheticCandidate(input.databaseUrl,name,identity),'CANDIDATE_SOURCE_PROJECTION_UNPROVEN');
  const result=await exercise(name,identity);
  if(result.state==='SUCCESS'&&await inspect())observed=true;
  return result;
 });
 return {state:observed&&reachedRetention?'OBSERVED':'UNKNOWN',database:operation.name};
}
