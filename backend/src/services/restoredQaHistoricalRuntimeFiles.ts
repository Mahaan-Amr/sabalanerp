/** Exact retained 89dd application graph, relocated inside the SAME restored
 * QA owner. This never accepts an executable path or grants DB authority. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const materialSha='8f9fb4f08af5027181232596b6f82fcb5c88b5d34556e629653ef5f3e7d5dc1d';
const baseSha='37f58e13131ada8a8afdd99a202c6592f3dfbf3dbd4b9dddcd9ef2abf16df3d1';
const oldImage='sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186';
const oldSource='7af34849e2aff4a23a32adb7387bf99283c3864e';
const prefixes=['app/node_modules','packages/contract-product-graph/node_modules','packages/partner-sales-contracts/node_modules'];
const excluded=['app/node_modules/@prisma/client','app/node_modules/.prisma/client','app/node_modules/@sabalanerp','packages/partner-sales-contracts/node_modules/@sabalanerp/contract-product-graph'];
type Row={path:string;kind:'file'|'directory'|'symlink';bytes?:number;sha256?:string;target?:string;mode?:number};
const sha=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
function need(v:unknown):asserts v{if(!v)throw Error('RESTORED_QA_HISTORICAL_RUNTIME_GRAPH_UNPROVEN');}
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
/** Path syntax only; this cannot mint a graph capability. */
export function historicalRuntimeRelativePath(value:string){
 need(typeof value==='string'&&value.length>0&&value.length<=4096&&!value.includes('\0')&&!value.includes('\\')&&!value.startsWith('/')
  &&value.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'));return value;
}
export function historicalRuntimeDirectory(file:string){need(fs.realpathSync(file)===file);const s=fs.lstatSync(file,{bigint:true});need(s.isDirectory()&&s.uid===0n&&!(s.mode&0o077n));return pin(s);}
function rawFile(file:string,expected:string,maximum:number){
 need(fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.nlink===1n&&before.uid===0n&&!(before.mode&0o022n)&&before.size>0n&&before.size<=BigInt(maximum));const raw=fs.readFileSync(fd);
  need(sha(raw)===expected&&pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));return raw;
 }finally{fs.closeSync(fd);}
}
function definitions(root:string){
 const input=path.join(path.dirname(root),'strict-complete-material','old89dd');historicalRuntimeDirectory(path.dirname(input));historicalRuntimeDirectory(input);const source=path.join(input,'context');historicalRuntimeDirectory(source);
 const material=JSON.parse(rawFile(path.join(input,'material-receipt.json'),materialSha,4*1024*1024).toString());
 const base=JSON.parse(rawFile(path.join(input,'base-inventory.json'),baseSha,4*1024*1024).toString());
 need(material.format==='sabalan-current-backend-material/v1'&&material.materialized===true&&material.sourceUnchanged===true
  &&material.inventorySha256&&material.schemaSha256==='3bafab1d4b4e8fa8d2ae9716c7ce2b60de32cc8ec3e0a1235e7551129b7d5f03'
  &&Array.isArray(material.files)&&material.files.length===6615
  &&base.format==='sabalan-immutable-shared-base-dependencies/v1'&&base.base?.index==='sha256:0772bcd13894be05d54c401134a197ff5906b6c5749fad53ed97de1238ddebaa'
  &&base.base?.config==='sha256:13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6'
  &&base.base?.compressedSha256==='d6f66240a68f8dbf264a0193b540435a2f8c4d11f9465db7873e0d1749532934'
  &&JSON.stringify(base.excludedReplacedRoots)===JSON.stringify(excluded)&&Array.isArray(base.entries)&&base.entries.length===7571&&JSON.stringify(base.selectedRoots)===JSON.stringify(prefixes));
 const rows:Row[]=base.entries.map((r:Row)=>({...r}));
 for(const r of rows){historicalRuntimeRelativePath(r.path);need(prefixes.some(p=>r.path===p||r.path.startsWith(p+'/'))
  &&!excluded.some(p=>r.path===p||r.path.startsWith(p+'/'))&&['file','directory','symlink'].includes(r.kind));}
 for(const file of material.files){historicalRuntimeRelativePath(file.path);need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&/^[a-f0-9]{64}$/.test(file.sha256));
  rows.push({path:file.path,kind:'file',bytes:file.bytes,sha256:file.sha256,mode:file.path==='app/scripts/hr-clamdscan.sh'?0o500:0o400});}
 const links=[['app/node_modules/@sabalanerp/contract-product-graph','packages/contract-product-graph'],
  ['app/node_modules/@sabalanerp/partner-sales-contracts','packages/partner-sales-contracts'],
  ['packages/partner-sales-contracts/node_modules/@sabalanerp/contract-product-graph','packages/contract-product-graph']];
 for(const [file,target]of links)rows.push({path:file,kind:'symlink',target:path.posix.relative(path.posix.dirname(file),target)});
 const map=new Map<string,Row>();for(const row of rows){need(!map.has(row.path));map.set(row.path,row);}
 for(const row of [...map.values()]){for(let parent=path.posix.dirname(row.path);parent!=='.';parent=path.posix.dirname(parent)){
  const prior=map.get(parent);need(!prior||prior.kind==='directory');if(!prior)map.set(parent,{path:parent,kind:'directory'});}}
 const all=[...map.values()].sort((a,b)=>a.path.localeCompare(b.path));return{input,source,rows:all,oldFiles:material.files.map((r:{path:string})=>r.path),baseNames:new Set<string>(base.entries.map((r:Row)=>r.path))};
}
export function historicalRuntimeFullTree(root:string){const rows=new Map<string,string>();const visit=(dir:string)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
 const file=path.join(dir,entry.name),relative=path.relative(root,file).split(path.sep).join('/');historicalRuntimeRelativePath(relative);const s=fs.lstatSync(file,{bigint:true});need(s.uid===0n&&(s.isFile()||s.isDirectory()||s.isSymbolicLink()));rows.set(relative,pin(s));if(s.isDirectory())visit(file);
 }};visit(root);return rows;}
