import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readLocalCheckpointRetentionHolds,enforceLocalCheckpointRetention} from '../services/deploymentCheckpointStorage';
import {inspectOriginalHostRemoteRetention} from '../services/deploymentRemoteRetention';
async function main(){
 const id=String(process.env.DEPLOYMENT_ID||'');assert.match(id,/^[a-zA-Z0-9_-]{8,160}$/);const root=path.join(String(process.env.RECOVERY_STORAGE_DIR||path.join(process.cwd(),'storage','recovery')),'packages');
 const [command,stage]=process.argv.slice(2);assert.ok(['BEFORE_CHECKPOINT','AFTER_CHECKPOINT'].includes(stage));
 if(command==='export-holds'){
  await fs.promises.mkdir(root,{recursive:true,mode:0o700});
  const reportRoot=String(process.env.DEPLOYMENT_REPORT_DIR||'');assert.ok(path.isAbsolute(reportRoot)&&await fs.promises.realpath(reportRoot)===reportRoot);const file=path.join(reportRoot,`retention-holds-${id}-${stage}.json`);
  const raw=Buffer.from(JSON.stringify(await readLocalCheckpointRetentionHolds(root))+'\n'),fd=await fs.promises.open(file,'wx',0o400);try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}const directory=await fs.promises.open(reportRoot,'r');try{await directory.sync();}finally{await directory.close();}process.stdout.write(JSON.stringify({file})+'\n');
 }else{assert.equal(command,'apply');const remoteRoot=String(process.env.DEPLOYMENT_REMOTE_MOUNT||'');assert.ok(path.isAbsolute(remoteRoot));const inspected=await inspectOriginalHostRemoteRetention(remoteRoot,id,root,stage as any);const result=await enforceLocalCheckpointRetention(root,remoteRoot,id,inspected);process.stdout.write(JSON.stringify({ok:true,localRetention:result})+'\n');}
}
main().catch(()=>{process.stderr.write('DEPLOYMENT_LOCAL_RETENTION_FAILED\n');process.exitCode=1;});
