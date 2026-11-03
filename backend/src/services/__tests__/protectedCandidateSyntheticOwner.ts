import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {Result} from './protectedTemporaryDatabase';

export type SyntheticOwner=Readonly<{deploymentId:string;releaseId:string;leaseToken:string;checkpoint:Readonly<Record<string,unknown>>}>;
/** Allocate once before the host creates its fixed read-only projection. */
export function createSyntheticCandidateOwner():SyntheticOwner{
 const nonce=randomBytes(16).toString('hex'),deploymentId='test-candidate-'+nonce,releaseId='test-release-'+nonce,leaseToken=randomBytes(32).toString('hex');
 return Object.freeze({deploymentId,releaseId,leaseToken,checkpoint:Object.freeze({deploymentId,releaseId,localVerified:true,remoteVerified:true,restoreVerified:true,manifestReadable:true,checksum:randomBytes(32).toString('hex')})});
}

/** Test fixture only. The caller must have created this UUID database and
 * retained its cluster:OID identity under the coordinated local window. No
 * production URL is accepted and checkpoint flags are synthetic test data. */
export async function seedSyntheticCandidateOwner(raw:string,name:string,identity:string,targetCommit:string,preallocated?:SyntheticOwner):Promise<Result<SyntheticOwner>>{
 let client:any,outcome:Result<SyntheticOwner>={state:'UNKNOWN'};
 try{
  if(!/^sabalanerp_protected_[a-f0-9]{32}$/.test(name)||!/^\d+:\d+$/.test(identity)||!/^[a-f0-9]{40}$/.test(targetCommit))return outcome;
  const url=new URL(raw);
  if(url.protocol!=='postgresql:'||!['localhost:55432','127.0.0.1:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)return outcome;
  url.pathname='/'+name;
  const root=path.resolve(__dirname,'../../../..');
  const requireLocal=createRequire(path.join(root,'backend/package.json'));
  const {Client}=requireLocal('pg');
  client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:7000,application_name:'sabalan-synthetic-candidate-owner'});
  await client.connect();
  const witness=await client.query(`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid
   FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`);
  if(witness.rows.length!==1||witness.rows[0].name!==name||`${witness.rows[0].system_id}:${witness.rows[0].oid}`!==identity)return outcome;
  const {deploymentId,releaseId,leaseToken,checkpoint}=preallocated??createSyntheticCandidateOwner();
  if(!/^test-candidate-[a-f0-9]{32}$/.test(deploymentId)||releaseId!=='test-release-'+deploymentId.slice('test-candidate-'.length)||!/^[a-f0-9]{64}$/.test(leaseToken)||checkpoint.deploymentId!==deploymentId||checkpoint.releaseId!==releaseId||checkpoint.localVerified!==true||checkpoint.remoteVerified!==true||checkpoint.restoreVerified!==true||checkpoint.manifestReadable!==true||typeof checkpoint.checksum!=='string'||!/^[a-f0-9]{64}$/.test(checkpoint.checksum))return outcome;
  await client.query(`INSERT INTO public.deployment_operations
   (id,"activeKey","releaseId","targetCommit",owner,phase,"leaseToken","leaseExpiresAt","heartbeatAt","startedAt","updatedAt","checkpointJson")
   VALUES ($1,'production',$2,$3,'synthetic-test-only','MUTATION_STARTED',$4,clock_timestamp()+interval '10 minutes',clock_timestamp(),clock_timestamp(),clock_timestamp(),$5::jsonb)`,
   [deploymentId,releaseId,targetCommit,leaseToken,JSON.stringify(checkpoint)]);
  outcome={state:'SUCCESS',value:Object.freeze({deploymentId,releaseId,leaseToken,checkpoint})};
 }catch{outcome={state:'UNKNOWN'};}
 finally{if(client)try{await client.end();}catch{outcome={state:'UNKNOWN'};}}
 return outcome;
}