function ensureDirectory(root:string,relative:string){if(relative==='.')return;const parts=historicalRuntimeRelativePath(relative).split('/');let current=root;
 for(const part of parts){current=path.join(current,part);if(!fs.existsSync(current))fs.mkdirSync(current,{mode:0o700});historicalRuntimeDirectory(current);}}
function copyFile(source:string,destination:string,row:Row){
 need(typeof row.bytes==='number'&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=512*1024*1024&&typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256));
 need(fs.realpathSync(source)===source);const fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.nlink===1n&&before.uid===0n&&!(before.mode&0o022n)&&before.size===BigInt(row.bytes));
  const out=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600),buffer=Buffer.alloc(262144),hash=createHash('sha256');let total=0;
  try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;need(total<=row.bytes);hash.update(buffer.subarray(0,count));let offset=0;while(offset<count){const n=fs.writeSync(out,buffer,offset,count-offset);need(n>0);offset+=n;}}
   need(total===row.bytes&&hash.digest('hex')===row.sha256);fs.fchmodSync(out,(row.mode??0)&0o100?0o500:0o400);fs.fsyncSync(out);
  }finally{fs.closeSync(out);}
  need(pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(source,{bigint:true})));verifyFile(destination,row);
 }finally{fs.closeSync(fd);}
}
function verifyFile(file:string,row:Row){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{
 const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.uid===0n&&before.nlink===1n&&!(before.mode&0o222n)&&before.size===BigInt(row.bytes!));const hash=createHash('sha256'),buffer=Buffer.alloc(262144);for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;hash.update(buffer.subarray(0,n));}
 need(hash.digest('hex')===row.sha256&&pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));
 }finally{fs.closeSync(fd);}}
/** Fixed-root data verification in the original child, before importing ANY
 * old modules. It grants no parent engine/DB capability across processes. */
export function inspectFixedHistoricalRuntimeGraph(root:string){
 need(process.platform==='linux'&&process.getuid?.()===0&&path.resolve(root)===root);const d=definitions(root),output=path.join(root,'.restored-qa-runtimes','old89dd','application');historicalRuntimeDirectory(output);
 const found=historicalRuntimeFullTree(output);need(found.size===d.rows.length);
 for(const row of d.rows){const file=path.join(output,row.path);need(found.has(row.path));const s=fs.lstatSync(file,{bigint:true});
  if(row.kind==='file')verifyFile(file,row);else if(row.kind==='directory')historicalRuntimeDirectory(file);else{need(s.isSymbolicLink()&&fs.readlinkSync(file)===row.target);const target=fs.realpathSync(file);need(target.startsWith(output+path.sep));}}
 need(JSON.stringify([...historicalRuntimeFullTree(output)])===JSON.stringify([...found]));
 return Object.freeze({kind:'OLD_89DD' as const,applicationRoot:path.join(output,'app'),sourceImage:oldImage,sourceCommit:oldSource,materialReceiptSha256:materialSha,baseInventorySha256:baseSha});
}

/** Data-only fixed materialization, no token or engine/DB authority. */
export function materializeFixedHistoricalRuntimeGraph(root:string){
 need(process.platform==='linux'&&process.getuid?.()===0&&path.resolve(root)===root);historicalRuntimeDirectory(root);
 const d=definitions(root),sourceBefore=historicalRuntimeFullTree(d.source),sourceNames=new Set<string>(d.oldFiles);
 for(const name of d.oldFiles)for(let parent=path.posix.dirname(name);parent!=='.';parent=path.posix.dirname(parent))sourceNames.add(parent);
 need(sourceBefore.size===sourceNames.size&&[...sourceBefore.keys()].every(p=>sourceNames.has(p)));
 const parent=path.join(root,'.restored-qa-runtimes');fs.mkdirSync(parent,{mode:0o700});const role=path.join(parent,'old89dd');fs.mkdirSync(role,{mode:0o700});const output=path.join(role,'application');fs.mkdirSync(output,{mode:0o700});
 for(const row of d.rows)if(row.kind==='directory')ensureDirectory(output,row.path);
 const fromBase=(row:Row)=>d.baseNames.has(row.path);
 const basePins=new Map(d.rows.filter(fromBase).map(row=>[row.path,pin(fs.lstatSync(path.join('/',row.path),{bigint:true}))]));
 const checkBase=()=>{for(const [p,identity]of basePins)need(pin(fs.lstatSync(path.join('/',p),{bigint:true}))===identity);};
 // Complete hash-verified base copy precedes EVERY old-overlay file.
 for(const basePhase of [true,false]){for(const row of d.rows.filter(r=>r.kind!=='directory'&&fromBase(r)===basePhase)){
  const file=path.join(output,row.path);
  if(row.kind==='file')copyFile(path.join(basePhase?'/':d.source,row.path),file,row);
  else{need(typeof row.target==='string');if(basePhase){const source=path.join('/',row.path),s=fs.lstatSync(source,{bigint:true});need(s.isSymbolicLink()&&s.uid===0n&&fs.readlinkSync(source)===row.target);}fs.symlinkSync(row.target,file);}
 }checkBase();
 }
 need(JSON.stringify([...historicalRuntimeFullTree(d.source)])===JSON.stringify([...sourceBefore]));
 for(const row of [...d.rows].reverse())if(row.kind==='directory')fs.chmodSync(path.join(output,row.path),0o500);fs.chmodSync(output,0o500);
 return inspectFixedHistoricalRuntimeGraph(root);
}
