/** The immutable host pack owns this fixed resource. A master stdin request
 * cannot choose executable code, source modules or a replacement verifier. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const file=path.resolve(import.meta.dirname,'../../deploy/qualification/complete-source-binding.json');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const stamp=st=>['dev','ino','mode','size','nlink','mtimeNs','ctimeNs'].map(key=>String(st[key])).join(':');
/** File-only packaging seam for #413, after source09/source12 freeze. Every
 * source/configuration digest is measured from existing bytes, never guessed.
 * This writes nothing, builds no image and creates no runtime authority. */
export function renderOriginalCompleteSourceBinding(configuration){
  assert.equal(configuration.format,'sabalan-original-existing-compose-complete-input/v1');
  const files=[configuration.configuration,configuration.python,...Object.values(configuration.sources)];
  for(const reference of files){
    assert.equal(path.resolve(reference.file),reference.file);assert.equal(fs.realpathSync(reference.file),reference.file);
    const before=fs.lstatSync(reference.file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n);
    assert.match(reference.sha256,/^[a-f0-9]{64}$/);assert.equal(sha(fs.readFileSync(reference.file)),reference.sha256);
    assert.equal(stamp(before),stamp(fs.lstatSync(reference.file,{bigint:true})));
  }
  return Buffer.from(JSON.stringify({format:'sabalan-original-complete-source-binding/v1',configuration:configuration.configuration,
    sources:configuration.sources,python:configuration.python,operation:configuration.operation,targetCommit:configuration.targetCommit,
    auditDirectory:configuration.auditDirectory,productionAdmission:false})+'\n');
}
export function readSourceOwnedCompleteBinding(){
  assert.ok(fs.existsSync(file),'COMPLETE_IMMUTABLE_SOURCE_BINDING_NOT_PACKAGED');assert.equal(fs.realpathSync(file),file);
  const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=65536n);
  const raw=fs.readFileSync(file);assert.equal(stamp(before),stamp(fs.lstatSync(file,{bigint:true})));
  const value=JSON.parse(raw.toString('utf8'));assert.equal(value.format,'sabalan-original-complete-source-binding/v1');assert.equal(value.productionAdmission,false);
  return {value,revalidate(){assert.equal(stamp(before),stamp(fs.lstatSync(file,{bigint:true})));assert.equal(sha(fs.readFileSync(file)),sha(raw));}};
}
