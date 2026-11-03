/** User-supplied SSH credential: anonymous stdin -> SID-bound DPAPI, never argv/log/plaintext file. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
const operation=randomBytes(16).toString('hex'),directory=path.resolve('D:/sabalanerp-online-qa/419-backup-credential-'+operation);
const custody=await prepareOriginalPrivateEvidenceDirectory(directory),lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');
const report={format:'sabalan-419-private-backup-credential-provision/v1',operation,pass:false,sshStarted:false,masterStarted:false,productionAdmission:false};
const script="Add-Type -AssemblyName System.Security; $inputStream=[Console]::OpenStandardInput(); $memory=New-Object System.IO.MemoryStream; $inputStream.CopyTo($memory); $plain=$memory.ToArray(); try { $cipher=[System.Security.Cryptography.ProtectedData]::Protect($plain,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($cipher)) } finally { [Array]::Clear($plain,0,$plain.Length); $memory.Dispose() }";
try{
 if(process.stdin.isTTY)process.stdin.setRawMode(true);
 console.log(JSON.stringify({operation,readyForPrivateStdin:true,echo:false}));
 let pending=Buffer.alloc(0);
 const frame=await new Promise((resolve,reject)=>{
  const read=part=>{try{pending=Buffer.concat([pending,part]);assert.ok(pending.length<=8192);
   const ends=[pending.indexOf(10),pending.indexOf(13)].filter(i=>i>=0);if(!ends.length)return;
   const end=Math.min(...ends);assert.match(pending.subarray(end).toString(),/^[\r\n]+$/);
   process.stdin.pause();process.stdin.off('data',read);resolve(JSON.parse(pending.subarray(0,end).toString()));
  }catch{process.stdin.off('data',read);reject(Error('PRIVATE_FRAME_REFUSED'));}};
  process.stdin.on('data',read);process.stdin.once('end',()=>reject(Error('PRIVATE_FRAME_MISSING')));
 });
 assert.ok(frame&&Object.keys(frame).sort().join(',')==='operation,password'&&frame.operation===operation&&typeof frame.password==='string'&&frame.password.length>0&&frame.password.length<=4096&&!/[\r\n\0]/.test(frame.password));
 const raw=Buffer.from(frame.password,'utf8');frame.password='';pending.fill(0);pending=null;
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const chunks=[];let fault=false;child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',()=>{fault=true;});child.on('error',()=>{fault=true;});
 const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));child.stdin.on('error',()=>{fault=true;});child.stdin.end(raw);const result=await done;raw.fill(0);
 assert.ok(!fault&&result.code===0&&result.signal===null&&child.stdout.readableEnded&&child.stderr.readableEnded);
 const encoded=Buffer.concat(chunks).toString();assert.match(encoded,/^[A-Za-z0-9+/]+={0,2}$/);assertOriginalPrivateEvidenceDirectory(custody,directory);const file=path.join(directory,'backup-credential.dpapi');fs.writeFileSync(file,encoded,{flag:'wx',mode:0o600});
 report.pass=true;report.credential={file,protection:'Windows-DPAPI-CurrentUser',ciphertextSha256:createHash('sha256').update(encoded).digest('hex')};report.originalChild={pid:child.pid,...result,stdoutEof:true,stderrEof:true};
}catch{report.error='PRIVATE_CREDENTIAL_PROVISION_REFUSED';process.exitCode=1;}
finally{if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();await lease.release();report.leaseClosed=true;report.completedAt=new Date().toISOString();const receipt=path.join(import.meta.dirname,'BACKUP-CREDENTIAL-PROVISION-'+operation+'.json');fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({receipt,pass:report.pass}));process.exit(process.exitCode??0);}
