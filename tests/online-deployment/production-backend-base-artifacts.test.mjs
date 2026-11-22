import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {backendBaseIdentity,qualifiedProductionBackendExport,freshBothHostBackendBasePreflight,
  backendBaseReadonlyFsyncFailure,inspectBackendBaseReadonlyFsyncFailure} from '../../scripts/lib/production-backend-base-artifacts.mjs';
import {originalBackendBaseCommands} from '../../scripts/lib/production-backend-base-process.mjs';
import {assertBackendArchiveHasNoAliases,assertBackendBaseProtectedStatus} from '../../scripts/lib/production-backend-base-local-guard.mjs';
const repository=path.resolve(import.meta.dirname,'../..');

test('original command uses its explicit private cwd and minimal environment',async()=>{
  const value=temporary(),commands=originalBackendBaseCommands();
  try{
    const result=await commands.run(process.execPath,['-e',
      "console.log(JSON.stringify({cwd:process.cwd(),marker:process.env.SABALAN_PRIVATE_CODEGEN_TEST,ambientHome:process.env.HOME??null}))"],
      {cwd:value.root,env:{SystemRoot:process.env.SystemRoot,SABALAN_PRIVATE_CODEGEN_TEST:'private'}});
    commands.assertSuccessful(result);
    assert.deepEqual(JSON.parse(result.stdout),{cwd:value.root,marker:'private',ambientHome:null});
  }finally{await commands.close();value.close();}
});
test('real canonical ten-service census includes Redis and ClamAV and refuses either omission',()=>{
  const stdout=fs.readFileSync(path.join(import.meta.dirname,'production-backend-base-ten-services.fixture.jsonl'),'utf8');
  const actual=assertBackendBaseProtectedStatus(stdout);assert.equal(actual.length,10);
  for(const missing of ['redis','clamav']){
    assert.throws(()=>assertBackendBaseProtectedStatus(JSON.stringify(actual.filter(row=>row.Service!==missing))));
    assert.throws(()=>assertBackendBaseProtectedStatus(JSON.stringify(actual.map(row=>row.Service===missing?{...row,Health:'unhealthy'}:row))));
  }
});
function temporary(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-backend-base-test-')));
  return {root,close(){assert.equal(fs.realpathSync(root),root);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root),/^sabalan-backend-base-test-/);fs.rmSync(root,{recursive:true});}};}
function fixture(){const value=temporary();fs.mkdirSync(path.join(value.root,'reports/qa'),{recursive:true});fs.mkdirSync(path.join(value.root,'backend'));
  for(const name of [backendBaseIdentity.exportReceipt,backendBaseIdentity.dependencyReceipt])fs.copyFileSync(path.join(repository,'reports/qa',name),path.join(value.root,'reports/qa',name));
  for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(repository,'backend',name),path.join(value.root,'backend',name));return value;}

