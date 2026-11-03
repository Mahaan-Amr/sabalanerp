/** Exact reviewed diagnostic successor. The historical issuer is never edited.
 * This source transformation grants no native/application/transport authority. */
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {revalidateC3OperationsSourceReuse,c3ApplicationCommit} from './c3-operations-source-reuse.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const c3ReadonlyProtocolSuccessor=Object.freeze({baseSha256:'f9482c06c83ac26da839f6f2a4c9a6e9673c3550320f83b4e39bca98634575d2',successorSha256:'d75a155e27e960393028c06f733ddaf13d0f14de61979193047bdaaeb41c7eb9',applicationSourceCommit:c3ApplicationCommit});
const changes=Object.freeze([
 ['backend/src/services/onlineRuntimeWork.ts','c78d2af67a70c21d3ad76890c43e75e2785b7203eaeb990f1c0e0bf0c8b05350','cee87e75a52bd176e3ef69382415e5ff724f2a34f977e6a2f62d5c4c3b28a1eb'],
 ['tests/online-deployment/application-native.worker.ts','50dcb1882130fa934a3f5724d8b9eb9e5be8f5274ea79ecd7e16fa0479d11340','acfe3db2c8110e4cae2a5093f15e72b8b338f5ac0ee87188d2f8a86fe5d3ca54'],
 ['tests/online-deployment/support-staged-http-native.fixture.ts','7605d709c1c9002c077c2496b9f59dedfd13a35837b8e00a5fbbfba55a35198f','1a9692c231c127ea51276bff289dc052f6926ec2a2fa58a3b09baf3c6221879d'],
].map(Object.freeze));
/** Pure packaging/test seam: exact byte transform only, no source approval. */
export function renderExactC3ReadonlyProtocolSource(base){
 assert.ok(Buffer.isBuffer(base));assert.equal(sha(base),c3ReadonlyProtocolSuccessor.baseSha256,'C3_READONLY_BASE_ISSUER_CHANGED');let source=base.toString('utf8');
 for(const [name,before,after]of changes){const old="    '"+name+"': '"+before+"',",next="    '"+name+"': '"+after+"',";assert.equal(source.split(old).length-1,1);source=source.replace(old,next);}
 const raw=Buffer.from(source);assert.equal(sha(raw),c3ReadonlyProtocolSuccessor.successorSha256,'C3_READONLY_SUCCESSOR_CHANGED');return raw;
}
/** Actual runner selection requires the same fully revalidated frozen C3
 * descriptor, rather than a caller boolean or an accept-current hash. */
export function readFrozenC3ReadonlyProtocolSource({root,operationsSourceReuse,base}){
 assert.equal(operationsSourceReuse?.applicationSourceCommit,c3ApplicationCommit,'C3_READONLY_EXACT_APPLICATION_REQUIRED');revalidateC3OperationsSourceReuse(root,operationsSourceReuse);return renderExactC3ReadonlyProtocolSource(base);
}
