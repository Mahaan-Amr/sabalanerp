import {createHash} from 'node:crypto';
import type {CatalogComparison} from './protectedCandidateCatalogContract';
import {initialCanonicalWitness} from './protectedCandidateInitialWitness';
/** A partial, data-only catalog assertion derived from the pinned first SQL.
 * This does not qualify constraints, indexes, triggers, functions or authority.
 */
type Column = Readonly<{name:string;type:string;notNull:boolean}>;
type Table = Readonly<{name:string;columns:readonly Column[]}>;
type ColumnDefault = Readonly<{table:string;column:string;kind:'text'|'current_timestamp';value:string}>;
const column=(name:string,type:string,notNull=true):Column=>Object.freeze({name,type,notNull});
const expected:readonly Table[]=Object.freeze([
 {name:'online_releases',columns:[column('id','text'),column('deploymentId','text'),column('manifestSha256','text'),column('sourceCommit','text'),column('identityJson','jsonb'),column('compatibilityJson','jsonb'),column('recoveryJson','jsonb'),column('acceptanceJson','jsonb',false),column('phase','text'),column('previousReleaseId','text',false),column('servedAt','timestamp(3) with time zone',false),column('retiredAt','timestamp(3) with time zone',false),column('browserSupportUntil','timestamp(3) with time zone',false),column('createdAt','timestamp(3) with time zone'),column('updatedAt','timestamp(3) with time zone')]},
 {name:'online_runtime_slots',columns:[column('id','text'),column('releaseId','text'),column('component','text'),column('role','text'),column('phase','text'),column('nonceSha256','text'),column('imageIdentity','text'),column('reportJson','jsonb',false),column('heartbeatAt','timestamp(3) with time zone',false),column('stoppedAt','timestamp(3) with time zone',false),column('createdAt','timestamp(3) with time zone')]},
 {name:'online_migration_steps',columns:[column('id','text'),column('releaseId','text'),column('stepId','text'),column('phase','text'),column('operationSha256','text'),column('operationJson','jsonb'),column('sourceMigrationName','text',false),column('state','text'),column('progressJson','jsonb',false),column('completedAt','timestamp(3) with time zone',false),column('createdAt','timestamp(3) with time zone')]},
]);

/** This result is scoped to columns, never complete catalog qualification. */
export function compareCandidateInitialColumns(actual:unknown):CatalogComparison {
 if(!Array.isArray(actual))return 'UNKNOWN';
 if(actual.some(a=>!a||typeof a.name!=='string'||!Array.isArray(a.columns)||a.columns.some((c:unknown)=>!c||typeof (c as Column).name!=='string'||typeof (c as Column).type!=='string'||typeof (c as Column).notNull!=='boolean')))return 'UNKNOWN';
 if(actual.length!==expected.length)return 'MISMATCH';
 for(let i=0;i<expected.length;i++){
  const a=actual[i],e=expected[i];
  if(a.name!==e.name||a.columns.length!==e.columns.length)return 'MISMATCH';
  for(let j=0;j<e.columns.length;j++){
   const c=a.columns[j],x=e.columns[j];
   if(c.name!==x.name||c.type!==x.type||c.notNull!==x.notNull)return 'MISMATCH';
  }
 }
 return 'MATCH';
}
/** A successful partial assertion must never admit DDL. */
export function assertCandidateInitialColumns(actual:readonly Table[]):'UNKNOWN' {
 if(compareCandidateInitialColumns(actual)!=='MATCH')throw new Error('CANDIDATE_INITIAL_COLUMNS_UNPROVEN');
 return 'UNKNOWN';
}

