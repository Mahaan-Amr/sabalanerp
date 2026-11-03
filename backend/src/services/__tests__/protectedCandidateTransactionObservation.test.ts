import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {exactCandidateMigrationDigests,exactCandidateMigrationNames,exactCandidatePlanSha256} from '../protectedCandidateMigrationInventory';
import {readCandidateTransactionObservation,readProtectedTransactionHistory,type CandidateObservationTransaction} from '../protectedCandidateTransactionObservation';
import {protectedCandidateLaterProjection,protectedCandidateCreatedColumns} from '../protectedCandidateLaterProjection';
import {initialCanonicalWitness} from '../protectedCandidateInitialWitness';
import {invoiceConstraintWitness} from '../protectedCandidateInvoiceWitness';

const owner={deploymentId:'deployment-fixture',releaseId:'release-fixture',leaseToken:'private-fixture-token'};
const files=new Map(exactCandidateMigrationNames.map(name=>[name,fs.readFileSync(path.resolve(process.cwd(),'backend/prisma/migrations',name,'migration.sql'))]));
const observe=(tx:CandidateObservationTransaction)=>readCandidateTransactionObservation(tx,owner,files);
const checkpoint={deploymentId:owner.deploymentId,releaseId:owner.releaseId,localVerified:true,remoteVerified:true,restoreVerified:true,manifestReadable:true,checksum:'a'.repeat(64)};
test('rejects an unapplied noncandidate predecessor before catalog or DDL',async()=>{
 const predecessor='20261014120000_hr_vehicle_assignment_plans';
 const sources=new Map(files);sources.set(predecessor,Buffer.from('predecessor'));
 const {tx,calls}=transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[]);
 await assert.rejects(readCandidateTransactionObservation(tx,owner,sources),/CANDIDATE_PREDECESSOR_HISTORY_INCOMPLETE/);
 assert.equal(calls.length,3);
});
function testColumn(table:unknown,name:unknown){
 const item=protectedCandidateCreatedColumns.find(c=>c.table===table&&c.column===name);if(!item)return [];
 const types:Record<string,[number,number]>={TEXT:[25,-1],'TIMESTAMPTZ(3)':[1184,3],JSONB:[3802,-1],INTEGER:[23,-1],'TIMESTAMP(3)':[1114,3],BOOLEAN:[16,-1],BIGINT:[20,-1],BYTEA:[17,-1],SERIAL:[23,-1],'DECIMAL(65,30)':[1700,(65<<16)+30+4]};
 const [typeOid,typmod]=types[item.typeDeclaration];return [{typeOid,typmod,notNull:!item.nullable,identity:'',generated:'',hasDefault:item.defaultSource!==null||item.typeDeclaration==='SERIAL'}];
}
const entry=(i:number)=>({name:exactCandidateMigrationNames[i],checksum:exactCandidateMigrationDigests[exactCandidateMigrationNames[i]],finished:new Date(),rolledBack:null,hasLogs:true});
const receipt=(i:number)=>({checksum:entry(i).checksum,finished:new Date(),receipt:JSON.stringify({format:'sabalan-owned-candidate-migration/v2',planSha256:exactCandidatePlanSha256,sqlSha256:entry(i).checksum,checkpointSha256:checkpoint.checksum,beforeScopedProjectionSha256:String(i).repeat(64),afterScopedProjectionSha256:String(i+1).repeat(64)})});
const functions=[...files.get(exactCandidateMigrationNames[0])!.toString('utf8').matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/g)].map(m=>({name:m[1],body:m[2],language:'plpgsql',returnType:'trigger',securityDefiner:false,argumentCount:0}));
const sql=files.get(exactCandidateMigrationNames[0])!.toString('utf8');
const columns=['online_releases','online_runtime_slots','online_migration_steps'].map(name=>{const body=sql.match(new RegExp('CREATE TABLE "'+name+'" \\(([\\s\\S]*?)\\n\\);'))![1];return {name,columns:[...body.matchAll(/^\s+"([^"]+)"\s+(TEXT|JSONB|TIMESTAMPTZ\(3\))(.*)$/gm)].map(m=>({name:m[1],type:m[2]==='TIMESTAMPTZ(3)'?'timestamp(3) with time zone':m[2].toLowerCase(),notNull:/\bNOT NULL\b/.test(m[3])}))};});
const triggers=[...sql.matchAll(/CREATE TRIGGER (\w+) BEFORE (UPDATE|DELETE|TRUNCATE) ON "([^"]+)"\s+FOR EACH (ROW|STATEMENT) EXECUTE FUNCTION (\w+)\(\);/g)].map(m=>({name:m[1],table:m[3],timing:'before',events:[m[2].toLowerCase()],level:m[4].toLowerCase(),functionName:m[5],enabled:'origin',tableSchema:'public',functionSchema:'public',functionArguments:0,triggerFunctionOid:1,resolvedFunctionOid:1,whenAbsent:true,updateColumnsEmpty:true,transitionAbsent:true,nonConstraint:true,argumentsEmpty:true}));
const keys=columns.flatMap(({name:table})=>{const body=sql.match(new RegExp('CREATE TABLE "'+table+'" \\(([\\s\\S]*?)\\n\\);'))![1];const primary=body.match(/CONSTRAINT "([^"]+)" PRIMARY KEY \("([^"]+)"\)/)!;const foreign=[...sql.matchAll(new RegExp('ALTER TABLE "'+table+'" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \\("([^"]+)"\\) REFERENCES "([^"]+)"\\("([^"]+)"\\) ON DELETE RESTRICT ON UPDATE CASCADE','g'))];return [{name:primary[1],table,kind:'primary',columns:[primary[2]],referencedTable:null,referencedColumns:[],onDelete:null,onUpdate:null,validated:true,tableSchema:'public',referencedSchema:null,deferrable:false,initiallyDeferred:false,match:null,tableOid:1,resolvedTableOid:1,referencedTableOid:null,resolvedReferencedTableOid:null},...foreign.map(m=>({name:m[1],table,kind:'foreign',columns:[m[2]],referencedTable:m[3],referencedColumns:[m[4]],onDelete:'restrict',onUpdate:'cascade',validated:true,tableSchema:'public',referencedSchema:'public',deferrable:false,initiallyDeferred:false,match:'simple',tableOid:1,resolvedTableOid:1,referencedTableOid:2,resolvedReferencedTableOid:2}))];});
const indexes=[...sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\(([^)]+)\);/g)].map(m=>{const c=[...m[4].matchAll(/"([^"]+)"/g)].map(x=>x[1]);return {name:m[2],table:m[3],columns:c,unique:!!m[1],valid:true,ready:true,predicate:null,schema:'public',method:'btree',order:c.map(()=> 'asc'),nulls:c.map(()=> 'last'),includedColumnsEmpty:true,expressionsAbsent:true,indexOid:1,resolvedIndexOid:1,opclasses:c.map(column=>column==='browserSupportUntil'?'pg_catalog.timestamptz_ops':'pg_catalog.text_ops'),collations:c.map(column=>column==='browserSupportUntil'?null:'database_default')};});
const defaults=columns.flatMap(({name:table})=>{const body=sql.match(new RegExp('CREATE TABLE "'+table+'" \\(([\\s\\S]*?)\\n\\);'))![1];return [...body.matchAll(/^\s+"([^"]+)"[^\n]*?\bDEFAULT\s+('([^']*)'|CURRENT_TIMESTAMP)/gm)].map(m=>({table,column:m[1],expression:'opaque'}));});
const checks=[['online_releases',['online_release_manifest_identity','online_release_phase','online_release_browser_window']],['online_runtime_slots',['online_runtime_component','online_runtime_role','online_runtime_phase','online_runtime_stopped_evidence','online_runtime_identity']],['online_migration_steps',['online_migration_operation_identity','online_migration_phase','online_migration_state']]].flatMap(([table,names])=>(names as string[]).map(name=>({table,name,schema:'public',validated:true,deferrable:false,initiallyDeferred:false,expression:'opaque'})));
for(const row of indexes)Object.assign(row,{definition:initialCanonicalWitness.indexes.find(value=>value.name===row.name)!.definition});
for(const row of defaults)row.expression=initialCanonicalWitness.defaults.find(value=>value.tablename===row.table&&value.columnname===row.column)!.expression;
for(const row of checks)row.expression=initialCanonicalWitness.checks.find(value=>value.conname===row.name)!.definition;
function transaction(lease:unknown,history:unknown,receipts:any[]=[receipt(0),receipt(1)],functionRows:any[]=functions,columnRows:any[]=columns,triggerRows:any[]=triggers,keyRows:any[]=keys,indexRows:any[]=indexes,defaultRows:any[]=defaults,checkRows:any[]=checks){
 const calls:{sql:string;values:unknown[]}[]=[];
 const tx={$queryRaw:async<T>(strings:TemplateStringsArray,...values:unknown[])=>{
  const q=strings.join('');calls.push({sql:strings.join('?'),values});return (calls.length===1?[]:calls.length===2?lease:calls.length===3?history:q.includes('a.attidentity::text AS identity')?testColumn(values[0],values[1]):q.includes('pg_catalog.pg_index i')?indexRows:q.includes('pg_catalog.pg_attrdef d')?defaultRows:q.includes("k.contype='c'")?checkRows:q.includes('pg_catalog.pg_constraint k')?keyRows:q.includes('pg_catalog.pg_attribute a')?columnRows:q.includes('pg_catalog.pg_trigger t')?triggerRows:q.includes('pg_catalog.pg_proc p')?functionRows:[receipts[calls.length-4]].filter(Boolean)) as T;
 }} satisfies CandidateObservationTransaction;
 return {tx,calls};
}
test('reads actual owner binding and contiguous candidate prefix without claiming catalog authority',async()=>{
 const {tx,calls}=transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0),entry(1)]);
 const result=await observe(tx);
 assert.equal(result.prefixLength,2);assert.equal(result.sourceImageBinding,'UNPROVEN');assert.equal(result.catalogQualification,'UNPROVEN');assert.equal(result.executionAuthority,'NOT_GRANTED');
 assert.match(calls[0].sql,/lock_timeout/);assert.match(calls[1].sql,/FOR SHARE/);assert.match(calls[1].sql,/MUTATION_STARTED/);assert.deepEqual(calls[1].values,[owner.deploymentId,owner.releaseId,owner.leaseToken]);
 assert.match(calls[2].sql,/LIMIT 8193/);assert.match(calls[2].sql,/logs IS NOT NULL AS "hasLogs"/);
 assert.equal(result.receiptPrefix,'CONSISTENT_NOT_QUALIFIED');assert.equal(result.lastReceiptScopedProjectionSha256,'2'.repeat(64));assert.match(calls[3].sql,/FOR SHARE/);
 assert.equal(calls.some(call=>call.sql.includes('pg_catalog.pg_proc p')),false);
 assert.doesNotMatch(JSON.stringify(result),/private-fixture-token/);
});
test('shared locked history validation does not interpret legacy receipts as candidate receipts',async()=>{
 const {tx,calls}=transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)]);
 const result=await readProtectedTransactionHistory(tx,owner,files);
 assert.equal(result.checkpointChecksum,checkpoint.checksum);assert.equal(calls.length,3);
});
test('owned observation incorporates numeric dimension without authorizing catalog',async()=>{
 const stage=protectedCandidateLaterProjection.find(s=>s.facts.some(f=>f.after==='NUMERIC_65_30'))!;
 const index=exactCandidateMigrationNames.indexOf(stage.name);assert.ok(index>0&&index<10);
 const history=Array.from({length:index+1},(_,i)=>entry(i));
 const make=(typmod:number)=>{let count=0;return {$queryRaw:async<T>(strings:TemplateStringsArray,...values:unknown[])=>{
  const q=strings.join('?');count++;
  if(count===1)return [] as T;
  if(count===2)return [{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}] as T;
  if(count===3)return history as T;
  if(q.includes('CASE WHEN octet_length(logs)'))return [receipt(count-4)] as T;
  if(q.includes("current_setting('server_version_num')"))return [{version:'150017'}] as T;
  if(q.includes('a.attidentity::text AS identity'))return testColumn(values[0],values[1]) as T;
  if(q.includes('a.atttypid::integer'))return [{typeOid:1700,typmod}] as T;
  throw Error('unexpected observation');
 }} satisfies CandidateObservationTransaction;};
 const matched=await observe(make((65<<16)+30+4));
 assert.equal(matched.numericDimension?.comparison,'MATCH');assert.equal(matched.catalogQualification,'UNPROVEN');assert.equal(matched.executionAuthority,'NOT_GRANTED');
 await assert.rejects(observe(make((65<<16)+29+4)),/CANDIDATE_NUMERIC_TYPE_MISMATCH/);
});
test('owned observation checks witnessed invoice constraints without granting authority',async()=>{
 const index=exactCandidateMigrationNames.indexOf('20261028093000_sales_invoice_evidence_constraints');
 const history=Array.from({length:index+1},(_,i)=>entry(i));
 const make=(changed:boolean)=>{let count=0,versionCalls=0;return {$queryRaw:async<T>(strings:TemplateStringsArray)=>{
  const q=strings.join('?');count++;
  if(count===1)return [] as T;if(count===2)return [{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}] as T;
  if(count===3)return history as T;
  if(q.includes('CASE WHEN octet_length(logs)'))return [receipt(count-4)] as T;
  if(q.includes("current_setting('server_version_num')"))return [{version:++versionCalls===1?'150018':'150017'}] as T;
  if(q.includes("sales_invoice_number_positive"))return invoiceConstraintWitness.map((row,i)=>({name:row.conname,type:row.type,validated:row.validated,deferrable:row.deferrable,deferred:row.initially_deferred,definition:row.definition+(changed&&i===0?' ':'')})) as T;
  throw Error('unexpected observation');
 }} satisfies CandidateObservationTransaction;};
 const result=await observe(make(false));assert.equal(result.invoiceConstraintDimension?.comparison,'MATCH');assert.equal(result.catalogQualification,'UNPROVEN');
 await assert.rejects(observe(make(true)),/CANDIDATE_INVOICE_CHECK_MISMATCH/);
});
test('initial catalog absence is necessary but never sufficient qualification',async()=>{
 const make=(catalog:unknown)=>{let calls=0;return {$queryRaw:async<T>()=>{calls++;return (calls===1?[]:calls===2?[{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}]:calls===3?[]:catalog) as T;}} satisfies CandidateObservationTransaction;};
 const result=await observe(make([{relations:0,functions:0}]));
 assert.equal(result.prefixLength,0);assert.equal(result.catalogQualification,'UNPROVEN');
 await assert.rejects(observe(make([{relations:1,functions:0}])),/CANDIDATE_INITIAL_CATALOG_MISMATCH/);
 await assert.rejects(observe(make([{relations:null,functions:0}])),/CANDIDATE_INITIAL_CATALOG_UNKNOWN/);
});
test('rejects missing checkpoint, changed checksum, gaps and duplicate native rows',async()=>{
 await assert.rejects(observe(transaction([],[]).tx),/CANDIDATE_CHECKPOINT_LEASE_UNPROVEN/);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint:{...checkpoint,remoteVerified:false}}],[]).tx),/CANDIDATE_CHECKPOINT_LEASE_UNPROVEN/);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(1)]).tx),/CANDIDATE_HISTORY_NONCONTIGUOUS/);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0),entry(0)]).tx),/PROTECTED_MIGRATION_HISTORY_REQUIRES_INSPECTION/);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[{...entry(0),checksum:'0'.repeat(64)}]).tx),/PROTECTED_MIGRATION_HISTORY_REQUIRES_INSPECTION/);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[{...entry(0),name:'older-migration',finished:null}]).tx),/PROTECTED_MIGRATION_HISTORY_REQUIRES_INSPECTION/);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[{...receipt(0),receipt:null}]).tx),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],exactCandidateMigrationNames.map((_,i)=>entry(i)),[]).tx),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 const bad=JSON.parse(receipt(0).receipt);bad.checkpointSha256='f'.repeat(64);
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[{...receipt(0),receipt:JSON.stringify(bad)}]).tx),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 const changed=structuredClone(functions);changed[0].body+='-- changed';
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],changed).tx),/CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN/);
 const changedColumns=structuredClone(columns);changedColumns[0].columns[0].type='integer';
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,changedColumns).tx),/CANDIDATE_INITIAL_COLUMNS_MISMATCH/);
 const changedTriggers=structuredClone(triggers);changedTriggers[0].triggerFunctionOid=2;
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,columns,changedTriggers).tx),/CANDIDATE_INITIAL_TRIGGERS_UNPROVEN/);
 const changedKeys=structuredClone(keys);changedKeys[0].deferrable=true;
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,columns,triggers,changedKeys).tx),/CANDIDATE_INITIAL_KEYS_UNPROVEN/);
 const changedIndexes=structuredClone(indexes);changedIndexes[0].nulls[0]='first';
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,columns,triggers,keys,changedIndexes).tx),/CANDIDATE_INITIAL_INDEXES_UNPROVEN/);
 const changedChecks=structuredClone(checks);changedChecks[0].validated=false;
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,columns,triggers,keys,indexes,defaults,changedChecks).tx),/CANDIDATE_INITIAL_CHECKS_UNPROVEN/);
 const changedDefinition=structuredClone(checks);changedDefinition[0].expression+=' AND true';
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,columns,triggers,keys,indexes,defaults,changedDefinition).tx),/CANDIDATE_INITIAL_CHECKS_UNPROVEN/);
 const changedDefaults=structuredClone(defaults);changedDefaults[0].expression+=" ";
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,columns,triggers,keys,indexes,changedDefaults,checks).tx),/CANDIDATE_INITIAL_DEFAULTS_UNPROVEN/);
 const changedDefinitionIndex=structuredClone(indexes);Object.assign(changedDefinitionIndex[0],{definition:'CREATE INDEX wrong'});
 await assert.rejects(observe(transaction([{id:owner.deploymentId,targetCommit:'b'.repeat(40),checkpoint}],[entry(0)],[receipt(0)],functions,columns,triggers,keys,changedDefinitionIndex,defaults,checks).tx),/CANDIDATE_INITIAL_INDEX_DEFINITION_MISMATCH/);
});
