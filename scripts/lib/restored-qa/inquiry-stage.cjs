/** Canonical recovery adoption on one further PRIVATE copy only. No live DB,
 * bootstrap credential, seed, migration bypass or restored receipt authority. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash,randomBytes}=require('node:crypto');
const stages=new WeakMap(),sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=s=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].map(k=>String(s[k])).join(':');
function read(file,maximum=64*1024**2){assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const a=fs.fstatSync(fd,{bigint:true}),n=fs.lstatSync(file,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n&&a.uid===0n&&a.size>0n&&a.size<=BigInt(maximum));assert.equal(stamp(a),stamp(n));const raw=fs.readFileSync(fd);assert.equal(raw.length,Number(a.size));assert.equal(stamp(a),stamp(fs.fstatSync(fd,{bigint:true})));assert.equal(stamp(n),stamp(fs.lstatSync(file,{bigint:true})));return{raw,stamp:stamp(a),size:raw.length,sha256:sha(raw)};}finally{fs.closeSync(fd);}}
function save(file,raw){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{let offset=0;while(offset<raw.length){const n=fs.writeSync(fd,raw.subarray(offset));assert.ok(n>0);offset+=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.ok(fs.readFileSync(file).equals(raw));return read(file);}
function directory(root){assert.equal(fs.realpathSync(root),root);const a=fs.lstatSync(root,{bigint:true});assert.ok(a.isDirectory()&&!a.isSymbolicLink()&&a.uid===0n&&(a.mode&0o077n)===0n);return[a.dev,a.ino,a.uid,a.mode].map(String).join(':');}
function sync(root){if(process.platform==='linux'){const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}

async function prepareOriginalInquiryStage({root,layoutRoot,sourceFile,operation,component,archiveSha256,assertActive}){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
 assert.match(operation,/^[a-f0-9]{32}$/);assert.match(archiveSha256,/^[a-f0-9]{64}$/);assert.match(component.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(component.size)&&component.size>0);assertActive();
 const rootId=directory(root),layoutId=directory(layoutRoot),original=read(sourceFile);assert.equal(original.size,component.size);assert.equal(original.sha256,component.sha256);assert.equal(path.dirname(layoutRoot),root);
 const recovery=path.join(root,'storage/recovery'),work=path.join(recovery,'work');for(const relative of ['storage','storage/recovery','storage/recovery/work']){const file=path.join(root,relative);if(!fs.existsSync(file))fs.mkdirSync(file,{mode:0o700});directory(file);}
 const operationId='complete-inquiry-'+operation,stage=path.join(work,'restore-'+operationId+'-'+randomBytes(16).toString('hex'));fs.mkdirSync(stage,{mode:0o700});fs.mkdirSync(path.join(stage,'payload'),{mode:0o700});fs.mkdirSync(path.join(stage,'payload/inquiry'),{mode:0o700});const file=path.join(stage,'payload/inquiry/inquiry.db');save(file,original.raw);sync(path.dirname(file));
 const coordination=path.join(root,'recovery-coordination'),coordId=directory(coordination),journalFile=path.join(coordination,'pending-restore.json');
 const journal=Buffer.from(JSON.stringify({operationId,checksum:archiveSha256,phase:'STAGED',packageType:'COMPLETE'})+'\n'),journalHeld=save(journalFile,journal);sync(coordination);
 const guard=()=>{assertActive();assert.equal(directory(root),rootId);assert.equal(directory(layoutRoot),layoutId);assert.equal(directory(coordination),coordId);assert.deepEqual(read(sourceFile),original);};
 const {adoptRecoveryStagedInquiry,verifyInquiryTransformation}=require('/app/dist/services/inquiryMigrationPlan.js');
 // A failure leaves the exact stage/journal held. Never erase a negative stage
 // or infer authority to touch /data/inquiry.db from this private operation.
 guard();const adopted=await adoptRecoveryStagedInquiry({databaseFile:file,operationId,checksum:archiveSha256});guard();const proof=adopted.transformation;
 assert.equal(proof.format,'sabalan-inquiry-adoption/v1');assert.equal(proof.sanitized,false);assert.equal(proof.operationId,operationId);assert.equal(proof.archiveSha256,archiveSha256);assert.deepEqual(proof.source,{size:component.size,sha256:component.sha256});assert.deepEqual(proof.businessBefore,proof.businessAfter);await verifyInquiryTransformation(file,proof,component,proof.businessBefore);guard();
 const target=read(file);assert.deepEqual({size:target.size,sha256:target.sha256},proof.target);assert.deepEqual(read(journalFile),journalHeld);
 const descriptor={format:'sabalan-original-complete-inquiry-stage/v1',operation,file,source:{size:component.size,sha256:component.sha256},target:{size:target.size,sha256:target.sha256},transformation:proof,originalWorkingInputPreserved:true,productionAdmission:false};
 const descriptorFile=path.join(layoutRoot,'inquiry-stage.json'),descriptorRaw=Buffer.from(JSON.stringify(descriptor)+'\n');save(descriptorFile,descriptorRaw);fs.chmodSync(descriptorFile,0o400);sync(layoutRoot);const heldDescriptor=read(descriptorFile);
 // Durable completed-stage evidence precedes retirement of our exact journal.
 guard();assert.deepEqual(read(journalFile),journalHeld);fs.unlinkSync(journalFile);sync(coordination);
 const owner=Object.freeze({async revalidate(){guard();assert.deepEqual(read(file),target);assert.deepEqual(read(descriptorFile),heldDescriptor);await verifyInquiryTransformation(file,proof,component,proof.businessBefore);guard();assert.deepEqual(read(file),target);},reference:Object.freeze({file:descriptorFile,bytes:descriptorRaw.length,sha256:sha(descriptorRaw)})});stages.set(owner,{descriptor,guard});return owner;
}
function readOriginalInquiryStage(owner){const state=stages.get(owner);assert.ok(state,'ORIGINAL_INQUIRY_STAGE_REQUIRED');state.guard();return structuredClone(state.descriptor);}
module.exports={prepareOriginalInquiryStage,readOriginalInquiryStage};
