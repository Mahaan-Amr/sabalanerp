import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {Result} from './protectedTemporaryDatabase';

/** Read actual history and public catalog within one repeatable-read snapshot.
 * Hashes are observations only, not proof of a qualified schema or authority. */
export async function observeSyntheticCandidate(raw:string,name:string,identity:string):Promise<Result<string>>{
 let client:any,outcome:Result<string>={state:'UNKNOWN'};
 try{
  if(!/^sabalanerp_protected_[a-f0-9]{32}$/.test(name)||!/^\d+:\d+$/.test(identity))return outcome;
  const url=new URL(raw);
  if(url.protocol!=='postgresql:'||!['localhost:55432','127.0.0.1:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)return outcome;
  url.pathname='/'+name;
  const requireLocal=createRequire(path.join(path.resolve(__dirname,'../../../..'),'backend/package.json'));
  const {Client}=requireLocal('pg');
  client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000,application_name:'sabalan-synthetic-candidate-observer'});
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const w=await client.query(`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid
   FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`);
  if(w.rows.length!==1||w.rows[0].name!==name||`${w.rows[0].system_id}:${w.rows[0].oid}`!==identity)return outcome;
  const history=await client.query('SELECT * FROM public._prisma_migrations ORDER BY id');
  const relations=await client.query(`SELECT c.oid::text,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
   (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid::text,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
     pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d
     ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
   (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
   (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid) AS indexes,
   (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid) AS triggers
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.oid`);
  const functions=await client.query(`SELECT p.oid::text,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`);
  await client.query('COMMIT');
  outcome={state:'SUCCESS',value:createHash('sha256').update(JSON.stringify({history:history.rows,relations:relations.rows,functions:functions.rows})).digest('hex')};
 }catch{outcome={state:'UNKNOWN'};}
 finally{if(client)try{await client.end();}catch{outcome={state:'UNKNOWN'};}}
 return outcome;
}
