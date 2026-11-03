import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOwnedTemporaryDatabase,inspectTemporaryDatabaseCensus,makeProtectedTemporaryRunner} from './protectedTemporaryPostgresRunner';

test('read-only temporary identity is bound to the requested name and cluster',async()=>{
 const raw='postgresql://test:test@127.0.0.1:55432/sabalanerp',name='sabalanerp_protected_'+'a'.repeat(32),cluster={containerId:'b'.repeat(64),systemIdentifier:'123'};
 let ended=0,calls=0;
 const client=()=>({async connect(){},async query(sql:string,values:readonly string[]){calls++;assert.match(sql,/pg_catalog\.pg_control_system/);assert.deepEqual(values,[name]);return {rows:[{systemIdentifier:'123',databaseOid:'456'}]};},async end(){ended++;}});
 assert.deepEqual(await inspectOwnedTemporaryDatabase(raw,name,cluster,client),{state:'SUCCESS',value:{systemIdentifier:'123',databaseOid:'456'}});
 assert.equal(calls,1);assert.equal(ended,1);
 assert.equal((await inspectOwnedTemporaryDatabase(raw,'postgres',cluster,client)).state,'UNKNOWN');
 assert.equal((await inspectOwnedTemporaryDatabase(raw,name,{...cluster,systemIdentifier:'999'},client)).state,'UNKNOWN');
 assert.equal((await inspectOwnedTemporaryDatabase(raw,name,cluster,()=>({...client(),async end(){throw Error('private');}}))).state,'UNKNOWN');
});

test('owned UUID lifecycle retains unknown setup and unknown create without drop',async()=>{
 const raw='postgresql://test:test@127.0.0.1:55432/sabalanerp',name='sabalanerp_protected_'+'c'.repeat(32),cluster={containerId:'b'.repeat(64),systemIdentifier:'123'};
 let exists=false,drops=0,creates=0,failEnd=false,sessions=0;
 const makeClient=()=>({async connect(){},async end(){if(failEnd)throw Error('private');},async query(sql:string){
  if(sql.startsWith('CREATE DATABASE')){exists=true;creates++;return {rows:[]};}
  if(sql.startsWith('DROP DATABASE')){exists=false;drops++;return {rows:[]};}
  if(sql.includes('SELECT oid FROM'))return {rows:exists?[{oid:'456'}]:[]};
  if(sql.includes('SELECT system_identifier::text AS id'))return {rows:[{id:'123'}]};
  if(sql.includes('AS "systemIdentifier"'))return {rows:exists?[{systemIdentifier:'123',databaseOid:'456',sessions,prepared:0}]:[]};
  if(sql.includes('AS id,d.oid'))return {rows:exists?[{id:'123',oid:'456',sessions,prepared:0}]:[]};
  throw Error('unexpected');}});
 const observe=async()=>({state:'SUCCESS' as const,value:cluster});
 const runner=makeProtectedTemporaryRunner(raw,{observe,makeClient});
 assert.equal((await runner.create('postgres')).state,'UNKNOWN');
 exists=true;const occupied='sabalanerp_protected_'+'e'.repeat(32);assert.equal((await runner.create(occupied)).state,'FAILURE');assert.equal(creates,0);exists=false;
 assert.equal((await runner.create(name)).state,'SUCCESS');
 sessions=1;assert.equal((await runner.drop(name)).state,'UNKNOWN');assert.equal(drops,0);
 sessions=0;assert.equal((await runner.drop(name)).state,'UNKNOWN');assert.equal(drops,0);
 const other='sabalanerp_protected_'+'d'.repeat(32),uncertain=makeProtectedTemporaryRunner(raw,{observe,makeClient});
 exists=false;failEnd=true;assert.equal((await uncertain.create(other)).state,'UNKNOWN');failEnd=false;
 assert.equal((await uncertain.create(other)).state,'UNKNOWN');
 assert.equal((await makeProtectedTemporaryRunner(raw,{observe,makeClient}).create(other)).state,'UNKNOWN');
 assert.equal((await uncertain.drop(other)).state,'UNKNOWN');assert.equal(drops,0);assert.equal(creates,2);
});

