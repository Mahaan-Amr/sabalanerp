/** DPAPI -> anonymous child stdin; metadata-only inventory with private raw paths. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
const operation=randomBytes(16).toString('hex'),directory=path.resolve('D:/sabalanerp-online-qa/419-backup-readonly-'+operation),sha=b=>createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'BACKUP-CREDENTIAL-PROVISION-f9dbc130c806c9c62b6b57b2bbba8c84.json')));
assert.equal(receipt.pass,true);assert.equal(receipt.credential.ciphertextSha256,'468a3d8f1094bd4b0eb67e3a58a7e4835efadbb9d297be7c82d2248b2cf66a63');
const report={format:'sabalan-419-backup-filesystem-observation/v1',operation,startedAt:new Date().toISOString(),pass:false,masterStarted:false,productionAdmission:false,fullAccepted:false,canonicalAuditAppend:false,cleanupPerformed:false};let lease,custody,interrupted=false;
const cancel=()=>{interrupted=true;};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
async function child(executable,args,input,maximum){
 const environment=Object.fromEntries(Object.entries(process.env).filter(([name])=>name.toLowerCase()!=='psmodulepath'));
 const p=spawn(executable,args,{env:environment,stdio:['pipe','pipe','pipe'],windowsHide:true});const out=[],errors=[];let count=0,errorCount=0,fault=false;
 p.stdout.on('data',b=>{count+=b.length;if(count<=maximum)out.push(b);else fault=true;});p.stderr.on('data',b=>{errorCount+=b.length;if(errorCount<=65536)errors.push(b);fault=true;});
 p.stdout.on('error',()=>{fault=true;});p.stderr.on('error',()=>{fault=true;});
 p.on('error',()=>{fault=true;});p.stdin.on('error',()=>{fault=true;});
 const done=new Promise(resolve=>p.once('close',(code,signal)=>resolve({originalPid:p.pid,code,signal,stdoutEof:p.stdout.readableEnded,stderrEof:p.stderr.readableEnded})));
 p.stdin.end(input);const result=await done;report.children??=[];report.children.push(result);
 if(errors.length){assertOriginalPrivateEvidenceDirectory(custody,directory);const file=path.join(directory,'child-'+report.children.length+'.stderr.raw');fs.writeFileSync(file,Buffer.concat(errors),{flag:'wx',mode:0o600});result.privateStderr={file,sha256:sha(fs.readFileSync(file))};}
 assert.ok(!interrupted&&!fault&&result.code===0&&result.signal===null&&result.stdoutEof&&result.stderrEof);return Buffer.concat(out);
}
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
 await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
 custody=await prepareOriginalPrivateEvidenceDirectory(directory);assertOriginalPrivateEvidenceDirectory(custody,directory);
 const space=fs.statfsSync('D:/',{bigint:true});assert.ok(space.bavail*space.bsize>=16n*1024n**3n+512n*1024n**2n);
 const cipher=fs.readFileSync(receipt.credential.file);assert.equal(sha(cipher),receipt.credential.ciphertextSha256);
 const script="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$p='D:\\sabalanerp-online-qa\\419-backup-credential-f9dbc130c806c9c62b6b57b2bbba8c84';$a=Get-Acl -LiteralPath $p;$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;if(-not $a.AreAccessRulesProtected -or $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $me.Value -or @($a.Access).Count -ne 1){throw 'PRIVATE_CREDENTIAL_ACL'};$r=@($a.Access)[0];if($r.IsInherited -or $r.AccessControlType -ne 'Allow' -or $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $me.Value -or $r.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl){throw 'PRIVATE_CREDENTIAL_ACE'};$encoded=[Console]::In.ReadToEnd();$plain=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($encoded),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);try{$s=[Console]::OpenStandardOutput();$s.Write($plain,0,$plain.Length);$s.Flush()}finally{[Array]::Clear($plain,0,$plain.Length)}";
 const secret=await child('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],cipher,4096);
 let input;try{input=Buffer.from(JSON.stringify({password:secret.toString('utf8')}));}finally{secret.fill(0);}
 lease.assertHeld();const python=path.join(import.meta.dirname,'fintech-residual-inspect.py');report.source={file:python,sha256:sha(fs.readFileSync(python))};
 let raw;try{raw=await child('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B',python,directory],input,256*1024);}finally{input.fill(0);}
 assertOriginalPrivateEvidenceDirectory(custody,directory);report.result=JSON.parse(raw);assert.equal(report.result.credentialLeafRetired,true);lease.assertHeld();report.pass=true;
}catch{report.error='BACKUP_READONLY_OBSERVATION_REFUSED';process.exitCode=1;}
finally{if(lease){await lease.release();report.lease.closed=true;}report.interrupted=interrupted;process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);report.completedAt=new Date().toISOString();const file=path.join(import.meta.dirname,'FINTECH-RESIDUAL-INSPECT-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,pass:report.pass}));}
