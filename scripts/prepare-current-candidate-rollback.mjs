/** Bounded read-only native preparation. Never starts UP or a master. */
import assert from 'node:assert/strict';
import {createOriginalCandidateRollbackOwner} from './lib/original-candidate-rollback-owner.mjs';
assert.deepEqual(process.argv.slice(2),['--prepare-only']);
let owner;
try{owner=await createOriginalCandidateRollbackOwner();const receipt=await owner.prepareOnly();const closure=await owner.closeReadOnlyOrRestored();console.log(JSON.stringify({format:'sabalan-419-safe-rollback-preparation-result/v1',receipt,closure,upStarted:false,masterStarted:false,productionAdmission:false}));}
catch(error){process.exitCode=1;let closure=null;if(owner){try{closure=await owner.closeReadOnlyOrRestored();}catch{}}
 console.log(JSON.stringify({format:'sabalan-419-safe-rollback-preparation-result/v1',failed:true,code:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:error?.code??error?.name??'THROWN_VALUE',owner:owner?.inspect(),closure,upStarted:false,masterStarted:false,productionAdmission:false}));}