/** SQL-level defaults, not pg_get_expr output or complete catalog qualification. */
const expectedDefaults:readonly ColumnDefault[]=Object.freeze([
 {table:'online_releases',column:'phase',kind:'text',value:'PREPARING'},
 {table:'online_releases',column:'createdAt',kind:'current_timestamp',value:'CURRENT_TIMESTAMP'},
 {table:'online_runtime_slots',column:'phase',kind:'text',value:'PREPARED'},
 {table:'online_runtime_slots',column:'createdAt',kind:'current_timestamp',value:'CURRENT_TIMESTAMP'},
 {table:'online_migration_steps',column:'state',kind:'text',value:'PENDING'},
 {table:'online_migration_steps',column:'createdAt',kind:'current_timestamp',value:'CURRENT_TIMESTAMP'},
]);
export function assertCandidateInitialSqlDefaults(actual:readonly ColumnDefault[]):'UNKNOWN' {
 if(!Array.isArray(actual)||actual.length!==expectedDefaults.length)throw new Error('CANDIDATE_INITIAL_DEFAULTS_UNPROVEN');
 for(let i=0;i<expectedDefaults.length;i++){
  const a=actual[i],e=expectedDefaults[i];
  if(!a||a.table!==e.table||a.column!==e.column||a.kind!==e.kind||a.value!==e.value)throw new Error('CANDIDATE_INITIAL_DEFAULTS_UNPROVEN');
 }
 return 'UNKNOWN';
}

type ObjectKind='constraint'|'index'|'trigger'|'function';
type CatalogObject=Readonly<{kind:ObjectKind;name:string}>;
// Names from the SHA-pinned SQL, not a replacement for definition checks.
const expectedObjects:readonly CatalogObject[]=Object.freeze([
 ...['online_releases_pkey','online_release_manifest_identity','online_release_phase','online_release_browser_window',
 'online_runtime_slots_pkey','online_runtime_component','online_runtime_role','online_runtime_phase','online_runtime_stopped_evidence','online_runtime_identity',
 'online_migration_steps_pkey','online_migration_operation_identity','online_migration_phase','online_migration_state',
 'online_releases_deploymentId_fkey','online_runtime_slots_releaseId_fkey','online_migration_steps_releaseId_fkey'].map(name=>({kind:'constraint' as const,name})),
 ...['online_releases_deploymentId_key','online_releases_phase_browserSupportUntil_idx','online_runtime_slots_nonceSha256_key',
 'online_runtime_slots_releaseId_phase_idx','online_migration_steps_sourceMigrationName_key','online_migration_steps_state_releaseId_idx',
 'online_migration_steps_releaseId_stepId_key'].map(name=>({kind:'index' as const,name})),
 ...['online_release_identity_guard','online_runtime_identity_guard','online_migration_identity_guard','online_release_delete_guard',
 'online_runtime_delete_guard','online_migration_delete_guard','online_release_truncate_guard','online_runtime_truncate_guard',
 'online_migration_truncate_guard'].map(name=>({kind:'trigger' as const,name})),
 ...['sabalan_protect_online_release_identity','sabalan_protect_online_runtime_identity','sabalan_protect_online_migration_identity',
 'sabalan_prevent_online_registry_delete'].map(name=>({kind:'function' as const,name})),
]);
/** Checks names and kinds only; constraint/trigger/function semantics remain UNKNOWN. */
export function assertCandidateInitialObjectNames(actual:readonly CatalogObject[]):'UNKNOWN' {
 if(!Array.isArray(actual)||actual.length!==expectedObjects.length)throw new Error('CANDIDATE_INITIAL_OBJECTS_UNPROVEN');
 const key=(v:CatalogObject)=>`${v.kind}:${v.name}`;
 const actualKeys=actual.map(key).sort(),expectedKeys=expectedObjects.map(key).sort();
 if(actualKeys.some((v,i)=>v!==expectedKeys[i]))throw new Error('CANDIDATE_INITIAL_OBJECTS_UNPROVEN');
 return 'UNKNOWN';
}

/** Native introspection must translate the pg_constraint fields to this finite
 * vocabulary; raw textual pg_get_constraintdef output is not accepted here. */
type KeyConstraint=Readonly<{name:string;table:string;kind:'primary'|'foreign';columns:readonly string[];
 referencedTable:string|null;referencedColumns:readonly string[];onDelete:'restrict'|null;onUpdate:'cascade'|null;validated:boolean;
 tableSchema:'public';referencedSchema:'public'|null;deferrable:false;initiallyDeferred:false;match:'simple'|null;
 tableOid:number;resolvedTableOid:number;referencedTableOid:number|null;resolvedReferencedTableOid:number|null}>;
