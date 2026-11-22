'use strict';
// Fixed original-host content sealing. Never import an app, Prisma or signer.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const ident=s=>['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'].map(key=>String(s[key])).join(':');
const digest=value=>assert.match(value,/^[a-f0-9]{64}$/);
const exact=(value,names)=>assert.deepEqual(Object.keys(value).sort(),names.sort());
const beneath=(root,file)=>file===root||file.startsWith(root.endsWith('/')?root:root+'/');
const directoryIdentity=s=>['dev','ino','mode','uid'].map(key=>String(s[key])).join(':');
function validateInput(value){
 assert.equal(value.format,'sabalan-original-host-checkpoint-crypto/v1');assert.ok(['point','wal'].includes(value.kind));
 exact(value,['format','kind','mapping','lockFile','localKeyFile','publicKeyFile','applicationMountHosts',...(value.kind==='point'?['point']:['wal'])]);
 exact(value.mapping,['host','runtime']);
 for(const file of [value.mapping.host,value.mapping.runtime,value.lockFile,value.localKeyFile,value.publicKeyFile,...value.applicationMountHosts])assert.ok(typeof file==='string'&&file.startsWith('/')&&path.posix.normalize(file)===file&&!file.includes('\0'));
 assert.ok(value.mapping.host!=='/'&&value.mapping.runtime!=='/');assert.ok(Array.isArray(value.applicationMountHosts)&&value.applicationMountHosts.length>=1&&value.applicationMountHosts.length<=64);
 for(const key of [value.localKeyFile,value.publicKeyFile])for(const mount of value.applicationMountHosts)assert.equal(beneath(mount,key),false,'HOST_CRYPTO_KEY_MUST_NOT_BE_APP_MOUNTED');
 for(const key of [value.localKeyFile,value.publicKeyFile])assert.equal(beneath(value.mapping.host,key),false,'HOST_CRYPTO_KEY_MUST_NOT_BE_APP_MOUNTED');
 if(value.kind==='point'){exact(value.point,['componentManifestFile','componentManifestSha256','operation','outputRoot']);digest(value.point.componentManifestSha256);digest(value.point.operation);assert.equal(value.point.outputRoot,path.posix.dirname(value.point.componentManifestFile)+'/sealed-components');}
 else{exact(value.wal,['root','captureSha256','configurationSha256']);digest(value.wal.captureSha256);digest(value.wal.configurationSha256);}
 return value;
}
function pinned(file,maximum,immutable=false){
 assert.equal(fs.realpathSync(file),file);const named=fs.lstatSync(file,{bigint:true});assert.ok(named.isFile()&&named.nlink===1n&&named.uid===0n&&!(named.mode&0o077n)&&named.size>=0n&&named.size<=BigInt(maximum));if(immutable)assert.equal(named.mode&0o222n,0n);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);assert.equal(ident(fs.fstatSync(fd,{bigint:true})),ident(named));
 return {fd,named,verify(){assert.equal(ident(fs.fstatSync(fd,{bigint:true})),ident(named));assert.equal(ident(fs.lstatSync(file,{bigint:true})),ident(named));}};
}
function sync(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function publish(file,value){const raw=Buffer.from(JSON.stringify(value));const fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));return raw;}
async function run(argv=process.argv.slice(2)){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(argv.length,2);process.umask(0o077);
 const [configurationFile,configurationSha256]=argv;digest(configurationSha256);const held=[];
 const read=(file,max,immutable=false)=>{const item=pinned(file,max,immutable);held.push(item);const raw=fs.readFileSync(item.fd);item.verify();fs.fsyncSync(item.fd);return raw;};
 try{
  const configRaw=read(configurationFile,65536,true);assert.equal(sha(configRaw),configurationSha256);const config=validateInput(JSON.parse(configRaw));
  const root=fs.lstatSync(config.mapping.host,{bigint:true});assert.ok(root.isDirectory()&&root.uid===0n&&!(root.mode&0o022n));assert.equal(fs.realpathSync(config.mapping.host),config.mapping.host);
  const lock=fs.fstatSync(9,{bigint:true}),named=fs.lstatSync(config.lockFile,{bigint:true});assert.equal(fs.realpathSync(config.lockFile),config.lockFile);assert.ok(named.isFile()&&named.nlink===1n&&named.uid===0n&&named.size===0n&&!(named.mode&0o022n)&&named.dev===lock.dev&&named.ino===lock.ino);
  function active(){
   assert.equal(directoryIdentity(fs.lstatSync(config.mapping.host,{bigint:true})),directoryIdentity(root),'HOST_CRYPTO_VOLUME_CHANGED');
   const actual=fs.fstatSync(9,{bigint:true});assert.equal(actual.dev,lock.dev);assert.equal(actual.ino,lock.ino);assert.equal(ident(fs.lstatSync(config.lockFile,{bigint:true})),ident(named));
   assert.ok(fs.readFileSync('/proc/self/fdinfo/9','utf8').split('\n').some(row=>new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'+lock.ino+'\\s+0\\s+EOF\\s*$').test(row)),'HOST_CRYPTO_ORIGINAL_FD9_REQUIRED');
   for(const item of held)item.verify();
  }
  function mapped(runtime){assert.ok(typeof runtime==='string'&&path.posix.normalize(runtime)===runtime&&!runtime.includes('\0')&&beneath(config.mapping.runtime,runtime));const file=config.mapping.host+runtime.slice(config.mapping.runtime.length);assert.equal(path.posix.normalize(file),file);return file;}
  active();const passphrase=read(config.localKeyFile,65536).toString();assert.ok(passphrase.length>=32);const key=crypto.createPublicKey(read(config.publicKeyFile,65536));assert.equal(key.asymmetricKeyType,'rsa');assert.ok(key.asymmetricKeyDetails.modulusLength>=2048);
  const reservedAliases=new Set(held.map(row=>row.named.dev+':'+row.named.ino));
  assert.equal(reservedAliases.size,held.length,'HOST_CRYPTO_PRIVATE_INPUT_ALIAS');
  // Exact named key inodes cannot occur under any actual application mount.
  const decode=value=>value.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
  const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').trim().split('\n').map(row=>{const fields=row.split(' ');return{device:fields[2],root:decode(fields[3]),target:decode(fields[4])};});
  const projected=file=>{const selected=mounts.filter(row=>beneath(row.target,file)).sort((a,b)=>b.target.length-a.target.length)[0];assert.ok(selected);return{device:selected.device,file:path.posix.join(selected.root,path.posix.relative(selected.target,file))};};
  for(const mount of config.applicationMountHosts){assert.equal(fs.realpathSync(mount),mount);const app=projected(mount);for(const file of [config.localKeyFile,config.publicKeyFile]){const secret=projected(file);assert.equal(app.device===secret.device&&beneath(app.file,secret.file),false,'HOST_CRYPTO_KEY_MUST_NOT_BE_APP_MOUNTED');}}
  const publicKeyPem=key.export({type:'spki',format:'pem'}).toString(),independentPublicKeySha256=sha(key.export({type:'spki',format:'der'}));
  const codec=require('./online-release-host-crypto.cjs');
  let rows,destination,manifest,range,capture,captureRaw,configurationRaw;
  if(config.kind==='point'){
   const raw=read(mapped(config.point.componentManifestFile),64*1024**2,true);assert.equal(sha(raw),config.point.componentManifestSha256);manifest=JSON.parse(raw);require('./seal-online-checkpoint.cjs').validateManifest(manifest,config.point.operation);
   rows=manifest.sources.map(row=>({...row,outputName:row.name+'.sabrec'}));destination=config.point.outputRoot;
  }else{
   captureRaw=read(mapped(config.wal.root+'/capture-state.json'),65536);configurationRaw=read(mapped(config.wal.root+'/configuration.json'),32768,true);assert.equal(sha(captureRaw),config.wal.captureSha256);assert.equal(sha(configurationRaw),config.wal.configurationSha256);
   capture=JSON.parse(captureRaw);const configuration=JSON.parse(configurationRaw);
   assert.equal(capture.phase,'COMPLETE');assert.equal(capture.nativeReaped,true);assert.equal(capture.databaseQuiet,true);assert.equal(capture.nativeStatus,0);assert.match(capture.namespace,/^sabalan-wal-[a-f0-9]{32}$/);assert.equal(configuration.namespace,capture.namespace);assert.equal(configuration.root,config.wal.root);assert.equal(capture.configurationSha256,sha(configurationRaw));
   for(const name of ['databaseName','databaseOid','systemIdentifier','timeline','segmentBytes'])assert.equal(capture.source[name],configuration[name]);for(const name of ['startLsn','endLsn'])assert.equal(capture[name],configuration[name]);
   range={startLsn:capture.startLsn,endLsn:capture.endLsn,timeline:capture.source.timeline,segmentBytes:capture.source.segmentBytes};
   const {postgresWalSegments}=await import('../../scripts/postgres-recovery-coverage.mjs');active();const names=postgresWalSegments(range);assert.ok(names.length>=1&&names.length<=8);assert.deepEqual(capture.segments.map(row=>row.name),names);
   rows=[{path:config.wal.root+'/capture-state.json',outputName:'capture.sabrec',sha256:sha(captureRaw),bytes:captureRaw.length},...capture.segments.map(row=>{digest(row.sha256);assert.equal(row.bytes,range.segmentBytes);return{path:config.wal.root+'/wal/'+row.name,outputName:row.name+'.sabrec',sha256:row.sha256,bytes:row.bytes};})];destination=config.wal.root+'/sealed';
  }
  const output=mapped(destination),parent=path.dirname(output);assert.equal(fs.realpathSync(parent),parent);const parentStat=fs.lstatSync(parent,{bigint:true});assert.ok(parentStat.isDirectory()&&parentStat.uid===0n&&!(parentStat.mode&0o077n));fs.mkdirSync(output,{mode:0o700});sync(parent);
  const objects=[];const aliases=reservedAliases;
  for(const row of rows){
   active();const file=mapped(row.path),source=pinned(file,row.bytes);const before=source.named;assert.equal(Number(before.size),row.bytes);const alias=before.dev+':'+before.ino;assert.equal(aliases.has(alias),false);aliases.add(alias);
   try{
    assert.equal(await codec.sha256File(file),row.sha256);active();source.verify();const space=fs.statfsSync(output,{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(row.bytes)*2n+256n*1024n**2n);
    assert.match(row.outputName,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,191}$/);const cipher=output+'/'+row.outputName;
    await codec.encryptRecoveryArchiveForRecipients(file,cipher,[{keyId:'local-rollback',passphrase},{keyId:'independent-recovery',publicKeyPem}]);active();source.verify();sync(cipher);
    const check=cipher+'.local-check';await codec.decryptRecoveryArchive(cipher,check,passphrase);active();source.verify();sync(check);assert.equal(fs.statSync(check).size,row.bytes);assert.equal(await codec.sha256File(check),row.sha256);active();
    assert.equal(await codec.sha256File(file),row.sha256);active();source.verify();fs.chmodSync(cipher,0o400);sync(cipher);
    const encrypted=pinned(cipher,row.bytes+65536,true);let encryptedSha256,encryptedBytes;
    try{encryptedSha256=await codec.sha256File(cipher);active();encrypted.verify();encryptedBytes=Number(encrypted.named.size);}finally{fs.closeSync(encrypted.fd);}
    fs.unlinkSync(check);sync(output);
    if(config.kind==='point'){const {outputName,...original}=row;objects.push({...original,cipherFile:destination+'/'+outputName,cipherSha256:encryptedSha256,cipherBytes:encryptedBytes,localDecryptVerified:true});}
    else objects.push({name:row.outputName,rawSha256:row.sha256,rawBytes:row.bytes,encryptedSha256,encryptedBytes,localDecryptVerified:true});
   }finally{fs.closeSync(source.fd);}
  }
  active();let result,receiptFile;
  if(config.kind==='point'){result={format:'sabalan-online-checkpoint-components-sealed/v1',phase:'SEALED_LOCAL',operation:manifest.operation,manifestSha256:config.point.componentManifestSha256,independentPublicKeySha256,objects,independentDecryptVerified:false,remoteReadBackVerified:false,healthyRecoveryPoint:false,productionAdmission:false};receiptFile=output+'/sealed.json';}
  else{assert.equal(sha(read(mapped(config.wal.root+'/capture-state.json'),65536)),sha(captureRaw));assert.equal(sha(read(mapped(config.wal.root+'/configuration.json'),32768,true)),sha(configurationRaw));result={format:'sabalan-wal-seal/v1',phase:'SEALED',namespace:capture.namespace,captureSha256:sha(captureRaw),independentPublicKeySha256,range,source:capture.source,objects};receiptFile=output+'/seal-state.json';}
  active();const raw=publish(receiptFile,result);assert.ok(raw.length<=(config.kind==='point'?8*1024*1024:262144));active();assert.equal(sha(read(receiptFile,8*1024*1024,true)),sha(raw));process.stdout.write(raw);process.stdout.write('\n');return result;
 }finally{for(const item of held)fs.closeSync(item.fd);}
}
module.exports={validateInput,run};
if(require.main===module)run().catch(error=>{process.stderr.write(JSON.stringify({code:'ORIGINAL_HOST_CRYPTO_UNPROVEN',name:error.name})+'\n');process.exitCode=1;});
