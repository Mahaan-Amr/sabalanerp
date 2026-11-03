/** File-only reuse of #413's successful compiler output. No compiler, install,
 * image build, runtime, database or cleanup operation is invoked. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash,randomBytes} from 'node:crypto';
import {acquireSerialHostLease} from './lib/serial-physical/host-lease.mjs';
import {verifyC3ApplicationInputBytes} from './lib/c3-operations-source-reuse.mjs';
const root=path.resolve(import.meta.dirname,'..'),source='D:/sabalanerp-online-qa/current-backend-compiled-a6176045c7e2ef26bec72c5f298d6968',receiptFile=path.join(source,'compiled-receipt.json'),expectedReceiptSha='c60c88e3a93e952f030115daf7a1ede32a423b49a0a8ed4207b53b78dfb16c90';
const sha=b=>createHash('sha256').update(b).digest('hex'),record={format:'sabalan-413-accepted-workspace-output-reuse/v1',pass:false,compilerStarted:false,imageBuilt:false,productionAdmission:false,files:[]};let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');record.leaseOriginalPid=lease.originalPid;
 assert.ok(os.freemem()>=512*1024**2);for(const [drive,reserve]of [['C:/',12n*1024n**3n],['D:/',16n*1024n**3n]]){const v=fs.statfsSync(drive,{bigint:true});assert.ok(v.bavail*v.bsize>=reserve+512n*1024n**2n);}
 record.applicationBefore=verifyC3ApplicationInputBytes(root);const raw=fs.readFileSync(receiptFile);assert.equal(sha(raw),expectedReceiptSha);const receipt=JSON.parse(raw);assert.equal(receipt.pass,true);assert.equal(receipt.sourceUnchanged,true);
 record.receipt={file:receiptFile,sha256:expectedReceiptSha};const plans=[];
 for(const [prefix,target]of [['graph-dist/','packages/contract-product-graph/dist'],['partner-dist/','packages/partner-sales-contracts/dist']]){
  const directory=path.join(root,target);assert.equal(fs.existsSync(directory),false,'ACCEPTED_OUTPUT_TARGET_ALREADY_EXISTS');assert.equal(fs.realpathSync(path.dirname(directory)),path.dirname(directory));
  for(const [name,entry]of Object.entries(receipt.outputs).filter(([name])=>name.startsWith(prefix))){const relative=name.slice(prefix.length);assert.ok(relative&&!relative.includes('\\')&&!relative.split('/').some(p=>p==='..'||p===''));const file=path.join(source,name);assert.equal(fs.realpathSync(file),file);const metadata=fs.lstatSync(file);assert.ok(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.nlink===1);const content=fs.readFileSync(file);assert.equal(content.length,entry.bytes);assert.equal(sha(content),entry.sha256);plans.push({file:relative,target:path.join(directory,relative),content,sha256:entry.sha256,bytes:entry.bytes});}
 }
 assert.ok(plans.length>100);lease.assertHeld();
 for(const entry of plans){lease.assertHeld();fs.mkdirSync(path.dirname(entry.target),{recursive:true});assert.equal(fs.realpathSync(path.dirname(entry.target)),path.dirname(entry.target));const fd=fs.openSync(entry.target,'wx',0o600);try{fs.writeFileSync(fd,entry.content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.equal(sha(fs.readFileSync(entry.target)),entry.sha256);record.files.push({file:entry.target,bytes:entry.bytes,sha256:entry.sha256});}
 record.applicationAfter=verifyC3ApplicationInputBytes(root);assert.deepEqual(record.applicationAfter,record.applicationBefore);lease.assertHeld();record.pass=true;
}catch(error){record.failure={code:error?.code??error?.name??'THROWN_VALUE',message:error?.message};process.exitCode=1;}
finally{if(lease){await lease.release();record.leaseClosed=true;}const file=path.join(root,'reports/qa/issue-419-c3-bindings-20261026/ACCEPTED-WORKSPACE-REUSE-'+randomBytes(16).toString('hex')+'.json');fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,pass:record.pass,files:record.files.length,compilerStarted:false,imageBuilt:false,failure:record.failure??null}));}
