import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {bindTargetBrowserImage} from '../../deploy/scripts/online-release-carriers.mjs';
import {selectOriginalInquiryForRelease} from '../../deploy/scripts/online-inquiry-original-selection.mjs';
const ts=createRequire(new URL('../../backend/package.json',import.meta.url))('typescript');
const source=fs.readFileSync('deploy/scripts/online-release-controller.mjs','utf8'),tree=ts.createSourceFile('controller.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),declaration=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='OriginalOnlineReleaseController');
const canonical=v=>Array.isArray(v)?Array.from(v,canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))),sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const runtimeId='e'.repeat(64),containerId='f'.repeat(64),runtimeBundle='0'.repeat(64),sourceCommit='d'.repeat(40),graph={index:'sha256:'+'1'.repeat(64),platform:'sha256:'+'2'.repeat(64),config:'sha256:'+'a'.repeat(64),rootfsDiffIds:['sha256:'+'3'.repeat(64)]};
 const sourceBuild={id:'inquiry_original',application:'inquiry',image:graph.index,manifestSha256:'b'.repeat(64),assets:[{path:'/immutable.js',sha256:'c'.repeat(64)}],actionIds:['action_original']},build={...structuredClone(sourceBuild),image:graph.config};
 const inquiryToken={},frontToken={},httpId='4'.repeat(64),scope={runtimeId,releaseId:'release_old',image:graph.config,manifestSha256:runtimeBundle,sourceCommit};
 const facts={runtimeId,containerId,slotId:'inquiry_'+runtimeId,image:scope.image,startedAt:'2026-10-21T00:00:00Z',scope,build:{...build,slotId:'inquiry_'+runtimeId},native:{runtimeId,containerId,image:scope.image,originalReady:true}};
 const front={kind:'frontend',releaseId:'release_new',slotId:'frontend_new',build:{id:'erp_new',application:'erp',image:'sha256:'+'5'.repeat(64),manifestSha256:'6'.repeat(64),assets:[],actionIds:[]}};
 const evidence={browserRegistries:[{current:{erp:'erp_new',inquiry:sourceBuild.id},builds:[sourceBuild]}],component:{sourceCommit,runtimeBundleSha256:runtimeBundle,image:graph.config,imageGraph:graph}},input={scopes:[{scope:{runtimeId:httpId,purpose:'http'}}]};
 const publication={generation:1,registry:{current:{erp:'erp_old',inquiry:sourceBuild.id},builds:[{...facts.build,retiredAt:null,supportUntil:null}],apiBindings:[]}},f={evidence,input,facts,front,publication,nativeReads:0,leaseReads:0};
 let text=declaration.getText(tree).replace(/^export /,'').replaceAll('import.meta.url',JSON.stringify(new URL('../../deploy/scripts/online-release-controller.mjs',import.meta.url).href));
 const replacements={constructor:`constructor(){this.#owner={releaseId:'release_new'};this.#releases=new Map([['release_new',{input:fixture.input}]]);this.#preparedInputs=new Map();this.#currentServingReleaseId='release_old';this.#store={readPublication:async()=>fixture.publication};this.#carriers=new Map([["frontend_new",frontToken]]);this.#inquiryActors=new Map([[inquiryToken,{closed:false,ready:{},scope:fixture.facts.scope}]]);this.#children=new Map([[httpId,{closed:false,scope:{runtimeId:httpId,releaseId:'release_new',purpose:'http',image:'image',manifestSha256:'manifest'},events:[{event:'READY'}]}]]);this.#database={$queryRaw:async()=>[{now:new Date('2026-10-21T01:00:00Z')}]};}`,
 assertOwned:`async assertOwned(){fixture.leaseReads++;}`,
 readInquiryReleaseEvidence:`readInquiryReleaseEvidence(){return fixture.evidence;}`,
 readCarrierReleaseEvidence:`readCarrierReleaseEvidence(){return fixture.evidence;}`};
 for(const [name,replacement]of Object.entries(replacements)){const n=declaration.members.find(m=>name==='constructor'?ts.isConstructorDeclaration(m):m.name?.getText(tree)===name);text=text.replace(n.getText(tree),replacement);}
 const env={fixture:f,Buffer,Date,Map,Set,structuredClone,httpId,inquiryToken,frontToken,bindTargetBrowserImage,selectOriginalInquiryForRelease,assert:(v,c)=>assert.ok(v,c),bytes,sha,
 readOriginalInquiryCarrier:async(_controller,token)=>{assert.equal(token,inquiryToken);f.nativeReads++;return f.facts;},readOriginalOnlineCarrier:async(_controller,token)=>{assert.equal(token,frontToken);return f.front;}};
 const Controller=vm.runInNewContext('('+text+')',env);return {f,controller:new Controller()};
}
test('actual cycle-plan, native selection and publication methods reuse ERP-only Inquiry without new scope/start',async()=>{
 const {f,controller}=fixture(),before=structuredClone(f.facts.scope);const cycle=await controller.readOriginalCyclePlan();
 assert.equal(cycle.inquiry.kind,'REUSE_ORIGINAL');assert.equal(cycle.inquiry.releaseId,'release_old');
 const registry=await controller.prepareOriginalPublicationRegistry();assert.equal(registry.current.inquiry,f.facts.build.id);assert.equal(registry.builds.find(b=>b.id===registry.current.inquiry).slotId,'inquiry_'+f.facts.runtimeId);
 await assert.rejects(controller.prepareInquiryRuntime({buildId:f.facts.build.id}),/ONLINE_INQUIRY_ORIGINAL_REUSE_REQUIRED/);
 assert.deepEqual(f.facts.scope,before);assert.ok(f.nativeReads>=3);assert.ok(f.leaseReads>=3);
});
test('actual changed-build cycle requires new Inquiry and publication refuses before it is started',async()=>{
 const {f,controller}=fixture();f.evidence.browserRegistries[0].builds[0].id='inquiry_changed';f.evidence.browserRegistries[0].current.inquiry='inquiry_changed';
 const cycle=await controller.readOriginalCyclePlan();assert.equal(cycle.inquiry.kind,'PREPARE_NEW');assert.equal(cycle.inquiry.runtimeId,null);assert.equal(cycle.inquiry.releaseId,'release_new');
 await assert.rejects(controller.prepareOriginalPublicationRegistry(),/ONLINE_ORIGINAL_CURRENT_INQUIRY_NOT_STARTED/);
});
test('actual native-reuse chain refuses changed incarnation proof or same-build bytes',async()=>{
 for(const mutate of [f=>f.facts.native.originalReady=false,f=>f.facts.native.containerId='7'.repeat(64),f=>f.facts.build.actionIds.push('CHANGED')]){
  const {f,controller}=fixture();mutate(f);await assert.rejects(controller.readOriginalCyclePlan());assert.equal(f.nativeReads,1);
 }
});
