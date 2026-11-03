/** File-only prerequisite for the native owner, before any candidate mutation.
 * Provenance is necessary and never proves live resources, FULL or acceptance. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {readOriginalCompleteConstructorPackage} from './original-complete-constructor-package.mjs';
import {readSourceOwnedCompleteBinding} from './original-complete-source-binding.mjs';
import {originalCompleteStartupNames as startupNames} from './restored-qa/prepare-original-layout.mjs';
function read(reference){assert.ok(reference&&path.isAbsolute(reference.file));const file=path.resolve(reference.file);assert.equal(fs.realpathSync(file),file);const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=128n*1024n**2n);const raw=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});for(const k of ['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'])assert.equal(after[k],before[k]);assert.equal(createHash('sha256').update(raw).digest('hex'),reference.sha256,'COMPLETE_PRE_UP_ARTIFACT_CHANGED');return raw;}
export function inspectOriginalCompletePreUpInputs(){
 const source=readSourceOwnedCompleteBinding();if(source.value.format==='sabalan-original-complete-source-binding/v2'){const pkg=readOriginalCompleteConstructorPackage(source.value.configuration);source.revalidate();pkg.revalidate();return{format:'sabalan-original-complete-constructor-pre-up/v2',configuration:source.value.configuration,targetCommit:pkg.value.targetCommit,startupDependencies:Object.keys(pkg.loaded.files.startup).length,constructorSources:Object.keys(pkg.value.constructorSources).length,dynamicRuntimeBindingRequired:true,runtimeBindingIssued:false,productionAdmission:false};}
 const c=JSON.parse(read(source.value.configuration));
 assert.equal(c.format,'sabalan-original-existing-compose-complete-input/v1');assert.equal(c.project,'sabalanerp-local');assert.equal(c.productionAdmission,false);
 for(const key of ['sources','python','operation','targetCommit','auditDirectory'])assert.deepEqual(c[key],source.value[key]);
 assert.deepEqual(Object.keys(c.sources).sort(),['callback','controller','owner','worker']);for(const value of Object.values(c.sources))read(value);read(c.python);
 assert.equal(c.python.file,path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe'));assert.match(c.operation,/^[a-f0-9]{32}$/);assert.match(c.targetCommit,/^[a-f0-9]{40}$/);
 assert.ok(c.originalIssuer,'COMPLETE_PRE_UP_ORIGINAL_ISSUER_NOT_PACKAGED');assert.deepEqual(Object.keys(c.originalIssuer).sort(),['expectedManifestSha256','observerSha256','port']);assert.ok(Number.isInteger(c.originalIssuer.port)&&c.originalIssuer.port>0&&c.originalIssuer.port<=65535);for(const k of ['expectedManifestSha256','observerSha256'])assert.match(c.originalIssuer[k],/^[a-f0-9]{64}$/);
 assert.ok(c.startupSources,'COMPLETE_PRE_UP_STARTUP_DEPENDENCIES_NOT_PACKAGED');assert.deepEqual(Object.keys(c.startupSources).sort(),startupNames);for(const value of Object.values(c.startupSources))read(value);
 assert.equal(c.startupSources['private-qualification-observer.py'].sha256,c.originalIssuer.observerSha256);
 assert.equal(path.resolve(c.auditDirectory),c.auditDirectory);assert.equal(fs.existsSync(c.auditDirectory),false,'COMPLETE_USED_AUDIT_REFUSED');source.revalidate();
 return{configuration:source.value.configuration,operation:c.operation,startupDependencies:startupNames.length,productionAdmission:false};
}
