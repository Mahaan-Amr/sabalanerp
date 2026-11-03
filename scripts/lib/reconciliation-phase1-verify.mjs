import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Verification is a pathname snapshot; callers must separately establish
// any source-to-execution/ancestor boundary required for real effects.
export async function verifyPhase1Manifest({root,manifestFile,expectedDigest,format,operation,action,targets,sources}) {
 if(!/^[a-f0-9]{64}$/.test(expectedDigest))throw Error('PHASE1_MANIFEST_ANCHOR_MISSING');
 const raw=await readFile(manifestFile);if(raw.length>65536||hash(raw)!==expectedDigest)throw Error('PHASE1_MANIFEST_DIGEST_MISMATCH');
 const data=JSON.parse(raw);
 if(data.format!==format||data.operation!==operation||data.action!==action||!Array.isArray(data.allowedTargets)||JSON.stringify(data.allowedTargets)!==JSON.stringify(targets)||!Array.isArray(data.sources)||data.sources.length!==sources.length)throw Error('PHASE1_MANIFEST_INVALID');
 for(let i=0;i<sources.length;i++){
  const item=data.sources[i];if(item.path!==sources[i]||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('PHASE1_SOURCE_LIST_INVALID');
  const file=path.join(root,...item.path.split('/'));const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||hash(await readFile(file))!==item.sha256)throw Error('PHASE1_SOURCE_DIGEST_MISMATCH');
 }
 return {manifestDigest:expectedDigest,sourceToExecution:'NONATOMIC_PATH_SNAPSHOT'};
}
