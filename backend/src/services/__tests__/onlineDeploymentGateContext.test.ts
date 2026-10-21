import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyOnlineDeploymentGateContext,readOnlineGateCatalogIdentity} from '../onlineDeploymentGateContext';
import {completeOnlinePrivateQualificationPrerequisite,completeReleaseDeploymentGateReport} from '../deploymentGates';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=(v:any)=>Buffer.from(JSON.stringify(canonical(v)));
const h=(c:string)=>c.repeat(64),now=Date.now(),pair=generateKeyPairSync('ed25519');
const decision=()=>({format:'sabalan-original-online-deployment-gates/v1',deploymentId:'deployment-current',releaseId:'release-next',manifestSha256:h('a'),checkpointSha256:h('b'),
  issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),targets:Object.fromEntries(['backend','frontend','inquiry','nginx'].map((role,i)=>[role,
    {containerId:h(String(i+1)),image:'sha256:'+h(String(i+2)),startedAt:'2026-10-20T00:00:00.000Z',url:'http://172.20.0.'+(i+2)+':'+[5000,3000,3001,80][i]+(role==='backend'?'/api/ready':role==='nginx'?'/healthz':'/')}]))});
function signed(d:any){return encode({format:'sabalan-signed-online-deployment-gates/v1',decision:d,signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-online-deployment-gates/v1\n'),encode(d)]),pair.privateKey).toString('base64')});}
const pub=pair.publicKey.export({format:'pem',type:'spki'}) as Buffer;
test('original signed gate context binds actual release and private endpoint quartet',()=>{
 const d=decision(),raw=signed(d);assert.deepEqual(verifyOnlineDeploymentGateContext(raw,pub,{deploymentId:d.deploymentId,releaseId:d.releaseId},now).decision,d);
 assert.throws(()=>verifyOnlineDeploymentGateContext(raw,pub,{deploymentId:d.deploymentId,releaseId:'other-release'},now));
 const tampered=JSON.parse(raw.toString());tampered.decision.targets.backend.url='http://172.20.0.99:5000/api/ready';assert.throws(()=>verifyOnlineDeploymentGateContext(encode(tampered),pub,d,now));
 for(const url of ['https://172.20.0.2/api/ready','http://example.com/api/ready','http://172.20.0.2/api/ready?override=1']){const bad=decision();bad.targets.backend.url=url;assert.throws(()=>verifyOnlineDeploymentGateContext(signed(bad),pub,bad,now));}
 assert.throws(()=>verifyOnlineDeploymentGateContext(raw,pub,d,now+60001));
});
test('ONLINE private prerequisite never qualifies production gates or accepts protected substitution',()=>{
 const qualificationReports=Object.fromEntries(['compatible-migrations','coherent-independent-restore','browser-24-hours','single-worker-and-completion','current-domain'].map(name=>[name,h('c')]));
 const expected={releaseId:'release-next',manifestSha256:h('a'),checkpointSha256:h('b'),captureId:h('d'),qualificationReports};
 const row={format:'sabalan-online-private-qualification-prerequisite/v1',...expected,publicTrafficQualified:false};
 assert.equal(completeOnlinePrivateQualificationPrerequisite(row,expected),true);assert.equal(completeReleaseDeploymentGateReport(row),false);
 for(const changed of [{captureId:h('e')},{checkpointSha256:h('e')},{publicTrafficQualified:true},{format:'sabalan-protected-private-qualification-prerequisite/v1'},{qualificationReports:{...qualificationReports,'current-domain':h('f')}}])
  assert.equal(completeOnlinePrivateQualificationPrerequisite({...row,...changed},expected),false);
});

test('signed current control runner remains distinct from old serving target and rejects untyped provenance',()=>{
 const d:any=decision();d.releaseId='release_old';d.controlRunner={format:'sabalan-original-online-gate-control-runner/v1',releaseId:'release_attempted',sourceCommit:'e'.repeat(40),image:'sha256:'+h('f'),imageInspectionSha256:h('1'),schemaSha256:h('2'),migrationCatalogSha256:h('3'),migrationLedgerSha256:h('4')};
 assert.deepEqual(verifyOnlineDeploymentGateContext(signed(d),pub,d,now).decision,d);
 assert.notEqual(d.controlRunner.image,d.targets.backend.image);
 for(const mutate of [(v:any)=>{v.controlRunner.capability='private';},(v:any)=>{delete v.controlRunner.migrationLedgerSha256;},(v:any)=>{v.controlRunner.schemaSha256='not-a-hash';},(v:any)=>{v.controlRunner.sourceCommit='mutable-tag';}]){
  const changed=structuredClone(d);mutate(changed);assert.throws(()=>verifyOnlineDeploymentGateContext(signed(changed),pub,changed,now));
 }
 const tampered=JSON.parse(signed(d).toString());tampered.decision.controlRunner.image=d.targets.backend.image;assert.throws(()=>verifyOnlineDeploymentGateContext(encode(tampered),pub,d,now));
});

test('real immutable Prisma catalog measurement binds schema and every migration byte and refuses hardlinks/extra files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-gate-catalog-')),migration=path.join(root,'migrations','20261021000000_base');
 try{
  fs.mkdirSync(migration,{recursive:true});fs.writeFileSync(path.join(root,'schema.prisma'),'model Example { id Int @id }\n');
  fs.writeFileSync(path.join(root,'migrations','migration_lock.toml'),'provider = "postgresql"\n');
  const sql=path.join(migration,'migration.sql');fs.writeFileSync(sql,'CREATE TABLE example(id integer PRIMARY KEY);\n');
  const first=readOnlineGateCatalogIdentity(root);assert.deepEqual(readOnlineGateCatalogIdentity(root),first);
  fs.appendFileSync(sql,'ALTER TABLE example ADD COLUMN optional_value text;\n');const second=readOnlineGateCatalogIdentity(root);
  assert.equal(first.schemaSha256,second.schemaSha256);assert.notEqual(first.migrationCatalogSha256,second.migrationCatalogSha256);
  fs.writeFileSync(path.join(migration,'unreviewed.sql'),'SELECT 1;');assert.throws(()=>readOnlineGateCatalogIdentity(root));fs.unlinkSync(path.join(migration,'unreviewed.sql'));
  fs.linkSync(sql,path.join(root,'linked.sql'));assert.throws(()=>readOnlineGateCatalogIdentity(root));fs.unlinkSync(path.join(root,'linked.sql'));
  fs.appendFileSync(path.join(root,'schema.prisma'),'// exact model-source pin changes\n');assert.notEqual(readOnlineGateCatalogIdentity(root).schemaSha256,second.schemaSha256);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
