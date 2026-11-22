import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../scripts/run-application-native-local.mjs',import.meta.url),'utf8');const start=source.indexOf('onHeld:value=>')+'onHeld:'.length,end=source.indexOf('}});',start)+1;assert.ok(end>start);const callback=source.slice(start,end);
test('actual onHeld callback emits immediate compact ROLEHELD after preserving private diagnostic',()=>{
 const calls=[],root='C:/workspace',directory='/app/online-runtime-acceptance/application-native-123';const original={held:true,innerHeld:{reason:'SAFE_ENUM',payloadSha256:'a'.repeat(64)},privateField:'CREDENTIAL_MUST_NOT_REACH_STDOUT'};
 const onHeld=vm.runInNewContext('('+callback+')',{path,root,directory,fs:{writeFileSync(file,raw){calls.push(['write',file,raw]);}},console:{log(raw){calls.push(['stdout',raw]);}}});onHeld(original);
 assert.equal(calls.length,2);assert.equal(calls[0][0],'write');assert.deepEqual(JSON.parse(calls[0][2]),original);assert.equal(calls[1][0],'stdout');const event=JSON.parse(calls[1][1]);assert.deepEqual(event,{format:'sabalan-original-inner-controller-held/v1',event:'ORIGINAL_INNER_CONTROLLER_HELD',status:'ROLEHELD',reportPath:calls[0][1],reason:'ORIGINAL_CONTROLLER_HELD'});assert.ok(calls[1][1].length<512);assert.ok(!calls[1][1].includes('CREDENTIAL'));assert.ok(!Object.hasOwn(event,'innerHeld'));
});
