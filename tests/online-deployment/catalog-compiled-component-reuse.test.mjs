import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertCatalogCompilerOriginals} from '../../scripts/lib/application-native-full-catalog-artifacts.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const child=()=>({originalPid:123,code:0,signal:null,naturalChildClosure:true,outputBoundExceeded:false});
function fixture(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-catalog-compiler-'));
 const sources={'packages/contract-product-graph/src/index.ts':'1'.repeat(64),'packages/partner-sales-contracts/src/index.ts':'2'.repeat(64),'backend/package-lock.json':'3'.repeat(64),'backend/src/changed.ts':'4'.repeat(64)};
 const outputs={'graph-dist/index.d.ts':{bytes:12,sha256:'a'.repeat(64)},'partner-dist/index.d.ts':{bytes:13,sha256:'b'.repeat(64)}};
 const prior={format:'sabalan-current-backend-compiled/v1',pass:true,sourceUnchanged:true,productionAdmission:false,originalChildren:{allOriginalChildrenClosed:true,interrupted:false},commands:Array.from({length:4},child),qualifiedReceiptSha256:'c'.repeat(64),sources,outputs};
 const file=path.join(folder,'compiled-receipt.json'),raw=Buffer.from(JSON.stringify(prior));fs.writeFileSync(file,raw,{flag:'wx'});
 const current=structuredClone(prior);current.commands=[child(),child()];current.sources['backend/src/changed.ts']='5'.repeat(64);
 current.reusedComponents={format:'sabalan-original-workspace-components-reused/v1',priorReceipt:{file,sha256:sha(raw)},recordedInputCount:3,outputs:Object.keys(outputs).sort().map(name=>({path:name,...outputs[name]})),newCompilerOriginalsClaimed:false,productionAdmission:false};
 return{prior,current,folder};
}
function using(fn){const f=fixture();try{fn(f);}finally{assert.equal(path.dirname(path.resolve(f.folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(f.folder).startsWith('sabalan-catalog-compiler-'));assert.equal(fs.realpathSync(f.folder),path.resolve(f.folder));fs.rmSync(f.folder,{recursive:true,force:true});}}
test('catalog keeps four genuine original compilers and accepts two new originals plus authenticated workspace reuse',()=>using(({prior,current})=>{assert.doesNotThrow(()=>assertCatalogCompilerOriginals(prior));assert.doesNotThrow(()=>assertCatalogCompilerOriginals(current));assert.equal(current.commands.length,2);}));
test('catalog refuses failed fresh children, altered prior receipts, SDK, inputs or reused output identities',()=>using(({current})=>{
 const changes=[v=>v.commands[0].code=1,v=>v.commands[0].naturalChildClosure=false,v=>v.commands[0].outputBoundExceeded=true,v=>v.commands.pop(),v=>v.originalChildren.interrupted=true,v=>v.reusedComponents.newCompilerOriginalsClaimed=true,v=>v.reusedComponents.productionAdmission=true,v=>v.reusedComponents.priorReceipt.sha256='0'.repeat(64),v=>v.qualifiedReceiptSha256='d'.repeat(64),v=>v.sources['backend/package-lock.json']='e'.repeat(64),v=>v.reusedComponents.recordedInputCount=2,v=>v.reusedComponents.outputs.pop(),v=>v.outputs['graph-dist/index.d.ts'].sha256='f'.repeat(64),v=>delete v.outputs['partner-dist/index.d.ts'],v=>v.outputs['graph-dist/foreign.d.ts']={bytes:1,sha256:'f'.repeat(64)},v=>delete v.reusedComponents];
 for(const [i,change]of changes.entries()){const value=structuredClone(current);change(value);assert.throws(()=>assertCatalogCompilerOriginals(value),'mutant '+i);}
}));
