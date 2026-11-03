import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {protectedCandidateLaterProjection as steps,protectedCandidateLaterCatalogQualification,invoiceConstraintDependency,compareLaterFact,protectedCandidateCreatedColumns,compareCreatedColumn,protectedCandidateCreatedIndexes,compareCreatedIndex,protectedCandidateCreatedTriggers,compareCreatedTrigger,observeLaterNumericColumns,observeLaterCreatedColumns,observeLaterAddedColumns,observeLaterCreatedIndexes,observeInvoiceConstraintDimension} from '../protectedCandidateLaterProjection';
import {invoiceConstraintWitness} from '../protectedCandidateInvoiceWitness';
import {exactCandidateMigrationNames,exactCandidateMigrationDigests} from '../protectedCandidateMigrationInventory';

test('all later stages retain independent pinned identities and explicit unresolved scope',()=>{
 assert.deepEqual(steps.map(s=>s.name),exactCandidateMigrationNames.slice(1));
 for(const step of steps){assert.equal(step.sha256,exactCandidateMigrationDigests[step.name]);assert.ok(step.unproven.length>0);}
 assert.equal(protectedCandidateLaterCatalogQualification,'UNKNOWN');
 assert.ok(steps.findIndex(s=>s.name===invoiceConstraintDependency.before)<steps.findIndex(s=>s.name===invoiceConstraintDependency.after));
});
test('decimal comparison checks precision and scale and cannot infer missing data',()=>{
 const decimal=steps.flatMap(s=>s.facts).find(f=>f.after==='NUMERIC_65_30');assert.ok(decimal);
 assert.equal(compareLaterFact(decimal,{exists:true,type:'numeric',precision:65,scale:30}),'UNKNOWN');
 assert.equal(compareLaterFact(decimal,{exists:true,type:'numeric',precision:65,scale:29}),'MISMATCH');
 assert.equal(compareLaterFact(decimal,{exists:true,type:'numeric'}),'UNKNOWN');
 assert.equal(compareLaterFact(decimal,{exists:false}),'MISMATCH');
});
test('stage numeric observer reports only its explicitly covered dimension',async()=>{
 const stage=steps.find(s=>s.facts.some(f=>f.after==='NUMERIC_65_30'))!;
 const expected=stage.facts.filter(f=>f.after==='NUMERIC_65_30');const seen:unknown[][]=[];
 const tx={$queryRaw:async<T>(_strings:TemplateStringsArray,...values:unknown[])=>{seen.push(values);return [{typeOid:1700,typmod:(65<<16)+30+4}] as T;}};
 assert.deepEqual(await observeLaterNumericColumns(tx,stage.name),{coverage:'numeric_type_oid_typmod',count:expected.length,comparison:'MATCH'});
 assert.equal(seen.length,expected.length);
 assert.deepEqual(seen,expected.map(f=>[f.object,f.column]));
 const wrong={$queryRaw:async<T>()=>[{typeOid:1700,typmod:(65<<16)+29+4}] as T};
 assert.equal((await observeLaterNumericColumns(wrong,stage.name)).comparison,'MISMATCH');
 const missing={$queryRaw:async<T>()=>[] as T};
 assert.equal((await observeLaterNumericColumns(missing,stage.name)).comparison,'MISMATCH');
 assert.equal((await observeLaterNumericColumns(tx,'unknown-stage')).comparison,'UNKNOWN');
});
test('created column dimensions distinguish exact structure from unknown default meaning',async()=>{
 const stage='20261019010000_customer_semantic_barrier',columns=protectedCandidateCreatedColumns.filter(c=>c.stage===stage);
 const types:Record<string,[number,number]>={TEXT:[25,-1],'TIMESTAMPTZ(3)':[1184,3],JSONB:[3802,-1],INTEGER:[23,-1],BOOLEAN:[16,-1],BIGINT:[20,-1],BYTEA:[17,-1],SERIAL:[23,-1],'TIMESTAMP(3)':[1114,3],'DECIMAL(65,30)':[1700,(65<<16)+30+4]};
 const make=(wrongDefault=false)=>({$queryRaw:async<T>(_strings:TemplateStringsArray,...values:unknown[])=>{
  const c=columns.find(x=>x.table===values[0]&&x.column===values[1])!;const [typeOid,typmod]=types[c.typeDeclaration];
  return [{typeOid,typmod,notNull:!c.nullable,identity:'',generated:'',hasDefault:wrongDefault?!Boolean(c.defaultSource):Boolean(c.defaultSource)}] as T;
 }});
 const result=await observeLaterCreatedColumns(make(),stage);
 assert.equal(result.structure,'MATCH');assert.equal(result.defaults,'UNKNOWN');assert.equal(result.count,columns.length);
 assert.equal((await observeLaterCreatedColumns(make(true),stage)).defaults,'MISMATCH');
 assert.equal((await observeLaterCreatedColumns({$queryRaw:async<T>()=>[] as T},stage)).structure,'MISMATCH');
});
test('SERIAL implies a default even without an explicit DEFAULT clause',async()=>{
 const stage='20261031130000_purchasing_operational_workspace';
 const columns=protectedCandidateCreatedColumns.filter(c=>c.stage===stage);
 const types:Record<string,[number,number]>={TEXT:[25,-1],'TIMESTAMPTZ(3)':[1184,3],JSONB:[3802,-1],INTEGER:[23,-1],'TIMESTAMP(3)':[1114,3],BOOLEAN:[16,-1],BIGINT:[20,-1],BYTEA:[17,-1],SERIAL:[23,-1],'DECIMAL(65,30)':[1700,(65<<16)+30+4]};
 const tx={$queryRaw:async<T>(_strings:TemplateStringsArray,...values:unknown[])=>{
  const c=columns.find(x=>x.table===values[0]&&x.column===values[1])!;const [typeOid,typmod]=types[c.typeDeclaration];
  return [{typeOid,typmod,notNull:!c.nullable,identity:'',generated:'',hasDefault:c.defaultSource!==null||c.typeDeclaration==='SERIAL'}] as T;
 }};
 const observed=await observeLaterCreatedColumns(tx,stage);assert.equal(observed.structure,'MATCH');assert.equal(observed.defaults,'UNKNOWN');
});
test('pinned JSONB expansion checks nullability, type and default absence',async()=>{
 const stage='20261019020000_hr_versioned_file_cleanup';let seen:unknown[]=[];
 const make=(row:Record<string,unknown>)=>({$queryRaw:async<T>(_s:TemplateStringsArray,...values:unknown[])=>{seen=values;return [row] as T;}});
 const valid={typeOid:3802,typmod:-1,notNull:false,identity:'',generated:'',hasDefault:false};
 assert.equal((await observeLaterAddedColumns(make(valid),stage)).comparison,'MATCH');
 assert.deepEqual(seen,['hr_deletion_file_cleanups','versionedFileState']);
 assert.equal((await observeLaterAddedColumns(make({...valid,hasDefault:true}),stage)).comparison,'MISMATCH');
 assert.equal((await observeLaterAddedColumns(make({...valid,notNull:true}),stage)).comparison,'MISMATCH');
});
test('index binding detects wrong table, uniqueness and invalid index without claiming key semantics',async()=>{
 const stage='20261028090000_sales_dispatch_invoices',expected=protectedCandidateCreatedIndexes.filter(i=>i.stage===stage);
 const make=(wrong=false)=>({$queryRaw:async<T>(_s:TemplateStringsArray,...values:unknown[])=>{
  const item=expected.find(x=>x.name===values[0])!;
  const names=item.keysSource.split(',').map(s=>s.trim().replace(/"/g,''));
  return [{table:item.table,method:'btree',unique:item.unique,valid:!wrong,ready:true,keyNames:names,options:names.map(()=>0),defaultOpclasses:names.map(()=>true),columnCollations:names.map(()=>true),noExpressions:true,noIncludes:true,nullsNotDistinct:false,hasPredicate:item.predicateSource!==null}] as T;
 }});
 const result=await observeLaterCreatedIndexes(make(),stage);assert.equal(result.count,expected.length);assert.equal(result.structure,'MATCH');assert.equal(result.keys,'MATCH');assert.equal(result.predicate,'UNKNOWN');
 assert.equal((await observeLaterCreatedIndexes(make(true),stage)).structure,'MISMATCH');
 assert.equal((await observeLaterCreatedIndexes({$queryRaw:async<T>()=>[] as T},stage)).structure,'MISMATCH');
});
test('invoice CHECK dimension uses local witness version and exact definitions',async()=>{
 const stage='20261028093000_sales_invoice_evidence_constraints';
 const make=(version:string,changed=false)=>{let count=0;return {$queryRaw:async<T>()=>{
  if(++count===1)return [{version}] as T;
  return invoiceConstraintWitness.map((row,i)=>({name:row.conname,type:row.type,validated:row.validated,deferrable:row.deferrable,deferred:row.initially_deferred,definition:row.definition+(changed&&i===0?' ':'')})) as T;
 }};};
 assert.equal((await observeInvoiceConstraintDimension(make('150018'),stage)).comparison,'MATCH');
 assert.equal((await observeInvoiceConstraintDimension(make('150017'),stage)).comparison,'UNKNOWN');
 assert.equal((await observeInvoiceConstraintDimension(make('150018',true),stage)).comparison,'MISMATCH');
});

test('created column declarations retain timestamp precision, nullability and unresolved default semantics',()=>{
 const issued=protectedCandidateCreatedColumns.find(c=>c.table==='sales_dispatch_invoices'&&c.column==='issuedAt');
 assert.ok(issued);assert.equal(issued.typeDeclaration,'TIMESTAMP(3)');assert.equal(issued.nullable,false);assert.equal(issued.defaultSource,'CURRENT_TIMESTAMP');
 assert.equal(compareCreatedColumn(issued,{exists:true,typeDeclaration:'timestamp(3)',nullable:false,defaultSource:'CURRENT_TIMESTAMP'}),'UNKNOWN');
 assert.equal(compareCreatedColumn(issued,{exists:true,typeDeclaration:'timestamp(6)',nullable:false}),'MISMATCH');
 const request=protectedCandidateCreatedColumns.find(c=>c.table==='sales_dispatch_invoices'&&c.column==='requestKey');assert.ok(request);
 assert.equal(compareCreatedColumn(request,{exists:true,typeDeclaration:'TEXT',nullable:false,defaultSource:null}),'UNKNOWN');
});

test('partial invoice index requires uniqueness, source keys and predicate',()=>{
 const index=protectedCandidateCreatedIndexes.find(i=>i.name==='sales_dispatch_invoices_active_loading');assert.ok(index);
 assert.equal(compareCreatedIndex(index,{exists:true,table:index.table,unique:true,keysSource:index.keysSource,predicateSource:index.predicateSource,valid:true,ready:true,accessMethod:'btree',collations:[],operatorClasses:[] }),'UNKNOWN');
 assert.equal(compareCreatedIndex(index,{exists:true,table:index.table,unique:false,keysSource:index.keysSource,predicateSource:index.predicateSource}),'MISMATCH');
 assert.equal(compareCreatedIndex(index,{exists:true,table:index.table,unique:true,valid:false}),'MISMATCH');
});

test('realtime trigger binding must include its events, function and enabled state',()=>{
 const trigger=protectedCandidateCreatedTriggers.find(t=>t.name==='online_realtime_batch_guard');assert.ok(trigger);
 const actual={exists:true,table:trigger.table,timing:trigger.timing,events:trigger.events,level:trigger.level,function:trigger.function,enabledMode:'ORIGIN' as const,functionSchema:'public',functionSignature:'()'};
 assert.equal(compareCreatedTrigger(trigger,actual),'UNKNOWN');assert.equal(compareCreatedTrigger(trigger,{...actual,enabledMode:'REPLICA'}),'MISMATCH');
 assert.equal(compareCreatedTrigger(trigger,{exists:true}),'UNKNOWN');
});

test('equivalent timestamp renderings do not create false drift',()=>{
 const column=protectedCandidateCreatedColumns.find(c=>c.typeDeclaration==='TIMESTAMPTZ(3)'&&c.defaultSource===null);assert.ok(column);
 assert.equal(compareCreatedColumn(column,{exists:true,typeDeclaration:'timestamp(3) with time zone',nullable:column.nullable,defaultSource:null}),'UNKNOWN');
 assert.equal(compareCreatedColumn(column,{exists:true,typeDeclaration:'TIMESTAMP WITH TIME ZONE',nullable:column.nullable,defaultSource:null}),'UNKNOWN');
});

test('every recorded column and index traces back to pinned migration bytes',()=>{
 const sqlByStage=new Map(steps.map(step=>{
  const git=spawnSync('git',['show',`e73830dffb15f29652748d6807d4d93ce82ab321:backend/prisma/migrations/${step.name}/migration.sql`],{encoding:'buffer'});
  assert.equal(git.status,0);assert.ok(git.stdout);const bytes=git.stdout;
  assert.equal(createHash('sha256').update(bytes).digest('hex'),step.sha256);return [step.name,bytes.toString('utf8')] as const;
 }));
 const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 assert.equal(protectedCandidateCreatedColumns.length,154);assert.equal(protectedCandidateCreatedIndexes.length,29);
 for(const column of protectedCandidateCreatedColumns){
  const sql=sqlByStage.get(column.stage)!;const table=new RegExp(`CREATE\\s+TABLE\\s+(?:public\\.)?"?${escape(column.table)}"?\\s*\\(`,'i');
  const found=table.exec(sql);assert.ok(found,`${column.stage}:${column.table}`);
  const from=found.index+found[0].length;const rest=sql.slice(from);const next=rest.search(/\n\s*\);/);assert.ok(next>=0);
  const body=rest.slice(0,next);const type=escape(column.typeDeclaration).replace(/\\ /g,'\\s+');
  assert.match(body,new RegExp(`(?:"${escape(column.column)}"|\\b${escape(column.column)}\\b)\\s+${type}(?=\\s|,|$)`,'i'));
 }
 for(const index of protectedCandidateCreatedIndexes){
  const sql=sqlByStage.get(index.stage)!;assert.match(sql,new RegExp(`CREATE\\s+${index.unique?'UNIQUE\\s+':''}INDEX\\s+"?${escape(index.name)}"?\\s+ON\\s+(?:public\\.)?"?${escape(index.table)}"?`,'i'));
  assert.ok(sql.replace(/\s+/g,' ').includes(index.keysSource));
  if(index.predicateSource)assert.ok(sql.replace(/\s+/g,' ').includes(index.predicateSource));
 }
});

test('presence alone cannot qualify an object',()=>{
 const fact=steps.flatMap(step=>step.facts).find(value=>value.after==='PRESENT')!;
 assert.equal(compareLaterFact(fact,{exists:true}),'UNKNOWN');
});
