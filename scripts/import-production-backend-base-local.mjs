import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {qualifiedProductionBackendArchive,stableBackendBaseFile,freshBothHostBackendBasePreflight} from './lib/production-backend-base-artifacts.mjs';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards,backendBaseLocalCapacity,assertBackendArchiveHasNoAliases} from './lib/production-backend-base-local-guard.mjs';
import {inspectPrivateDockerArchive} from './lib/private-docker-image-archive.mjs';
import {imageInspectionIdentity} from './lib/image-inspection-identity.mjs';
import {syncOwnedBackendBaseFile} from './lib/backend-base-owned-file.mjs';

const repository=path.resolve(import.meta.dirname,'..'),[mode='--inspect',transferReceipt,preflightFile]=process.argv.slice(2);
assert.ok(['--inspect','--load'].includes(mode));assert.equal(process.argv.length,mode==='--inspect'?4:5);
const source=qualifiedProductionBackendArchive(repository,transferReceipt);
if(mode==='--inspect')console.log(JSON.stringify({source,sourceIndex:source.source.sourceIndex,configIdentity:source.source.configIdentity,
  explicitIndexConfigMapping:true,dockerExecuted:false,productionAdmission:false}));
else{
  const preflight=freshBothHostBackendBasePreflight(repository,preflightFile),capacity=backendBaseLocalCapacity(source.source);
  const operation='production-backend-base-local-'+randomBytes(16).toString('hex'),root=path.resolve('D:/sabalanerp-online-qa',operation);
  fs.mkdirSync(root,{mode:0o700});const evidence=path.join(repository,'reports/qa',operation);
  const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
  const report={format:'sabalan-production-backend-base-local/v1',operation,root,phase:'INTENT',pass:false,source,preflight,capacity,
    explicitIndexConfigMapping:true,requestedEngineIdentity:source.source.sourceIndex,remoteConfigIdentity:source.source.configIdentity,
    serviceStarted:false,productionAdmission:false,helperFile:stableBackendBaseFile(import.meta.filename)};
  const publish=(suffix,value)=>{const fd=fs.openSync(evidence+suffix+'.json','wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  let failure;
  try{
    publish('-intent',report);report.servicesBefore=await guards.protectedIdentities();report.aliasesBefore=await guards.aliases();
    const raw=path.join(root,'backend.docker.tar');let expanded=0;
    await pipeline(fs.createReadStream(source.archive),createGunzip(),new Transform({transform(chunk,encoding,callback){
      expanded+=chunk.length;if(expanded>source.source.rawBytes)callback(Error('BACKEND_BASE_EXPANSION_REFUSED'));else callback(null,chunk);}}),
      fs.createWriteStream(raw,{flags:'wx',mode:0o600}));
    assert.equal(expanded,source.source.rawBytes);
    report.rawFile=syncOwnedBackendBaseFile(raw,{bytes:source.source.rawBytes,sha256:source.source.rawSha256});
    assert.equal(report.rawFile.bytes,source.source.rawBytes);assert.equal(report.rawFile.sha256,source.source.rawSha256);
    report.rawGraph=inspectPrivateDockerArchive(raw,source.source.sourceIndex);
    assert.equal(report.rawGraph.config,source.source.configIdentity);assert.equal(report.rawGraph.platform,source.source.sourcePlatform);
    assert.deepEqual(report.rawGraph.rootfsDiffIds,source.source.layers);
    report.noAliasArchive=assertBackendArchiveHasNoAliases(raw);
    // The known engine identity is the original OCI index, not the config.
    // No intentionally failed config lookup or tag assignment is attempted.
    backendBaseLocalCapacity(source.source);freshBothHostBackendBasePreflight(repository,preflightFile);
    await guards.status();report.load=await commands.run('docker',['load','--input',raw]);
    publish('-load-result',report.load);commands.assertSuccessful(report.load);
    const identity=imageInspectionIdentity(JSON.parse(await guards.docker(['image','inspect',source.source.sourceIndex])));
    assert.equal(identity.id,source.source.sourceIndex);assert.deepEqual(identity.layers,source.source.layers);
    assert.equal(Object.keys(identity.volumes??{}).length,0,'BACKEND_BASE_UNQUALIFIED_DECLARED_VOLUMES');
    report.image={id:identity.id,layers:identity.layers,volumes:identity.volumes};
    report.aliasesAfter=await guards.aliases();assert.deepEqual(report.aliasesAfter,report.aliasesBefore);report.noMutableAliasesCreated=true;
    assert.deepEqual(qualifiedProductionBackendArchive(repository,transferReceipt),source);
    assert.deepEqual(stableBackendBaseFile(import.meta.filename),report.helperFile);
    report.phase='COMPLETE';report.pass=true;
  }catch(error){failure=error;report.phase='FAILED_HELD';report.error=error instanceof Error?error.message:'BACKEND_BASE_IMPORT_FAILED';}
  finally{
    try{if(report.servicesBefore){report.servicesAfter=await guards.protectedIdentities();
      assert.deepEqual(report.servicesAfter,report.servicesBefore);report.protectedServicesUnchanged=true;}}
    catch(error){failure??=error;report.phase='FAILED_HELD';report.pass=false;report.postGuardError=error instanceof Error?error.message:'SERVICE_POSTGUARD_FAILED';}
    report.originalChildren=await commands.close();
    if(report.originalChildren.interrupted){failure??=Error('ORIGINAL_CONTROLLER_INTERRUPTED');report.phase='FAILED_HELD';report.pass=false;}
  }
  publish('',report);console.log(JSON.stringify({evidence:evidence+'.json',phase:report.phase,pass:report.pass,image:report.image?.id??null,productionAdmission:false}));
  if(failure)throw failure;
}
