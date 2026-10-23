/** Preserve one qualified existing scanner. No mutation, repair or admission authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validateSelection,validateBinding,selectionBinding,canonical,hash,validateResumeSelection} from '../../backend/scripts/preserved-clamav-policy.mjs';
export {validateSelection,validateBinding,selectionBinding,canonical,hash,validateResumeSelection} from '../../backend/scripts/preserved-clamav-policy.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const digest=/^[a-f0-9]{64}$/;
export const preservationSources=['deploy/scripts/preserved-clamav.mjs','backend/scripts/preserved-clamav-policy.mjs','scripts/clamav-release-readiness.mjs','scripts/clamav-source-migration.mjs','backend/scripts/clamav-checkpoint.mjs','backend/scripts/clamav-incident-policy.mjs'];
export function validateIdentity(selection,row){
 validateSelection(selection);assert.equal(row.Id,selection.containerId,'PRESERVED_CLAMAV_CONTAINER_CHANGED');assert.equal(row.Image,selection.image,'PRESERVED_CLAMAV_IMAGE_CHANGED');
 assert.equal(row.State?.StartedAt,selection.startedAt,'PRESERVED_CLAMAV_BIRTH_CHANGED');assert.equal(row.State?.Pid,selection.hostPid,'PRESERVED_CLAMAV_PID_CHANGED');
 assert.equal(row.State?.Running,true);assert.equal(row.State?.Restarting,false);assert.equal(row.State?.Dead,false);assert.equal(row.State?.Health?.Status,'healthy');
 assert.equal(row.Config?.Labels?.['com.docker.compose.project'],'sabalanerp');assert.equal(row.Config?.Labels?.['com.docker.compose.service'],'clamav');
 const projected={Config:row.Config,HostConfig:row.HostConfig,Mounts:row.Mounts,Networks:row.NetworkSettings?.Networks};
 for(const item of Object.values(projected))assert.ok(item&&typeof item==='object');
 assert.equal(hash(canonical(projected)),selection.stableConfigurationSha256,'PRESERVED_CLAMAV_CONFIGURATION_CHANGED');return row;
}
export function assertComposePreserves(args){
 assert.ok(Array.isArray(args)&&args.length>0);const [verb,...tail]=args;
 if(['config','ps','logs','port','images','version'].includes(verb))return;
 assert.ok(['up','start','stop','run','exec'].includes(verb),'PRESERVED_CLAMAV_MUTATION_REFUSED');
 const services=new Set(['postgres','backend','frontend','inquiry','nginx','release-edge','deployment']);
 const flags=new Set(['-d','-T','--rm','--no-deps','--no-build','--wait','--force-recreate']);
 const values=new Set(['-t','--timeout','--wait-timeout','-e','--env','--label']);
 let found=0;
 for(let i=0;i<tail.length;i++){
  const arg=tail[i];
  if(flags.has(arg))continue;
  if(values.has(arg)){assert.ok(i+1<tail.length);const value=tail[++i];assert.ok(value&&!value.startsWith('-'));if(['-t','--timeout','--wait-timeout'].includes(arg))assert.match(value,/^[1-9][0-9]*$/);continue;}
  assert.ok(services.has(arg),'PRESERVED_CLAMAV_UNKNOWN_OR_SCANNER_SERVICE');found++;
  // exec/run tail is the explicit other service's command, never a Compose target.
  if(verb==='exec'||verb==='run')break;
 }
 assert.ok(found>0,'PRESERVED_CLAMAV_IMPLICIT_ALL_SERVICES');
 if(verb==='up'||verb==='run')assert.ok(tail.includes('--no-deps'),'PRESERVED_CLAMAV_DEPENDENCY_TRAVERSAL');
}
export function infrastructureDescriptor(desiredComposeSha256,binding){
 assert.match(desiredComposeSha256,digest);validateBinding(binding);
 return {format:'sabalan-effective-infrastructure-with-preserved-clamav/v1',desiredComposeSha256,preservedClamavStableConfigurationSha256:binding.selection.stableConfigurationSha256,preservedClamavImage:binding.selection.image,preservationBindingSha256:hash(canonical(binding))};
}
export function validatePreservationJournal(entries){
 assert.ok(Array.isArray(entries)&&entries.length>0);let previous=null;
 for(let i=0;i<entries.length;i++){const {hash:expected,...unsigned}=entries[i];assert.equal(unsigned.sequence,i+1);assert.equal(unsigned.previousHash,previous);assert.equal(hash(JSON.stringify(unsigned)),expected,'PRESERVED_CLAMAV_JOURNAL_CORRUPTED');assert.equal(unsigned.deploymentId,entries[0].deploymentId);previous=expected;}return entries[0];
}
function privateJson(file,firstLine=false){
 assert.ok(path.isAbsolute(file)&&fs.realpathSync(file)===file);
 for(let ancestor=path.dirname(file);;ancestor=path.dirname(ancestor)){
  const st=fs.lstatSync(ancestor,{bigint:true});assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0n&&!(st.mode&0o022n));if(path.dirname(ancestor)===ancestor)break;
 }
 const pin=st=>['dev','ino','size','mtimeNs','ctimeNs','mode','uid','gid','nlink'].map(key=>String(st[key]));
 const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.uid===0n&&before.nlink===1n&&!(before.mode&0o077n)&&before.size>0n&&before.size<=1048576n);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(before));const raw=fs.readFileSync(fd);assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(before));assert.deepEqual(pin(fs.lstatSync(file,{bigint:true})),pin(before));return firstLine?validatePreservationJournal(raw.toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))):JSON.parse(raw);}finally{fs.closeSync(fd);}
}
function bindingFromEnvironment(){
 const hex=process.env.DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX;assert.match(hex??'',/^(?:[a-f0-9]{2}){1,16384}$/);return validateBinding(JSON.parse(Buffer.from(hex,'hex').toString('utf8')));
}
export async function observeOriginalCommand(program,args,deadlineMs=120000){
 assert.ok(Number.isSafeInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=120000);
 // A deadline refuses qualification but never kills/disowns an inspector or its Docker exec.
 // Wait for the original child and both pipes to close even after a deadline failure.
 return await new Promise((resolve,reject)=>{
  const child=spawn(program,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',failure=null,expired=false;
  const timer=setTimeout(()=>{expired=true;process.stderr.write('PRESERVED_CLAMAV_INSPECTOR_DEADLINE_HELD\n');},deadlineMs);
  for(const [stream,name]of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',data=>{if(!failure){if(name==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>8*1024**2)failure=new Error('PRESERVED_CLAMAV_OUTPUT_BOUND');}});
  child.on('error',error=>{failure=error;});
  child.on('close',(code,signal)=>{clearTimeout(timer);if(failure||expired||code!==0||signal!==null){const error=failure??new Error('PRESERVED_CLAMAV_ORIGINAL_CHILD_FAILED');error.original={pid:child.pid,code,signal,pipesClosed:true,deadlineExceeded:expired};reject(error);}else resolve(stdout);});
 });
}
function writeEvidence(prefix,raw){
 const directory=process.env.DEPLOYMENT_PRESERVED_CLAMAV_EVIDENCE_DIR;assert.ok(directory&&path.isAbsolute(directory)&&fs.realpathSync(directory)===directory);
 const st=fs.lstatSync(directory);assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&!(st.mode&0o022));
 const name=prefix+'-'+Date.now()+'-'+hash(raw)+'.json';const fd=fs.openSync(path.join(directory,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(directory,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 return {file:name,sha256:hash(raw),bytes:Buffer.byteLength(raw)};
}
async function guard(binding,health){
 const inspect=async()=>{const rows=JSON.parse(await observeOriginalCommand('docker',['inspect',binding.selection.containerId]));assert.equal(rows.length,1);return validateIdentity(binding.selection,rows[0]);};await inspect();
 if(health){
  const raw=await observeOriginalCommand(process.execPath,[path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../scripts/clamav-release-readiness.mjs'),'inspect',binding.selection.containerId]);
  const report=JSON.parse(raw);assert.equal(report.image,binding.selection.image);assert.equal(report.updaterHealthy,true);assert.equal(report.signatureVerified,true);assert.equal(report.loadVerified,true);assert.equal(report.eicarRejected,true);await inspect();
  // Actual canonical bytes/version evolution are evidence, never a copied initial PASS flag.
  const evidence=writeEvidence('preserved-clamav-health',raw);
  process.stderr.write(JSON.stringify({format:'sabalan-preserved-clamav-health-evidence/v1',...evidence,versions:report.versions,loadedDaily:report.loadedDaily})+'\n');
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);const [mode,...args]=process.argv.slice(2);
 if(mode==='resume'){
  assert.equal(args.length,1);const session=privateJson(args[0]);
  assert.match(session.deploymentId??'',/^[a-zA-Z0-9_-]{1,160}$/);
  const journalFile=path.join(path.dirname(args[0]),'active-deployment.jsonl');
  const journal=privateJson(journalFile,true);assert.equal(journal.deploymentId,session.deploymentId);
  const metadataFile=path.join(path.dirname(args[0]),'preserved-clamav-'+session.deploymentId+'.json');
  const inherited=process.env.DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX?bindingFromEnvironment():null;
  const binding=validateResumeSelection(session,journal,fs.existsSync(metadataFile)?privateJson(metadataFile):null,inherited);
  if(binding)process.stdout.write('export DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX='+Buffer.from(canonical(binding)).toString('hex')+'\n');
 }else{
  const binding=bindingFromEnvironment();
  if(mode==='identity'||mode==='health'){assert.equal(args.length,0);await guard(binding,mode==='health');}
  else if(mode==='compose'){assertComposePreserves(args);await guard(binding,false);}
  else if(mode==='infrastructure'){assert.equal(args.length,1);await guard(binding,false);const raw=canonical(infrastructureDescriptor(args[0],binding));writeEvidence('preserved-clamav-infrastructure',raw);process.stdout.write(hash(raw));}
  else throw new Error('Unknown preserved scanner operation');
 }
}
