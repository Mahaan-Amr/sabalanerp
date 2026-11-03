/** Explicit read-only observation entrypoint. No create, drop or mutation. */
import path from 'node:path';
import {readLocalEndpointIdentity,runDockerObservation,verifyLocalClusterIdentity} from './protectedLocalClusterIdentity';

async function main(){
 const raw=process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL;
 if(!raw){console.log(JSON.stringify({status:'UNKNOWN',reason:'ENDPOINT_UNAVAILABLE'}));process.exitCode=2;return;}
 const report=(stage:string,status:string)=>console.log(JSON.stringify({stage,status}));
 const result=await verifyLocalClusterIdentity(path.resolve(process.cwd(),'docker-compose.local.yml'),runDockerObservation,()=>readLocalEndpointIdentity(raw,report),report);
 if(result.state==='SUCCESS'){console.log(JSON.stringify({status:'OBSERVED_MATCH',project:'sabalanerp-local',service:'postgres'}));return;}
 console.log(JSON.stringify({status:'UNKNOWN',reason:'IDENTITY_OR_CLOSURE_UNPROVEN'}));process.exitCode=2;
}
main().catch(()=>{console.log(JSON.stringify({status:'UNKNOWN',reason:'OBSERVATION_ERROR'}));process.exitCode=2;});