const expectedKeys:readonly Omit<KeyConstraint,'tableSchema'|'referencedSchema'|'deferrable'|'initiallyDeferred'|'match'|'tableOid'|'resolvedTableOid'|'referencedTableOid'|'resolvedReferencedTableOid'>[]=Object.freeze([
 {name:'online_releases_pkey',table:'online_releases',kind:'primary',columns:['id'],referencedTable:null,referencedColumns:[],onDelete:null,onUpdate:null,validated:true},
 {name:'online_runtime_slots_pkey',table:'online_runtime_slots',kind:'primary',columns:['id'],referencedTable:null,referencedColumns:[],onDelete:null,onUpdate:null,validated:true},
 {name:'online_migration_steps_pkey',table:'online_migration_steps',kind:'primary',columns:['id'],referencedTable:null,referencedColumns:[],onDelete:null,onUpdate:null,validated:true},
 {name:'online_releases_deploymentId_fkey',table:'online_releases',kind:'foreign',columns:['deploymentId'],referencedTable:'deployment_operations',referencedColumns:['id'],onDelete:'restrict',onUpdate:'cascade',validated:true},
 {name:'online_runtime_slots_releaseId_fkey',table:'online_runtime_slots',kind:'foreign',columns:['releaseId'],referencedTable:'online_releases',referencedColumns:['id'],onDelete:'restrict',onUpdate:'cascade',validated:true},
 {name:'online_migration_steps_releaseId_fkey',table:'online_migration_steps',kind:'foreign',columns:['releaseId'],referencedTable:'online_releases',referencedColumns:['id'],onDelete:'restrict',onUpdate:'cascade',validated:true},
]);
/** Key semantics alone are partial and grant no authority. */
export function assertCandidateInitialKeyConstraints(actual:readonly KeyConstraint[]):'UNKNOWN' {
 if(!Array.isArray(actual)||actual.length!==expectedKeys.length)throw new Error('CANDIDATE_INITIAL_KEYS_UNPROVEN');
 const byName=new Map(actual.map(item=>[item?.name,item]));
 if(byName.size!==expectedKeys.length)throw new Error('CANDIDATE_INITIAL_KEYS_UNPROVEN');
 for(const e of expectedKeys){const a=byName.get(e.name);
  if(!a||a.table!==e.table||a.kind!==e.kind||a.referencedTable!==e.referencedTable||a.onDelete!==e.onDelete||a.onUpdate!==e.onUpdate||a.validated!==true||
   a.tableSchema!=='public'||a.referencedSchema!==(e.kind==='foreign'?'public':null)||a.deferrable!==false||a.initiallyDeferred!==false||a.match!==(e.kind==='foreign'?'simple':null)||
   !Number.isSafeInteger(a.tableOid)||a.tableOid<=0||a.tableOid!==a.resolvedTableOid||(e.kind==='foreign'?(!Number.isSafeInteger(a.referencedTableOid)||!a.referencedTableOid||a.referencedTableOid!==a.resolvedReferencedTableOid):(a.referencedTableOid!==null||a.resolvedReferencedTableOid!==null))||
   !Array.isArray(a.columns)||!Array.isArray(a.referencedColumns)||JSON.stringify(a.columns)!==JSON.stringify(e.columns)||JSON.stringify(a.referencedColumns)!==JSON.stringify(e.referencedColumns))throw new Error('CANDIDATE_INITIAL_KEYS_UNPROVEN');
 }
 return 'UNKNOWN';
}

