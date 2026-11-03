import fs from 'node:fs';
import {createHash} from 'node:crypto';

type Binding={deploymentId:string;releaseId:string;targetCommit:string;controlImage:string};
const fail=():never=>{throw Object.assign(new Error('CANDIDATE_SOURCE_PROJECTION_UNPROVEN'),{code:'CANDIDATE_SOURCE_PROJECTION_UNPROVEN'});};
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');

/** Structural and byte comparison only; never grants native or lease authority. */
export function validateCandidateProjection(value:any,binding:Binding,files:ReadonlyMap<string,Buffer>){
 if(!value||Object.keys(value).sort().join(',')!==['applicationCommit','applicationSourceHash','applicationTree','backendImage','deploymentId','format','hostLock','inventory','planSha256','releaseAdmission','releaseId'].sort().join(',')||!['sabalan-prebuilt-migration-projection/v1','sabalan-build-migration-projection/v1'].includes(value.format)||value.releaseAdmission!==false||
   value.deploymentId!==binding.deploymentId||value.releaseId!==binding.releaseId||value.applicationCommit!==binding.targetCommit||
   value.backendImage!==binding.controlImage||!/^sha256:[a-f0-9]{64}$/.test(value.backendImage)||
   !/^[a-f0-9]{40}$/.test(value.applicationCommit)||!/^[a-f0-9]{40}$/.test(value.applicationTree)||
   !/^[a-f0-9]{64}$/.test(value.planSha256)||!/^[a-f0-9]{64}$/.test(value.applicationSourceHash)||
   !value.hostLock||!/^[0-9]+$/.test(value.hostLock.device)||!/^[0-9]+$/.test(value.hostLock.inode))fail();
 const inventory=value.inventory;
 if(!inventory||Object.keys(inventory).sort().join(',')!==['commit','entries','format','releaseAdmission','sha256'].sort().join(',')||inventory.format!=='sabalan-git-migration-inventory/v1'||inventory.commit!==binding.targetCommit||inventory.releaseAdmission!==false||
   !Array.isArray(inventory.entries)||inventory.entries.length<1||inventory.entries.length>8192||inventory.entries.length!==files.size||
   !/^[a-f0-9]{64}$/.test(inventory.sha256)||sha(JSON.stringify(inventory.entries))!==inventory.sha256)fail();
 let previous='';
 for(const item of inventory.entries){
  if(!item||Object.keys(item).sort().join(',')!=='name,sha256'||typeof item.name!=='string'||!/^\d{14}_[A-Za-z0-9_]+$/.test(item.name)||
    !/^[a-f0-9]{64}$/.test(item.sha256)||previous.localeCompare(item.name,'en')>=0)fail();
  const bytes=files.get(item.name);if(!Buffer.isBuffer(bytes)||sha(bytes)!==item.sha256)fail();previous=item.name;
 }
 return Object.freeze({planSha256:value.planSha256,inventorySha256:inventory.sha256,sourceImageBinding:'HOST_REPORTED_NOT_INDEPENDENT' as const,releaseAdmission:false as const});
}

/** Fixed read-only bind only. Runtime/native owner and locked DB lease remain separate gates. */
export function readCandidateProjection(binding:Binding,files:ReadonlyMap<string,Buffer>){
 const file='/run/deployment-migration-projection.json';
 if(process.platform!=='linux'||process.getuid?.()!==0)fail();
 const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').map(line=>line.split(' '));
 if(!mounts.some(parts=>parts[4]===file&&parts[5]?.split(',').includes('ro')))fail();
 if(fs.realpathSync(file)!==file)fail();
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true});
  if(!before.isFile()||before.uid!==0n||before.nlink!==1n||(before.mode&0o777n)!==0o400n||before.size<1n||before.size>1048576n)fail();
  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
  if(before.dev!==named.dev||before.ino!==named.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)fail();
  return validateCandidateProjection(JSON.parse(bytes.toString('utf8')),binding,files);
 }finally{fs.closeSync(fd);}
}
