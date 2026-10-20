import test from 'node:test';
import assert from 'node:assert/strict';
import {createReleaseEndpointCatalog,readReleaseEndpoint} from '../../deploy/scripts/release-endpoint-catalog.mjs';
import {createOriginalIngressTrust,originalForwardedHeaders} from '../../deploy/scripts/release-forwarding.mjs';
import {issueOriginalQualificationOrigin} from '../../deploy/scripts/online-qualification-origin-issuer.mjs';
const image='sha256:'+'a'.repeat(64);
test('append-only endpoint enrollment is atomic and a JSON clone cannot change original locations',()=>{
 const {catalog,append}=createReleaseEndpointCatalog();
 const old={slotId:'frontend_original',host:'frontend-old',port:3000,image};append({ui:[old]});
 assert.deepEqual(readReleaseEndpoint(catalog,'ui',old.slotId),old);
 assert.throws(()=>readReleaseEndpoint({},'ui',old.slotId));
 assert.throws(()=>append({ui:[{...old,slotId:'frontend_new'},{...old,host:'frontend-replacement'}]}));
 assert.equal(readReleaseEndpoint(catalog,'ui','frontend_new'),undefined);
 assert.deepEqual(readReleaseEndpoint(catalog,'ui',old.slotId),old);
 append({ui:[old],backend:[{slotId:'backend_original',host:'backend-original',port:5000,image,manifestSha256:'b'.repeat(64)}]});
 assert.equal(readReleaseEndpoint(catalog,'backend','backend_original').manifestSha256,'b'.repeat(64));
});
test('only actual enrolled ingress addresses can preserve HTTPS and audit forwarding',()=>{
 const owner=createOriginalIngressTrust();owner.append(['172.18.0.2']);
 const request={socket:{remoteAddress:'172.18.0.3'},headers:{'x-forwarded-for':'203.0.113.2','x-forwarded-proto':'https'}};
 assert.deepEqual(originalForwardedHeaders(request,owner.trust),{'x-forwarded-for':'172.18.0.3','x-forwarded-proto':'http'});
 request.socket.remoteAddress='::ffff:172.18.0.2';
 assert.deepEqual(originalForwardedHeaders(request,owner.trust),{'x-forwarded-for':'203.0.113.2','x-forwarded-proto':'https'});
 assert.throws(()=>originalForwardedHeaders(request,{}));
 request.headers['x-forwarded-for']='arbitrary-user';assert.throws(()=>originalForwardedHeaders(request,owner.trust));
});
test('parsed reports cannot reach the fixed qualification signer',async()=>{
 await assert.rejects(issueOriginalQualificationOrigin({localCompletion:{productionAdmission:true},independentCompletion:{},evidenceDirectory:'/unused',manifestSha256:'a'.repeat(64),acceptanceSha256:'b'.repeat(64)}),/ORIGINAL_ROLE_COMPLETION_TOKEN_REQUIRED/);
});