type IndexProjection=Readonly<{name:string;table:string;columns:readonly string[];unique:boolean;valid:boolean;ready:boolean;predicate:null;schema:'public';method:'btree';order:readonly 'asc'[];nulls:readonly 'last'[];opclasses:readonly string[];collations:readonly ('database_default'|null)[];includedColumnsEmpty:true;expressionsAbsent:true;indexOid:number;resolvedIndexOid:number}>;
const expectedIndexes:readonly Omit<IndexProjection,'schema'|'method'|'order'|'nulls'|'opclasses'|'collations'|'includedColumnsEmpty'|'expressionsAbsent'|'indexOid'|'resolvedIndexOid'>[]=Object.freeze([
 {name:'online_releases_deploymentId_key',table:'online_releases',columns:['deploymentId'],unique:true,valid:true,ready:true,predicate:null},
 {name:'online_releases_phase_browserSupportUntil_idx',table:'online_releases',columns:['phase','browserSupportUntil'],unique:false,valid:true,ready:true,predicate:null},
 {name:'online_runtime_slots_nonceSha256_key',table:'online_runtime_slots',columns:['nonceSha256'],unique:true,valid:true,ready:true,predicate:null},
 {name:'online_runtime_slots_releaseId_phase_idx',table:'online_runtime_slots',columns:['releaseId','phase'],unique:false,valid:true,ready:true,predicate:null},
 {name:'online_migration_steps_sourceMigrationName_key',table:'online_migration_steps',columns:['sourceMigrationName'],unique:true,valid:true,ready:true,predicate:null},
 {name:'online_migration_steps_state_releaseId_idx',table:'online_migration_steps',columns:['state','releaseId'],unique:false,valid:true,ready:true,predicate:null},
 {name:'online_migration_steps_releaseId_stepId_key',table:'online_migration_steps',columns:['releaseId','stepId'],unique:true,valid:true,ready:true,predicate:null},
]);
export function assertCandidateInitialIndexes(actual:readonly IndexProjection[]):'UNKNOWN' {
 if(!Array.isArray(actual)||actual.length!==expectedIndexes.length)throw new Error('CANDIDATE_INITIAL_INDEXES_UNPROVEN');
 const rows=new Map(actual.map(item=>[item?.name,item]));
 if(rows.size!==expectedIndexes.length)throw new Error('CANDIDATE_INITIAL_INDEXES_UNPROVEN');
 for(const e of expectedIndexes){const a=rows.get(e.name);
  const timestamp=e.name==='online_releases_phase_browserSupportUntil_idx';
  const classes=e.columns.map((_,i)=>timestamp&&i===1?'pg_catalog.timestamptz_ops':'pg_catalog.text_ops');
  const collations=e.columns.map((_,i)=>timestamp&&i===1?null:'database_default');
  if(!a||a.table!==e.table||a.unique!==e.unique||a.valid!==true||a.ready!==true||a.predicate!==null||a.schema!=='public'||a.method!=='btree'||!Array.isArray(a.order)||a.order.length!==e.columns.length||a.order.some(x=>x!=='asc')||!Array.isArray(a.nulls)||a.nulls.length!==e.columns.length||a.nulls.some(x=>x!=='last')||a.includedColumnsEmpty!==true||a.expressionsAbsent!==true||!Number.isSafeInteger(a.indexOid)||a.indexOid<=0||a.indexOid!==a.resolvedIndexOid||JSON.stringify(a.opclasses)!==JSON.stringify(classes)||JSON.stringify(a.collations)!==JSON.stringify(collations)||!Array.isArray(a.columns)||JSON.stringify(a.columns)!==JSON.stringify(e.columns))throw new Error('CANDIDATE_INITIAL_INDEXES_UNPROVEN');
 }
 return 'UNKNOWN';
}

