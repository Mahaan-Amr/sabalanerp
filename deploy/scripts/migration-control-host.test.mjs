import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {runFixedMigrationKeeper,prepareNormalMigrationArchive} from './migration-control-host.mjs';
import {sanitizeProductionImageInspection,productionInspectionSha256} from './production-image-execution-binding.mjs';

function setup(mode){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'migration-host-test-'));
 const portable=directory.replaceAll('\\','/').replace(/^[A-Za-z]:/,'');
 const id='a'.repeat(64),imageId='sha256:'+'b'.repeat(64),index='sha256:'+'c'.repeat(64),layer='sha256:'+'d'.repeat(64),operation='deploy-test123';
 const graph={config:imageId,index,rootfsDiffIds:[layer]},image={Id:imageId,Descriptor:null,Os:'linux',Architecture:'amd64',RootFS:{Type:'layers',Layers:[layer]},Config:{Labels:null}};
 const nativeInspection=sanitizeProductionImageInspection(image),binding={format:'sabalan-production-image-execution-binding/v1',role:'backend',store:'classic',graph,executionImageId:imageId,nativeInspection,inspectionSha256:productionInspectionSha256(nativeInspection)};
 const projection=path.posix.join(portable,`migration-projection-${operation}.json`),url='postgresql://role:fake@postgres:5432/db';
 const resolved={services:{backend:{environment:{DATABASE_URL:url}},deployment:{image:imageId,volumes:[],environment:{DATABASE_URL:url,BACKEND_RUNTIME_ROLE:'control'}}},volumes:{}};
 const keeperCommand=['-I','-B','-c','import time; time.sleep(2147483647)'];
 const container={Id:id,Image:imageId,State:{Running:true,StartedAt:'2026-11-03T00:00:00Z'},Config:{Env:['BACKEND_RUNTIME_ROLE=control','DATABASE_URL='+url],Entrypoint:['/usr/bin/python3'],Cmd:keeperCommand},Mounts:[{Type:'bind',Source:projection,Destination:'/run/deployment-migration-projection.json',RW:false}]};
 const env={DEPLOYMENT_MIGRATION_PROJECTION_SOURCE:projection,DEPLOYMENT_ID:operation,DEPLOYMENT_RELEASE_ID:'release-test123',DEPLOYMENT_TARGET_COMMIT:'1'.repeat(40),DEPLOYMENT_LEASE_TOKEN:'fake',DEPLOYMENT_OWNER:'test-owner',DEPLOYMENT_PHASE:'MUTATION_STARTED',DEPLOYMENT_MIGRATION_DEADLINE_SECONDS:'1'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const calls=[];let observations=0;
 const command=async args=>{calls.push(args);if(args.includes('config'))return JSON.stringify(resolved);if(args.includes('run'))return id+'\n';if(args[0]==='inspect'){observations++;const value=structuredClone(container);if(mode==='replaced'&&observations===2)value.State.StartedAt='2026-11-03T01:00:00Z';if(mode==='mount')value.Mounts[0].RW=true;return JSON.stringify([value]);}if(args[0]==='image')return JSON.stringify([image]);throw Error('unexpected');};
 const original={interrupted:mode==='heartbeat',run:async(executable,args)=>{calls.push([executable,...args]);if(mode==='deadline')await new Promise(r=>setTimeout(r,1100));return {code:mode==='failure'?1:mode==='lost'?null:0,signal:null,streamError:undefined,spawnError:mode==='lost'?'LOST':undefined,outputBoundExceeded:false};}};
 const restore=()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;delete process.env.BACKEND_RUNTIME_ROLE;delete process.env.DEPLOYMENT_CONTROL_IMAGE;delete process.env.DEPLOYMENT_BACKEND_IMAGE;delete process.env.BACKEND_DB_CONNECTION_LIMIT;delete process.env.DATABASE_APPLICATION_NAME;};
 return {input:{context:{repository:directory,id:operation,image:imageId,lock:{directory:portable}},graph,binding,prefix:['compose'],command,original},calls,id,restore};
}
test('actual host sequence uses inspected ID and retains keeper after success',async()=>{
 const f=setup('success');try{await runFixedMigrationKeeper(f.input);const exec=f.calls.find(x=>x[0]==='docker'&&x[1]==='exec');assert.equal(exec[2],f.id);assert.equal(f.calls.filter(x=>x[0]==='inspect').length,2);assert.ok(!f.calls.some(x=>x.includes('rm')||x.includes('stop')));}finally{f.restore();}
});
test('separate host evidence directory preserves the Linux projection and same ID',async()=>{
 const f=setup('success'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'migration-host-receipt-'));try{
  await runFixedMigrationKeeper({...f.input,recordDirectory:directory});
  const record=JSON.parse(fs.readFileSync(path.join(directory,`migration-control-${f.input.context.id}.json`),'utf8'));
  assert.equal(record.id,f.id);const run=f.calls.find(x=>x.includes('run'));const i=run.indexOf('--volume');
  assert.equal(run[i+1],`${process.env.DEPLOYMENT_MIGRATION_PROJECTION_SOURCE}:/run/deployment-migration-projection.json:ro`);
  assert.ok(f.calls.some(x=>x[0]==='docker'&&x[1]==='exec'&&x[2]===f.id));
 }finally{f.restore();}
});
test('receipt failure after keeper creation refuses execution and retains keeper',async()=>{
 const f=setup('success'),directory=path.join(os.tmpdir(),'unavailable-'+Date.now()+'-'+Math.random());try{
  await assert.rejects(runFixedMigrationKeeper({...f.input,recordDirectory:directory}));
  assert.ok(f.calls.some(x=>x.includes('run')));assert.ok(!f.calls.some(x=>x[0]==='docker'&&x[1]==='exec'));
  assert.ok(!f.calls.some(x=>x.includes('rm')||x.includes('stop')));
 }finally{f.restore();}
});
test('changed mount, replaced incarnation, failed and lost exec, heartbeat loss or deadline never report success',async()=>{
 for(const mode of ['mount','replaced','failure','lost','heartbeat','deadline']){const f=setup(mode);try{await assert.rejects(runFixedMigrationKeeper(f.input));assert.ok(!f.calls.some(x=>x.includes('rm')||x.includes('stop')));}finally{f.restore();}}
});
test('failed pre-maintenance archive is retained and never qualified',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'migration-archive-test-'));
 const archive=path.join(directory,'partial.tar'),image='sha256:'+'b'.repeat(64);
 const context={image,repository:directory,archive,lock:{directory}};
 await assert.rejects(prepareNormalMigrationArchive(context,{Id:image,Size:128},'classic',async(_id,fd)=>{fs.writeSync(fd,Buffer.alloc(2048));}));
 assert.equal(fs.statSync(archive).size,2048);
});
