import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {combineCatalogComparisons} from '../protectedCandidateCatalogContract';
import {assertCandidateInitialColumns,compareCandidateInitialColumns,assertCandidateInitialSqlDefaults,assertCandidateInitialObjectNames,assertCandidateInitialKeyConstraints,assertCandidateInitialIndexes,assertCandidateInitialTriggers,assertCandidateInitialFunctionBodies,observeCandidateInitialFunctions} from '../protectedCandidateInitialColumns';

test('initial column assertion agrees with the pinned migration and rejects drift',async()=>{
 assert.equal(combineCatalogComparisons(['MATCH','UNKNOWN']),'UNKNOWN');
 assert.equal(combineCatalogComparisons(['UNKNOWN','MISMATCH']),'MISMATCH');
 assert.equal(combineCatalogComparisons([]),'UNKNOWN');
 const raw=fs.readFileSync(path.resolve(__dirname,'../../../prisma/migrations/20261014140000_online_deployment_control/migration.sql'));
 assert.equal(createHash('sha256').update(raw).digest('hex'),'872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2');
 const source=raw.toString('utf8');
 const objects=[
  ...[...source.matchAll(/\b(?:ADD\s+)?CONSTRAINT\s+"([^"]+)"/g)].map(m=>({kind:'constraint' as const,name:m[1]})),
  ...[...source.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"/g)].map(m=>({kind:'index' as const,name:m[1]})),
  ...[...source.matchAll(/\bCREATE\s+TRIGGER\s+(\w+)/g)].map(m=>({kind:'trigger' as const,name:m[1]})),
  ...[...source.matchAll(/\bCREATE\s+FUNCTION\s+(\w+)/g)].map(m=>({kind:'function' as const,name:m[1]})),
 ];
 assert.doesNotThrow(()=>assertCandidateInitialObjectNames(objects));
 assert.throws(()=>assertCandidateInitialObjectNames(objects.slice(1)),/CANDIDATE_INITIAL_OBJECTS_UNPROVEN/);
 const keys= ['online_releases','online_runtime_slots','online_migration_steps'].flatMap(table=>{
  const body=source.match(new RegExp('CREATE TABLE "'+table+'" \\(([\\s\\S]*?)\\n\\);'))![1];
  const primary=body.match(/CONSTRAINT "([^"]+)" PRIMARY KEY \("([^"]+)"\)/)!;
  const foreign=[...source.matchAll(new RegExp('ALTER TABLE "'+table+'" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \\("([^"]+)"\\) REFERENCES "([^"]+)"\\("([^"]+)"\\) ON DELETE RESTRICT ON UPDATE CASCADE','g'))];
  return [{name:primary[1],table,kind:'primary' as const,columns:[primary[2]],referencedTable:null,referencedColumns:[],onDelete:null,onUpdate:null,validated:true,tableSchema:'public' as const,referencedSchema:null,deferrable:false as const,initiallyDeferred:false as const,match:null,tableOid:1,resolvedTableOid:1,referencedTableOid:null,resolvedReferencedTableOid:null},
   ...foreign.map(m=>({name:m[1],table,kind:'foreign' as const,columns:[m[2]],referencedTable:m[3],referencedColumns:[m[4]],onDelete:'restrict' as const,onUpdate:'cascade' as const,validated:true,tableSchema:'public' as const,referencedSchema:'public' as const,deferrable:false as const,initiallyDeferred:false as const,match:'simple' as const,tableOid:1,resolvedTableOid:1,referencedTableOid:2,resolvedReferencedTableOid:2}))];
 });
 assert.doesNotThrow(()=>assertCandidateInitialKeyConstraints(keys));
 const wrongKeys=structuredClone(keys);wrongKeys[1].validated=false;
 assert.throws(()=>assertCandidateInitialKeyConstraints(wrongKeys),/CANDIDATE_INITIAL_KEYS_UNPROVEN/);
 const missingFlags=structuredClone(keys);delete (missingFlags[0] as any).deferrable;
 assert.throws(()=>assertCandidateInitialKeyConstraints(missingFlags),/CANDIDATE_INITIAL_KEYS_UNPROVEN/);
 const wrongReference=structuredClone(keys);wrongReference[1].resolvedReferencedTableOid=3;
 assert.throws(()=>assertCandidateInitialKeyConstraints(wrongReference),/CANDIDATE_INITIAL_KEYS_UNPROVEN/);
 const indexes=[...source.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\(([^)]+)\);/g)].map(m=>{const columns=[...m[4].matchAll(/"([^"]+)"/g)].map(x=>x[1]);return {name:m[2],table:m[3],columns,unique:!!m[1],valid:true,ready:true,predicate:null,schema:'public' as const,method:'btree' as const,order:columns.map(()=> 'asc' as const),nulls:columns.map(()=> 'last' as const),includedColumnsEmpty:true as const,expressionsAbsent:true as const,indexOid:1,resolvedIndexOid:1,opclasses:columns.map(column=>column==='browserSupportUntil'?'pg_catalog.timestamptz_ops':'pg_catalog.text_ops'),collations:columns.map(column=>column==='browserSupportUntil'?null:'database_default' as const)};});
 assert.doesNotThrow(()=>assertCandidateInitialIndexes(indexes));
 const wrongIndexes=structuredClone(indexes);wrongIndexes[0].unique=false;
 assert.throws(()=>assertCandidateInitialIndexes(wrongIndexes),/CANDIDATE_INITIAL_INDEXES_UNPROVEN/);
 const wrongOpclass=structuredClone(indexes);(wrongOpclass[0].opclasses as string[])[0]='pg_catalog.int4_ops';
 assert.throws(()=>assertCandidateInitialIndexes(wrongOpclass),/CANDIDATE_INITIAL_INDEXES_UNPROVEN/);
 const triggers=[...source.matchAll(/CREATE TRIGGER (\w+) BEFORE (UPDATE|DELETE|TRUNCATE) ON "([^"]+)"\s+FOR EACH (ROW|STATEMENT) EXECUTE FUNCTION (\w+)\(\);/g)].map(m=>({name:m[1],table:m[3],timing:'before' as const,events:[m[2].toLowerCase() as 'update'|'delete'|'truncate'],level:m[4].toLowerCase() as 'row'|'statement',functionName:m[5],enabled:'origin' as const,tableSchema:'public' as const,functionSchema:'public' as const,functionArguments:0 as const,triggerFunctionOid:1,resolvedFunctionOid:1,whenAbsent:true as const,updateColumnsEmpty:true as const,transitionAbsent:true as const,nonConstraint:true as const,argumentsEmpty:true as const}));
 assert.doesNotThrow(()=>assertCandidateInitialTriggers(triggers));
 const wrongTriggers=structuredClone(triggers);wrongTriggers[0].functionName='other';
 assert.throws(()=>assertCandidateInitialTriggers(wrongTriggers),/CANDIDATE_INITIAL_TRIGGERS_UNPROVEN/);
 const wrongOid=structuredClone(triggers);wrongOid[0].resolvedFunctionOid=2;
 assert.throws(()=>assertCandidateInitialTriggers(wrongOid),/CANDIDATE_INITIAL_TRIGGERS_UNPROVEN/);
 const functions=[...source.matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/g)].map(m=>({name:m[1],body:m[2],language:'plpgsql',returnType:'trigger',securityDefiner:false,argumentCount:0}));
 assert.doesNotThrow(()=>assertCandidateInitialFunctionBodies(raw,functions));
 const wrongFunctions=structuredClone(functions);wrongFunctions[0].body+=' -- changed';
 assert.throws(()=>assertCandidateInitialFunctionBodies(raw,wrongFunctions),/CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN/);
 let observations=0;
 const tx={$queryRaw:async <T>(strings:TemplateStringsArray):Promise<T>=>{observations++;assert.match(strings.join(''),/pg_catalog\.pg_proc/);return functions as T;}};
 assert.equal(await observeCandidateInitialFunctions(tx,raw),'UNKNOWN');assert.equal(observations,1);
 await assert.rejects(observeCandidateInitialFunctions({$queryRaw:async <T>()=>wrongFunctions as T},raw),/CANDIDATE_INITIAL_FUNCTIONS_UNPROVEN/);
 const tables=['online_releases','online_runtime_slots','online_migration_steps'].map(name=>{
  const body=source.match(new RegExp('CREATE TABLE "'+name+'" \\(([\\s\\S]*?)\\n\\);'))?.[1];
  assert.ok(body);
  const columns=[...body.matchAll(/^\s+"([^"]+)"\s+(TEXT|JSONB|TIMESTAMPTZ\(3\))(.*)$/gm)].map(m=>({name:m[1],type:m[2]==='TIMESTAMPTZ(3)'?'timestamp(3) with time zone':m[2].toLowerCase(),notNull:/\bNOT NULL\b/.test(m[3])}));
  return {name,columns};
 });
 assert.equal(assertCandidateInitialColumns(tables),'UNKNOWN');
 assert.equal(compareCandidateInitialColumns(tables),'MATCH');
 const incomplete=structuredClone(tables);delete (incomplete[0].columns[0] as any).type;
 assert.equal(compareCandidateInitialColumns(incomplete),'UNKNOWN');
 const defaults=tables.flatMap(table=>{
  const body=source.match(new RegExp('CREATE TABLE "'+table.name+'" \\(([\\s\\S]*?)\\n\\);'))![1];
  return [...body.matchAll(/^\s+"([^"]+)"[^\n]*?\bDEFAULT\s+('([^']*)'|CURRENT_TIMESTAMP)/gm)].map(m=>({table:table.name,column:m[1],kind:m[3]===undefined?'current_timestamp' as const:'text' as const,value:m[3]??'CURRENT_TIMESTAMP'}));
 });
 assert.doesNotThrow(()=>assertCandidateInitialSqlDefaults(defaults));
 const wrongDefaults=structuredClone(defaults);wrongDefaults[0].value='READY';
 assert.throws(()=>assertCandidateInitialSqlDefaults(wrongDefaults),/CANDIDATE_INITIAL_DEFAULTS_UNPROVEN/);
 const changed=structuredClone(tables);changed[0].columns[0].type='integer';
 assert.equal(compareCandidateInitialColumns(changed),'MISMATCH');
 assert.throws(()=>assertCandidateInitialColumns(changed),/CANDIDATE_INITIAL_COLUMNS_UNPROVEN/);
 changed[0].columns[0].type='text';changed[0].columns.pop();
 assert.throws(()=>assertCandidateInitialColumns(changed),/CANDIDATE_INITIAL_COLUMNS_UNPROVEN/);
});