type TriggerProjection=Readonly<{name:string;table:string;timing:'before';events:readonly ('update'|'delete'|'truncate')[];level:'row'|'statement';functionName:string;enabled:'origin';tableSchema:'public';functionSchema:'public';functionArguments:0;triggerFunctionOid:number;resolvedFunctionOid:number;whenAbsent:true;updateColumnsEmpty:true;transitionAbsent:true;nonConstraint:true;argumentsEmpty:true}>;
const expectedTriggers:readonly Omit<TriggerProjection,'tableSchema'|'functionSchema'|'functionArguments'|'triggerFunctionOid'|'resolvedFunctionOid'|'whenAbsent'|'updateColumnsEmpty'|'transitionAbsent'|'nonConstraint'|'argumentsEmpty'>[]=Object.freeze([
 ...(['release','runtime','migration'] as const).flatMap(part=>{
  const table={release:'online_releases',runtime:'online_runtime_slots',migration:'online_migration_steps'}[part];
  return [
   {name:`online_${part}_identity_guard`,table,timing:'before' as const,events:['update' as const],level:'row' as const,functionName:`sabalan_protect_online_${part}_identity`,enabled:'origin' as const},
   {name:`online_${part}_delete_guard`,table,timing:'before' as const,events:['delete' as const],level:'row' as const,functionName:'sabalan_prevent_online_registry_delete',enabled:'origin' as const},
   {name:`online_${part}_truncate_guard`,table,timing:'before' as const,events:['truncate' as const],level:'statement' as const,functionName:'sabalan_prevent_online_registry_delete',enabled:'origin' as const},
  ];
 }),
]);
export function assertCandidateInitialTriggers(actual:readonly TriggerProjection[]):'UNKNOWN' {
 if(!Array.isArray(actual)||actual.length!==expectedTriggers.length)throw new Error('CANDIDATE_INITIAL_TRIGGERS_UNPROVEN');
 const rows=new Map(actual.map(item=>[item?.name,item]));
 if(rows.size!==expectedTriggers.length)throw new Error('CANDIDATE_INITIAL_TRIGGERS_UNPROVEN');
 for(const e of expectedTriggers){const a=rows.get(e.name);
  if(!a||a.table!==e.table||a.timing!==e.timing||a.level!==e.level||a.functionName!==e.functionName||a.enabled!==e.enabled||a.tableSchema!=='public'||a.functionSchema!=='public'||a.functionArguments!==0||!Number.isSafeInteger(a.triggerFunctionOid)||a.triggerFunctionOid<=0||a.triggerFunctionOid!==a.resolvedFunctionOid||a.whenAbsent!==true||a.updateColumnsEmpty!==true||a.transitionAbsent!==true||a.nonConstraint!==true||a.argumentsEmpty!==true||!Array.isArray(a.events)||JSON.stringify(a.events)!==JSON.stringify(e.events))throw new Error('CANDIDATE_INITIAL_TRIGGERS_UNPROVEN');
 }
 return 'UNKNOWN';
}

type FunctionProjection=Readonly<{name:string;body:string;language:string;returnType:string;securityDefiner:boolean;argumentCount:number}>;
/** Compare prosrc to the exact dollar-quoted body from the reviewed source.
 * Unexpected formatting or catalog shapes are UNKNOWN, never an admission. */
export function assertCandidateInitialFunctionBodies(sql:Buffer,actual:readonly FunctionProjection[]):'UNKNOWN' {
 if(!Buffer.isBuffer(sql)||createHash('sha256').update(sql).digest('hex')!=='872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2')throw new Error('CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN');
 const definitions=[...sql.toString('utf8').matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/g)];
 if(definitions.length!==4||!Array.isArray(actual)||actual.length!==4)throw new Error('CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN');
 const names=new Set(['sabalan_protect_online_release_identity','sabalan_protect_online_runtime_identity','sabalan_protect_online_migration_identity','sabalan_prevent_online_registry_delete']);
 const rows=new Map(actual.map(item=>[item?.name,item]));
 if(rows.size!==4)throw new Error('CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN');
 for(const d of definitions){const a=rows.get(d[1]);
  if(!names.delete(d[1])||!a||a.body!==d[2]||a.language!=='plpgsql'||a.returnType!=='trigger'||a.securityDefiner!==false||a.argumentCount!==0)throw new Error('CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN');
 }
 if(names.size!==0)throw new Error('CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN');
 return 'UNKNOWN';
}

/** Call within the same owned transaction; this observation alone is not a
 * complete catalog check and does not confer authority or permit mutation. */
export async function observeCandidateInitialFunctions(tx:{ $queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T> },sql:Buffer):Promise<'UNKNOWN'> {
 const rows=await tx.$queryRaw<FunctionProjection[]>`SELECT p.proname AS name,p.prosrc AS body,l.lanname AS language,
   pg_catalog.format_type(p.prorettype,NULL) AS "returnType",p.prosecdef AS "securityDefiner",p.pronargs::integer AS "argumentCount"
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname IN
   ('sabalan_protect_online_release_identity','sabalan_protect_online_runtime_identity',
    'sabalan_protect_online_migration_identity','sabalan_prevent_online_registry_delete') ORDER BY p.proname`;
 return assertCandidateInitialFunctionBodies(sql,rows);
}

