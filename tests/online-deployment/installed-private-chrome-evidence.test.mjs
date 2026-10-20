import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyInstalledPrivateChromeEnvelope,verifyInstalledPrivateLegacyChromeEnvelope} from './installed-private-chrome-evidence.fixture.mjs';
function fixture(legacy=false){
 const {privateKey,publicKey:key}=generateKeyPairSync('ed25519'),publicKey=key.export({format:'der',type:'spki'}).toString('base64'),session='a'.repeat(64),root='/app/online-runtime-acceptance/application-native-'+'b'.repeat(32),mainHost='172.18.0.10',candidateHost='172.18.0.9';
 const birth=pid=>({pid,startTicks:'12345',pidNamespace:'pid:[123]',bootId:'12345678-1234-1234-1234-123456789abc'}),endpoint='ws://'+candidateHost+':4567/'+'c'.repeat(64)+'/devtools/browser/12345678-1234-1234-1234-123456789abc';
 const body={host:candidateHost,profile:root+'/candidate-original-controller/'+(legacy?'legacy-private-chrome':'private-chrome')+'/profile',browserOrigin:'http://localhost:3199',controllerId:'d'.repeat(64),actorId:'e'.repeat(64),originalChromePid:100,birth:birth(100),browserWSEndpoint:endpoint,ingress:{originalIngressPid:101,birth:birth(101),host:'127.0.0.1',port:3199,targetHost:mainHost,targetPort:3199},proxy:{originalProxyPid:102,birth:birth(102),endpoint,configSha256:'f'.repeat(64)}};
 const frame={format:'sabalan-original-host-controller/v1',role:'main',command:legacy?'PRIVATE_LEGACY_CHROME_READY':'PRIVATE_CHROME_READY',session,sequence:1,payload:Buffer.from(JSON.stringify(body)).toString('base64')};
 frame.signature=sign(null,Buffer.from([frame.format,frame.session,frame.role,String(frame.sequence),frame.command,frame.payload].join('\0'),'ascii'),privateKey).toString('base64');
 return{value:{publicKey,session,envelope:frame},expected:{publicKey,session,root,mainHost,candidateHost},body};
}
test('real Ed25519 receipt verifies only exact original private Chrome topology',()=>{const {value,expected,body}=fixture();assert.deepEqual(verifyInstalledPrivateChromeEnvelope(value,expected),body);});
test('tampered unsigned payload and other original session cannot authorize Chrome',()=>{const {value,expected}=fixture();value.envelope.payload=Buffer.from('{}').toString('base64');assert.throws(()=>verifyInstalledPrivateChromeEnvelope(value,expected));const fresh=fixture();assert.throws(()=>verifyInstalledPrivateChromeEnvelope(fresh.value,{...fresh.expected,session:'0'.repeat(64)}));});
test('valid signature cannot relabel its original target or private profile root',()=>{const {value,expected}=fixture();assert.throws(()=>verifyInstalledPrivateChromeEnvelope(value,{...expected,mainHost:'172.18.0.11'}));assert.throws(()=>verifyInstalledPrivateChromeEnvelope(value,{...expected,root:expected.root+'-different'}));});
test('a current Chrome grant cannot be replayed as the distinct original legacy round',()=>{const old=fixture(),legacy=fixture(true);assert.deepEqual(verifyInstalledPrivateLegacyChromeEnvelope(legacy.value,legacy.expected),legacy.body);assert.throws(()=>verifyInstalledPrivateLegacyChromeEnvelope(old.value,old.expected));assert.throws(()=>verifyInstalledPrivateChromeEnvelope(legacy.value,legacy.expected));});
