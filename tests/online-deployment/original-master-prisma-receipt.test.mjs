import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('../../backend/node_modules/typescript');
const filename=new URL('../../scripts/run-original-online-qualification-master.mjs',import.meta.url),source=fs.readFileSync(filename,'utf8'),tree=ts.createSourceFile(filename.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='runOriginalOnlineQualificationMaster');assert.ok(declaration);
const keyDeclaration=tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==='keys'));assert.ok(keyDeclaration);
// Execute the actual finite request parser and option forwarding. Original
// factories are explicit inert test doubles; no authority tokens are minted.
async function exercise(extra={},upfront){
 const invoked=[],events=[];let finish;const done=new Promise(resolve=>{finish=resolve;});
 const context={assert,Buffer,process:{platform:'win32'},setInterval:()=>1,pinnedConfiguration:()=>({testConfiguration:true}),inspectOriginalLocalOnlineCheckpointInputs:()=>{},runOriginalApplicationNativeQualification:async options=>{invoked.push(options);return{reportPath:'test-report-only',completion:null};}};
 const master=vm.runInNewContext('(()=>{'+keyDeclaration.getText(tree)+';return ('+declaration.getText(tree).replace(/^export\s+/,'')+');})()',context);
 const frames=[{command:'PREPARE_LOCAL_RUNTIME',sequence:1,nativeOwnerElfReceipt:'test-elf.json'},{command:'PREPARE_INDEPENDENT',sequence:2,configurationFile:'test-config.json',configurationSha256:'a'.repeat(64),password:'test-only-not-a-real-credential'},{command:'RUN_LOCAL',sequence:3,candidateReplacementReceipt:'test-candidate.json',...extra}];
 async function* input(){for(const frame of frames)yield Buffer.from(JSON.stringify(frame)+'\n');}
 const output={write(raw){const value=JSON.parse(raw);events.push(value);if(['ORIGINAL_MASTER_INPUT_CLOSED_RETAINED','ORIGINAL_MASTER_REQUEST_FAILED_RETAINED'].includes(value.event))finish();}};
 const retained=master({deferLocal:true,input:input(),output,prismaQualificationReceipt:upfront});retained.catch(error=>finish(error));const failure=await done;if(failure)throw failure;
 return{invoked,events};
}
test('RUN_LOCAL forwards explicit fresh Prisma receipt through the actual strict parser',async()=>{const result=await exercise({prismaQualificationReceipt:'new-current-capsule.json'},'old-upfront.json');assert.equal(result.invoked.length,1);assert.equal(result.invoked[0].prismaQualificationReceipt,'new-current-capsule.json');assert.equal(result.invoked[0].candidateReplacementReceipt,'test-candidate.json');assert.equal(result.invoked[0].nativeOwnerElfReceipt,'test-elf.json');assert.equal(result.events.at(-1).event,'ORIGINAL_MASTER_INPUT_CLOSED_RETAINED');});
test('RUN_LOCAL preserves upfront receipt fallback and historical omitted-field shape',async()=>{for(const value of ['upfront-capsule.json',undefined]){const result=await exercise({},value);assert.equal(result.invoked.length,1);assert.equal(result.invoked[0].prismaQualificationReceipt,value);}});
test('RUN_LOCAL refuses foreign approval fields before original local factory invocation',async()=>{for(const extra of [{prismaQualificationReceipt:'fresh.json',approved:true},{prismaQualificationReceipt:'fresh.json',databaseConnected:false}]){const result=await exercise(extra);assert.equal(result.invoked.length,0);assert.equal(result.events.at(-1).event,'ORIGINAL_MASTER_REQUEST_FAILED_RETAINED');}});
