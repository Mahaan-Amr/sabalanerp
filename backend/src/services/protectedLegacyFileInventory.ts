import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
function required(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
const pin=(value:fs.BigIntStats)=>[value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.uid,value.mode,value.nlink].map(String).join(':');
export type ProtectedLegacyFile={key:string;bytes:number;sha256:string};
/** Bounded read-only inventory; a callback reasserts the caller's real gate,
 * never substitutes for authority. No missing root or symlink is adopted. */
export async function inventoryProtectedLegacyFiles(root:string,assertOwned=()=>{}):Promise<{files:ProtectedLegacyFile[];directories:string[];identity:{device:string;inode:string}}>{
 const files:ProtectedLegacyFile[]=[],directories:string[]=[],rootStat=fs.lstatSync(root,{bigint:true});let total=0;
 async function walk(directory:string,prefix:string){
  assertOwned();const before=fs.lstatSync(directory,{bigint:true});required(before.isDirectory()&&before.uid===0n&&!(before.mode&0o022n)&&before.dev===rootStat.dev&&fs.realpathSync(directory)===directory,'PROTECTED_FILE_SOURCE_UNSAFE');
  directories.push(directory);required(directories.length<=10000,'PROTECTED_FILE_SOURCE_CAPACITY');const children=fs.readdirSync(directory).sort();
  for(const name of children){required(name!=='.'&&name!=='..'&&!name.startsWith('.sabalan-file-')&&!name.includes('\\')&&!name.includes('\0'),'PROTECTED_FILE_SOURCE_NAME_UNSAFE');const target=path.join(directory,name),st=fs.lstatSync(target,{bigint:true});
   if(st.isDirectory()){await walk(target,prefix+name+'/');continue;}
   required(st.isFile()&&st.nlink===1n&&st.uid===0n&&!(st.mode&0o022n)&&st.dev===rootStat.dev&&st.size<=2n*1024n**3n,'PROTECTED_FILE_SOURCE_UNSAFE');
   const descriptor=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK),hash=createHash('sha256');let bytes=0;
   try{const buffer=Buffer.alloc(262144);for(;;){assertOwned();const n=fs.readSync(descriptor,buffer,0,buffer.length,null);if(!n)break;bytes+=n;hash.update(buffer.subarray(0,n));}required(bytes===Number(st.size)&&pin(st)===pin(fs.fstatSync(descriptor,{bigint:true}))&&pin(st)===pin(fs.lstatSync(target,{bigint:true})),'PROTECTED_FILE_SOURCE_CHANGED');fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
   files.push({key:prefix+name,bytes,sha256:hash.digest('hex')});total+=bytes;required(files.length<=10000&&total<=32*1024**3,'PROTECTED_FILE_SOURCE_CAPACITY');
  }
  assertOwned();required(pin(before)===pin(fs.lstatSync(directory,{bigint:true})),'PROTECTED_FILE_SOURCE_CHANGED');
 }
 await walk(root,'');files.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);return {files,directories,identity:{device:String(rootStat.dev),inode:String(rootStat.ino)}};
}
