import assert from 'node:assert/strict';
import path from 'node:path';
import {createPublicKey,verify} from 'node:crypto';
export function verifyInstalledPrivateChromeEnvelope(value,{publicKey,session,root,mainHost,candidateHost}){
 return verifyPrivateChrome(value,{publicKey,session,root,mainHost,candidateHost},'PRIVATE_CHROME_READY','private-chrome');
}
export function verifyInstalledPrivateLegacyChromeEnvelope(value,{publicKey,session,root,mainHost,candidateHost}){
 return verifyPrivateChrome(value,{publicKey,session,root,mainHost,candidateHost},'PRIVATE_LEGACY_CHROME_READY','legacy-private-chrome');
}
function verifyPrivateChrome(value,{publicKey,session,root,mainHost,candidateHost},command,profile){
 assert.equal(value.publicKey,publicKey);assert.equal(value.session,session);assert.match(session,/^[a-f0-9]{64}$/);
 const key=Buffer.from(publicKey,'base64');assert.equal(key.length,44);assert.equal(key.subarray(0,12).toString('hex'),'302a300506032b6570032100');const frame=value.envelope;
 assert.equal(frame.format,'sabalan-original-host-controller/v1');assert.equal(frame.role,'main');assert.equal(frame.command,command);assert.equal(frame.session,session);assert.ok(Number.isSafeInteger(frame.sequence)&&frame.sequence>0);
 assert.ok(typeof frame.payload==='string'&&frame.payload.length<65536);const preimage=Buffer.from([frame.format,frame.session,frame.role,String(frame.sequence),frame.command,frame.payload].join('\0'),'ascii');assert.equal(verify(null,preimage,createPublicKey({key,type:'spki',format:'der'}),Buffer.from(frame.signature,'base64')),true);
 const body=JSON.parse(Buffer.from(frame.payload,'base64').toString());assert.equal(body.host,candidateHost);assert.equal(body.profile,path.posix.join(root,'candidate-original-controller',profile,'profile'));assert.equal(body.browserOrigin,'http://localhost:3199');assert.match(body.controllerId,/^[a-f0-9]{64}$/);assert.match(body.actorId,/^[a-f0-9]{64}$/);
 const endpoint=new URL(body.browserWSEndpoint);assert.equal(endpoint.protocol,'ws:');assert.equal(endpoint.hostname,candidateHost);assert.ok(Number(endpoint.port)>=1024&&Number(endpoint.port)<=65535);assert.equal(endpoint.username+endpoint.password+endpoint.search+endpoint.hash,'');assert.match(endpoint.pathname,/^\/[a-f0-9]{64}\/devtools\/browser\/[a-f0-9-]{36}$/);
 for(const [pid,birth]of [[body.originalChromePid,body.birth],[body.ingress.originalIngressPid,body.ingress.birth],[body.proxy.originalProxyPid,body.proxy.birth]]){assert.equal(pid,birth.pid);assert.ok(Number.isSafeInteger(pid)&&pid>1);assert.match(birth.startTicks,/^[1-9][0-9]*$/);assert.match(birth.pidNamespace,/^pid:\[\d+\]$/);assert.match(birth.bootId,/^[a-f0-9-]{36}$/);}
 assert.equal(body.ingress.host,'127.0.0.1');assert.equal(body.ingress.port,3199);assert.equal(body.ingress.targetHost,mainHost);assert.equal(body.ingress.targetPort,3199);assert.equal(body.proxy.endpoint,body.browserWSEndpoint);assert.match(body.proxy.configSha256,/^[a-f0-9]{64}$/);
 return body;
}
