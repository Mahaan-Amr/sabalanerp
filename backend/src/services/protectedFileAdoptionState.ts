import fs from 'node:fs';
import path from 'node:path';
const fail=()=>{throw Error('PROTECTED_FILE_ADOPTION_COMPLETION_UNPROVEN');};
const birth=(pid:number)=>({pid,bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),pidNamespace:fs.readlinkSync(`/proc/${pid}/ns/pid`),startTicks:fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ')[19]});
const sameBirth=(value:any,actual:ReturnType<typeof birth>)=>value&&Object.keys(actual).every(key=>value[key]===actual[key as keyof typeof actual]);
/** This denies replacement controls. ACTIVE is usable only by the exact child
 * still held by its original guardian, with BOTH inherited kernel EX locks. */
export function assertProtectedFileAdoptionState(directory:string){
 const file=path.join(directory,'deployment-file-adoption-native.json');let fd:number;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(error:any){if(error.code==='ENOENT')return;throw error;}
 try{const before=fs.fstatSync(fd,{bigint:true});if(!before.isFile()||before.uid!==0n||before.nlink!==1n||before.mode&0o077n||before.size<1n||before.size>16384n||fs.realpathSync(file)!==file)fail();
  const value=JSON.parse(fs.readFileSync(fd,'utf8')),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
  for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'] as const)if(before[key]!==after[key]||before[key]!==named[key])fail();
  if(value.format!=='sabalan-protected-file-adoption-native/v1')fail();
  if(value.phase==='QUIESCENT'&&value.nativeReaped===true&&value.databaseQuiet===true&&Number.isInteger(value.nativeStatus))return;
  if(value.phase!=='ACTIVE'||!sameBirth(value.child,birth(process.pid))||!sameBirth(value.guardian,birth(process.ppid)))fail();
  for(const [descriptor,name]of [[9,'deployment-runtime-control.lock'],[10,'deployment-write-admission.lock']] as const){
   const expected=path.join(directory,name),actual=fs.fstatSync(descriptor,{bigint:true}),entry=fs.lstatSync(expected,{bigint:true});
   if(!actual.isFile()||actual.nlink!==1n||actual.uid!==0n||actual.dev!==entry.dev||actual.ino!==entry.ino||fs.realpathSync(expected)!==expected||actual.mode&0o022n)fail();
   if(!new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'+actual.ino+'\\s+0\\s+EOF\\s*$','m').test(fs.readFileSync('/proc/self/fdinfo/'+descriptor,'utf8')))fail();
  }
 }finally{fs.closeSync(fd);}
}