/** Native column snapshot, scoped to names/types/nullability. The remaining
 * catalog is not proven by this read and qualification remains UNKNOWN. */
export async function observeCandidateInitialColumns(tx:{ $queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T> }):Promise<'UNKNOWN'> {
 const rows=await tx.$queryRaw<unknown[]>`SELECT c.relname AS name,
   jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) ORDER BY a.attnum) AS "columns"
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    AND c.relname IN ('online_releases','online_runtime_slots','online_migration_steps')
   GROUP BY c.oid,c.relname ORDER BY CASE c.relname WHEN 'online_releases' THEN 0 WHEN 'online_runtime_slots' THEN 1 ELSE 2 END`;
 const result=compareCandidateInitialColumns(rows);
 if(result==='UNKNOWN')throw new Error('CANDIDATE_INITIAL_COLUMNS_UNKNOWN');
 if(result==='MISMATCH')throw new Error('CANDIDATE_INITIAL_COLUMNS_MISMATCH');
 return 'UNKNOWN';
}

/** Trigger bindings are observed within the same owned transaction as
 * function bodies. This remains only a partial catalog observation. */
export async function observeCandidateInitialTriggers(tx:{ $queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T> }):Promise<'UNKNOWN'> {
 const rows=await tx.$queryRaw<TriggerProjection[]>`SELECT t.tgname AS name,c.relname AS "table",n.nspname AS "tableSchema",
   CASE WHEN (t.tgtype::integer & 2)=2 THEN 'before' ELSE 'other' END AS timing,
   array_remove(ARRAY[CASE WHEN (t.tgtype::integer & 16)=16 THEN 'update' END,
     CASE WHEN (t.tgtype::integer & 8)=8 THEN 'delete' END,CASE WHEN (t.tgtype::integer & 32)=32 THEN 'truncate' END,
     CASE WHEN (t.tgtype::integer & 4)=4 THEN 'insert' END],NULL) AS events,
   CASE WHEN (t.tgtype::integer & 1)=1 THEN 'row' ELSE 'statement' END AS level,
   p.proname AS "functionName",pn.nspname AS "functionSchema",p.pronargs::integer AS "functionArguments",
   t.tgfoid::bigint::double precision AS "triggerFunctionOid",p.oid::bigint::double precision AS "resolvedFunctionOid",
   CASE WHEN t.tgenabled='O' THEN 'origin' ELSE 'other' END AS enabled,
   (t.tgqual IS NULL) AS "whenAbsent",(t.tgattr::text='') AS "updateColumnsEmpty",
   (t.tgoldtable IS NULL AND t.tgnewtable IS NULL) AS "transitionAbsent",
   (t.tgconstraint=0) AS "nonConstraint",(t.tgnargs=0) AS "argumentsEmpty"
   FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
   WHERE n.nspname='public' AND c.relname IN ('online_releases','online_runtime_slots','online_migration_steps') AND NOT t.tgisinternal`;
 return assertCandidateInitialTriggers(rows);
}

/** Primary/foreign key catalog snapshot; no CHECK expression qualification. */
export async function observeCandidateInitialKeys(tx:{ $queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T> }):Promise<'UNKNOWN'> {
 const rows=await tx.$queryRaw<KeyConstraint[]>`SELECT k.conname AS name,c.relname AS "table",n.nspname AS "tableSchema",
   CASE k.contype WHEN 'p' THEN 'primary' WHEN 'f' THEN 'foreign' ELSE 'other' END AS kind,
   ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord)
     JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS "columns",
   CASE WHEN k.contype='f' THEN rc.relname ELSE NULL END AS "referencedTable",
   CASE WHEN k.contype='f' THEN rn.nspname ELSE NULL END AS "referencedSchema",
   ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord)
     JOIN pg_catalog.pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord) AS "referencedColumns",
   CASE WHEN k.contype='f' AND k.confdeltype='r' THEN 'restrict' WHEN k.contype='p' THEN NULL ELSE 'other' END AS "onDelete",
   CASE WHEN k.contype='f' AND k.confupdtype='c' THEN 'cascade' WHEN k.contype='p' THEN NULL ELSE 'other' END AS "onUpdate",
   CASE WHEN k.contype='f' AND k.confmatchtype='s' THEN 'simple' WHEN k.contype='p' THEN NULL ELSE 'other' END AS "match",
   k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS "initiallyDeferred",
   k.conrelid::bigint::double precision AS "tableOid",c.oid::bigint::double precision AS "resolvedTableOid",
   CASE WHEN k.contype='f' THEN k.confrelid::bigint::double precision ELSE NULL END AS "referencedTableOid",
   CASE WHEN k.contype='f' THEN rc.oid::bigint::double precision ELSE NULL END AS "resolvedReferencedTableOid"
   FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_class rc ON rc.oid=k.confrelid
   LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=rc.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('online_releases','online_runtime_slots','online_migration_steps') AND k.contype IN ('p','f')`;
 return assertCandidateInitialKeyConstraints(rows);
}

