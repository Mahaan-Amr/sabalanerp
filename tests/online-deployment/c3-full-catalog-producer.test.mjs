import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {renderC3FullCatalogProducer} from '../../scripts/lib/c3-full-catalog-producer.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('catalog producer selects current C3 sources and pins reused dependency bytes',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c3-catalog-source-'));try{
  const rendered=renderC3FullCatalogProducer(path.resolve(import.meta.dirname,'../..'),directory),source=rendered.raw.toString(),file=path.join(directory,'producer.mjs');fs.writeFileSync(file,rendered.raw);
  const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});assert.equal(check.status,0,check.stderr);
  assert.ok(source.includes('assertCatalogCompilerOriginals(compiled)'));assert.ok(!source.includes('assert.equal(compiled.commands.length,4)'));
  assert.ok(source.includes('CURRENT_CATALOG_GENERATION_SCHEMA_CHANGED'));assert.ok(source.includes('repositoryRoot:'+JSON.stringify(path.resolve('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp'))));
  assert.ok(!source.includes("repository='C:/Users/mahan/.codex/worktrees/online-deployment"));assert.ok(source.includes('CATALOG_DEPENDENCY_CHANGED'));assert.ok(source.includes('UNPINNED_CATALOG_DEPENDENCY'));assert.ok(source.includes('Test imports must not create application pool'));
  assert.equal(rendered.provenance.compilerRebuilt,false);rendered.revalidate();
  const copied={},fixture=path.join(directory,'dependency'),destination=path.join(directory,'destination');fs.mkdirSync(fixture);fs.mkdirSync(destination);const dependency=path.join(fixture,'file.js'),original=Buffer.from('dependency');fs.writeFileSync(dependency,original);
  const start=source.indexOf('function copy(source,relative){'),end=source.indexOf("\nfor(const name of ['@playwright/test'",start);assert.ok(start>0&&end>start);
  const context={assert,fs,path,sha,destination,files:copied,sourceChecks:new Map(),frozenDependencyRoot:fixture,frozenDependencyFiles:{'file.js':{bytes:original.length,sha256:sha(original)}}};const copy=vm.runInNewContext('('+source.slice(start,end).trim()+')',context);
  copy(dependency,'first.js');assert.ok(fs.readFileSync(path.join(destination,'first.js')).equals(original));fs.writeFileSync(dependency,Buffer.from('changed!!!'));assert.throws(()=>copy(dependency,'changed.js'),/CATALOG_DEPENDENCY_CHANGED/);assert.equal(fs.existsSync(path.join(destination,'changed.js')),false);
 }finally{assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(directory).startsWith('c3-catalog-source-'));fs.rmSync(directory,{recursive:true});}
});
