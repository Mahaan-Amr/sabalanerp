import {createHash} from 'node:crypto';
import {candidateStageProjection} from './protectedCandidateStageProjection';

/** Compares only the witness's bounded semantic projection inside the caller's
 * existing owned transaction. This does not authorize DDL or release. */
export async function compareCandidateStage(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},prefix:number){
 const expected=candidateStageProjection(prefix);
 if(expected.state!=='SCOPED_EXPECTATION'||!tx||typeof tx.$queryRaw!=='function')return {state:'UNKNOWN' as const};
 const version=await tx.$queryRaw<Array<{version:string}>>`SELECT current_setting('server_version_num') AS version`;
 if(!Array.isArray(version)||version.length!==1||version[0].version!==expected.serverVersion)return {state:'UNKNOWN' as const};
 const tableNames=Object.keys(expected.tables).sort(),functionNames=Object.keys(expected.functions).sort();
 const columns=await tx.$queryRaw<any[]>`SELECT c.relname AS tablename,a.attname AS columnname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
  a.attnotnull AS not_null,a.attidentity::text AS identity,a.attgenerated::text AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relname=ANY(${tableNames}::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`;
 const constraints=await tx.$queryRaw<any[]>`SELECT c.relname AS tablename,k.conname,k.contype::text AS type,k.convalidated AS validated,k.condeferrable AS deferrable,
  k.condeferred AS initially_deferred,pg_get_constraintdef(k.oid) AS definition FROM pg_catalog.pg_constraint k
  JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=ANY(${tableNames}::text[]) ORDER BY c.relname,k.conname`;
 const indexes=await tx.$queryRaw<any[]>`SELECT t.relname AS tablename,c.relname AS name,am.amname AS method,i.indisunique AS is_unique,i.indisvalid AS valid,i.indisready AS ready,
  pg_get_indexdef(c.oid) AS definition,pg_get_expr(i.indpred,i.indrelid) AS predicate,i.indoption::text AS options,
  ARRAY(SELECT pn.nspname||'.'||p.opcname FROM generate_series(0,i.indnkeyatts-1) x(pos) JOIN pg_catalog.pg_opclass p ON p.oid=i.indclass[x.pos] JOIN pg_catalog.pg_namespace pn ON pn.oid=p.opcnamespace ORDER BY x.pos) AS opclasses,
  ARRAY(SELECT CASE WHEN i.indcollation[x.pos]=0 THEN NULL ELSE cn.nspname||'.'||co.collname END FROM generate_series(0,i.indnkeyatts-1) x(pos) LEFT JOIN pg_catalog.pg_collation co ON co.oid=i.indcollation[x.pos] LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace ORDER BY x.pos) AS collations
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid
  JOIN pg_catalog.pg_class t ON t.oid=i.indrelid JOIN pg_catalog.pg_am am ON am.oid=c.relam
  WHERE n.nspname='public' AND t.relname=ANY(${tableNames}::text[]) ORDER BY t.relname,c.relname`;
 const triggers=await tx.$queryRaw<any[]>`SELECT c.relname AS tablename,t.tgname AS name,t.tgenabled::text AS enabled,pg_get_triggerdef(t.oid) AS definition,
  pn.nspname AS function_schema,p.proname AS function_name,pg_get_function_identity_arguments(p.oid) AS function_arguments,pg_get_functiondef(p.oid) AS function_definition
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
  WHERE n.nspname='public' AND c.relname=ANY(${tableNames}::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`;
 const functions=await tx.$queryRaw<any[]>`SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(${functionNames}::text[]) ORDER BY n.nspname,p.proname,arguments`;
 const collections=[columns,constraints,indexes,triggers,functions];
 if(collections.some(rows=>!Array.isArray(rows)||rows.length>8192)||Buffer.byteLength(JSON.stringify(collections))>4*1024*1024)return {state:'UNKNOWN' as const};
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 for(const name of tableNames){
  const actual={columns:columns.filter(row=>row.tablename===name),constraints:constraints.filter(row=>row.tablename===name),indexes:indexes.filter(row=>row.tablename===name),triggers:triggers.filter(row=>row.tablename===name)};
  if(hash(actual)!==expected.tables[name])return {state:'MISMATCH' as const,coverage:'WITNESSED_TABLE_FIELDS' as const};
 }
 for(const name of functionNames)if(hash(functions.filter(row=>row.name===name))!==expected.functions[name])return {state:'MISMATCH' as const,coverage:'WITNESSED_FUNCTION_FIELDS' as const};
 return Object.freeze({state:'SCOPED_MATCH' as const,prefix,receiptSha256:expected.receiptSha256,coverage:'WITNESSED_TABLE_AND_FUNCTION_FIELDS' as const,requiredAdditionalDimensions:expected.requiredAdditionalDimensions,requiredSeparateGates:expected.requiredSeparateGates});
}
