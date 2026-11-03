import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Resolved Compose configuration is private. Compare only the selected DB
 * endpoint and role in memory; never print URLs, credentials or config. */
export function validateDeploymentRoleBinding(config){
 const backend=config?.services?.backend?.environment?.DATABASE_URL,control=config?.services?.deployment?.environment?.DATABASE_URL;
 assert.equal(typeof backend,'string');assert.equal(typeof control,'string');
 const a=new URL(backend),b=new URL(control);
 for(const value of [a,b]){
  assert.ok(['postgres:','postgresql:'].includes(value.protocol));assert.ok(value.hostname&&value.username&&value.pathname.length>1&&!value.hash);
  assert.equal(value.searchParams.has('options'),false);
 }
 for(const key of ['protocol','hostname','port','pathname','username'])assert.equal(a[key],b[key],'DEPLOYMENT_ROLE_BINDING_MISMATCH');
 assert.equal(config?.services?.deployment?.environment?.BACKEND_RUNTIME_ROLE,'control');
 return Object.freeze({matched:true,scope:'COMPOSE_DB_ENDPOINT_AND_ROLE',releaseAdmission:false});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const raw=fs.readFileSync(0);if(raw.length>8*1024*1024)throw Error();validateDeploymentRoleBinding(JSON.parse(raw.toString('utf8')));}
 catch{process.stderr.write('DEPLOYMENT_ROLE_BINDING_UNPROVEN\n');process.exitCode=1;}
}
