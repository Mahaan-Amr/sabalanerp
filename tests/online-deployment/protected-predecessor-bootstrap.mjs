import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import {readPrebuiltMigrationInventory} from '../../deploy/scripts/prebuilt-migration-inventory.mjs';

// Source-only preparation. It creates no database and grants no authority.
const commit='e73830dffb15f29652748d6807d4d93ce82ab321';
const candidateNames=Object.freeze([
 '20261014140000_online_deployment_control','20261019010000_customer_semantic_barrier','20261019020000_hr_versioned_file_cleanup',
 '20261020010000_online_realtime_completion','20261020093000_online_serving_epochs','20261021120000_attendance_effective_rest_windows',
 '20261025120000_preserve_exact_fulfillment_quantities','20261028090000_sales_dispatch_invoices','20261028093000_sales_invoice_evidence_constraints',
 '20261028100000_sales_invoice_correction_evidence','20261031130000_purchasing_operational_workspace','20261101160000_supply_chain_exact_purchase_quantities',
 '20261101170000_purchasing_private_attachments','20261102120000_accounting_financial_approval_receipts',
]);
export function preparePredecessorBootstrap(root){
 assert.equal(path.resolve(root),root);
 const receipt=fs.readFileSync('C:/Users/mahan/AppData/Local/Temp/sabalan-ledger-query-review-fc54bbb08e1d4858b27e8db6f3abe960/ledger-clean-comparison.json');
 assert.equal(createHash('sha256').update(receipt).digest('hex'),'5a50c16a52b507e2d748c4d57bef6e9c51c9cd3e3bf47434ca4bc833f17614c1','BOOTSTRAP_LEDGER_RECEIPT_UNPROVEN');
 const observed=JSON.parse(receipt.toString('utf8'));
 assert.equal(observed.candidate,commit);assert.equal(observed.applied,439);assert.equal(observed.candidateCount,453);assert.equal(observed.outerExit,0);
 assert.deepEqual(observed.pending,candidateNames);assert.deepEqual(observed.mismatches,[]);assert.deepEqual(observed.extraApplied,[]);assert.deepEqual(observed.unfinished,[]);
 assert.equal(observed.ledgerRows,440);assert.deepEqual(observed.rolledBack,['20260720000100_security_report_attendance_operations']);assert.equal(observed.rollbackMarker,true);assert.equal(observed.remoteExitMarker,0);
 const inventory=readPrebuiltMigrationInventory(root,commit);
 assert.equal(inventory.entries.length,453,'BOOTSTRAP_FULL_INVENTORY_UNPROVEN');
 const excluded=new Set(candidateNames),candidate=inventory.entries.filter(entry=>excluded.has(entry.name));
 assert.deepEqual(candidate.map(entry=>entry.name),candidateNames,'BOOTSTRAP_CANDIDATE_SET_UNPROVEN');
 const predecessor=inventory.entries.filter(entry=>!excluded.has(entry.name));
 assert.equal(predecessor.length,439,'BOOTSTRAP_PREDECESSOR_COUNT_UNPROVEN');
 assert.equal(predecessor.filter(entry=>entry.name===observed.rolledBack[0]).length,1,'BOOTSTRAP_FINISHED_COUNTERPART_UNPROVEN');
 let total=0;
 const steps=predecessor.map(entry=>{
  const file=path.join(root,'backend','prisma','migrations',entry.name,'migration.sql');
  const raw=fs.readFileSync(file);total+=raw.length;
  assert.ok(raw.length>0&&raw.length<=8*1024*1024&&total<=128*1024*1024,'BOOTSTRAP_SOURCE_LIMIT');
  assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256,'BOOTSTRAP_SOURCE_MISMATCH');
  return Object.freeze({name:entry.name,sha256:entry.sha256,sql:raw.toString('utf8')});
 });
 return Object.freeze({commit,inventorySha256:inventory.sha256,steps:Object.freeze(steps),authority:false});
}

