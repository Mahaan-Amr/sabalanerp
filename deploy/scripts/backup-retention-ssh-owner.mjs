/** Fixed host guardian: holds deployment FD9 even if OpenSSH closes extra FDs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
let interrupted=null;
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{interrupted??=signal;});
function lock(){
 const file='/opt/sabalanerp/.deploy-state/deployment.lock';assert.equal(fs.realpathSync(file),file);
 const a=fs.lstatSync(file,{bigint:true}),b=fs.fstatSync(9,{bigint:true});assert.ok(b.isFile()&&b.uid===0n&&b.nlink===1n&&(b.mode&0o022n)===0n&&a.dev===b.dev&&a.ino===b.ino);
 assert.ok([...fs.readFileSync('/proc/self/fdinfo/9','utf8').matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)].some(row=>row[1]===String(b.ino)));return String(b.dev)+':'+String(b.ino);
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.cwd(),'/opt/sabalanerp');
 const [host,user,key,knownHosts]=process.argv.slice(2);assert.equal(process.argv.length,6);assert.match(host,/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);assert.equal(user,'sabalan-backup-ops');
 for(const file of [key,knownHosts]){assert.equal(fs.realpathSync(file),file);const s=fs.lstatSync(file);assert.ok(s.isFile()&&s.uid===0&&s.nlink===1&&(s.mode&0o022)===0);}
 const originalLock=lock(),chunks=[];let size=0;for await(const raw of process.stdin){size+=raw.length;assert.ok(size<=1024*1024);chunks.push(raw);}assert.ok(size>0);
 assert.equal(interrupted,null);
 const child=spawn('/usr/bin/ssh',['-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','UserKnownHostsFile='+knownHosts,'-i',key,user+'@'+host,'retain'],{stdio:['pipe','pipe','pipe']});
 const stdout=[],stderr=[];let output=0,errors=0,failure=null,outEof=false,errEof=false;child.on('error',e=>{failure??=e;});child.stdin.on('error',e=>{failure??=e;});
 child.stdout.on('data',raw=>{output+=raw.length;if(output<=4*1024*1024)stdout.push(raw);else failure??=Error('OUTPUT_BOUND');});child.stderr.on('data',raw=>{errors+=raw.length;if(errors<=65536)stderr.push(raw);else failure??=Error('ERROR_BOUND');});child.stdout.once('end',()=>{outEof=true;});child.stderr.once('end',()=>{errEof=true;});
 child.stdin.end(Buffer.concat(chunks));const originalSsh=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({pid:child.pid,code,signal})));
 assert.equal(failure,null);assert.equal(originalSsh.code,0);assert.equal(originalSsh.signal,null);assert.ok(outEof&&errEof);assert.equal(lock(),originalLock);assert.equal(interrupted,null,'BACKUP_RETENTION_OWNER_INTERRUPTED_AFTER_ORIGINAL_CLOSURE');
 // No output is sent while SSH can mutate: a dead requester cannot release this guardian's FD9.
 process.stdout.write(JSON.stringify({format:'sabalan-original-host-retention-ssh-owner/v1',originalSsh,originalPipesClosed:true,responseRawBase64:Buffer.concat(stdout).toString('base64'),stderrSha256:sha(Buffer.concat(stderr))})+'\n');
}
main().catch(()=>{process.stderr.write('BACKUP_RETENTION_SSH_OWNER_FAILED\n');process.exitCode=1;});
