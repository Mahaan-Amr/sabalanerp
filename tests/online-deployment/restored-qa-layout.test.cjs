'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
// Explicit filesystem boundary model. No Linux root, scope, actual files,
// original child, database or native admission is created by this test.
test('layout closes the actual opened source handle when destination creation fails',()=>{
 const root='/app/runtime-authority/application-native-'+'a'.repeat(32)+'/restored-complete-app';
 const data=Buffer.from('retained business file'),source=root+'/storage/contracts/retained.txt';
 const nodes=new Map(),opened=new Map();let nextInode=1,nextFd=10,failedCopies=0;
 const directory=name=>nodes.set(name,{directory:true,ino:nextInode++,raw:Buffer.alloc(0)});
 directory(root);directory(root+'/storage');directory(root+'/storage/contracts');nodes.set(source,{directory:false,ino:nextInode++,raw:data});
 const stat=(name,big)=>{const row=nodes.get(name);assert.ok(row,name);const number=n=>big?BigInt(n):n;return{isDirectory:()=>row.directory,isSymbolicLink:()=>false,isFile:()=>!row.directory,uid:number(0),mode:number(row.directory?0o40700:0o100600),dev:number(1),ino:number(row.ino),nlink:number(1),size:number(row.raw.length),mtimeNs:number(1),ctimeNs:number(1)};};
 const fake={constants:fs.constants,realpathSync:p=>{assert.ok(nodes.has(p));return p;},existsSync:p=>nodes.has(p),mkdirSync:directory,
  lstatSync:(p,o)=>stat(p,o?.bigint),fstatSync:(fd,o)=>stat(opened.get(fd).name,o?.bigint),
  readdirSync:p=>[...nodes.keys()].filter(n=>path.posix.dirname(n)===p).map(n=>path.posix.basename(n)),
  openSync:p=>{if(p!==source){failedCopies++;throw Object.assign(Error('modeled destination full'),{code:'ENOSPC'});}const fd=nextFd++;opened.set(fd,{name:p,offset:0});return fd;},
  closeSync:fd=>assert.ok(opened.delete(fd)),
  readSync:(fd,buffer,offset,size)=>{const row=opened.get(fd),raw=nodes.get(row.name).raw,n=Math.min(size,raw.length-row.offset);raw.copy(buffer,offset,row.offset,row.offset+n);row.offset+=n;return n;},
 };
 const module={exports:{}};
 const file=new URL('../../scripts/lib/restored-qa/coherent-layout.cjs','file://'+__filename.replaceAll('\\','/'));
 const sandbox=vm.createContext({module,exports:module.exports,Buffer,process:{platform:'linux',getuid:()=>0,cwd:()=>root},require:n=>n==='node:fs'?fake:n==='node:path'?path.posix:n==='node:assert/strict'?assert:n==='node:crypto'?crypto:n==='./lineage.cjs'?require('../../scripts/lib/restored-qa/lineage.cjs'):(()=>{throw Error(n);})()});
 vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
 const context={manifest:{components:[{path:'files/contracts/retained.txt',size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')}]}};
 assert.throws(()=>module.exports.createLayout({context:vm.runInContext('('+JSON.stringify(context)+')',sandbox),view:{root},assertActive(){}}),/modeled destination full/);
 assert.equal(failedCopies,1);assert.equal(opened.size,0);
});