/** Creates only a fresh temporary source directory; never contacts a DB.
 * Failed partial materializations are retained for inspection. */
export function materializePredecessorBootstrap(root){
 const plan=preparePredecessorBootstrap(root);
 const gitBlob=relative=>{
  const result=spawnSync('git',['show',`${commit}:${relative}`],{cwd:root,stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:8*1024*1024});
  assert.equal(result.status,0,'BOOTSTRAP_GIT_BLOB_UNPROVEN');assert.equal(result.signal,null,'BOOTSTRAP_GIT_BLOB_UNPROVEN');
  assert.ok(!result.error&&result.stdout.length>0,'BOOTSTRAP_GIT_BLOB_UNPROVEN');return result.stdout;
 };
 const schema=gitBlob('backend/prisma/schema.prisma'),lock=gitBlob('backend/prisma/migrations/migration_lock.toml');
 assert.equal(createHash('sha256').update(schema).digest('hex'),'5d3d345c2f0bee9b010ac2747fb0af7795c620c441e7cc7024520e509ccc4110','BOOTSTRAP_SCHEMA_UNPROVEN');
 assert.equal(createHash('sha256').update(lock).digest('hex'),'693566b52c49db47a2b0901d12400aa3d710d13a49f4a2a154b80c0505ed737c','BOOTSTRAP_LOCK_UNPROVEN');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalanerp-predecessor-bootstrap-'));
 const write=(file,bytes)=>{const fd=fs.openSync(file,'wx',0o600);try{
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
  const first=fs.fstatSync(fd,{bigint:true}),before=fs.lstatSync(file,{bigint:true});
  assert.ok(first.isFile()&&before.isFile()&&!before.isSymbolicLink()&&first.ino===before.ino&&first.nlink===1n&&before.nlink===1n&&fs.realpathSync(file)===file,'BOOTSTRAP_FILE_IDENTITY_UNPROVEN');
  const reader=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
   const second=fs.fstatSync(reader,{bigint:true}),content=fs.readFileSync(reader),after=fs.lstatSync(file,{bigint:true}),last=fs.fstatSync(fd,{bigint:true}),readLast=fs.fstatSync(reader,{bigint:true});
   const same=(a,b)=>a.isFile()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.nlink===1n&&b.nlink===1n;
   assert.ok(same(first,second)&&same(first,last)&&same(second,readLast)&&after.isFile()&&!after.isSymbolicLink()&&after.nlink===1n&&before.ino===after.ino&&first.ino===after.ino&&before.size===after.size&&after.size===first.size&&fs.realpathSync(file)===file,'BOOTSTRAP_FILE_IDENTITY_UNPROVEN');
   assert.equal(createHash('sha256').update(content).digest('hex'),createHash('sha256').update(bytes).digest('hex'),'BOOTSTRAP_FILE_READBACK_UNPROVEN');
  }finally{fs.closeSync(reader);}
 }finally{fs.closeSync(fd);}};
 try{
  const migrations=path.join(directory,'migrations');fs.mkdirSync(migrations,{mode:0o700});
  write(path.join(directory,'schema.prisma'),schema);write(path.join(migrations,'migration_lock.toml'),lock);
  for(const step of plan.steps){
   const raw=Buffer.from(step.sql,'utf8');assert.equal(createHash('sha256').update(raw).digest('hex'),step.sha256,'BOOTSTRAP_UTF8_CHANGED');
   const target=path.join(migrations,step.name);fs.mkdirSync(target,{mode:0o700});write(path.join(target,'migration.sql'),raw);
  }
  return Object.freeze({directory,commit:plan.commit,inventorySha256:plan.inventorySha256,steps:plan.steps.length,authority:false});
 }catch(error){throw Object.assign(new Error('BOOTSTRAP_MATERIALIZATION_UNPROVEN'),{directory,cause:error});}
}
