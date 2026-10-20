import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyOnlineDeploymentGateContext} from '../onlineDeploymentGateContext';
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
