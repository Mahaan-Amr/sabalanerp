/** Original local content-sealing executor. Keys never cross into Docker.
 * A sealed object is not independent verification, retention or admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {originalBackendBaseCommands} from './production-backend-base-process.mjs';
import {createCanonicalHostRecoveryCrypto,readPinnedHostCryptoFile,hashPinnedHostCryptoFile} from './canonical-host-recovery-crypto.mjs';
import {postgresWalSegments} from '../postgres-recovery-coverage.mjs';
import {writePrivateFileTar,extractPrivateFileTar} from './private-checkpoint-tar.mjs';
import {sourceBatchTarScript,sourceBatchAuditScript,cipherBatchExtractScript,removeOwnedTarScript} from './checkpoint-tar-transfer.mjs';
const base='D:/sabalanerp/docker-compose.local.yml';
const project='sabalanerp-local';
const services=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'].sort();
const facts=new WeakMap(),executors=new WeakSet(),sha=raw=>createHash('sha256').update(raw).digest('hex');
const format='{"Id":{{json .Id}},"Image":{{json .Image}},"StartedAt":{{json .State.StartedAt}},"Running":{{json .State.Running}},"Health":{{if (index .State "Health")}}{{json .State.Health.Status}}{{else}}null{{end}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}}}';
const parse=raw=>{try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}catch{return raw.trim().split(/\r?\n/).map(JSON.parse);}};
const stable=value=>JSON.stringify(value);
const digest=value=>assert.match(value,/^[a-f0-9]{64}$/);
const sourceInspector=`import os,sys,stat,hashlib,json
p=sys.argv[1]; assert os.path.realpath(p)==p
f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
 s=os.fstat(f); assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==os.getuid() and not s.st_mode&0o077 and s.st_size<=16*1024**3
 h=hashlib.sha256()
 while True:
  b=os.read(f,262144)
  if not b: break
  h.update(b)
 def ident(s): return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_nlink]
 assert ident(s)==ident(os.fstat(f))==ident(os.lstat(p)); os.fsync(f)
 print(json.dumps(dict(path=p,bytes=s.st_size,sha256=h.hexdigest(),identity=ident(s))))
finally: os.close(f)
`;
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function assertOriginalLocalCheckpointCryptoExecutor(executor){assert.ok(executors.has(executor),'ORIGINAL_LOCAL_CRYPTO_EXECUTOR_REQUIRED');}
export async function readOriginalLocalCheckpointCryptoCompletion(token){const value=facts.get(token);assert.ok(value,'ORIGINAL_LOCAL_CRYPTO_COMPLETION_REQUIRED');assert.equal(readPinnedHostCryptoFile(value.receiptFile,64*1024**2).sha256,value.receiptSha256);for(const row of value.hostObjects)assert.equal((await hashPinnedHostCryptoFile(row.cipherFile)).sha256,row.cipherSha256);return structuredClone(value);}
/** Enrollment occurs in the original runner with its actual inspected topology.
 * The executor independently re-inspects all ten services and the exact volume;
 * it never accepts a callback, executable, reported completion or arbitrary key. */
