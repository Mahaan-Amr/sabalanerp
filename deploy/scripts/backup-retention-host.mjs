/** Host-only requester for the fixed restricted backup owner. Never an app key mount. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value)));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function readOriginalBackupRetentionSettings(raw){
 assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=1024*1024);
 const rows=raw.toString('utf8').split(/\r?\n/);
 const setting=name=>{const matching=rows.filter(line=>line.startsWith(name+'='));assert.equal(matching.length,1);let value=matching[0].slice(name.length+1);if(/^(['"]).*\1$/.test(value))value=value.slice(1,-1);assert.ok(value&&!/[\r\n\0]/.test(value));return value;};
 const host=setting('DEPLOYMENT_BACKUP_HOST'),user=setting('DEPLOYMENT_BACKUP_OPERATIONS_USER');assert.match(host,/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);assert.equal(user,'sabalan-backup-ops');
 const key=setting('DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE'),transferKey=setting('DEPLOYMENT_BACKUP_SSH_KEY_FILE'),knownHosts=setting('DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE');
 for(const file of [key,transferKey,knownHosts])assert.ok(path.posix.isAbsolute(file)&&path.posix.normalize(file)===file);
 assert.notEqual(key,transferKey,'BACKUP_OPERATION_AND_TRANSFER_KEYS_MUST_DIFFER');
 return {host,user,key,transferKey,knownHosts,setting};
}
function privateFile(file,maximum,mode,forbiddenMode=0o077){
 assert.ok(path.isAbsolute(file)&&fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(maximum));
  assert.ok(mode===undefined?(before.mode&BigInt(forbiddenMode))===0n:(before.mode&0o777n)===BigInt(mode));
  const pin=s=>['dev','ino','size','mode','mtimeNs','ctimeNs','nlink'].map(key=>String(s[key])).join(':');assert.equal(pin(before),pin(named));const raw=fs.readFileSync(fd);
  assert.equal(pin(before),pin(fs.fstatSync(fd,{bigint:true})));assert.equal(pin(named),pin(fs.lstatSync(file,{bigint:true})));return raw;
 }finally{fs.closeSync(fd);}
}
export function validateOriginalBackupRetentionResponse(request,raw){
 assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=4*1024*1024);const response=JSON.parse(raw.toString('utf8'));
 assert.ok(raw.equals(Buffer.concat([bytes(response),Buffer.from('\n')])),'BACKUP_RETENTION_RESPONSE_NOT_CANONICAL');
 assert.equal(response.format,'sabalan-original-backup-retention-result/v1');assert.equal(response.deploymentId,request.deploymentId);assert.equal(response.requestId,request.requestId);assert.equal(response.requestSha256,sha(bytes(request)));
 assert.equal(response.storageRoot,'/srv/sabalanerp-recovery/checkpoints');assert.ok(Number.isSafeInteger(response.originalPid)&&response.originalPid>0);
 assert.equal(response.originalStorageLock?.ownerUid,0);assert.equal(response.originalStorageLock?.descriptor,9);for(const key of ['device','inode'])assert.match(response.originalStorageLock[key],/^[1-9][0-9]*$/);
 assert.ok(response.plan&&Array.isArray(response.audit)&&Array.isArray(response.retainedPoints)&&response.retainedPoints.length<=2);
 for(const point of response.retainedPoints){assert.match(point.id,/^[a-zA-Z0-9_-]{1,160}$/);for(const key of ['checksum','metadataSha256'])assert.match(point[key],/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(point.size)&&point.size>=0);}
 return response;
}
function deploymentLock(){
 const file='/opt/sabalanerp/.deploy-state/deployment.lock';assert.equal(fs.realpathSync(file),file);const named=fs.lstatSync(file,{bigint:true}),fd=fs.fstatSync(9,{bigint:true});
 assert.ok(fd.isFile()&&fd.uid===0n&&fd.nlink===1n&&(fd.mode&0o022n)===0n&&fd.dev===named.dev&&fd.ino===named.ino);
 assert.ok([...fs.readFileSync('/proc/self/fdinfo/9','utf8').matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)].some(row=>row[1]===String(fd.ino)));
 return String(fd.dev)+':'+String(fd.ino);
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.cwd(),'/opt/sabalanerp');
 const inspect=process.argv[2]==='--inspect';let envFile,deploymentId,stage,receiptFile,protectedIdsFile;
 if(inspect){assert.equal(process.argv.length,4);envFile=process.argv[3];}else{[envFile,deploymentId,stage,receiptFile,protectedIdsFile]=process.argv.slice(2);assert.equal(process.argv.length,7);assert.match(deploymentId,/^[a-zA-Z0-9_-]{8,160}$/);assert.ok(['BEFORE_CHECKPOINT','AFTER_CHECKPOINT'].includes(stage));}
 const {host,user,key,transferKey,knownHosts,setting}=readOriginalBackupRetentionSettings(privateFile(path.resolve(envFile),1024*1024));
 const keySha=sha(privateFile(key,65536)),transferKeySha=sha(privateFile(transferKey,65536)),knownSha=sha(privateFile(knownHosts,1024*1024,undefined,0o022));
 assert.notEqual(keySha,transferKeySha,'BACKUP_OPERATION_AND_TRANSFER_KEYS_MUST_DIFFER');
 const ownerFile=fileURLToPath(new URL('./backup-retention-ssh-owner.mjs',import.meta.url)),ownerRaw=privateFile(ownerFile,65536,undefined,0o022);
 const ssh=fs.lstatSync('/usr/bin/ssh');assert.ok(ssh.isFile()&&ssh.uid===0&&(ssh.mode&0o022)===0&&(ssh.mode&0o111)!==0);
 if(inspect){deploymentLock();process.stdout.write(JSON.stringify({format:'sabalan-host-backup-retention-prerequisites/v1',inspected:true,sshStarted:false,mutation:false})+'\n');return;}
 const protectedRaw=privateFile(protectedIdsFile,1024*1024,0o400),protectedCheckpointIds=JSON.parse(protectedRaw.toString());assert.ok(Array.isArray(protectedCheckpointIds)&&protectedCheckpointIds.length<=4096&&new Set(protectedCheckpointIds).size===protectedCheckpointIds.length);for(const id of protectedCheckpointIds)assert.match(id,/^[a-zA-Z0-9_-]{1,160}$/);
 const reportRoot=fs.realpathSync(setting('DEPLOYMENT_REPORT_DIR_HOST'));assert.ok(path.isAbsolute(receiptFile)&&path.dirname(receiptFile)===reportRoot&&fs.realpathSync(reportRoot)===reportRoot);const directory=fs.lstatSync(reportRoot);assert.ok(directory.isDirectory()&&directory.uid===0&&(directory.mode&0o022)===0);assert.equal(fs.existsSync(receiptFile),false);
 const lock=deploymentLock(),request={format:'sabalan-restricted-backup-retention-request/v1',deploymentId,requestId:randomBytes(32).toString('hex'),protectedCheckpointIds};
 const inherited=Array.from({length:10},()=> 'ignore');inherited[0]='pipe';inherited[1]='pipe';inherited[2]='pipe';inherited[9]=9;
 const child=spawn(process.execPath,[ownerFile,host,user,key,knownHosts],{stdio:inherited});
 const stdout=[];let outputBytes=0,errorBytes=0,failure=null,outEof=false,errEof=false;child.on('error',error=>{failure??=error;});child.stdin.on('error',error=>{failure??=error;});
 child.stdout.on('data',raw=>{outputBytes+=raw.length;if(outputBytes<=6*1024*1024)stdout.push(raw);else failure??=Error('BACKUP_RETENTION_OUTPUT_BOUND');});child.stderr.on('data',raw=>{errorBytes+=raw.length;if(errorBytes>65536)failure??=Error('BACKUP_RETENTION_ERROR_BOUND');});child.stdout.once('end',()=>{outEof=true;});child.stderr.once('end',()=>{errEof=true;});
 child.stdin.end(Buffer.concat([bytes(request),Buffer.from('\n')]));const closed=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({pid:child.pid,code,signal})));
 assert.equal(failure,null);assert.equal(closed.code,0);assert.equal(closed.signal,null);assert.ok(outEof&&errEof);assert.equal(deploymentLock(),lock);assert.equal(sha(privateFile(key,65536)),keySha);assert.equal(sha(privateFile(knownHosts,1024*1024,undefined,0o022)),knownSha);assert.ok(privateFile(protectedIdsFile,1024*1024,0o400).equals(protectedRaw));assert.ok(privateFile(ownerFile,65536,undefined,0o022).equals(ownerRaw));
 const owned=JSON.parse(Buffer.concat(stdout).toString('utf8'));assert.equal(owned.format,'sabalan-original-host-retention-ssh-owner/v1');assert.ok(Number.isSafeInteger(owned.originalSsh?.pid)&&owned.originalSsh.pid>0&&owned.originalSsh.pid!==closed.pid);assert.equal(owned.originalSsh.code,0);assert.equal(owned.originalSsh.signal,null);assert.equal(owned.originalPipesClosed,true);assert.match(owned.stderrSha256,/^[a-f0-9]{64}$/);
 const responseRaw=Buffer.from(owned.responseRawBase64,'base64');assert.equal(responseRaw.toString('base64'),owned.responseRawBase64);validateOriginalBackupRetentionResponse(request,responseRaw);
 const receipt={format:'sabalan-original-host-backup-retention/v1',deploymentId,stage,request,originalSsh:owned.originalSsh,originalHostOwner:closed,responseRawBase64:responseRaw.toString('base64'),responseSha256:sha(responseRaw),originalPipesClosed:true,stderrSha256:owned.stderrSha256};
 const raw=Buffer.concat([bytes(receipt),Buffer.from('\n')]),fd=fs.openSync(receiptFile,'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(reportRoot,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}assert.ok(privateFile(receiptFile,8*1024*1024,0o400).equals(raw));process.stdout.write(JSON.stringify({file:receiptFile,sha256:sha(raw)})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('ORIGINAL_HOST_BACKUP_RETENTION_FAILED\n');process.exitCode=1;});
