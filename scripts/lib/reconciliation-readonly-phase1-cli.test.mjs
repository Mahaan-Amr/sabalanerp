import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readFixedEvidence} from './reconciliation-readonly-phase1-cli.mjs';

test('bounded audit returns only identity metadata and digest for a test-owned file',async()=>{
  const root=path.join(tmpdir(),'sabalan-evidence-fixture-'+randomUUID().replaceAll('-',''));
  await mkdir(root,{mode:0o700});
  const file=path.join(root,'evidence.json');const raw=Buffer.from('{"fixture":true}');
  await writeFile(file,raw,{flag:'wx'});
  const result=await readFixedEvidence('fixture',file);
  assert.equal(result.sha256,createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.bytes,raw.length);
  assert.equal(result.pathSnapshot,'NONATOMIC_ANCESTOR_UNPROVEN');
  assert.equal(JSON.stringify(result).includes('fixture":true'),false);
});
test('evidence reader refuses an unlisted path',async()=>{
  const root=path.join(tmpdir(),'sabalan-evidence-fixture-'+randomUUID().replaceAll('-',''));
  await mkdir(root,{mode:0o700});
  const file=path.join(root,'not-allowed.json');await writeFile(file,'fixture',{flag:'wx'});
  await assert.rejects(readFixedEvidence('fixture',file),/CENSUS_CLOSURE_UNPROVEN/);
});
test('evidence reader rejects an oversized test-owned file',async()=>{
  const root=path.join(tmpdir(),'sabalan-evidence-fixture-'+randomUUID().replaceAll('-',''));
  await mkdir(root,{mode:0o700});const file=path.join(root,'evidence.json');
  await writeFile(file,Buffer.alloc(16777217),{flag:'wx'});
  await assert.rejects(readFixedEvidence('fixture',file),/CENSUS_CLOSURE_UNPROVEN/);
});
