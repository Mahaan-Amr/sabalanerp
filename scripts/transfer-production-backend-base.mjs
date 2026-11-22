import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {backendBaseIdentity,qualifiedProductionBackendExport,stableBackendBaseFile,freshBothHostBackendBasePreflight} from './lib/production-backend-base-artifacts.mjs';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
import {syncOwnedBackendBaseFile} from './lib/backend-base-owned-file.mjs';

const repository=path.resolve(import.meta.dirname,'..'),[mode='--inspect',preflightFile]=process.argv.slice(2);
assert.ok(['--inspect','--transfer'].includes(mode)&&process.argv.length<=(mode==='--inspect'?3:4));
const source=qualifiedProductionBackendExport(repository);
if(mode==='--inspect'){
  assert.equal(preflightFile,undefined);console.log(JSON.stringify({source,sshExecuted:false,dockerExecuted:false,productionAdmission:false}));
}else{
  assert.ok(preflightFile,'Pass a fresh completed BOTH-host preflight receipt.');
  const preflight=freshBothHostBackendBasePreflight(repository,preflightFile);
  const operation='production-backend-base-transfer-'+randomBytes(16).toString('hex');
  const root=path.resolve('D:/sabalanerp-online-qa',operation),archive=path.join(root,'backend.docker.tar.gz');
  const free=fs.statfsSync('D:/',{bigint:true});assert.ok(free.bavail*free.bsize>=BigInt(source.compressedBytes+512*1024**2),'LOCAL_TRANSFER_CAPACITY_REFUSED');
  fs.mkdirSync(root,{mode:0o700});assert.equal(fs.realpathSync(root),root);
  const evidence=path.join(repository,'reports/qa',operation),commands=originalBackendBaseCommands();
  const key=path.resolve('C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519'),known=path.resolve('C:/Users/mahan/.ssh/known_hosts');
  assert.equal(fs.realpathSync(key),key);const keyStat=fs.lstatSync(key,{bigint:true});assert.ok(keyStat.isFile()&&keyStat.nlink===1n);
  const keyPin=value=>['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'].map(field=>String(value[field])).join(':');
  const keyIdentity=keyPin(keyStat),knownIdentity=stableBackendBaseFile(known,4*1024**2);
  const helper=path.join(repository,'scripts/lib/production-backend-base-remote-readonly.py');
  const observer=path.join(repository,'scripts/lib/production-backend-base-observer.py');
  const helperFile=stableBackendBaseFile(helper,1024**2),observerFile=stableBackendBaseFile(observer,1024**2);
  const helperSource=fs.readFileSync(helper),observerSource=fs.readFileSync(observer);
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(helperSource),helperFile.sha256);assert.equal(sha(observerSource),observerFile.sha256);
  const helperBytes=Buffer.concat([observerSource,Buffer.from('\n'),helperSource]);
  const sshOptions=['-F',process.platform==='win32'?'NUL':'/dev/null','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none',
    '-o','PreferredAuthentications=publickey','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no',
    '-o','NumberOfPasswordPrompts=0','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,
    '-o','GlobalKnownHostsFile='+ (process.platform==='win32'?'NUL':'/dev/null'),'-o','ConnectTimeout=15','-o','ClearAllForwardings=yes'];
  const report={format:'sabalan-production-backend-base-transfer/v1',operation,phase:'INTENT',pass:false,source,preflight,root,archive,
    sourceExportReceipt:source.exportReceipt,helperFile,observerFile,remoteEnvelopeSha256:sha(helperBytes),
    sshTrust:{knownHostsFile:known,knownHostsIdentity:knownIdentity,privateKeyPath:key,privateKeyMetadata:keyIdentity},
    localImageImported:false,productionMutation:false,publicOnlineAdmission:false};
  const publish=(suffix,value)=>{const fd=fs.openSync(evidence+suffix+'.json','wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  let failure;
  try{
    publish('-intent',report);
    const before=await commands.run('ssh',['-T',...sshOptions,'root@94.182.85.254','python3 -I -B -'],{input:helperBytes});
    report.beforeCommand=before;commands.assertSuccessful(before);report.before=JSON.parse(before.stdout);
    assert.equal(report.before.format,'sabalan-backend-base-source-readonly/v1');assert.equal(report.before.allOriginalObserversClosed,true);
    assert.equal(report.before.sha256,backendBaseIdentity.compressedSha256);assert.equal(report.before.bytes,backendBaseIdentity.compressedBytes);
    const output=fs.openSync(archive,'wx',0o600);fs.closeSync(output);
    report.scp=await commands.run('scp',['-q',...sshOptions,'root@94.182.85.254:'+source.remoteArchive,archive]);
    const after=await commands.run('ssh',['-T',...sshOptions,'root@94.182.85.254','python3 -I -B -'],{input:helperBytes});
    report.afterCommand=after;commands.assertSuccessful(after);report.after=JSON.parse(after.stdout);
    assert.equal(report.after.allOriginalObserversClosed,true);assert.deepEqual(report.after.identity,report.before.identity);
    assert.deepEqual(report.after.servicesBefore,report.before.servicesBefore);assert.deepEqual(report.after.servicesAfter,report.before.servicesBefore);
    assert.equal(report.after.sha256,source.compressedSha256);assert.equal(report.after.bytes,source.compressedBytes);
    report.sourceArchiveUnchanged=true;report.productionServicesUnchanged=true;
    commands.assertSuccessful(report.scp);
    report.archiveFile=syncOwnedBackendBaseFile(archive,{bytes:source.compressedBytes,sha256:source.compressedSha256});
    assert.equal(keyPin(fs.lstatSync(key,{bigint:true})),keyIdentity);assert.deepEqual(stableBackendBaseFile(known,4*1024**2),knownIdentity);
    assert.deepEqual(stableBackendBaseFile(helper,1024**2),helperFile);assert.deepEqual(stableBackendBaseFile(observer,1024**2),observerFile);
    assert.deepEqual(qualifiedProductionBackendExport(repository),source);
    report.phase='COMPLETE';report.pass=true;
  }catch(error){failure=error;report.phase='FAILED_HELD';report.error=error instanceof Error?error.message:'BACKEND_TRANSFER_FAILED';}
  finally{report.originalChildren=await commands.close();if(report.originalChildren.interrupted){report.phase='FAILED_HELD';report.pass=false;failure??=Error('ORIGINAL_CONTROLLER_INTERRUPTED');}}
  publish('',report);console.log(JSON.stringify({evidence:evidence+'.json',archive,phase:report.phase,pass:report.pass,productionAdmission:false}));
  if(failure)throw failure;
}
