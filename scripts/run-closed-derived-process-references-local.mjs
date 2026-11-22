import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),compose=['compose','-f','D:/sabalanerp/docker-compose.local.yml'];
const source=fs.readFileSync(path.join(root,'deploy/scripts/closed-derived-process-references.py'));
const fixture=fs.readFileSync(path.join(root,'tests/online-deployment/closed-derived-process-references.fixture.py'));
const holdSource=fs.readFileSync(path.join(root,'deploy/scripts/closed-diagnostic-holds.py'));
const holdFixture=fs.readFileSync(path.join(root,'tests/online-deployment/closed-diagnostic-holds.fixture.py'));
function verify(){
  const output=execFileSync('docker',[...compose,'ps','--format','json'],{encoding:'utf8'});
  let rows;try{const parsed=JSON.parse(output);rows=Array.isArray(parsed)?parsed:[parsed];}catch{rows=output.trim().split(/\r?\n/).map(JSON.parse);}
  for(const name of ['postgres','backend','frontend','inquiry'])assert.ok(rows.some(x=>x.Project==='sabalanerp-local'&&x.Service===name&&x.State==='running'&&x.Health==='healthy'));
  return rows;
}
const before=verify(),backend=before.find(x=>x.Service==='backend');
const script=Buffer.concat([Buffer.from('MODULE_SOURCE = __import__("base64").b64decode("'+source.toString('base64')+'")\nHOLD_SOURCE = __import__("base64").b64decode("'+holdSource.toString('base64')+'")\n'),fixture,Buffer.from('\n'),holdFixture]);
verify();const result=spawnSync('docker',['exec','-i','--user','0',backend.Name,'python3','-I','-B','-'],{input:script,encoding:'utf8',maxBuffer:1024*1024});
const receipt={format:'sabalan-closed-derived-reference-local/v1',moduleSha256:createHash('sha256').update(source).digest('hex'),fixtureSha256:createHash('sha256').update(fixture).digest('hex'),holdModuleSha256:createHash('sha256').update(holdSource).digest('hex'),holdFixtureSha256:createHash('sha256').update(holdFixture).digest('hex'),status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr};
console.log(JSON.stringify(receipt));
assert.equal(result.signal,null);assert.equal(result.status,0);assert.match(result.stdout,/"closedDerivedReferenceAcceptance": true/);
assert.match(result.stdout,/"closedDiagnosticHoldsAcceptance": true/);
const after=verify();for(const row of before){const current=after.find(x=>x.Service===row.Service);assert.equal(current.ID,row.ID);assert.equal(current.Name,row.Name);}