export async function createOriginalLocalCheckpointCrypto({directory,topology,scratch}){
 assert.equal(process.platform,'win32');assert.match(directory,/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}$/);
 assert.equal(path.resolve(scratch),scratch);assert.ok(scratch.startsWith('D:\\sabalanerp-online-qa\\')||scratch.startsWith('D:/sabalanerp-online-qa/'));
 const owner=originalBackendBaseCommands();let baseline,closed=false,active=false;
 async function census(){const result=await owner.run('docker',['compose','-f',base,'ps','--all','--format','json']);owner.assertSuccessful(result);const rows=parse(result.stdout);assert.equal(rows.length,10);assert.deepEqual(rows.map(row=>row.Service).sort(),services);for(const row of rows)assert.equal(row.Project,project);return rows;}
 async function inspect(){const rows=await census();const result=await owner.run('docker',['inspect','--format',format,...rows.map(row=>row.ID??row.Name)]);owner.assertSuccessful(result);const actual=parse(result.stdout);assert.equal(actual.length,10);return Object.fromEntries(actual.map(row=>{assert.equal(row.Labels['com.docker.compose.project'],project);assert.equal(row.Running,true);assert.equal(row.Health,'healthy');return[row.Labels['com.docker.compose.service'],row];}));}
 baseline=await inspect();
 for(const [role,service]of [['main','backend-retained'],['candidate','backend-candidate']]){assert.equal(baseline[service].Id,topology[role].containerId);assert.equal(baseline[service].Image,topology[role].image);}
 const backend=baseline['backend-retained'];const mount=backend.Mounts.find(row=>row.Destination==='/app/online-runtime-acceptance');
 assert.ok(mount&&mount.Type==='volume'&&mount.RW&&mount.Name==='sabalanerp-local_online_runtime_acceptance');
 async function guard(){assert.equal(closed,false);assert.equal(stable(await inspect()),stable(baseline),'LOCAL_CRYPTO_SERVICE_OR_MOUNT_DRIFT');}
 async function docker(args,options){await guard();const result=await owner.run('docker',args,options);
  if(result.code!==0||result.signal!==null){save(path.join(root,'failed-command-'+randomBytes(16).toString('hex')+'.json'),{args,code:result.code,signal:result.signal,stderr:result.stderr,stdoutSha256:sha(Buffer.from(result.stdout))});}
  owner.assertSuccessful(result);return result.stdout;}
 const root=path.join(scratch,'host-crypto-'+randomBytes(16).toString('hex'));fs.mkdirSync(root,{mode:0o700});
 const user=await owner.run('whoami',['/user','/fo','csv','/nh'],{maximum:65536});owner.assertSuccessful(user);
 const sid=user.stdout.match(/S-1-[0-9-]+/g);assert.equal(sid?.length,1,'HOST_CRYPTO_ACCOUNT_SID_REQUIRED');
 const secured=await owner.run('icacls',[root,'/inheritance:r','/grant:r','*'+sid[0]+':(OI)(CI)F'],{maximum:65536});owner.assertSuccessful(secured);
 const canonical=await createCanonicalHostRecoveryCrypto({root});
 const passphrase=randomBytes(48).toString('base64');
 const localKeyFile=path.join(root,'local-rollback.key');
 const publicKeyFile='D:/sabalanerp-online-qa/independent-recovery-public-key-20261020.pem';
 const publicPin=readPinnedHostCryptoFile(publicKeyFile,65536);
 assert.equal(publicPin.sha256,'fe5bebc32890c667e085a1e4284a25c968761d8de0e511e5b46eaa0bde511139','ACTUAL_INDEPENDENT_PUBLIC_KEY_REQUIRED');
 const publicKeyPem=publicPin.raw.toString(),publicKey=createPublicKey(publicKeyPem);
 assert.equal(publicKey.asymmetricKeyType,'rsa');assert.ok(publicKey.asymmetricKeyDetails.modulusLength>=3072);
 const fd=fs.openSync(localKeyFile,'wx',0o600);try{fs.writeFileSync(fd,passphrase);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.chmodSync(localKeyFile,0o400);
 const publicKeySha256=sha(publicKey.export({type:'spki',format:'der'}));
 const keyPins=[localKeyFile,publicKeyFile].map(file=>({file,...readPinnedHostCryptoFile(file,65536)}));
 function remotePath(file){assert.ok(typeof file==='string'&&file.startsWith(directory+'/')&&!file.includes('\0'));assert.equal(path.posix.normalize(file),file);return file;}
 async function remotePin(file){return JSON.parse(await docker(['exec',backend.Id,'python3','-I','-B','-c',sourceInspector,remotePath(file)],{maximum:65536}));}
 async function copySource(file,hostFile,expected,maximum=16*1024**3){const before=await remotePin(file);assert.ok(before.bytes<=maximum,'LOCAL_CRYPTO_SOURCE_BOUND');if(expected){assert.equal(before.bytes,expected.bytes);assert.equal(before.sha256,expected.sha256);}const space=fs.statfsSync(root,{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(before.bytes)*3n+256n*1024n**2n,'LOCAL_CRYPTO_HOST_CAPACITY_REFUSED');await docker(['cp',backend.Id+':'+file,hostFile]);const actual=await hashPinnedHostCryptoFile(hostFile);assert.equal(actual.bytes,before.bytes);assert.equal(actual.sha256,before.sha256);assert.deepEqual(await remotePin(file),before);return before;}
 const executor=Object.freeze({async seal({componentManifestFile,componentManifestSha256}){
  assert.equal(active,false);active=true;digest(componentManifestSha256);
  try{
   const sequence=randomBytes(16).toString('hex'),manifestHost=path.join(root,sequence+'-manifest.json');
   await copySource(remotePath(componentManifestFile),manifestHost,undefined,64*1024**2);const manifestRaw=readPinnedHostCryptoFile(manifestHost,64*1024**2);assert.equal(manifestRaw.sha256,componentManifestSha256);
   const manifest=JSON.parse(manifestRaw.raw);const {validateManifest}=createRequire(import.meta.url)('../../deploy/scripts/seal-online-checkpoint.cjs');validateManifest(manifest,manifest.operation);digest(manifest.operation);
   const remoteOutput=directory+'/host-sealed-'+sequence;
   await docker(['exec',backend.Id,'python3','-I','-B','-c','import os,sys;os.mkdir(sys.argv[1],0o700)',remoteOutput]);
   const hostObjects=[],objects=[],transportBatches=[];
   async function direct(row,index){
    remotePath(row.path);const local=path.join(root,sequence+'-'+index+'.plain');const original=await copySource(row.path,local,row);
    const sealed=await canonical.seal({source:local,destination:path.join(root,sequence+'-'+index+'.sabrec'),bytes:row.bytes,sha256:row.sha256,passphrase,publicKeyPem});
    assert.deepEqual(await remotePin(row.path),original);
    const remoteCipher=remoteOutput+'/'+row.name+'.sabrec';await docker(['cp',sealed.cipherFile,backend.Id+':'+remoteCipher]);
    await docker(['exec',backend.Id,'python3','-I','-B','-c','import os,sys;os.chmod(sys.argv[1],0o400)',remoteCipher]);
    const copied=await remotePin(remoteCipher);assert.equal(copied.bytes,sealed.cipherBytes);assert.equal(copied.sha256,sealed.cipherSha256);
    hostObjects.push({...sealed,source:row.path,sourceIdentity:original.identity});objects.push({...row,cipherFile:remoteCipher,cipherSha256:sealed.cipherSha256,cipherBytes:sealed.cipherBytes,localDecryptVerified:true});
    fs.unlinkSync(local);
   }
   for(const row of manifest.sources)remotePath(row.path);
   let first=0,batchNumber=0;
   while(first<manifest.sources.length){
    // USTAR cannot encode an >=8GiB member. Preserve the original direct path
    // for that single large source; normal objects use bounded batch custody.
    if(manifest.sources[first].bytes>=8*1024**3-65536){await direct(manifest.sources[first],first++);continue;}
    let end=first,total=0;while(end<manifest.sources.length&&end-first<512){const bytes=manifest.sources[end].bytes;if(bytes>=8*1024**3-65536||end>first&&total+bytes>256*1024**2)break;total+=bytes;end++;}
    const selected=manifest.sources.slice(first,end),tag=sequence+'-batch-'+batchNumber++,remoteTar=remoteOutput+'/'+tag+'-source.tar';
    const original=JSON.parse(await docker(['exec','-i',backend.Id,'python3','-I','-B','-c',sourceBatchTarScript],{input:JSON.stringify({root:directory,output:remoteTar,rows:selected}),maximum:512*1024}));
    assert.equal(original.snapshots.length,selected.length);const localTar=path.join(root,tag+'-source.tar');await copySource(remoteTar,localTar,original);
    const localEntries=selected.map((row,index)=>({name:'row-'+String(index).padStart(6,'0'),file:path.join(root,tag+'-'+index+'.plain'),bytes:row.bytes,sha256:row.sha256}));
    await extractPrivateFileTar({archive:localTar,entries:localEntries});
    assert.equal((await docker(['exec','-i',backend.Id,'python3','-I','-B','-c',removeOwnedTarScript],{input:JSON.stringify({root:directory,file:remoteTar,bytes:original.bytes,sha256:original.sha256})})).trim(),'OWNED_TAR_REMOVED');
    fs.chmodSync(localTar,0o600);fs.unlinkSync(localTar);
    const cipherEntries=[],remoteRows=[];
    for(const [index,row]of selected.entries()){
     const sealed=await canonical.seal({source:localEntries[index].file,destination:path.join(root,sequence+'-'+(first+index)+'.sabrec'),bytes:row.bytes,sha256:row.sha256,passphrase,publicKeyPem});
     const remoteCipher=remoteOutput+'/'+row.name+'.sabrec';
     hostObjects.push({...sealed,source:row.path,sourceIdentity:original.snapshots[index]});objects.push({...row,cipherFile:remoteCipher,cipherSha256:sealed.cipherSha256,cipherBytes:sealed.cipherBytes,localDecryptVerified:true});
     cipherEntries.push({name:'row-'+String(index).padStart(6,'0')+'.sabrec',file:sealed.cipherFile,bytes:sealed.cipherBytes,sha256:sealed.cipherSha256});remoteRows.push({path:remoteCipher,bytes:sealed.cipherBytes,sha256:sealed.cipherSha256});fs.unlinkSync(localEntries[index].file);
    }
    const cipherTar=path.join(root,tag+'-cipher.tar');const space=fs.statfsSync(root,{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(cipherEntries.reduce((sum,row)=>sum+row.bytes+1024,0))+256n*1024n**2n);
    await writePrivateFileTar({archive:cipherTar,entries:cipherEntries});const cipherPin=await hashPinnedHostCryptoFile(cipherTar),remoteCipherTar=remoteOutput+'/'+tag+'-cipher.tar';
    await docker(['cp',cipherTar,backend.Id+':'+remoteCipherTar]);
    await docker(['exec',backend.Id,'python3','-I','-B','-c','import os,sys;os.chmod(sys.argv[1],0o400)',remoteCipherTar]);
    const readback=JSON.parse(await docker(['exec','-i',backend.Id,'python3','-I','-B','-c',cipherBatchExtractScript],{input:JSON.stringify({root:directory,archive:remoteCipherTar,archiveBytes:cipherPin.bytes,archiveSha256:cipherPin.sha256,rows:remoteRows}),maximum:65536}));assert.equal(readback.files,selected.length);assert.equal(readback.fullCipherReadbackVerified,true);
    assert.equal((await docker(['exec','-i',backend.Id,'python3','-I','-B','-c',sourceBatchAuditScript],{input:JSON.stringify({root:directory,rows:selected,snapshots:original.snapshots})})).trim(),'ORIGINAL_BATCH_SOURCES_UNCHANGED');
    assert.equal((await docker(['exec','-i',backend.Id,'python3','-I','-B','-c',removeOwnedTarScript],{input:JSON.stringify({root:directory,file:remoteCipherTar,bytes:cipherPin.bytes,sha256:cipherPin.sha256})})).trim(),'OWNED_TAR_REMOVED');
    fs.unlinkSync(cipherTar);transportBatches.push({files:selected.length,sourceArchiveSha256:original.sha256,cipherArchiveSha256:cipherPin.sha256,fullSourceReadbackVerified:true,fullCipherReadbackVerified:true});first=end;
   }
   for(const key of keyPins)assert.equal(readPinnedHostCryptoFile(key.file,65536).sha256,key.sha256);canonical.revalidate();await guard();
   const result={format:'sabalan-online-checkpoint-components-sealed/v1',phase:'SEALED_LOCAL',operation:manifest.operation,manifestSha256:componentManifestSha256,independentPublicKeySha256:publicKeySha256,objects,independentDecryptVerified:false,remoteReadBackVerified:false,healthyRecoveryPoint:false,productionAdmission:false};
   const receiptFile=path.join(root,sequence+'-sealed.json');save(receiptFile,result);const receipt=readPinnedHostCryptoFile(receiptFile);
   const runtimeReceipt=remoteOutput+'/sealed.json';await docker(['cp',receiptFile,backend.Id+':'+runtimeReceipt]);await docker(['exec',backend.Id,'python3','-I','-B','-c','import os,sys;os.chmod(sys.argv[1],0o400)',runtimeReceipt]);assert.equal((await remotePin(runtimeReceipt)).sha256,receipt.sha256);
   const token=Object.freeze({});facts.set(token,{result,receiptFile,receiptSha256:receipt.sha256,runtimeReceipt,hostObjects,transportBatches,canonicalCrypto:canonical.provenance,keys:{localKeyFile,publicKeyFile,publicKeySha256},mapping:{containerId:backend.Id,image:backend.Image,startedAt:backend.StartedAt,mount},originalCommandsClosed:true});return token;
  }finally{active=false;}
 },async sealWal({root:runtimeRoot,captureSha256,configurationSha256}){
  assert.equal(active,false);active=true;digest(captureSha256);digest(configurationSha256);remotePath(runtimeRoot);
  try{
   const sequence=randomBytes(16).toString('hex'),captureFile=runtimeRoot+'/capture-state.json',configurationFile=runtimeRoot+'/configuration.json';
   const captureHost=path.join(root,sequence+'-capture.json'),configurationHost=path.join(root,sequence+'-configuration.json');
   const capturePin=await copySource(captureFile,captureHost,undefined,65536),configurationPin=await copySource(configurationFile,configurationHost,undefined,32768);
   assert.equal(capturePin.sha256,captureSha256);assert.equal(configurationPin.sha256,configurationSha256);
   const capture=JSON.parse(readPinnedHostCryptoFile(captureHost,65536).raw),configuration=JSON.parse(readPinnedHostCryptoFile(configurationHost,32768).raw);
   assert.equal(capture.phase,'COMPLETE');assert.equal(capture.nativeReaped,true);assert.equal(capture.databaseQuiet,true);assert.equal(capture.nativeStatus,0);
   assert.match(capture.namespace,/^sabalan-wal-[a-f0-9]{32}$/);assert.equal(capture.namespace,configuration.namespace);assert.equal(configuration.root,runtimeRoot);assert.equal(capture.configurationSha256,configurationSha256);
   for(const key of ['databaseName','databaseOid','systemIdentifier','timeline','segmentBytes'])assert.equal(capture.source[key],configuration[key]);
   for(const key of ['startLsn','endLsn'])assert.equal(capture[key],configuration[key]);
   const range={startLsn:capture.startLsn,endLsn:capture.endLsn,timeline:capture.source.timeline,segmentBytes:capture.source.segmentBytes};
   const expected=postgresWalSegments(range);assert.ok(expected.length>=1&&expected.length<=8);assert.deepEqual(capture.segments.map(row=>row.name),expected);
   const destination=runtimeRoot+'/sealed';await docker(['exec',backend.Id,'python3','-I','-B','-c','import os,sys;os.mkdir(sys.argv[1],0o700)',destination]);
   const rows=[{path:captureFile,name:'capture.sabrec',sha256:captureSha256,bytes:capturePin.bytes},...capture.segments.map(row=>{digest(row.sha256);assert.equal(row.bytes,range.segmentBytes);return{...row,path:runtimeRoot+'/wal/'+row.name,name:row.name+'.sabrec'};})];
   const objects=[],hostObjects=[];
   for(const [index,row]of rows.entries()){
    const local=path.join(root,sequence+'-wal-'+index+'.plain');const pin=await copySource(row.path,local,row);
    const sealed=await canonical.seal({source:local,destination:path.join(root,sequence+'-wal-'+index+'.sabrec'),bytes:row.bytes,sha256:row.sha256,passphrase,publicKeyPem});
    assert.deepEqual(await remotePin(row.path),pin);const remote=destination+'/'+row.name;
    await docker(['cp',sealed.cipherFile,backend.Id+':'+remote]);await docker(['exec',backend.Id,'python3','-I','-B','-c','import os,sys;os.chmod(sys.argv[1],0o400)',remote]);
    const actual=await remotePin(remote);assert.equal(actual.bytes,sealed.cipherBytes);assert.equal(actual.sha256,sealed.cipherSha256);
    objects.push({name:row.name,rawSha256:row.sha256,rawBytes:row.bytes,encryptedSha256:sealed.cipherSha256,encryptedBytes:sealed.cipherBytes,localDecryptVerified:true});hostObjects.push(sealed);fs.unlinkSync(local);
   }
   assert.deepEqual(await remotePin(captureFile),capturePin);assert.deepEqual(await remotePin(configurationFile),configurationPin);canonical.revalidate();for(const key of keyPins)assert.equal(readPinnedHostCryptoFile(key.file,65536).sha256,key.sha256);
   const result={format:'sabalan-wal-seal/v1',phase:'SEALED',namespace:capture.namespace,captureSha256,independentPublicKeySha256:publicKeySha256,range,source:capture.source,objects};
   const receiptFile=path.join(root,sequence+'-wal-sealed.json');save(receiptFile,result);const receipt=readPinnedHostCryptoFile(receiptFile),runtimeReceipt=destination+'/seal-state.json';
   await docker(['cp',receiptFile,backend.Id+':'+runtimeReceipt]);await docker(['exec',backend.Id,'python3','-I','-B','-c','import os,sys;os.chmod(sys.argv[1],0o400)',runtimeReceipt]);assert.equal((await remotePin(runtimeReceipt)).sha256,receipt.sha256);await guard();
   const token=Object.freeze({});facts.set(token,{result,receiptFile,receiptSha256:receipt.sha256,runtimeReceipt,hostObjects,canonicalCrypto:canonical.provenance,keys:{localKeyFile,publicKeyFile,publicKeySha256},mapping:{containerId:backend.Id,image:backend.Image,startedAt:backend.StartedAt,mount},originalCommandsClosed:true});return token;
  }finally{active=false;}
 },async close(){assert.equal(active,false);await guard();const result=await owner.close();closed=true;return result;}});
 executors.add(executor);return executor;
}
