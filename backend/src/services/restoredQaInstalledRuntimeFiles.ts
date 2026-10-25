/** Data only. A measured installed tree is NOT an image provenance decision.
 * The original outer verifier must join this receipt SHA/file-map digest to
 * its authenticated material, compilation and actual execution-image graph. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.mode,s.uid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function need(v:unknown):asserts v{if(!v)throw Error('RESTORED_QA_INSTALLED_CONTENT_UNPROVEN');}
/** Strict material-path projection, with no filesystem or admission authority. */
export function installedRuntimeReceiptProjection(raw:Buffer){
 need(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=4*1024*1024);const receipt=JSON.parse(raw.toString());
 need(receipt?.format==='sabalan-current-backend-material/v1'&&receipt.materialized===true&&receipt.sourceUnchanged===true
  &&Array.isArray(receipt.files)&&receipt.files.length>0&&receipt.files.length<=20000);
 const ids=new Set<string>();const files=receipt.files.map((row:any)=>{
  need(row&&Object.keys(row).sort().join(',')==='bytes,path,sha256'&&typeof row.path==='string'&&row.path.length<=4096
   &&!row.path.includes('\\')&&!row.path.includes('\0')&&!row.path.startsWith('/')&&row.path.split('/').every((p:string)=>p!==''&&p!=='.'&&p!=='..')
   &&!ids.has(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=512*1024*1024&&/^[a-f0-9]{64}$/.test(row.sha256));ids.add(row.path);
  need(row.path==='Dockerfile'||row.path.startsWith('app/')||row.path.startsWith('packages/contract-product-graph/')||row.path.startsWith('packages/partner-sales-contracts/'));
  return{path:row.path,bytes:row.bytes,sha256:row.sha256};
 }).filter((row:{path:string})=>row.path!=='Dockerfile').sort((a:{path:string},b:{path:string})=>a.path<b.path?-1:a.path>b.path?1:0);
 need(files.some((r:{path:string})=>r.path==='app/dist/application.js')&&files.some((r:{path:string})=>r.path==='app/dist/lib/prisma.js')
  &&files.some((r:{path:string})=>r.path==='app/prisma/schema.prisma')&&files.some((r:{path:string})=>r.path.startsWith('app/node_modules/@prisma/client/')));
 return Object.freeze({files:Object.freeze(files.map((r:any)=>Object.freeze(r))),materialReceiptSha256:hash(raw),fileMapSha256:hash(JSON.stringify(files))});
}
function measured(file:string,bytes:number,expected:string){
 need(fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.nlink===1n&&before.uid===0n&&!(before.mode&0o022n)&&before.size===BigInt(bytes));
  const digest=createHash('sha256'),buffer=Buffer.alloc(262144);let total=0;for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;need(total<=bytes);digest.update(buffer.subarray(0,count));}
  need(total===bytes&&digest.digest('hex')===expected&&pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));
 }finally{fs.closeSync(fd);}
}
export function measureInstalledRestoredQaCurrentGraph(root:string){
 need(process.platform==='linux'&&process.getuid?.()===0&&path.resolve(root)===root);
 const file=path.join(path.dirname(root),'strict-complete-material/current/material-receipt.json');need(fs.realpathSync(file)===file);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let raw:Buffer;
 try{const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<=4194304n);
  raw=fs.readFileSync(fd);need(pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));
 }finally{fs.closeSync(fd);}
 const projection=installedRuntimeReceiptProjection(raw);for(const row of projection.files)measured('/'+row.path,row.bytes,row.sha256);
 need(fs.readFileSync(file).equals(raw));return Object.freeze({kind:'CURRENT_INSTALLED' as const,format:'sabalan-installed-backend-content/v1' as const,
  materialReceiptSha256:projection.materialReceiptSha256,fileMapSha256:projection.fileMapSha256,fileCount:projection.files.length,
  imageProvenanceClaimed:false as const});
}
