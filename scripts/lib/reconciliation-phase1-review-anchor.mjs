// Validate externally reviewed data; this is not a grant of human authority.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const effects=['METADATA_OPEN_FIXED_LEASE','EXCLUSIVE_OWN_LEASE','READ_TWO_FIXED_FILES','CREATE_OWN_AUDIT_RECORDS'];
async function readBinding(scope){
 const [anchorBytes,reviewBytes,indexBytes,manifestBytes]=await Promise.all([
  readFile(path.join(root,'reconciliation-phase1-external-anchor.json')),
  readFile(path.join(root,'reconciliation-phase1-review-evidence.json')),
  readFile(path.join(root,'reconciliation-phase1-source-index.json')),
  readFile(path.join(root,'reconciliation-phase1-reviewed-intent.json')),
 ]);
 if([anchorBytes,reviewBytes,indexBytes,manifestBytes].some(x=>x.length>65536))throw Error('PHASE1_REVIEW_BOUND');
 const anchor=JSON.parse(anchorBytes),review=JSON.parse(reviewBytes);
 if(anchor.format!=='phase1-external-review/v1'||anchor.operation!==scope.operation||anchor.action!==scope.action||anchor.reviewEvidenceSha256!==hash(reviewBytes)||anchor.sourceIndexSha256!==hash(indexBytes)||anchor.manifestSha256!==hash(manifestBytes))throw Error('PHASE1_REVIEW_BINDING_INVALID');
 if(review.format!=='phase1-derived-review-transcription/v1'||review.sourceIndexSha256!==anchor.sourceIndexSha256||review.verdictScope!=='LIMITED_SOURCE_REVIEW'||review.liveExecutionAuthorized!==false||!Array.isArray(review.allowedEffects)||JSON.stringify(review.allowedEffects)!==JSON.stringify(effects))throw Error('PHASE1_REVIEW_SCOPE_INVALID');
 if(scope.operation==='TEST_ONLY'){
  const manifest=JSON.parse(manifestBytes);
  if(anchor.testOnly!==true||review.testOnly!==true||manifest.testOnly!==true||!/^[a-f0-9]{32}$/.test(manifest.runId))throw Error('PHASE1_TEST_SCOPE_INVALID');
 }
 return {manifestSha256:anchor.manifestSha256,sourceIndexSha256:anchor.sourceIndexSha256,reviewEvidenceSha256:anchor.reviewEvidenceSha256};
}
export async function readReviewedBinding(){return readBinding({operation:'a0d2baba08ec7e004d1458675799db6a',action:'READ_ONLY_AUDIT_NEW_OWN_LEASE'});}
export async function readFixtureReviewedBinding(){return readBinding({operation:'TEST_ONLY',action:'FIXTURE_AUDIT'});}