/** Explicit non-primary index properties, without treating them as a complete
 * catalog proof. Default collation means the pg_catalog default collation. */
export async function observeCandidateInitialIndexes(tx:{ $queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T> }):Promise<'MATCH'> {
 const rows=await tx.$queryRaw<Array<IndexProjection & {definition:string}>>`SELECT ix.relname AS name,c.relname AS "table",n.nspname AS "schema",am.amname AS method,pg_catalog.pg_get_indexdef(ix.oid) AS definition,
   i.indisunique AS "unique",i.indisvalid AS valid,i.indisready AS ready,pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS predicate,
   (i.indnatts=i.indnkeyatts) AS "includedColumnsEmpty",(i.indexprs IS NULL) AS "expressionsAbsent",
   i.indexrelid::bigint::double precision AS "indexOid",ix.oid::bigint::double precision AS "resolvedIndexOid",
   ARRAY(SELECT a.attname::text FROM generate_series(0,i.indnkeyatts-1) x(pos)
     LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[x.pos] ORDER BY x.pos) AS "columns",
   ARRAY(SELECT CASE WHEN (i.indoption[x.pos]::integer & 1)=0 THEN 'asc' ELSE 'other' END FROM generate_series(0,i.indnkeyatts-1) x(pos) ORDER BY x.pos) AS "order",
   ARRAY(SELECT CASE WHEN (i.indoption[x.pos]::integer & 2)=0 THEN 'last' ELSE 'other' END FROM generate_series(0,i.indnkeyatts-1) x(pos) ORDER BY x.pos) AS "nulls",
   ARRAY(SELECT opn.nspname||'.'||op.opcname FROM generate_series(0,i.indnkeyatts-1) x(pos)
     LEFT JOIN pg_catalog.pg_opclass op ON op.oid=i.indclass[x.pos] LEFT JOIN pg_catalog.pg_namespace opn ON opn.oid=op.opcnamespace ORDER BY x.pos) AS opclasses,
   ARRAY(SELECT CASE WHEN i.indcollation[x.pos]=0 THEN NULL WHEN cn.nspname='pg_catalog' AND co.collname='default' THEN 'database_default' ELSE 'other' END
     FROM generate_series(0,i.indnkeyatts-1) x(pos) LEFT JOIN pg_catalog.pg_collation co ON co.oid=i.indcollation[x.pos]
     LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace ORDER BY x.pos) AS collations
   FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=ix.relam
   WHERE n.nspname='public' AND c.relname IN ('online_releases','online_runtime_slots','online_migration_steps') AND NOT i.indisprimary`;
 assertCandidateInitialIndexes(rows);
 const expected=new Map<string,typeof initialCanonicalWitness.indexes[number]>(initialCanonicalWitness.indexes.map(row=>[row.name,row]));
 for(const row of rows){const match=expected.get(row.name);if(!match||row.definition!==match.definition||row.predicate!==match.predicate)throw new Error('CANDIDATE_INITIAL_INDEX_DEFINITION_MISMATCH');expected.delete(row.name);}
 if(expected.size)throw new Error('CANDIDATE_INITIAL_INDEX_DEFINITION_MISMATCH');return 'MATCH';
}

