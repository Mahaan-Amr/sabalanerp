'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(root,start,exclude,maxFiles,maxBytes){
 const rows=[];let bytes=0;const identity=s=>[process.platform==='win32'?0n:s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].map(String).join(':');
 function visit(relative){if(exclude.includes(relative))return;const name=root+'/'+relative,s=fs.lstatSync(name,{bigint:true});
  if(s.isSymbolicLink()){const target=fs.readlinkSync(name);assert.ok(fs.realpathSync(name).startsWith(root+'/'));rows.push({path:relative,kind:'SYMLINK',target,sha256:sha(Buffer.from(target))});assert.equal(identity(fs.lstatSync(name,{bigint:true})),identity(s));return;}
  if(s.isDirectory()){const names=fs.readdirSync(name).sort();assert.ok(names.length<=50000);for(const child of names)visit(relative+'/'+child);assert.deepEqual(fs.readdirSync(name).sort(),names);assert.equal(identity(fs.lstatSync(name,{bigint:true})),identity(s));return;}
  assert.ok(s.isFile()&&s.nlink===1n&&s.size<=268435456n);const fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let count=0;const h=crypto.createHash('sha256'),buffer=Buffer.alloc(262144);
  try{assert.equal(identity(fs.fstatSync(fd,{bigint:true})),identity(s));for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n));count+=n;}assert.equal(identity(fs.fstatSync(fd,{bigint:true})),identity(s));assert.equal(identity(fs.lstatSync(name,{bigint:true})),identity(s));}finally{fs.closeSync(fd);}
  bytes+=count;assert.ok(rows.length<maxFiles&&bytes<=maxBytes);rows.push({path:relative,bytes:count,sha256:h.digest('hex'),executable:Number(s.mode&73n)});
 }
 visit(start);rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return{files:rows.length,bytes,sha256:sha(Buffer.from(JSON.stringify(rows))),entries:rows};
}
exports.inventory=inventory;
exports.verify=function(root,expected){
 assert.equal(expected.format,'sabalan-production-inquiry-legacy-code/v1');if(expected.sourceSnapshot){const source=expected.sourceSnapshot;assert.equal(source.format,'sabalan-measured-inquiry-source/v1');assert.match(source.engineImage,/^sha256:[a-f0-9]{64}$/);assert.match(source.baselineSha256,/^[a-f0-9]{64}$/);assert.match(source.deployedHead,/^[a-f0-9]{40}$/);assert.match(source.containerId,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(source.startedAt)));assert.match(expected.frameworkBuildId,/^[A-Za-z0-9_-]{1,200}$/);}else assert.equal(expected.frameworkBuildId,'KQravWuGMIUURyrEIN-mE');assert.equal(expected.knownBusinessSourceCommit,null);
 assert.equal(fs.readFileSync(root+'/.next/BUILD_ID','utf8').trim(),expected.frameworkBuildId,'LEGACY_NATIVE_BUILD_ID_CHANGED');
 const compiled=inventory(root,'.next',['.next/cache'],30000,1073741824);assert.deepEqual(compiled,expected.compiled,'LEGACY_COMPILED_BYTES_CHANGED');
 assert.deepEqual(inventory(root,'public',[],10000,536870912),expected.publicFiles,'LEGACY_PUBLIC_BYTES_CHANGED');
 const dependencies=inventory(root,'node_modules',['node_modules/.cache'],100000,2147483648);delete dependencies.entries;assert.deepEqual(dependencies,expected.dependencies,'LEGACY_DEPENDENCIES_CHANGED');
 for(const row of expected.configFiles){const raw=fs.readFileSync(path.join(root,row.path));assert.equal(raw.length,row.bytes);assert.equal(sha(raw),row.sha256);}
 for(const row of expected.schemaFiles){const raw=fs.readFileSync(path.join(root,row.path));assert.equal(raw.toString('base64'),row.rawBase64);assert.equal(sha(raw),row.sha256);}
 const required=JSON.parse(fs.readFileSync(root+'/.next/required-server-files.json'));assert.equal(required.config.deploymentId||null,expected.deploymentId);
 const manifest=JSON.parse(fs.readFileSync(root+'/.next/server/server-reference-manifest.json'));assert.deepEqual([...new Set([...Object.keys(manifest.node||{}),...Object.keys(manifest.edge||{})])].sort(),expected.actionIds);
 return{format:'sabalan-legacy-inquiry-compiled-preservation/v1',frameworkBuildId:expected.frameworkBuildId,compiledSha256:compiled.sha256,dependenciesSha256:dependencies.sha256,legacyBusinessSource:{kind:'COMPILED_IMAGE',image:expected.sourceSnapshot?.engineImage??'sha256:ab6e2933e2d0d397f0b1a514dba69206e21856fa7d4275ab33383020bf9dd66e',sourceCommit:null,...(expected.sourceSnapshot?{sourceSnapshot:expected.sourceSnapshot}:{})},productionAdmission:false};
};
if(require.main===module){assert.equal(process.argv.length,3);process.stdout.write(JSON.stringify(exports.verify('/app',JSON.parse(fs.readFileSync(process.argv[2]))))+'\n');}
