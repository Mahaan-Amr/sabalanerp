/** Initial private B file adoption. A source A checkpoint is not represented
 * as a B checkpoint. The ordinary production adoption authority is unchanged. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertActiveStrictRestoreProof,withSystemRecoveryDatabaseClient} from './systemRecoveryEngine';
import {assertRestoredQaWorkingMaterial,type RestoredQaWorkingMaterial} from './restoredQaWorkingMaterial';
import {assertRestoredQaMigrationBaseline,assertRestoredQaMigrationLease,type RestoredQaMigrationBaseline} from './restoredQaMigrationBaseline';
import {HR_PERSONNEL_ERASURE_STORAGE_ROOTS} from './hrPersonnelErasureGraph';
import {DOCUMENT_PDF_RETAINED_ROOTS} from './documentPdfFileRuntime';
import {DISPATCH_DOCUMENT_STORAGE_ROOT} from './dispatchFileRuntime';
import {performanceExportStorageDirectory} from './performanceFileRuntime';
import {supportTicketStorageDirectory} from './supportFileRuntime';
import {inventoryProtectedLegacyFiles} from './protectedLegacyFileInventory';
import {VersionedFilePublication} from './versionedFilePublication';

type Owner=Readonly<{deploymentId:string;releaseId:string;leaseToken:string}>;
type Root=Readonly<{root:string;liveRoot:string}>;
type Context=ReturnType<typeof assertActiveStrictRestoreProof>;
const issued=new WeakSet<RestoredQaFileAdoptionAuthority>();
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
const hash=(raw:string|Buffer)=>createHash('sha256').update(raw).digest('hex');
type Group={active:boolean;closed:boolean;closeObserved:boolean;proof:unknown;context:Context;baseline:RestoredQaMigrationBaseline;material:RestoredQaWorkingMaterial;
 owner:Owner;root:string;gateFile:string;gatePin:string;gate:{device:string;inode:string;ownerUid:number}};
function assertGroup(g:Group){
 assert.ok(g.active&&!g.closed,'RESTORED_QA_ADOPTION_NOT_ACTIVE');assert.equal(assertActiveStrictRestoreProof(g.proof),g.context);
 const view=assertRestoredQaWorkingMaterial(g.material,g.owner),baseline=assertRestoredQaMigrationBaseline(g.baseline,g.owner);
 assert.equal(view.root,g.root);assert.deepEqual(view.database,g.context.proof.database);assert.deepEqual(baseline.targetDatabase,view.database);
 assert.equal(process.platform,'linux');assert.equal(process.getuid!(),0);assert.equal(process.env.BACKEND_RUNTIME_ROLE,'control');
 assert.equal(process.env.BACKEND_CAPTURE_GATE_FD,'10');assert.equal(process.env.BACKEND_CAPTURE_GATE_FILE,g.gateFile);
 assert.equal(process.env.BACKEND_CAPTURE_GATE_DEVICE,g.gate.device);assert.equal(process.env.BACKEND_CAPTURE_GATE_INODE,g.gate.inode);
 assert.equal(fs.realpathSync(g.gateFile),g.gateFile);const held=fs.fstatSync(10,{bigint:true});
 assert.ok(held.isFile()&&held.nlink===1n&&held.uid===0n&&held.size===0n&&!(held.mode&0o022n));
 assert.equal(pin(held),g.gatePin);assert.equal(pin(fs.lstatSync(g.gateFile,{bigint:true})),g.gatePin);
 assert.match(fs.readFileSync('/proc/self/fdinfo/10','utf8'),new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'+g.gate.inode+'\\s+0\\s+EOF\\s*$','m'));
}
export function assertRestoredQaFileAdoptionAuthority(authority:RestoredQaFileAdoptionAuthority){assert.ok(issued.has(authority),'RESTORED_QA_ADOPTION_AUTHORITY_REQUIRED');authority.assertOwned();}
declare const completionBrand:unique symbol;
export type RestoredQaAdoptionCompletion=Readonly<{[completionBrand]:true}>;
const completions=new WeakMap<RestoredQaAdoptionCompletion,Group>();
export function assertRestoredQaAdoptionCompletion(completion:RestoredQaAdoptionCompletion,baseline:RestoredQaMigrationBaseline,owner:Owner){
 const g=completions.get(completion);assert.ok(g?.active&&g.closed&&g.baseline===baseline,'RESTORED_QA_ADOPTION_COMPLETION_UNPROVEN');assert.deepEqual(g.owner,owner);
 assert.equal(assertActiveStrictRestoreProof(g.proof),g.context);assertRestoredQaMigrationBaseline(baseline,owner);assertRestoredQaWorkingMaterial(g.material,owner);
 for(const key of ['FD','FILE','DEVICE','INODE'])assert.equal(process.env['BACKEND_CAPTURE_GATE_'+key],undefined);
 assert.ok(g.closeObserved,'RESTORED_QA_GATE_CLOSE_NOT_OBSERVED');assert.equal(fs.realpathSync(g.gateFile),g.gateFile);assert.equal(pin(fs.lstatSync(g.gateFile,{bigint:true})),g.gatePin);
 // Descriptor numbers may subsequently be reused by a database client. What
 // must remain absent is this original gate, not every future allocation 10.
 const descriptors=fs.readdirSync('/proc/self/fd');assert.ok(descriptors.length<=4096);
 for(const name of descriptors){assert.match(name,/^(?:0|[1-9][0-9]*)$/);let held:fs.BigIntStats;
  try{held=fs.fstatSync(Number(name),{bigint:true});}catch(error){assert.equal((error as NodeJS.ErrnoException).code,'EBADF');continue;}
  assert.ok(String(held.dev)!==g.gate.device||String(held.ino)!==g.gate.inode,'RESTORED_QA_ORIGINAL_GATE_REOPENED');
 }
}
export class RestoredQaFileAdoptionAuthority{
 private constructor(private readonly group:Group,readonly source:Root,readonly captureId:string){}
 assertOwned(){assertGroup(this.group);}
 gateIdentity(){this.assertOwned();return this.group.gate;}
 async assertLease(){this.assertOwned();await withSystemRecoveryDatabaseClient(this.group.context.proof.database.name,async db=>{
  await db.$transaction(async tx=>{await assertRestoredQaMigrationLease(tx,this.group.baseline,this.group.owner);
   const [quiet]=await tx.$queryRaw<Array<{foreignSessions:number;prepared:number}>>`SELECT
    (SELECT count(*)::int FROM pg_stat_activity a WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'
     AND NOT(application_name=${'sabalan-lock-'+this.group.owner.deploymentId} AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory' AND l.classid=0 AND l.objid=741936425 AND l.objsubid=1 AND l.granted AND l.mode='ExclusiveLock'))) AS "foreignSessions",
    (SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared`;
   assert.deepEqual(quiet,{foreignSessions:0,prepared:0});},{maxWait:1000,timeout:15000});
 });this.assertOwned();}
 async assertSource(){this.assertOwned();const observed=await inventoryProtectedLegacyFiles(this.source.liveRoot,()=>this.assertOwned());
  const relative=path.relative(this.group.root,this.source.liveRoot).split(path.sep).join('/'),prefix=relative.startsWith('storage/')?'files/'+relative.slice(8):'files/'+relative;
  const expected=this.group.context.manifest.components.filter(c=>c.path.startsWith(prefix+'/')).map(c=>({key:c.path.slice(prefix.length+1),bytes:c.size,sha256:c.sha256})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  assert.deepEqual(observed.files,expected,'RESTORED_QA_ADOPTION_SOURCE_CHANGED');this.assertOwned();return observed;
 }
 static async adoptAll(proof:unknown,baseline:RestoredQaMigrationBaseline,material:RestoredQaWorkingMaterial,owner:Owner){
  const context=assertActiveStrictRestoreProof(proof),view=assertRestoredQaWorkingMaterial(material,owner);assert.deepEqual(assertRestoredQaMigrationBaseline(baseline,owner).targetDatabase,context.proof.database);
  assert.deepEqual(view.database,context.proof.database);assert.equal(process.cwd(),view.root);
  const expected=['storage/hr-hiring','uploads/images','uploads/security-shift-log','uploads/security-vehicle-pairs','storage/contracts','storage/accounting-contracts','storage/dispatch-documents','storage/performance-exports','storage/support-tickets'].map(r=>path.join(view.root,r)).sort();
  const liveRoots=[...new Set([...HR_PERSONNEL_ERASURE_STORAGE_ROOTS,...DOCUMENT_PDF_RETAINED_ROOTS,DISPATCH_DOCUMENT_STORAGE_ROOT,performanceExportStorageDirectory(),supportTicketStorageDirectory()])].sort();assert.deepEqual(liveRoots,expected);
  const gateFile=path.join(view.roots['recovery-coordination'],'deployment-write-admission.lock'),st=fs.lstatSync(gateFile,{bigint:true});
  const group:Group={active:true,closed:false,closeObserved:false,proof,context,baseline,material,owner:Object.freeze({...owner}),root:view.root,gateFile,gatePin:pin(st),gate:Object.freeze({device:String(st.dev),inode:String(st.ino),ownerUid:0})};assertGroup(group);
  const storeParent=path.join(view.roots['recovery-coordination'],'online-file-versions');fs.mkdirSync(storeParent,{mode:0o700});
  const records:Array<Readonly<{liveRoot:string;root:string;captureId:string;adoption:Awaited<ReturnType<VersionedFilePublication['adoptLegacy']>>}>>=[];
  try{for(const liveRoot of liveRoots){assertGroup(group);const root=path.join(storeParent,hash(liveRoot));fs.mkdirSync(root,{mode:0o700});
    const captureId=hash(JSON.stringify({format:'sabalan-restored-qa-file-adoption/v1',database:view.database,owner,liveRoot,source:context.proof.rawHistorySha256}));
    const authority=new RestoredQaFileAdoptionAuthority(group,Object.freeze({root,liveRoot}),captureId);issued.add(authority);Object.freeze(authority);
    const port=await VersionedFilePublication.openForRestoredQaLegacyAdoption(authority),adoption=await port.adoptLegacy();
    await authority.assertSource();await authority.assertLease();records.push(Object.freeze({liveRoot,root,captureId,adoption}));
   }
   assert.equal(records.length,9);assertGroup(group);assert.deepEqual(fs.readdirSync(storeParent).sort(),records.map(r=>path.basename(r.root)).sort());
   for(const record of records)assert.deepEqual(fs.readdirSync(path.join(record.root,'pending')),[]);
   // All original clients above have disconnected. No descriptor is closed
   // until every source/readback, lease and quiet check has completed.
   fs.closeSync(10);
   // Synchronous, before another await/open can reuse the released number.
   let closed=false;try{fs.fstatSync(10);}catch(error){assert.equal((error as NodeJS.ErrnoException).code,'EBADF');closed=true;}assert.ok(closed);group.closeObserved=true;
   for(const key of ['FD','FILE','DEVICE','INODE'])delete process.env['BACKEND_CAPTURE_GATE_'+key];group.closed=true;
   const completion=Object.freeze({})as RestoredQaAdoptionCompletion;completions.set(completion,group);assertRestoredQaAdoptionCompletion(completion,baseline,owner);
   return Object.freeze({completion,proof:Object.freeze({format:'sabalan-restored-qa-nine-root-adoption-complete/v1',records:Object.freeze(records),captureGateClosed:true,productionAdmission:false,cleanupPending:true})});
  }catch(error){group.active=false;throw error;}
 }
}
export const adoptRestoredQaLegacyFiles=RestoredQaFileAdoptionAuthority.adoptAll;
