import fs from 'node:fs';
import path from 'node:path';
function required(v:unknown):asserts v{if(!v)throw Error('ORIGINAL_CONTINUOUS_WAL_RECOVERY_REQUIRED');}
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
/** This only permits a completed producer record; it never recreates custody. */
export function assertClosedContinuousWalRecord(value:any){
 required(value?.format==='sabalan-original-continuous-wal-state/v1'&&value.phase==='COMPLETE'&&value.finalIntervalCompletion===true&&digest(value.captureId));
 const terminal=value.terminal;
 required(terminal?.format==='sabalan-original-terminal-wal-coverage/v1'&&terminal.phase==='COMPLETE'
  &&terminal.finalIntervalCompletion===true&&terminal.ownedChildrenDomain==='continuous-wal-producer'&&terminal.allOriginalChildrenClosed===true
  &&terminal.captureId===value.captureId&&JSON.stringify(terminal.originalOwner)===JSON.stringify(value.originalOwner)
  &&Array.isArray(terminal.windows)&&terminal.windows.length>0&&terminal.windows.length<=4096
  &&value.windowsCreated===terminal.windows.length&&value.closedWindows===terminal.windows.length
  &&digest(terminal.publicationSha256)&&digest(terminal.terminalEpochSha256));
 required(terminal.windows.every((v:any)=>['windowSha256','requestSha256','certificateSha256'].every(k=>digest(v[k]))));
}
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].join(':');
/** Called before direct System Recovery mutations as well as by host preflight.
 * No timestamp, expired lease or vanished process can retire an unknown owner. */
export function assertNoUnclosedContinuousWalOwners(coordination:string){
 required(path.isAbsolute(coordination)&&fs.realpathSync(coordination)===coordination);
 const uid=BigInt(process.getuid!()),online=path.join(coordination,'online'),work=path.join(online,'work');
 for(const directory of [online,work]){const s=fs.lstatSync(directory,{bigint:true,throwIfNoEntry:false});if(!s)return;
  required(s.isDirectory()&&s.uid===uid&&!(s.mode&0o022n)&&fs.realpathSync(directory)===directory);}
 const names=fs.readdirSync(work).sort();required(names.length<=4096);
 for(const name of names){
  required(/^[a-f0-9]{64}$/.test(name));const directory=path.join(work,name),s=fs.lstatSync(directory,{bigint:true});
  required(s.isDirectory()&&s.uid===uid&&!(s.mode&0o022n)&&fs.realpathSync(directory)===directory);
  const file=path.join(directory,'continuous-wal-state.json');if(!fs.lstatSync(file,{throwIfNoEntry:false}))continue;
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=fs.fstatSync(fd,{bigint:true});required(before.isFile()&&before.nlink===1n&&before.uid===uid&&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<=4194304n);
   const raw=fs.readFileSync(fd);required(BigInt(raw.length)===before.size&&pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));
   assertClosedContinuousWalRecord(JSON.parse(raw.toString()));
  }finally{fs.closeSync(fd);}
 }
 required(JSON.stringify(fs.readdirSync(work).sort())===JSON.stringify(names));
}
