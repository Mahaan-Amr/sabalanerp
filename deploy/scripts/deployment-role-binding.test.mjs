import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateDeploymentRoleBinding} from './deployment-role-binding.mjs';

const config=()=>({services:{backend:{environment:{DATABASE_URL:'postgresql://fixture:private-secret@postgres:5432/erp?connection_limit=10'}},deployment:{environment:{DATABASE_URL:'postgresql://fixture:private-secret@postgres:5432/erp?connection_limit=2',BACKEND_RUNTIME_ROLE:'control'}}}});
test('resolved control and serving DB endpoint and role match without disclosing credentials',()=>{
 const c=config();assert.equal(validateDeploymentRoleBinding(c).matched,true);
 c.services.deployment.environment.DATABASE_URL='postgresql://different:private-secret@postgres:5432/erp';
 assert.throws(()=>validateDeploymentRoleBinding(c));
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./deployment-role-binding.mjs',import.meta.url))],{input:JSON.stringify(c),encoding:'utf8'});
 assert.equal(result.status,1);assert.doesNotMatch(result.stderr+result.stdout,/private-secret|postgresql:/);assert.match(result.stderr,/DEPLOYMENT_ROLE_BINDING_UNPROVEN/);
});
test('missing URLs, other database, unsafe options and non-control role fail closed',()=>{
 for(const mutate of [c=>delete c.services.backend.environment.DATABASE_URL,c=>{c.services.deployment.environment.DATABASE_URL='postgresql://fixture:secret@postgres/other';},c=>{c.services.deployment.environment.DATABASE_URL+='&options=bad';},c=>{c.services.deployment.environment.BACKEND_RUNTIME_ROLE='serving';}]){
  const c=config();mutate(c);assert.throws(()=>validateDeploymentRoleBinding(c));
 }
});