test('real retained receipts bind distinct engine-index/config identities and all21 layers without Docker',()=>{
  const value=fixture();try{const actual=qualifiedProductionBackendExport(value.root);
    assert.equal(actual.sourceIndex,backendBaseIdentity.sourceIndex);assert.equal(actual.configIdentity,backendBaseIdentity.configIdentity);
    assert.notEqual(actual.sourceIndex,actual.configIdentity);assert.equal(actual.imageMapping.configLookupRequired,false);
    assert.equal(actual.layers.length,21);assert.equal(actual.installedDependencyTreeQualified,false);assert.equal(actual.currentSchemaClientQualified,false);
  }finally{value.close();}
});
test('only the exact actual terminal fsync failure is inspectable; it remains false and other failures refuse',()=>{
  const original=inspectBackendBaseReadonlyFsyncFailure(repository);
  assert.equal(original.value.pass,false);assert.equal(original.value.phase,'FAILED_HELD');
  assert.equal(original.receiptFile.sha256,backendBaseReadonlyFsyncFailure.sha256);
  const value=fixture();try{
    const changed=structuredClone(original.value);changed.error='some other failure';
    fs.writeFileSync(path.join(value.root,'reports/qa',backendBaseReadonlyFsyncFailure.receipt),JSON.stringify(changed));
    assert.throws(()=>inspectBackendBaseReadonlyFsyncFailure(value.root));
  }finally{value.close();}
});
test('future package scripts do not invalidate identical dependencies; changed lock bytes or dependencies refuse',()=>{
  const value=fixture();try{
    const before=qualifiedProductionBackendExport(value.root),file=path.join(value.root,'backend/package.json'),input=JSON.parse(fs.readFileSync(file));
    input.scripts['future:online-bridge']='node dist/online.js';fs.writeFileSync(file,JSON.stringify(input)+'\n');
    assert.deepEqual(qualifiedProductionBackendExport(value.root),before);
    input.dependencies['unqualified-dependency']='1.0.0';fs.writeFileSync(file,JSON.stringify(input)+'\n');
    assert.throws(()=>qualifiedProductionBackendExport(value.root),/CURRENT_BACKEND_MANIFEST_LOCK_MISMATCH/);
    delete input.dependencies['unqualified-dependency'];fs.writeFileSync(file,JSON.stringify(input)+'\n');
    fs.appendFileSync(path.join(value.root,'backend/package-lock.json'),' ');
    assert.throws(()=>qualifiedProductionBackendExport(value.root));
  }finally{value.close();}
});
test('an export with the config replaced by its engine index is rejected before any image lookup',()=>{
  const value=fixture();try{
    const file=path.join(value.root,'reports/qa',backendBaseIdentity.exportReceipt),receipt=JSON.parse(fs.readFileSync(file));
    const body=JSON.parse(receipt.stdout);body.component.images.backend.verifiedRawArchive.config=backendBaseIdentity.sourceIndex;
    receipt.stdout=JSON.stringify(body);fs.writeFileSync(file,JSON.stringify(receipt));
    assert.throws(()=>qualifiedProductionBackendExport(value.root));
  }finally{value.close();}
});
test('actual both-host receipt data must be fresh at the caller clock',()=>{
  const value=fixture();try{
    const name='both-host-storage-preflight-before-independent-decryption-9da46fabd18f4545aa806a9dfd77ee9d.json';
    const file=path.join(value.root,'reports/qa',name);fs.copyFileSync(path.join(repository,'reports/qa',name),file);
    const observed=Date.parse(JSON.parse(fs.readFileSync(file)).observedAt);
    assert.equal(freshBothHostBackendBasePreflight(value.root,file,observed+1).hosts.length,2);
    assert.throws(()=>freshBothHostBackendBasePreflight(value.root,file,observed+600001),/FRESH_BOTH_HOST_PREFLIGHT_REQUIRED/);
    assert.throws(()=>freshBothHostBackendBasePreflight(value.root,file,observed-1),/FRESH_BOTH_HOST_PREFLIGHT_REQUIRED/);
  }finally{value.close();}
});
test('bounded output refuses only after the SAME real child closes naturally; no kill or replacement',async()=>{
  const commands=originalBackendBaseCommands();try{
    const outcome=await commands.run(process.execPath,['-e',"process.stdout.write('x'.repeat(2048))"],{maximum:128});
    assert.equal(outcome.code,0);assert.equal(outcome.signal,null);assert.equal(outcome.naturalChildClosure,true);
    assert.equal(outcome.outputBoundExceeded,true);assert.throws(()=>commands.assertSuccessful(outcome));
  }finally{const closed=await commands.close();assert.equal(closed.allOriginalChildrenClosed,true);assert.equal(closed.childCount,1);}
});

function tar(entries){const parts=[];for(const[name,value]of Object.entries(entries)){
  const bytes=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(512);header.write(name);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);
  header[156]=48;header.write('ustar\0',257);header.fill(32,148,156);
  const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);
  parts.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));}parts.push(Buffer.alloc(1024));return Buffer.concat(parts);}
test('alias metadata filter refuses tag-bearing archives before load; it never claims full graph qualification',()=>{
  const value=temporary();try{const file=path.join(value.root,'metadata.tar');
    const write=(tags,annotations)=>fs.writeFileSync(file,tar({'manifest.json':[{Config:'unqualified-data',RepoTags:tags,Layers:[]}],
      'index.json':{schemaVersion:2,manifests:[{digest:'unqualified-data',annotations}]}}));
    write([],{});assert.deepEqual(assertBackendArchiveHasNoAliases(file),{manifestTagsAbsent:true,ociImportAliasesAbsent:true});
    write(['mutable:production'],{});assert.throws(()=>assertBackendArchiveHasNoAliases(file),/BACKEND_ARCHIVE_MUTABLE_TAGS_REFUSED/);
    write([],{ 'org.opencontainers.image.ref.name':'mutable:production' });
    assert.throws(()=>assertBackendArchiveHasNoAliases(file),/BACKEND_ARCHIVE_IMPORT_ALIAS_REFUSED/);
  }finally{value.close();}
});
