'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),{Writable}=require('node:stream'),{pipeline}=require('node:stream/promises'),{pathToFileURL}=require('node:url');
const COMPONENT=null;
const INSPECTOR='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/scripts/lib/private-docker-image-archive.mjs',INSPECTOR_SHA='eb46c61e52f3d90b5a480fedb30cedcd8a6bad38b2e060dab4bff42f46ac3788';
const need=v=>{if(!v)throw new Error('FIXED_EXISTING_GZIP_READBACK_UNPROVEN');},sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const same=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].map(String).join(':'),portable=s=>[s.ino,s.size,s.mtimeNs,s.mode,s.nlink].map(String).join(':');
async function main(){
 need(COMPONENT&&['frontend','inquiry'].includes(COMPONENT.service));const[file,rawFile,json]=process.argv.slice(2),expected=JSON.parse(json);need(Object.keys(expected).sort().join(',')==='bytes,rootfsDiffIds,sha256');need(expected.bytes===COMPONENT.gzip.bytes&&expected.sha256===COMPONENT.gzip.sha256&&JSON.stringify(expected.rootfsDiffIds)===JSON.stringify(COMPONENT.rootfsDiffIds));
 need(path.resolve(file)===fs.realpathSync(file)&&path.resolve(rawFile)===path.resolve(COMPONENT.raw.file)&&path.resolve(rawFile)===fs.realpathSync(rawFile));
 const named=fs.lstatSync(file,{bigint:true}),rawNamed=fs.lstatSync(rawFile,{bigint:true});need(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n&&Number(named.size)===expected.bytes);need(rawNamed.isFile()&&!rawNamed.isSymbolicLink()&&rawNamed.nlink===1n&&Number(rawNamed.size)===COMPONENT.raw.bytes);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),held=fs.fstatSync(fd,{bigint:true});let rawFd;
 try{
  need(portable(named)===portable(held));rawFd=fs.openSync(rawFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const rawHeld=fs.fstatSync(rawFd,{bigint:true});need(portable(rawNamed)===portable(rawHeld));
  const compressed=crypto.createHash('sha256');let bytes=0;for await(const block of fs.createReadStream(file,{fd,autoClose:false,start:0})){bytes+=block.length;need(bytes<=expected.bytes);compressed.update(block);}need(bytes===expected.bytes&&compressed.digest('hex')===expected.sha256);
  let expandedBytes=0;const expanded=crypto.createHash('sha256'),sink=new Writable({write(block,_,done){expandedBytes+=block.length;if(expandedBytes>COMPONENT.raw.bytes)return done(new Error('RAW_BOUND'));expanded.update(block);done();}});
  await pipeline(fs.createReadStream(file,{fd,autoClose:false,start:0}),zlib.createGunzip(),sink);need(expandedBytes===COMPONENT.raw.bytes&&expanded.digest('hex')===COMPONENT.raw.sha256);
  need(sha(fs.readFileSync(INSPECTOR))===INSPECTOR_SHA);const{inspectPrivateDockerArchive}=await import(pathToFileURL(INSPECTOR));const graph=inspectPrivateDockerArchive(rawFile,COMPONENT.image);assert.deepEqual(graph,COMPONENT.archiveGraph);
  need(same(held)===same(fs.fstatSync(fd,{bigint:true}))&&same(named)===same(fs.lstatSync(file,{bigint:true}))&&same(rawHeld)===same(fs.fstatSync(rawFd,{bigint:true}))&&same(rawNamed)===same(fs.lstatSync(rawFile,{bigint:true})));
  console.log(JSON.stringify({format:'sabalan-source-a-private-local-gzip-oci/v1',service:COMPONENT.service,compressed:{file,bytes,sha256:expected.sha256},raw:{file:rawFile,bytes:graph.archiveBytes,sha256:graph.archiveSha256},archiveGraph:graph,canonicalInspectorSha256:INSPECTOR_SHA,existingRawArchiveReused:true,newRawArchiveCreated:false,regzipped:false,productionAdmission:false,healthyPointClaimed:false}));
 }finally{if(rawFd!==undefined)fs.closeSync(rawFd);fs.closeSync(fd);}
}
main().catch(error=>{console.error(JSON.stringify({format:'sabalan-source-a-private-local-gzip-oci-negative/v1',failureType:error.code||error.name}));process.exitCode=1;});
