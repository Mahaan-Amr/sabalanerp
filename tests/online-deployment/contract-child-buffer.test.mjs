import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import test from 'node:test';
const frontend=fileURLToPath(new URL('../../frontend/',import.meta.url)),require=createRequire(path.join(frontend,'package.json')),{buildSync}=require('esbuild'),React=require('react');
function load(relative){const code=buildSync({entryPoints:[path.join(frontend,'src',relative)],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,require);return module.exports;}
const {BrowserBuildHandoff}=load('lib/browserBuildHandoff.ts'),{registerUnarchivedDraftGuard}=load('lib/unarchivedDraftGuard.ts'),{createContractAutosaveDraft}=load('features/contract-creation/utils/contractDraftStorage.ts'),{recoverContractModalIdentity}=load('features/contract-creation/utils/contractModalRecoveryIdentity.ts');
const lease={userId:'owner_a',sessionId:'session_a',generation:1};
function fieldFactory(guard){const filename=path.join(frontend,'src/features/contract-creation/components/product-modal-system/LongitudinalProductSection.tsx');
 const stubs=['@/components/erp','./productModalPrimitives','./productPricingVisibility','@/components/FormattedNumberInput','@/lib/useUnarchivedDraftGuard'];
 const source=fs.readFileSync(filename,'utf8')+'\nexport {CompactDecimalField};';
 const code=buildSync({stdin:{contents:source,resolveDir:path.dirname(filename),sourcefile:filename,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',external:['react',...stubs],tsconfig:path.join(frontend,'tsconfig.json')}).outputFiles[0].text;
 const states=[];let index=0,release;const react={...React,useState:initial=>{const n=index++;if(!(n in states))states[n]=initial;return [states[n],v=>{states[n]=v;}];},useRef:initial=>{const n=index++;return states[n]??={current:initial};},useEffect(){}};
 const module={exports:{}};const mocks={react,'@/components/erp':{ErpInput:'input',ErpInlineState:'status'},'./productModalPrimitives':{CompactSwitch:'switch',CompactUnitSwitch:'unit'},'./productPricingVisibility':{useProductPricingVisibility:()=>true},'@/components/FormattedNumberInput':{default:'numeric'},'@/lib/useUnarchivedDraftGuard':{useUnarchivedDraftGuard:(workflow,active)=>{release?.();release=active?guard(workflow):undefined;}}};
 new Function('module','exports','require',code)(module,module.exports,key=>Object.hasOwn(mocks,key)?mocks[key]:require(key));
 return props=>{index=0;return module.exports.CompactDecimalField(props);};
}
function findInput(node){if(!node||typeof node!=='object')return; if(node.props?.id==='quantity-buffer'&&typeof node.props.onChange==='function')return node;for(const child of React.Children.toArray(node.props?.children)){const found=findInput(child);if(found)return found;}}
test('actual quantity child keeps1.5 while parent3; parent-only handoff was false PRESERVED, explicit child denial blocks it',async()=>{
 for(const guarded of [false,true]){
  let writes=0,parent=3;const handoff=new BrowserBuildHandoff('erp_contract_buffer_20261020',async input=>{writes++;return {...input,format:'sabalan-browser-draft/v1',id:'archive',sha256:'a'.repeat(64),capturedAt:'2026-10-20T00:00:00Z'};});
  handoff.register({userId:lease.userId,workflow:'sales-contract',draftId:'contract-a',schemaVersion:1,baseRevision:4,capturePayloadJson:()=>JSON.stringify(createContractAutosaveDraft({currentStep:3,wizardData:{products:[{quantity:parent}]},productModal:{productConfig:{quantity:parent}}},1234))});
  const render=fieldFactory(workflow=>guarded?registerUnarchivedDraftGuard(handoff,workflow,'quantity'):()=>{});
  const props={id:'quantity-buffer',label:'تعداد',value:String(parent),inputMode:'numeric',onValueChange:text=>{if(/^[1-9]\d*$/.test(text))parent=Number(text);}};
  findInput(render(props)).props.onChange({target:{value:'1.5'}});const input=findInput(render(props));assert.equal(input.props.value,'1.5');assert.equal(parent,3);
  const result=await handoff.preserve(lease,()=>{});assert.equal(result.status,guarded?'BLOCKED':'PRESERVED');assert.equal(writes,guarded?0:1);
 }
});
test('payment/product modal restore retains exact edit identity and refuses missing, mismatched or ambiguous ownership before mutation',()=>{
 const payments=[{id:'payment-a'}],products=[{rowId:'row-a'},{rowId:'row-b'}];
 const modal={editingPaymentEntryId:'payment-a',paymentEntryForm:{id:'payment-a',amount:150},isEditMode:true,editingProductRowId:'row-b',editingProductIndex:1,productConfig:{rowId:'row-b'}};
 assert.deepEqual(recoverContractModalIdentity(modal,payments,products),{editingPaymentEntryId:'payment-a',isEditMode:true,editingProductIndex:1});
 assert.throws(()=>recoverContractModalIdentity({...modal,editingPaymentEntryId:null},payments,products));
 assert.throws(()=>recoverContractModalIdentity({...modal,editingProductIndex:0},payments,products));
 assert.throws(()=>recoverContractModalIdentity({...modal,editingProductRowId:'missing'},payments,products));
 assert.throws(()=>recoverContractModalIdentity({showProductModal:true,productConfig:{rowId:'row-a'}},payments,products));
 assert.deepEqual(recoverContractModalIdentity({showProductModal:false,productConfig:{rowId:'row-a'}},payments,products),{editingPaymentEntryId:null,isEditMode:false,editingProductIndex:null});
 assert.deepEqual(recoverContractModalIdentity({editingPaymentEntryId:null,isEditMode:false,editingProductIndex:null,editingProductRowId:null},payments,products),{editingPaymentEntryId:null,isEditMode:false,editingProductIndex:null});
});

function contractRecoveryFixture(){
 let reloads=0,writes=0,payload='original';const effects=[],storage=new Map();
 const handoff=new BrowserBuildHandoff('erp_contract_reload_20261020',async input=>{writes++;return {...input,format:'sabalan-browser-draft/v1',id:'archive',sha256:'a'.repeat(64),capturedAt:'2026-10-20T00:00:00Z'};});
 const react={useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:value=>({current:value}),useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){},useLayoutEffect:fn=>effects.push(fn)};
 const file=path.join(frontend,'src/features/contract-creation/hooks/useContractEditRecovery.ts');
 const code=buildSync({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',external:['react','@/lib/api','@/lib/browserBuildHandoff'],tsconfig:path.join(frontend,'tsconfig.json')}).outputFiles[0].text;
 const memory={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const window={sessionStorage:memory,localStorage:memory,location:{reload:()=>reloads++}};
 const mocks={'react':react,'@/lib/browserBuildHandoff':{browserBuildHandoff:handoff},'@/lib/api':{salesAPI:{},browserSessionContinuation:{acquire:async()=>lease,assertCurrent(){}}}};
 const module={exports:{}};new Function('module','exports','require','window',code)(module,module.exports,key=>Object.hasOwn(mocks,key)?mocks[key]:require(key),window);
 const scope={userId:'owner_a',draftId:'contract-a',schemaVersion:1,baseRevision:4};
 const api=module.exports.useContractEditRecovery({scope,captureDraft:time=>({payload,capturedAt:time}),onRestore(){assert.fail('no automatic restore');}});effects.forEach(fn=>fn());
 return {api,handoff,get reloads(){return reloads;},get writes(){return writes;}};
}
test('actual Contract reloadLatestRevision consults every registered child before reloading',async()=>{
 const f=contractRecoveryFixture(),remove=registerUnarchivedDraftGuard(f.handoff,'contract-child','raw');
 assert.equal(await f.api.reloadLatestRevision({payload:'original'}),false);assert.equal(f.reloads,0);assert.equal(f.writes,0);
 remove();assert.equal(await f.api.reloadLatestRevision({payload:'original'}),true);assert.equal(f.reloads,1);assert.equal(f.writes,1);
});
