/** Source/image binding evidence for the ordinary protected maintenance lane.
 * This never grants lease, checkpoint, migration or release authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readPrebuiltMigrationInventory} from './prebuilt-migration-inventory.mjs';
import {writeMigrationProjection} from './prebuilt-release-plan.mjs';

export function verifyNormalMigrationBinding(value){
 assert.match(value.commit,/^[a-f0-9]{40}$/);assert.match(value.tree,/^[a-f0-9]{40}$/);
 assert.match(value.sourceHash,/^[a-f0-9]{64}$/);assert.match(value.image,/^sha256:[a-f0-9]{64}$/);
 assert.equal(value.status,'','NORMAL_PROJECTION_SOURCE_DIRTY');
 assert.equal(value.commit,value.targetCommit,'NORMAL_PROJECTION_COMMIT_CHANGED');
 assert.equal(value.sourceHash,value.expectedSourceHash,'NORMAL_PROJECTION_SOURCE_CHANGED');
 assert.equal(value.observedImage,value.image,'NORMAL_PROJECTION_IMAGE_CHANGED');
 assert.equal(value.labelCommit,value.commit,'NORMAL_PROJECTION_IMAGE_COMMIT_CHANGED');
 assert.equal(value.labelSourceHash,value.sourceHash,'NORMAL_PROJECTION_IMAGE_SOURCE_CHANGED');
 return Object.freeze({applicationCommit:value.commit,applicationSourceHash:value.sourceHash,images:{backend:value.image},releaseAdmission:false});
}
function command(executable,args,cwd){
 const r=spawnSync(executable,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
 assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,0,'NORMAL_PROJECTION_COMMAND_FAILED');return r.stdout.trim();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.argv.length,3);
 const repository=process.argv[2];assert.equal(fs.realpathSync(repository),repository);assert.equal(process.cwd(),repository);
 const git=(...args)=>command('git',args,repository);
 const commit=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
 const sourceHash=await (await import(pathToFileURL(path.join(repository,'scripts/performance-source-identity.mjs')).href)).performanceSourceHash();
 const image=process.env.DEPLOYMENT_TARGET_BACKEND_IMAGE;
 assert.match(image??'',/^sha256:[a-f0-9]{64}$/);
 const observed=JSON.parse(command('docker',['image','inspect',image],repository));assert.equal(observed.length,1);
 const v=verifyNormalMigrationBinding({commit,tree,sourceHash,image,status:git('status','--porcelain','--untracked-files=all'),
  targetCommit:process.env.DEPLOYMENT_TARGET_COMMIT,expectedSourceHash:process.env.PERFORMANCE_RELEASE_SOURCE_HASH,
  observedImage:observed[0].Id,labelCommit:observed[0].Config?.Labels?.['io.sabalan.performance.source-commit'],
  labelSourceHash:observed[0].Config?.Labels?.['io.sabalan.performance.source-hash']});
 const inventory=readPrebuiltMigrationInventory(repository,commit);
 const bindingSha=createHash('sha256').update(JSON.stringify({format:'sabalan-normal-build-migration-binding/v1',commit,tree,sourceHash,image,inventorySha256:inventory.sha256})).digest('hex');
 writeMigrationProjection(repository,v,tree,bindingSha,inventory,'sabalan-build-migration-projection/v1');
}