test('census rejects replaced database identity and reports sessions without terminating them',async()=>{
 const raw='postgresql://test:test@127.0.0.1:55432/sabalanerp',name='sabalanerp_protected_'+'a'.repeat(32),identity={systemIdentifier:'123',databaseOid:'456'};
 const client=(oid:string)=>()=>({async connect(){},async query(sql:string,values:readonly string[]){assert.match(sql,/pg_stat_activity/);assert.match(sql,/pg_prepared_xacts/);assert.deepEqual(values,[name]);return {rows:[{systemIdentifier:'123',databaseOid:oid,sessions:1,prepared:0}]};},async end(){}});
 assert.deepEqual(await inspectTemporaryDatabaseCensus(raw,name,identity,client('456')),{state:'SUCCESS',value:{sessions:1,prepared:0}});
 assert.equal((await inspectTemporaryDatabaseCensus(raw,name,identity,client('457'))).state,'UNKNOWN');
});

test('definitive setup outcomes permit one owned cleanup; unknown setup retains the database',async()=>{
 const raw='postgresql://test:test@127.0.0.1:55432/sabalanerp',cluster={containerId:'b'.repeat(64),systemIdentifier:'123'};
 for(const [index,result] of (['SUCCESS','FAILURE','UNKNOWN'] as const).entries()){
  const name='sabalanerp_protected_'+String(index+4).repeat(32);let exists=false,drops=0,runs=0;
  const makeClient=()=>({async connect(){},async end(){},async query(sql:string){
   if(sql.startsWith('CREATE DATABASE')){exists=true;return {rows:[]};}if(sql.startsWith('DROP DATABASE')){exists=false;drops++;return {rows:[]};}
   if(sql.includes('SELECT oid FROM'))return {rows:exists?[{oid:'456'}]:[]};
   if(sql.includes('SELECT system_identifier::text AS id'))return {rows:[{id:'123'}]};
   if(sql.includes('AS "systemIdentifier"'))return {rows:exists?[{systemIdentifier:'123',databaseOid:'456',sessions:0,prepared:0}]:[]};
   if(sql.includes('AS id,d.oid'))return {rows:exists?[{id:'123',oid:'456',sessions:0,prepared:0}]:[]};throw Error('unexpected');}});
  const runner=makeProtectedTemporaryRunner(raw,{observe:async()=>({state:'SUCCESS',value:cluster}),makeClient,
   prepare:async()=>({directory:'fake'}),bootstrap:async()=>{runs++;return result==='UNKNOWN'?{state:'UNKNOWN'}:{state:'SUCCESS',value:result};}});
  assert.equal((await runner.create(name)).state,'SUCCESS');
  const setup=await runner.setup(name);assert.equal(setup.state,result==='UNKNOWN'?'UNKNOWN':'SUCCESS');
  assert.equal((await runner.setup(name)).state,'UNKNOWN');assert.equal(runs,1);
  assert.equal((await runner.drop(name)).state,result==='UNKNOWN'?'UNKNOWN':'SUCCESS');assert.equal(drops,result==='UNKNOWN'?0:1);
  assert.equal((await runner.drop(name)).state,'UNKNOWN');
 }
});

test('bootstrap materialization failure reports only the bounded safe code',async()=>{
 const raw='postgresql://test:test@127.0.0.1:55432/sabalanerp',name='sabalanerp_protected_'+'f'.repeat(32),cluster={containerId:'b'.repeat(64),systemIdentifier:'123'};
 let exists=false;const reports:string[]=[];
 const makeClient=()=>({async connect(){},async end(){},async query(sql:string){
  if(sql.startsWith('CREATE DATABASE')){exists=true;return {rows:[]};}
  if(sql.includes('SELECT oid FROM'))return {rows:exists?[{oid:'456'}]:[]};
  if(sql.includes('SELECT system_identifier::text AS id'))return {rows:[{id:'123'}]};
  if(sql.includes('AS "systemIdentifier"'))return {rows:[{systemIdentifier:'123',databaseOid:'456'}]};
  throw Error('unexpected');}});
 const runner=makeProtectedTemporaryRunner(raw,{observe:async()=>({state:'SUCCESS',value:cluster}),makeClient,prepare:async()=>{throw Object.assign(new Error('BOOTSTRAP_MATERIALIZATION_UNPROVEN'),{cause:'private'});}},code=>reports.push(code));
 assert.equal((await runner.create(name)).state,'SUCCESS');assert.equal((await runner.setup(name)).state,'UNKNOWN');
 assert.deepEqual(reports,['BOOTSTRAP_MATERIALIZATION_UNPROVEN']);assert.equal((await runner.drop(name)).state,'UNKNOWN');
});
