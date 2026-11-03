import {createRequire} from 'node:module';
import path from 'node:path';
import {compileExactCandidatePending,exactCandidateMigrationNames} from '../protectedCandidateMigrationInventory';
import {readProtectedMigrationSources} from '../protectedMigrationHistory';
import {protectedCandidateCreatedColumns,protectedCandidateCreatedIndexes,protectedCandidateLaterProjection} from '../protectedCandidateLaterProjection';
import {runProtectedTemporaryDatabase,type ChildRunner,type Result} from './protectedTemporaryDatabase';
import {makeProtectedTemporaryRunner} from './protectedTemporaryPostgresRunner';

/** Mapping only; no execution authority or general SQL parsing claim. */
export function schemaWitnessSourceMap(stage:string,source:string,statements:readonly string[]){
 const columns=protectedCandidateCreatedColumns.filter(c=>c.stage===stage),indexes=protectedCandidateCreatedIndexes.filter(i=>i.stage===stage);
 const stageFacts=protectedCandidateLaterProjection.find(s=>s.name===stage)?.facts??[];
 const initial=stage===exactCandidateMigrationNames[0];
 const tablesFromDdl=[...source.matchAll(/\b(?:ALTER|CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(m=>m[1]);
 const triggerTargets=statements.flatMap(statement=>[...statement.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?[A-Za-z_][A-Za-z0-9_]*"?[\s\S]*?\bON\s+(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(m=>m[1]));
 // Two FOREACH loops in this exact pinned migration install triggers on a
 // literal list using format('... public.%I'). Regex cannot resolve %I.
 const dynamicTargets=stage==='20261019010000_customer_semantic_barrier'?[
  'accounting_customer_opening_reviews','accounting_customer_receipt_adjustments','accounting_customer_commands',
  'accounting_customer_opening_attributions','accounting_customer_receipt_resolutions','accounting_treasury_transactions',
  'accounting_check_instruments','accounting_check_instrument_events','accounting_settlement_allocation_lines',
 ]:[];
 for(const name of dynamicTargets)if(!source.includes(`'${name}'`))throw Error('SCHEMA_WITNESS_LITERAL_TARGET_UNPROVEN');
 const functions=[...new Set([...source.matchAll(/\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|ALTER\s+|DROP\s+)FUNCTION\s+(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi)].map(m=>m[1]))].sort();
 const tables=[...new Set([...tablesFromDdl,...triggerTargets.filter(name=>name!=='public'),...dynamicTargets,...columns.map(c=>c.table),...stageFacts.filter(f=>f.kind==='column').map(f=>f.object),...(initial?['online_releases','online_runtime_slots','online_migration_steps']:[])])].sort();
 const indexNames=initial?[...source.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"/gi)].map(m=>m[1]):indexes.map(i=>i.name);
 return Object.freeze({tables,functions,indexes:indexNames,sourceMap:'BOUNDED_SQL_PATTERN_NOT_PARSER' as const});
}

/** NOT QUALIFIED OR RUN. This is a schema-only rehearsal in a fresh synthetic
 * UUID database. It deliberately has no deployment, checkpoint, FD9, lease,
 * production, promotion or recovery authority. All candidate SQL is inside
 * one transaction, followed by ROLLBACK; the database is always retained. */
export async function runCandidateSchemaWitness(raw:string,requestedName?:string):Promise<{state:'WITNESSED'|'UNKNOWN';database:string;phase:string;stage?:string;bootstrapCode?:string;settings?:unknown;stages?:readonly unknown[]}>{
 const root=path.resolve(__dirname,'../../../..');
 const files=readProtectedMigrationSources(path.join(root,'backend/prisma/migrations'));
 const plan=compileExactCandidatePending(exactCandidateMigrationNames.map(name=>({name,bytes:files.get(name)!})));
 let bootstrapCode:string|undefined;
 const base=makeProtectedTemporaryRunner(raw,undefined,code=>{bootstrapCode=code;});
 let reachedRetention=false;
 const runner:ChildRunner={...base,drop:async()=>{reachedRetention=true;return {state:'UNKNOWN'};}};
 let stages:unknown[]|undefined,settingsSnapshot:unknown,phase='CREATE_OR_BOOTSTRAP',currentStage:string|undefined;
 const lifecycle=await runProtectedTemporaryDatabase(runner,async(name,identity):Promise<Result<void>>=>{
  phase='CONNECT_AND_IDENTITY';
  let client:any,ok=false,rows:unknown[]=[];
  try{
   if(!/^sabalanerp_protected_[a-f0-9]{32}$/.test(name)||!/^\d+:\d+$/.test(identity))return {state:'UNKNOWN'};
   const url=new URL(raw);
   if(url.protocol!=='postgresql:'||!['localhost:55432','127.0.0.1:55432'].includes(url.host)||url.pathname!=='/sabalanerp'||url.search||url.hash)return {state:'UNKNOWN'};
   url.pathname='/'+name;
   const requireLocal=createRequire(path.join(root,'backend/package.json'));const {Client}=requireLocal('pg');
   client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:35000,application_name:'sabalan-schema-witness-'+name.slice(-12)});
   await client.connect();
   const witness=await client.query(`SELECT current_database() AS name,c.system_identifier::text AS system_id,d.oid::text AS oid FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_control_system() c WHERE d.datname=current_database()`);
   if(witness.rows.length!==1||witness.rows[0].name!==name||`${witness.rows[0].system_id}:${witness.rows[0].oid}`!==identity)return {state:'UNKNOWN'};
   phase='BEGIN';await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='250ms'");await client.query("SET LOCAL statement_timeout='30s'");
   const settings=await client.query(`SELECT current_setting('server_version_num') AS server_version_num,current_setting('DateStyle') AS date_style,current_setting('IntervalStyle') AS interval_style,
    current_setting('standard_conforming_strings') AS standard_conforming_strings,current_setting('search_path') AS search_path,
    current_setting('TimeZone') AS timezone,current_setting('client_encoding') AS client_encoding,current_setting('server_encoding') AS server_encoding,
    (SELECT datcollate FROM pg_catalog.pg_database WHERE datname=current_database()) AS database_collation,
    (SELECT datctype FROM pg_catalog.pg_database WHERE datname=current_database()) AS database_ctype`);
   if(settings.rows.length!==1)throw Error('SCHEMA_WITNESS_SETTINGS_UNPROVEN');
   settingsSnapshot=settings.rows[0];
   for(const stage of plan){
    currentStage=stage.name;phase='SOURCE_MAP';
    const source=files.get(stage.name)!.toString('utf8');
    const coverage=schemaWitnessSourceMap(stage.name,source,stage.statements),tableNames=coverage.tables,functionNames=coverage.functions,indexNames=coverage.indexes;
    const capture=async()=>{
     const columnRows=await client.query(`SELECT c.relname AS tablename,a.attname AS columnname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null,a.attidentity::text AS identity,a.attgenerated::text AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,[tableNames]);
     const constraintRows=await client.query(`SELECT c.relname AS tablename,k.conname,k.contype::text AS type,k.convalidated AS validated,k.condeferrable AS deferrable,
      k.condeferred AS initially_deferred,pg_get_constraintdef(k.oid) AS definition FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`,[tableNames]);
     const indexRows=await client.query(`SELECT t.relname AS tablename,c.relname AS name,am.amname AS method,i.indisunique AS is_unique,i.indisvalid AS valid,i.indisready AS ready,
      pg_get_indexdef(c.oid) AS definition,pg_get_expr(i.indpred,i.indrelid) AS predicate,i.indoption::text AS options,
      ARRAY(SELECT pn.nspname||'.'||p.opcname FROM generate_series(0,i.indnkeyatts-1) x(pos) JOIN pg_catalog.pg_opclass p ON p.oid=i.indclass[x.pos] JOIN pg_catalog.pg_namespace pn ON pn.oid=p.opcnamespace ORDER BY x.pos) AS opclasses,
      ARRAY(SELECT CASE WHEN i.indcollation[x.pos]=0 THEN NULL ELSE cn.nspname||'.'||co.collname END FROM generate_series(0,i.indnkeyatts-1) x(pos) LEFT JOIN pg_catalog.pg_collation co ON co.oid=i.indcollation[x.pos] LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace ORDER BY x.pos) AS collations
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid
      JOIN pg_catalog.pg_class t ON t.oid=i.indrelid JOIN pg_catalog.pg_am am ON am.oid=c.relam
      WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,c.relname`,[tableNames]);
     const triggerRows=await client.query(`SELECT c.relname AS tablename,t.tgname AS name,t.tgenabled::text AS enabled,pg_get_triggerdef(t.oid) AS definition,
      pn.nspname AS function_schema,p.proname AS function_name,pg_get_function_identity_arguments(p.oid) AS function_arguments,pg_get_functiondef(p.oid) AS function_definition
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,[tableNames]);
     const functionRows=await client.query(`SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY n.nspname,p.proname,arguments`,[functionNames]);
     return {columns:columnRows.rows,constraints:constraintRows.rows,indexes:indexRows.rows,triggers:triggerRows.rows,functions:functionRows.rows};
    };
    phase='CATALOG_BEFORE';const before=await capture();phase='SQL';
    for(const statement of stage.statements)await client.query(statement);
    phase='CATALOG_AFTER';const after=await capture();
    for(const name of indexNames)if(!after.indexes.some((row:any)=>row.name===name))throw Error('SCHEMA_WITNESS_INDEX_INCOMPLETE');
    rows.push({stage:stage.name,sqlSha256:stage.sha256,coverage,before,after});
    if(Buffer.byteLength(JSON.stringify(rows))>4*1024*1024)throw Error('SCHEMA_WITNESS_OUTPUT_BOUND');
   }
   phase='ROLLBACK';await client.query('ROLLBACK');ok=true;
  }catch{ok=false;}
  finally{if(client)try{await client.end();}catch{ok=false;phase='CLIENT_CLOSE';}}
  if(!ok)return {state:'UNKNOWN'};
  stages=rows;phase='CENSUS_AND_RETENTION';return {state:'SUCCESS',value:undefined};
 },requestedName);
 return stages&&reachedRetention?{state:'WITNESSED',database:lifecycle.name,phase:'ROLLED_BACK_RETAINED',settings:settingsSnapshot,stages}:{state:'UNKNOWN',database:lifecycle.name,phase,...(currentStage?{stage:currentStage}:{}),...(bootstrapCode?{bootstrapCode}:{})};
}