/** Observe default identities without guessing PostgreSQL deparse equivalence.
 * Expressions are bounded and retained only in memory; semantic result UNKNOWN. */
export async function observeCandidateInitialDefaults(tx:{ $queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T> }):Promise<'MATCH'> {
 const rows=await tx.$queryRaw<Array<{table:string;column:string;expression:string|null}>>`SELECT c.relname AS "table",a.attname AS "column",
   CASE WHEN octet_length(pg_catalog.pg_get_expr(d.adbin,d.adrelid))<=4096 THEN pg_catalog.pg_get_expr(d.adbin,d.adrelid) ELSE NULL END AS expression FROM pg_catalog.pg_attrdef d
   JOIN pg_catalog.pg_class c ON c.oid=d.adrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
   WHERE n.nspname='public' AND c.relname IN ('online_releases','online_runtime_slots','online_migration_steps')`;
 if(!Array.isArray(rows)||rows.length!==expectedDefaults.length)throw new Error('CANDIDATE_INITIAL_DEFAULTS_UNPROVEN');
 const expectedNames=new Map(initialCanonicalWitness.defaults.map(x=>[`${x.tablename}:${x.columnname}`,x.expression]));
 for(const row of rows){const key=`${row.table}:${row.column}`;if(!row||!expectedNames.has(key)||row.expression!==expectedNames.get(key))throw new Error('CANDIDATE_INITIAL_DEFAULTS_UNPROVEN');expectedNames.delete(key);}
 if(expectedNames.size)throw new Error('CANDIDATE_INITIAL_DEFAULTS_UNPROVEN');return 'MATCH';
}

/** CHECK definition bytes require an independently verified PostgreSQL
 * deparse baseline. Names/flags alone never qualify the expression. */
export async function observeCandidateInitialChecks(tx:{ $queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T> }):Promise<'MATCH'> {
 const rows=await tx.$queryRaw<Array<{name:string;table:string;schema:string;validated:boolean;deferrable:boolean;initiallyDeferred:boolean;expression:string|null}>>`SELECT k.conname AS name,c.relname AS "table",n.nspname AS "schema",
   k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS "initiallyDeferred",
   CASE WHEN octet_length(pg_catalog.pg_get_constraintdef(k.oid))<=65536 THEN pg_catalog.pg_get_constraintdef(k.oid) ELSE NULL END AS expression FROM pg_catalog.pg_constraint k
   JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('online_releases','online_runtime_slots','online_migration_steps') AND k.contype='c'`;
 const expectedChecks=new Map([
  ['online_release_manifest_identity','online_releases'],['online_release_phase','online_releases'],['online_release_browser_window','online_releases'],
  ['online_runtime_component','online_runtime_slots'],['online_runtime_role','online_runtime_slots'],['online_runtime_phase','online_runtime_slots'],
  ['online_runtime_stopped_evidence','online_runtime_slots'],['online_runtime_identity','online_runtime_slots'],
  ['online_migration_operation_identity','online_migration_steps'],['online_migration_phase','online_migration_steps'],['online_migration_state','online_migration_steps'],
 ]);
 if(!Array.isArray(rows)||rows.length!==expectedChecks.size)throw new Error('CANDIDATE_INITIAL_CHECKS_UNPROVEN');
 const definitions=new Map<string,string>(initialCanonicalWitness.checks.map(row=>[row.conname,row.definition]));
 for(const row of rows){if(!row||expectedChecks.get(row.name)!==row.table||row.schema!=='public'||row.validated!==true||row.deferrable!==false||row.initiallyDeferred!==false||row.expression!==definitions.get(row.name))throw new Error('CANDIDATE_INITIAL_CHECKS_UNPROVEN');expectedChecks.delete(row.name);definitions.delete(row.name);}
 if(expectedChecks.size||definitions.size)throw new Error('CANDIDATE_INITIAL_CHECKS_UNPROVEN');return 'MATCH';
}

/** Incomplete CHECK/default/function/index semantics cannot be aggregated as
 * a MATCH even if each currently implemented partial assertion passes. */
export const candidateInitialCatalogQualification:CatalogComparison='UNKNOWN';
