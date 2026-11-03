/** Component crypto over modeled observations; no native admission. */
import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {assertOriginalIssuerResources,consumeOriginalRestoredMaterial,consumeOriginalPrivateControl} from '../../scripts/lib/restored-qa/original-issuer-material.mjs';
import {compileRestoredQaPrivateQualificationMaterial,qualificationBytes} from '../../scripts/lib/independent-private-qualification-material.mjs';
import {restored} from './restored-qa-material.fixture.mjs';
function fixture(){
 const key=generateKeyPairSync('ed25519'),input=restored();
 const enrollment={publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64'),publicKeyPem:key.publicKey.export({type:'spki',format:'pem'}),session:input.config.session,actorId:input.config.actorId};
 input.config.publicKey=enrollment.publicKey;const material=compileRestoredQaPrivateQualificationMaterial({...input,now:new Date()});
 const materials=Object.fromEntries(Object.entries(material.decisionsByRuntime).map(([id,decision])=>[id,{artifacts:material.artifactsByRuntime[id],decision:{format:'sabalan-signed-online-private-qualification/v1',decision,signature:sign(null,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(decision)]),key.privateKey).toString('base64')}}]));
 let active=true,calls=[],clockOffset=0,lifetime=600_000;const reply={materials,enrollment,productionAdmission:false};
 const control=(command,sequence)=>({format:'sabalan-private-qualification-control/v1',session:enrollment.session,actorId:enrollment.actorId,scopeSha256:material.decisionsByRuntime[Object.keys(materials).find(id=>material.decisionsByRuntime[id].runtimePurpose==='http')].scopeSha256,sequence,command});
 const signed=value=>({...value,signature:sign(null,Buffer.from([value.format,value.session,value.actorId,value.scopeSha256,String(value.sequence),value.command].join('\0')),key.privateKey).toString('base64')});
 const issuer={enrollment,assertActive:()=>assert.equal(active,true),issueOriginalRestoredMaterial:async(...args)=>{calls.push(['material',args]);const issuedAt=new Date(Date.now()+clockOffset).toISOString(),expiresAt=new Date(Date.parse(issuedAt)+lifetime).toISOString();for(const row of Object.values(reply.materials)){if(!row.decision)continue;row.decision.decision={...row.decision.decision,issuedAt,expiresAt};if(row.decision.signature!==Buffer.alloc(64).toString('base64'))row.decision.signature=sign(null,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(row.decision.decision)]),key.privateKey).toString('base64');}return reply;},prepareOriginalPrivateDrain:async(...args)=>{calls.push(['drain',args]);return signed(control('PRIVATE_PREPARE_DRAIN',1));},shutdownOriginalPrivateHttp:async(...args)=>{calls.push(['shutdown',args]);return signed(control('PRIVATE_SHUTDOWN',2));}};
 return{issuer,material,input,reply,calls,control,setClock:(offset,ttl)=>{clockOffset=offset;lifetime=ttl;},lose:()=>{active=false;}};
}
test('broker consumes only zero-input original operations and independently verifies all material and controls',async()=>{
 const f=fixture();assert.deepEqual((await consumeOriginalRestoredMaterial(f.issuer,f.input)).materials,f.reply.materials);
 await consumeOriginalPrivateControl(f.issuer,f.control('PRIVATE_PREPARE_DRAIN',1));await consumeOriginalPrivateControl(f.issuer,f.control('PRIVATE_SHUTDOWN',2));
 assert.deepEqual(f.calls,[['material',[]],['drain',[]],['shutdown',[]]]);
});
for(const mode of ['decision','artifact','signature','extra-runtime','enrollment','admission'])test('broker rejects changed original response: '+mode,async()=>{
 const f=fixture(),id=Object.keys(f.reply.materials)[0];f.reply.materials=structuredClone(f.reply.materials);
 if(mode==='decision')f.reply.materials[id].decision.decision.sourceCommit='e'.repeat(40);
 if(mode==='artifact')f.reply.materials[id].artifacts.extra=true;
 if(mode==='signature')f.reply.materials[id].decision.signature=Buffer.alloc(64).toString('base64');
 if(mode==='extra-runtime')f.reply.materials.extra={};
 if(mode==='enrollment')f.reply.enrollment={...f.reply.enrollment,actorId:'e'.repeat(64)};
 if(mode==='admission')f.reply.productionAdmission=true;
 await assert.rejects(consumeOriginalRestoredMaterial(f.issuer,f.input));
});
test('unknown controls, altered scope, expired originals and mismatched signed controls never pass',async()=>{
 const f=fixture();await assert.rejects(consumeOriginalPrivateControl(f.issuer,f.control('PRIVATE_SHUTDOWN',1)));assert.equal(f.calls.length,0);
 const expected=f.control('PRIVATE_PREPARE_DRAIN',1);expected.scopeSha256='e'.repeat(64);await assert.rejects(consumeOriginalPrivateControl(f.issuer,expected));
 f.lose();await assert.rejects(consumeOriginalRestoredMaterial(f.issuer,f.input));
});

for(const [name,offset,ttl]of [['stale',-1000,600_000],['future',1000,600_000],['weakened-ttl',0,600_001]])test('authentic original signature cannot hide '+name+' issuance',async()=>{
 const f=fixture();f.setClock(offset,ttl);await assert.rejects(consumeOriginalRestoredMaterial(f.issuer,f.input));
});

test('a broker becoming HELD during remote I/O prevents the next executor despite a live issuer',async()=>{
 let held=false,executions=0;const issuer={assertActive:()=>{},checkOriginalResources:async()=>{await Promise.resolve();held=true;}};
 await assert.rejects((async()=>{await assertOriginalIssuerResources(issuer,()=>assert.equal(held,false));executions++;})());assert.equal(executions,0);
});
