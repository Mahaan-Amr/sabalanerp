/** Current read-only prerequisites under the actual native lease. Never UP. */
import fs from 'node:fs';import path from 'node:path';import {randomBytes,createHash} from 'node:crypto';
import {createOriginalCandidateRollbackOwner} from './lib/original-candidate-rollback-owner.mjs';
import {inspectOriginalCompletePreUpInputs} from './lib/original-complete-pre-up.mjs';
import {runOriginalNativeReadiness} from './lib/original-native-readiness.mjs';
const value=await runOriginalNativeReadiness({createOwner:createOriginalCandidateRollbackOwner,inspectInputs:inspectOriginalCompletePreUpInputs});
value.completeBindingFile=path.resolve('deploy/qualification/complete-source-binding.json');value.completeBindingExists=fs.existsSync(value.completeBindingFile);
if(!value.pass)process.exitCode=1;
const file=path.resolve('reports/qa/issue-419-c3-bindings-20261026/NATIVE-CURRENT-READINESS-'+randomBytes(16).toString('hex')+'.json'),raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
fs.writeFileSync(file,raw,{flag:'wx'});console.log(JSON.stringify({file,sha256:createHash('sha256').update(raw).digest('hex'),pass:value.pass,failure:value.failure??null,closure:value.closure??null,upStarted:false,masterStarted:false,productionAdmission:false}));
