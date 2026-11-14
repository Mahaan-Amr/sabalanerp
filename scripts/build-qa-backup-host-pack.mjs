/** Package only the separately reviewed QA backup owner; never provision or run it. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire, builtinModules} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=[
  'deploy/scripts/provision-qa-backup-host.sh',
  'deploy/scripts/qa-backup-preflight-client.sh',
  'deploy/scripts/qa-backup-preflight-root.sh',
  'deploy/scripts/qa-backup-retention-root.sh',
  'deploy/scripts/storage-preflight.mjs',
  'scripts/deployment-storage.mjs',
  'deploy/scripts/backup-checkpoint-retention.cjs',
];
const sourceFiles=files.slice(0,-1);
const entry='backend/src/scripts/backup-checkpoint-retention.ts';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--inspect'){
  console.log(JSON.stringify({format:'sabalan-qa-backup-host-pack-plan/v1',files,entry,
    requires:'--build --output <fresh absolute external directory>',productionAdmission:false,mutated:false}));
}else{
  assert.deepEqual(args.slice(0,2),['--build','--output']);assert.equal(args.length,3);
  assert.ok(path.isAbsolute(args[2]));const output=path.resolve(args[2]);
  const relative=path.relative(root,output);
  assert.ok(relative==='..'||relative.startsWith('..'+path.sep),'QA pack must be outside checkout');
  assert.ok(!fs.existsSync(output),'Fresh output directory required');
  const sources={};
  function read(relative){
    const file=path.resolve(root,relative),within=path.relative(root,file);
    assert.ok(within&&!within.startsWith('..'+path.sep)&&!path.isAbsolute(within));
    const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&stat.nlink===1);
    const bytes=fs.readFileSync(file);sources[relative]={bytes:bytes.length,sha256:sha(bytes)};
    return bytes;
  }
  const contents=new Map(sourceFiles.map(file=>[file,read(file)]));
  const retentionSource=read(entry).toString('utf8');
  const targetSource=read('backend/src/services/deploymentBackupRetention.ts').toString('utf8');
  assert.ok(retentionSource.includes('backupRetentionTarget(target).root')&&
    retentionSource.includes('assertOriginalBackupStorageLock(target)')&&
    targetSource.includes("QA_BACKUP_CHECKPOINT_ROOT='/srv/sabalanerp-qa-recovery/checkpoints'")&&
    targetSource.includes("QA_BACKUP_STORAGE_LOCK='/run/lock/sabalan-qa-backup-storage.lock'"),
  'QA_RETENTION_SELECTOR_REQUIRED');
  const require=createRequire(path.join(root,'backend/package.json'));
  const esbuild=require('esbuild');
  const result=await esbuild.build({absWorkingDir:root,entryPoints:[entry],bundle:true,platform:'node',target:'node18',format:'cjs',
    write:false,metafile:true,sourcemap:false,logLevel:'silent',plugins:[{name:'qa-retention-source',setup(builder){
      builder.onLoad({filter:/.*/,namespace:'file'},({path:file})=>{
        const relative=path.relative(root,file).replaceAll('\\','/');
        assert.ok(relative===entry||relative.startsWith('backend/src/services/'),'QA owner source outside retention policy');
        assert.ok(!relative.includes('/node_modules/'));const extension=path.extname(file);
        assert.ok(['.ts','.js','.json'].includes(extension));
        return {contents:read(relative).toString('utf8'),loader:extension==='.ts'?'ts':extension==='.json'?'json':'js'};
      });
    }}]});
  assert.equal(result.outputFiles.length,1);
  const builtins=new Set(builtinModules.flatMap(name=>[name,'node:'+name]));
  for(const definition of Object.values(result.metafile.outputs))for(const imported of definition.imports)
    assert.ok(imported.external&&builtins.has(imported.path),'Unpackaged QA owner dependency');
  contents.set(files.at(-1),Buffer.from(result.outputFiles[0].contents));
  for(const [file,bytes] of contents)if(file.endsWith('.sh')){
    const projected=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
    assert.ok(!projected.includes(13),'Bare CR in QA shell source');contents.set(file,projected);
  }
  fs.mkdirSync(output,{mode:0o700});const outputs={};
  for(const [relative,bytes] of contents){
    const destination=path.join(output,...relative.split('/'));
    fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
    const fd=fs.openSync(destination,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    outputs[relative]={bytes:bytes.length,sha256:sha(bytes)};
  }
  const receipt={format:'sabalan-qa-backup-host-pack/v1',productionAdmission:false,mutatedHost:false,
    sources,outputs,retentionInputs:Object.keys(result.metafile.inputs).sort(),esbuildVersion:esbuild.version};
  fs.writeFileSync(path.join(output,'qa-backup-host-pack-receipt.json'),JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({output,receipt:path.join(output,'qa-backup-host-pack-receipt.json'),files:files.length,productionAdmission:false}));
}
