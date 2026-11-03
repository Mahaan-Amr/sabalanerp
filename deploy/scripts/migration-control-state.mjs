/** Durable evidence of an in-flight host migration; never a lease or grant. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectOriginalDeploymentHostLock} from './prebuilt-release-plan.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
export function classifyMigrationControlEvidence(operation,started,completed){
 assert.match(operation,/^[A-Za-z0-9_-]{8,160}$/);
 if(started===null){assert.equal(completed,null,'MIGRATION_CONTROL_EVIDENCE_UNPROVEN');return 'NONE';}
 const start=JSON.parse(started.toString('utf8'));
 assert.deepEqual(start,{format:'sabalan-migration-control-start/v1',operation,productionAdmission:false});
 if(completed===null)return 'UNKNOWN';
 const done=JSON.parse(completed.toString('utf8'));
 assert.deepEqual(done,{format:'sabalan-migration-control-complete/v1',operation,startSha256:sha(started),productionAdmission:false});
 return 'COMPLETE';
}
function paths(directory,id){return {started:path.join(directory,`migration-control-start-${id}.json`),completed:path.join(directory,`migration-control-complete-${id}.json`)};}
function read(file){
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(e){if(e?.code==='ENOENT')return null;throw e;}
 try{const a=fs.fstatSync(fd,{bigint:true});assert.ok(a.isFile()&&a.uid===0n&&a.nlink===1n&&(a.mode&0o777n)===0o400n&&a.size>0n&&a.size<=4096n);
  const b=fs.readFileSync(fd),z=fs.fstatSync(fd,{bigint:true}),n=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs']){assert.equal(a[key],z[key]);assert.equal(a[key],n[key]);}return b;
 }finally{fs.closeSync(fd);}
}
function write(directory,file,value){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value));fs.fchmodSync(fd,0o400);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const d=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
}
function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.argv.length,4);
 const mode=process.argv[2],repository=fs.realpathSync(process.argv[3]),id=process.env.DEPLOYMENT_ID;
 assert.ok(['begin','complete','check'].includes(mode));assert.match(id??'',/^[A-Za-z0-9_-]{8,160}$/);assert.equal(process.cwd(),repository);
 const {directory}=inspectOriginalDeploymentHostLock(repository),files=paths(directory,id);
 const started=read(files.started),completed=read(files.completed),state=classifyMigrationControlEvidence(id,started,completed);
 if(mode==='check'){process.stdout.write(state+'\n');return;}
 if(mode==='begin'){assert.equal(state,'NONE');write(directory,files.started,{format:'sabalan-migration-control-start/v1',operation:id,productionAdmission:false});return;}
 assert.equal(state,'UNKNOWN');write(directory,files.completed,{format:'sabalan-migration-control-complete/v1',operation:id,startSha256:sha(started),productionAdmission:false});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch{process.stderr.write('MIGRATION_CONTROL_EVIDENCE_UNPROVEN\n');process.exitCode=1;}
