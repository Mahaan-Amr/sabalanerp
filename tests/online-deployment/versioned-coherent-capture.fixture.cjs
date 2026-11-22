'use strict';
// Private publisher actor: FD10 was inherited BEFORE the parent takes EX.
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const readline = require('node:readline');
const {KernelWriteAdmission} = require('./kernelWriteAdmission');
const {RuntimeBoundaryJournal,runtimeBoundaryProvisionBytes,runtimeNativePostgresApplicationName} = require('./runtimeBoundaryJournal');
const {RuntimeTaskAdmission} = require('./runtimeTaskAdmission');
const {RuntimeWorkContext} = require('./runtimeWorkContext');
const {VersionedFilePublication} = require('./versionedFilePublication');

(async()=>{
 const root=__dirname, gate=path.join(root,'deployment-write-admission.lock');
 const stat=fs.fstatSync(10,{bigint:true});
 const named=fs.statSync(gate,{bigint:true});
 if(stat.dev!==named.dev||stat.ino!==named.ino)throw Error('INHERITED_GATE_CHANGED');
 const identity={device:String(stat.dev),inode:String(stat.ino),ownerUid:Number(stat.uid)};
 const runtimeId=randomBytes(32).toString('hex');
 const scope={runtimeId,image:'sha256:'+'a'.repeat(64),registrySha256:'b'.repeat(64),generation:1,
   gate:identity,postgresApplicationName:runtimeNativePostgresApplicationName(runtimeId)};
 const journalRoot=path.join(root,runtimeId);fs.mkdirSync(journalRoot,{mode:0o700});
 fs.writeFileSync(path.join(journalRoot,'scope.json'),runtimeBoundaryProvisionBytes(scope),{flag:'wx',mode:0o600});
 const journal=new RuntimeBoundaryJournal(journalRoot,scope);await journal.initialize();
 const tasks=new RuntimeTaskAdmission(new KernelWriteAdmission(gate,identity,()=>{}),journal,()=>{},()=>true);
 const work=new RuntimeWorkContext(tasks,()=>{});
 const publisher=await VersionedFilePublication.open(path.join(root,'store'),path.join(root,'uploads'),work);
 await publisher.publish('original.pdf',Buffer.from('ORIGINAL-ATTACHMENT-123456789.12345678'));
 console.log(JSON.stringify({phase:'PUBLISHER_READY',gate:identity,journalRoot}));
 const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of input){
  const command=JSON.parse(line);
  if(command.command==='seal'){
   const cut=await publisher.seal(command.captureId,10);
   console.log(JSON.stringify({phase:'SEALED',versionedCuts:[{name:'uploads',captureId:command.captureId,
     storeRoot:path.join(root,'store'),sha256:cut.sha256}]}));
  }else if(command.command==='mutate'){
   await publisher.publish('original.pdf',Buffer.from('NEW-ATTACHMENT-77.00000001'),{replace:true});
   console.log(JSON.stringify({phase:'MUTATED'}));
  }else if(command.command==='stop'){
   await work.stopAndDrain(10000);fs.closeSync(10);input.close();
   console.log(JSON.stringify({phase:'PUBLISHER_CLOSED'}));return;
  }else throw Error('UNKNOWN_COMMAND');
 }
 throw Error('PUBLISHER_INPUT_CLOSED_WITHOUT_DRAIN');
})().catch(error=>{console.error(error);process.exitCode=1;});
